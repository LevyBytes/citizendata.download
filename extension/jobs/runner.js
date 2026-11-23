(function initializeCitizenDataRunner(root, factory) {
  "use strict";

  const api = factory(root.CitizenDataAuthorization, root.CitizenDataDatabase, root.CITIZENDATA_REQUEST_PACING, root.CitizenDataPaceController, root.CitizenDataPaceHistory);
  root.CitizenDataRunner = api;
  if (typeof module === "object" && module?.exports) module.exports = factory(require("../shared/authorization.js"), require("../storage/database.js"), require("../shared/request-pacing-settings.js").settings, require("../shared/pace-controller.js"), require("../shared/pace-history.js"));
})(globalThis, function createCitizenDataRunner(Authorization, Database, Pacing, PaceController, PaceHistory) {
  "use strict";

  // The request pacing settings, the pace controller and the pace history (shared/) load before this file.
  if (!Pacing) throw new Error("request-pacing-settings.js must load before runner.js.");
  if (!PaceController || !PaceHistory) throw new Error("pace-controller.js and pace-history.js must load before runner.js.");

  // `partial`: a run that ended with a section set aside (§10.3).
  const TERMINAL = new Set(["cancelled", "failed", "complete", "partial"]);
  const MAXIMUM_REQUESTS_PER_JOB = 4096;
  const MAXIMUM_REQUESTS_PER_SECTION = 2048;
  // The baseline pace: the lowest account section interval, and the largest jitter a section has at it.
  const BASELINE_INTERVAL_MS = Math.min(...Object.values(Pacing.accountBuild.sections).map((section) => section.intervalMs));
  const MAXIMUM_BASELINE_JITTER_MS = Math.max(...Object.values(Pacing.accountBuild.sections).map((section) => section.jitterMs ?? 0));
  const ACTIVITY_LIMIT = 20;
  // The separate allowances of actual requests (§7.13). Each has its own counter; none borrows from another.
  // Appends activities to a job's log, each numbered by the job's own sequence (§12.5). The sequence goes on from the
  // highest of the stored sequence and the numbers the log holds, so a job stored before the sequence, or a log
  // carried into a continuation, is never numbered again from below.
  function appendActivities(job, entries) {
    let sequence = activitySequenceOf(job);
    const numbered = entries.map((entry) => {
      sequence += 1;
      return { ...entry, seq: sequence };
    });
    return { activityLog: [...(job.activityLog ?? []), ...numbered].slice(-ACTIVITY_LIMIT), activitySequence: sequence };
  }

  function activitySequenceOf(job) {
    const stored = Number.isSafeInteger(job.activitySequence) && job.activitySequence > 0 ? job.activitySequence : 0;
    return (Array.isArray(job.activityLog) ? job.activityLog : []).reduce((highest, entry) => Math.max(highest, Number.isSafeInteger(entry?.seq) ? entry.seq : 0), stored);
  }

  const REQUEST_ALLOWANCES = Object.freeze(["baseline", "retries", "canaryAndSessionChecks", "probes", "statusChecks"]);

  function emptyAllowanceCounts() {
    return Object.fromEntries(REQUEST_ALLOWANCES.map((name) => [name, 0]));
  }

  const isCount = (value) => Number.isSafeInteger(value) && value >= 0;
  const isPlainRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

  // Null when `value` names every allowance once, each a finite count of at least 0; otherwise what is wrong.
  function allowancesProblem(value, name) {
    if (!isPlainRecord(value)) return `${name} is not a set of allowances.`;
    const unknown = Object.keys(value).find((key) => !REQUEST_ALLOWANCES.includes(key));
    if (unknown !== undefined) return `${name} names an unknown allowance.`;
    const wrong = REQUEST_ALLOWANCES.find((key) => !isCount(value[key]));
    return wrong === undefined ? null : `${name}.${wrong} is missing or not a whole number of at least 0.`;
  }

  // Null when a job's request counters (§7.13) are whole numbers of at least 0, with every allowance counted;
  // otherwise what is wrong. The message names fields only, never a stored value.
  function requestCountersProblem(job) {
    if (!isCount(job.actualRequestCount)) return "actualRequestCount is missing or not a whole number of at least 0.";
    const byAllowance = allowancesProblem(job.actualRequestsByAllowance, "actualRequestsByAllowance");
    if (byAllowance) return byAllowance;
    if (!isPlainRecord(job.actualRequestsBySection) || !Object.values(job.actualRequestsBySection).every(isCount)) return "actualRequestsBySection holds a count that is not a whole number of at least 0.";
    if (job.retriedHttpRequestCount !== undefined && !isCount(job.retriedHttpRequestCount)) return "retriedHttpRequestCount is not a whole number of at least 0.";
    return allowancesProblem(job.maximumActualRequests, "maximumActualRequests");
  }
  // The most requests one logical step sends: the CCU step's five, one after another.
  const MAXIMUM_REQUESTS_PER_STEP = 5;
  const REFUSAL_KINDS = new Set(["limit", "transient", "ambiguous"]);
  const IDENTIFY_ROUTE = "/api/spectrum/auth/identify";
  // The sections that read the billing page (D23).
  const BILLING_SECTIONS = new Set(["financial.balances", "financial.billingTotal", "financial.orders", "financial.subscriptions"]);
  // Billing page 1 as the client read it, kept with the run's stored pages until the run's pages are deleted (§7.3, D23).
  const KEPT_BILLING_SECTION = "kept.billingPage1";
  // The fixed message of each code a run stops with for the time being (§7.4).
  const STOP_MESSAGES = Object.freeze({
    RSI_RATE_LIMITED: "RSI kept refusing requests.",
    RUN_LIFETIME_REACHED: "The run reached its time limit.",
    RSI_SIGNED_OUT: "The RSI session is signed out.",
    RSI_ACCOUNT_CHANGED: "A different RSI account is signed in.",
    RSI_CHECK_IN_BROWSER: "RSI asks for a check in the browser."
  });
  // The user's matters, by the signal's reason (§7.6).
  const USER_STOP_CODES = Object.freeze({ "signed-out": "RSI_SIGNED_OUT", "account-changed": "RSI_ACCOUNT_CHANGED", "check-in-browser": "RSI_CHECK_IN_BROWSER" });

  // The fixed route of a request family: the dossier's address names the account, so its handle is left out.
  function routeTemplate(route) {
    return /^\/en\/citizens\/[^/]+$/u.test(route) ? "/en/citizens/{handle}" : route;
  }

  // JSON with object keys sorted, as the settings fingerprint is written (§4.7).
  function canonicalJson(value) {
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
    if (value !== null && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
    return JSON.stringify(value);
  }

  function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  }

  function safeRequestStartedActivity(value) {
    if (value?.kind !== "request-started" || !["GET", "POST"].includes(value.method)
      || typeof value.route !== "string" || !/^\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]{1,200}$/u.test(value.route)
      || value.page !== null && (!Number.isSafeInteger(value.page) || value.page < 1)
      || value.pageCount !== null && (!Number.isSafeInteger(value.pageCount) || value.pageCount < 1)
      || typeof value.at !== "string" || Number.isNaN(Date.parse(value.at))) return null;
    return {
      kind: "request-started",
      method: value.method,
      route: value.route,
      page: value.page,
      pageCount: value.pageCount,
      at: value.at
    };
  }

  const SAFE_ROUTE = /^\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]{1,200}$/u;

  function nullableCount(value, minimum = 0) {
    return value === null || Number.isSafeInteger(value) && value >= minimum;
  }

  // A request line of a step, with every field bounded; null when any field is out of its shape.
  function safeRequestCompletedActivity(value) {
    if (value?.kind !== "request-completed" || !["GET", "POST"].includes(value.method) || typeof value.route !== "string" || !SAFE_ROUTE.test(value.route)
      || !nullableCount(value.page, 1) || !nullableCount(value.pageCount, 1) || !Number.isSafeInteger(value.responseStatus) || value.responseStatus < 100 || value.responseStatus > 599
      || !nullableCount(value.recordsReceived ?? null) || !nullableCount(value.recordsTotal ?? null) || !nullableCount(value.retryAfterMs ?? null)
      || !nullableCount(value.elapsedMs ?? null) || typeof value.at !== "string" || Number.isNaN(Date.parse(value.at))) return null;
    return {
      kind: "request-completed",
      method: value.method,
      route: value.route,
      page: value.page,
      pageCount: value.pageCount,
      responseStatus: value.responseStatus,
      recordsReceived: value.recordsReceived ?? null,
      recordsTotal: value.recordsTotal ?? null,
      retryAfterMs: value.retryAfterMs ?? null,
      elapsedMs: value.elapsedMs ?? null,
      at: value.at
    };
  }

  // A request that timed out or failed on the network (§5.5).
  function safeRequestFailedActivity(value) {
    if (value?.kind !== "request-failed" || !["GET", "POST"].includes(value.method) || typeof value.route !== "string" || !SAFE_ROUTE.test(value.route)
      || !nullableCount(value.page, 1) || !["TIMEOUT", "NETWORK"].includes(value.error) || !nullableCount(value.elapsedMs ?? null)
      || typeof value.at !== "string" || Number.isNaN(Date.parse(value.at))) return null;
    return { kind: "request-failed", method: value.method, route: value.route, page: value.page, error: value.error, elapsedMs: value.elapsedMs ?? null, at: value.at };
  }

  // The request lines of a step that may enter the activity log: completed and failed requests, each validated.
  // A smart-check line (§8.2, §9): the request without cookies or the status feed, and what it gave.
  const SMART_CHECK_OUTCOMES = Object.freeze({ "public-page": ["answered", "refused", "failed"], "status-page": ["ok", "issue", "unknown"] });
  function safeSmartCheckActivity(value) {
    if (value?.kind !== "smart-check" || typeof value.at !== "string" || Number.isNaN(Date.parse(value.at))) return null;
    if (typeof value.section !== "string" || !/^[A-Za-z0-9._-]{1,120}$/u.test(value.section)) return null;
    if (!Object.hasOwn(SMART_CHECK_OUTCOMES, value.check) || !SMART_CHECK_OUTCOMES[value.check].includes(value.outcome)) return null;
    const httpStatus = Number.isSafeInteger(value.httpStatus) && value.httpStatus >= 100 && value.httpStatus <= 599 ? value.httpStatus : null;
    return { kind: "smart-check", at: value.at, section: value.section, check: value.check, outcome: value.outcome, httpStatus };
  }

  function safeRequestActivities(values) {
    // Lines of a refused attempt are written by the runner itself; the adapter's lines are its requests.
    return (Array.isArray(values) ? values : []).flatMap((value) => {
      const safe = value?.kind === "request-completed" ? safeRequestCompletedActivity(value) : value?.kind === "request-failed" ? safeRequestFailedActivity(value) : value?.kind === "smart-check" ? safeSmartCheckActivity(value) : null;
      return safe ? [safe] : [];
    });
  }

  // A signal as an activity line shows it: its class, code, status and wait, the request it answered, never RSI's
  // message.
  function safeSignal(value) {
    if (!value || !["limit", "transient", "ambiguous", "user", "contract"].includes(value.kind) || typeof value.code !== "string" || !/^[A-Z0-9_]{1,80}$/u.test(value.code)) return null;
    const route = typeof value.route === "string" && SAFE_ROUTE.test(value.route) ? value.route : null;
    return {
      kind: value.kind,
      code: value.code,
      httpStatus: Number.isSafeInteger(value.httpStatus) && value.httpStatus >= 100 && value.httpStatus <= 599 ? value.httpStatus : null,
      retryAfterMs: Number.isSafeInteger(value.retryAfterMs) && value.retryAfterMs >= 0 ? value.retryAfterMs : null,
      method: value.method === "GET" || value.method === "POST" ? value.method : null,
      route,
      page: Number.isSafeInteger(value.page) && value.page > 0 ? value.page : null,
      fromCanary: value.fromCanary === true
    };
  }

  // A refused attempt's line: a free retry (rule 8) or a refusal with its wait, factor and attempt (§7.4).
  function safePaceActivity(value) {
    if (!value || !["free-retry", "rate-limited"].includes(value.kind) || typeof value.at !== "string" || Number.isNaN(Date.parse(value.at))) return null;
    if (typeof value.section !== "string" || !/^[A-Za-z0-9._-]{1,120}$/u.test(value.section)) return null;
    const signal = safeSignal(value.signal);
    if (!signal || !Number.isSafeInteger(value.waitMs) || value.waitMs < 0 || value.waitMs > 86400000) return null;
    const line = { kind: value.kind, at: value.at, section: value.section, signal, waitMs: value.waitMs };
    if (value.kind === "free-retry") return line;
    if (typeof value.factor !== "number" || !Number.isFinite(value.factor) || value.factor < 1 || !Number.isSafeInteger(value.attempt) || value.attempt < 1) return null;
    return { ...line, factor: Math.round(value.factor * 1000) / 1000, attempt: value.attempt };
  }

  const MAXIMUM_CONTRACT_FINDINGS = 100;

  // The staged run's contract findings with one more, each finding once by its key, the newest kept.
  function withContractFinding(findings, finding) {
    if (!finding || typeof finding.findingKey !== "string" || !/^[a-f0-9]{64}$/u.test(finding.findingKey)) return findings ?? [];
    return [...(findings ?? []).filter((entry) => entry?.findingKey !== finding.findingKey), clone(finding)].slice(-MAXIMUM_CONTRACT_FINDINGS);
  }

  function merge(target, patch) {
    if (patch === undefined) return clone(target);
    if (patch === null || typeof patch !== "object" || Array.isArray(patch)) return clone(patch);
    const output = target && typeof target === "object" && !Array.isArray(target) ? clone(target) : {};
    for (const [key, value] of Object.entries(patch)) output[key] = merge(output[key], value);
    return output;
  }

  function valueAt(document, section) {
    let value = document;
    for (const segment of section.split(".")) value = value?.[segment];
    return value;
  }

  function without(record, key) {
    const output = { ...(record ?? {}) };
    delete output[key];
    return output;
  }

  async function sha256Hex(text) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  function createJob(input) {
    const now = input.now ?? new Date().toISOString();
    return {
      jobId: input.jobId,
      runId: input.runId,
      // Names the stored pages of this collection. A continuation keeps the identifier of the run it continues.
      collectionId: input.collectionId ?? input.runId,
      accountId: input.accountId,
      authorizationId: input.authorizationId,
      localAccountId: input.localAccountId ?? null,
      organizationMemberAuthorization: clone(input.organizationMemberAuthorization ?? null),
      status: "running",
      mode: input.mode ?? "baseline",
      plan: clone(input.plan),
      sectionIndex: 0,
      // The position in each unfinished section. It holds no collected rows; those are in the page store.
      cursorBySection: {},
      // How many steps of each unfinished section have a stored page.
      storedStepsBySection: {},
      recordsBySection: {},
      requestsBySection: {},
      httpRequestsBySection: {},
      requestProgressBySection: {},
      requestTotalsBySection: {},
      resolvedRequestTotalsForSections: 0,
      httpRequestsTotal: null,
      nextEligibleAt: now,
      requestCount: 0,
      httpRequestCount: 0,
      lastActivity: null,
      activityLog: [],
      activitySequence: 0,
      updateSignals: {},
      accountVerifiedAt: null,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      failure: null,
      warnings: [],
      // The pace of this run (shared/pace-controller.js). Every run starts slower than the fastest baseline (§6.4,
      // rule 1); no pace is carried over from another run.
      pace: PaceController.initialPace(Pacing),
      // A request slot kept for a later invocation of the worker (§6.3), or null.
      pendingStep: null,
      // Every request actually sent, retries, canaries, probes and status checks included (§7.13). The step caps above
      // count logical steps; these bound what is sent. The maximum comes from the plan and the adapters, and is set
      // by the runner before the first request.
      actualRequestCount: 0,
      actualRequestsBySection: {},
      actualRequestsByAllowance: emptyAllowanceCounts(),
      maximumActualRequests: clone(input.maximumActualRequests ?? null),
      retriedHttpRequestCount: 0,
      // This run's record in the retained pace history (shared/pace-history.js).
      paceHistory: { historyKey: PaceHistory.runKey(input.runId), settingsFingerprint: input.settingsFingerprint ?? null }
    };
  }

  function replaceResults(results, parserResults) {
    const next = [...(results ?? [])];
    for (const parsed of parserResults) {
      const existing = next.findIndex((value) => value.section === parsed.section);
      if (existing >= 0) next[existing] = parsed;
      else next.push(parsed);
    }
    return next;
  }

  function createSerialRunner(options) {
    const repository = options.repository;
    const registry = options.registry;
    const nowMs = options.nowMs ?? (() => Date.now());
    const random = options.random ?? Math.random;
    // Called when a job becomes runnable again (resume), so the host can start its loop and watchdog.
    const schedule = options.schedule ?? (async () => {});
    const sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    const onStatus = options.onStatus ?? (async () => {});
    // Told the time a waiting job's status refresh is due, or null when none is, so the host can keep it across worker
    // restarts (§7.5).
    const onStatusRefresh = options.onStatusRefresh ?? (async () => {});
    const assembleDocument = options.assembleDocument;
    // Decides what the build history gains and loses when a finished build replaces the saved one. Optional.
    const planHistory = options.planHistory ?? null;
    const resultSectionsForJob = options.resultSectionsForJob ?? ((section) => [section]);
    const digest = options.digest ?? sha256Hex;
    const locks = new Set();
    const loops = new Map();
    const wakeRequests = new Set();
    let jobWrites = Promise.resolve();
    // The section being collected: what it has gathered so far and what the saved backup holds for it. It lives in
    // this worker's memory only. A worker that starts over rebuilds it from the stored pages and the saved backup.
    let memory = null;
    // The saved backup an update compares against. Sections that end in one step share one read of it. It is let go
    // as soon as a section needs a second step, so it is not held while a long section gathers its rows.
    let savedBackup = null;

    function adapterFor(section) {
      if (typeof registry?.getAdapter === "function") return registry.getAdapter(section);
      return registry?.adapters?.find((adapter) => adapter.section === section) ?? null;
    }

    // Every read-then-write of a job record goes through this queue, so a control change and a step save cannot overwrite each other.
    function exclusive(operation) {
      const result = jobWrites.then(operation);
      jobWrites = result.catch(() => {});
      return result;
    }

    // What a control request writes to the stored job while a step is in flight: its status, and the sections the
    // user asked to skip. A step that saves its own progress keeps both.
    // What the stored record owns over a copy being written: the status, the sections to skip, and what a status-feed
    // read added meanwhile (§7.5): the newer status page, its smart-check line, and the diagnostic requests reserved.
    function controlled(stored, next = null) {
      const owned = { status: stored.status, ...(Array.isArray(stored.skipSections) ? { skipSections: stored.skipSections } : {}) };
      if (!next) return owned;
      const kept = {};
      const storedPage = stored.pace?.statusPage ?? null;
      if (next.pace && storedPage && !(Date.parse(next.pace.statusPage?.checkedAt) >= Date.parse(storedPage.checkedAt))) {
        kept.pace = { ...next.pace, statusPage: storedPage };
      }
      Object.assign(kept, keepMergedLines(stored, next));
      const reserved = {};
      for (const name of ["probes", "statusChecks"]) {
        const more = (stored.actualRequestsByAllowance?.[name] ?? 0) - (next.actualRequestsByAllowance?.[name] ?? 0);
        if (more > 0) reserved[name] = more;
      }
      if (Object.keys(reserved).length > 0) {
        kept.actualRequestsByAllowance = { ...next.actualRequestsByAllowance, ...Object.fromEntries(Object.entries(reserved).map(([name, more]) => [name, (next.actualRequestsByAllowance?.[name] ?? 0) + more])) };
        kept.actualRequestCount = (next.actualRequestCount ?? 0) + Object.values(reserved).reduce((total, more) => total + more, 0);
      }
      return { ...kept, ...owned };
    }

    // The smart-check lines a status merge stored after this copy was read keep their numbers; this copy's own new lines
    // are numbered after them. The lines both hold are the common start; without one nothing is changed.
    function keepMergedLines(stored, next) {
      const key = (line) => JSON.stringify(line);
      const storedKeys = new Set((stored.activityLog ?? []).map(key));
      const nextKeys = new Set((next.activityLog ?? []).map(key));
      const common = (next.activityLog ?? []).filter((line) => storedKeys.has(key(line)));
      if (common.length === 0) return {};
      const base = Math.max(...common.map((line) => line.seq ?? 0));
      const merged = (stored.activityLog ?? []).filter((line) => line.kind === "smart-check" && line.seq > base && !nextKeys.has(key(line)));
      if (merged.length === 0) return {};
      let sequence = Math.max(activitySequenceOf(stored), ...merged.map((line) => line.seq));
      const own = (next.activityLog ?? []).filter((line) => line.seq > base && !storedKeys.has(key(line))).map((line) => {
        sequence += 1;
        return { ...line, seq: sequence };
      });
      const earlier = (next.activityLog ?? []).filter((line) => line.seq <= base);
      return { activityLog: [...earlier, ...merged, ...own].slice(-ACTIVITY_LIMIT), activitySequence: sequence };
    }

    // The most requests of an allowance a job may send: the job's bound, and the authorization's when it names one.
    // Both are checked counts before the first request of a tick (normalizeStoredState, checkedAuthorizationBounds);
    // a bound that is not a count is none at all, never an unlimited one.
    function allowanceBound(job, authorization, allowance) {
      const own = job.maximumActualRequests?.[allowance];
      const authorized = authorization?.maximumActualRequests?.[allowance] ?? own;
      return isCount(own) && isCount(authorized) ? Math.min(own, authorized) : 0;
    }

    // Whether a request of an allowance may still be sent.
    function allowanceLeft(job, authorization, allowance) {
      return (job.actualRequestsByAllowance?.[allowance] ?? 0) < allowanceBound(job, authorization, allowance);
    }

    function reserveRequests(job, allowances) {
      const counts = { ...(job.actualRequestsByAllowance ?? {}) };
      for (const allowance of allowances) counts[allowance] = (counts[allowance] ?? 0) + 1;
      return { ...job, actualRequestCount: (job.actualRequestCount ?? 0) + allowances.length, actualRequestsByAllowance: counts };
    }

    // RSI's status feed while a warning shows (§7.5): read when no result as recent as the cache period is stored, and
    // never while one read of this job is under way. Its request is reserved first. The read does not hold up a wait or
    // a step; the repository merges its result into the stored job, which the runner's next write keeps.
    const statusReads = new Set();
    // When this worker last set out to read the status feed for a job, so a read in flight or refused by its allowance
    // is not tried again before the next cache period.
    const statusAttempts = new Map();
    // A real status request reserves its allowance in the job transaction immediately before the checker fetches.
    // A cache hit or another worker's pending lease never calls this hook and therefore consumes no allowance.
    async function reserveStatusRequest(job, authorization) {
      const outcome = await exclusive(() => repository.updateRun({
        jobId: job.jobId,
        authorizationId: authorization?.authorizationId ?? null,
        decide: ({ job: stored, authorization: storedAuthorization }) => {
          const currentAuthorization = storedAuthorization ?? authorization;
          if (stored?.status !== "running" || !stored.pace?.warning || !allowanceLeft(stored, currentAuthorization, "statusChecks")) return { outcome: { reserved: false } };
          return { job: reserveRequests(stored, ["statusChecks"]), outcome: { reserved: true } };
        }
      }));
      return outcome?.reserved === true;
    }

    async function startStatusRead(job, adapter, authorization) {
      if (!job.pace?.warning || typeof adapter?.checkStatusPage !== "function" || typeof repository.mergeStatusPage !== "function" || statusReads.has(job.jobId)) return job;
      const checkedAtMs = Date.parse(job.pace.statusPage?.checkedAt);
      if (Number.isFinite(checkedAtMs) && nowMs() - checkedAtMs < Pacing.smartCheck.statusPageCacheMs) return job;
      statusAttempts.set(job.jobId, nowMs());
      if (!allowanceLeft(job, authorization, "statusChecks")) return job;
      statusReads.add(job.jobId);
      void Promise.resolve()
        .then(() => adapter.checkStatusPage({ beforeRequest: () => reserveStatusRequest(job, authorization) }))
        .then((statusPage) => repository.mergeStatusPage({
          jobId: job.jobId,
          runId: job.runId,
          statusPage,
          activity: safeSmartCheckActivity({ kind: "smart-check", at: statusPage?.checkedAt, section: job.plan.selectedSections[job.sectionIndex] ?? "run", check: "status-page", outcome: statusPage?.status, httpStatus: statusPage?.httpStatus }),
          activityLimit: ACTIVITY_LIMIT
        }))
        .catch(() => false)
        .finally(() => statusReads.delete(job.jobId));
      return job;
    }

    // When a job's status feed result is next due while its warning shows: one cache period after the later of the
    // stored result and this worker's last attempt; null without a warning.
    function statusRefreshDue(job) {
      if (!job.pace?.warning) return null;
      const last = Math.max(Date.parse(job.pace.statusPage?.checkedAt) || 0, statusAttempts.get(job.jobId) ?? 0);
      return last > 0 ? last + Pacing.smartCheck.statusPageCacheMs : nowMs();
    }

    // A job that waits for its next request slot (§7.5): while a warning shows, the status feed is read when it is due,
    // with no account request and no change to the slot. The job wakes at the earlier of the slot and the next status
    // refresh, which the host is told so a worker restart keeps it.
    async function waitWithStatusRefresh(job, eligibleAt) {
      let waiting = job;
      const adapter = adapterFor(job.plan.selectedSections[job.sectionIndex]);
      // Without a status reader there is no refresh to wake for.
      const canRead = typeof adapter?.checkStatusPage === "function" && typeof repository.mergeStatusPage === "function";
      const due = canRead ? statusRefreshDue(job) : null;
      if (due !== null && due <= nowMs()) {
        statusAttempts.set(job.jobId, nowMs());
        waiting = await startStatusRead(job, adapter, await repository.getAuthorization(job.authorizationId));
      }
      const next = canRead ? statusRefreshDue(waiting) : null;
      const refreshAt = next !== null && next < eligibleAt ? next : null;
      await onStatusRefresh({ jobId: job.jobId, at: refreshAt === null ? null : new Date(refreshAt).toISOString() });
      return { ok: true, waiting: true, eligibleAt: refreshAt ?? eligibleAt };
    }

    // The smart check at the give-up (§8.2, §9): one in-step wait after the last refused attempt, the account's public
    // dossier without cookies, then the status feed. Without the adapter's check, or past its allowances, there is no
    // diagnosis.
    async function smartCheck(job, adapter, authorization, section) {
      if (typeof adapter?.smartCheck !== "function" || !allowanceLeft(job, authorization, "probes")) return { job, diagnosis: null, lines: [] };
      await sleep(Pacing.brakes.maximumInStepWaitMs);
      const reserved = await saveStepStatus(reserveRequests(job, ["probes"]), "activity", {});
      if (TERMINAL.has(reserved.status)) return { job: reserved, diagnosis: null, lines: [] };
      try {
        const checked = await adapter.smartCheck({ handle: job.accountId, beforeStatusRequest: () => reserveStatusRequest(reserved, authorization) });
        const at = new Date(nowMs()).toISOString();
        const lines = [
          safeSmartCheckActivity({ kind: "smart-check", at, section, check: "public-page", outcome: checked?.probe?.probe, httpStatus: checked?.probe?.httpStatus }),
          safeSmartCheckActivity({ kind: "smart-check", at: checked?.status?.checkedAt ?? at, section, check: "status-page", outcome: checked?.status?.status, httpStatus: checked?.status?.httpStatus })
        ].filter(Boolean);
        return { job: await repository.getJob(job.jobId) ?? reserved, diagnosis: checked?.diagnosis ?? null, lines };
      } catch {
        return { job: reserved, diagnosis: null, lines: [] };
      }
    }

    // A pause, resume, cancel, or skip can arrive while a step is in flight. The step owns its progress fields; the
    // stored record owns the status. A cancelled job records nothing further.
    async function saveStepStatus(job, event, detail = {}) {
      const saved = await exclusive(async () => {
        const stored = await repository.getJob(job.jobId);
        if (stored && TERMINAL.has(stored.status)) return stored;
        const next = stored ? { ...job, ...controlled(stored, job) } : job;
        await repository.saveJob(next);
        return next;
      });
      if (!TERMINAL.has(saved.status)) await onStatus({ event, job: clone(saved), detail: clone(detail) });
      return saved;
    }

    function terminalRunReceipt(job, authorization, status, endedAt, pacing = null) {
      if (!authorization) return null;
      return {
        runId: job.runId,
        status,
        startedAt: job.createdAt,
        endedAt,
        selectedSections: [...job.plan.selectedSections],
        authorization: Authorization.runAuthorizationReceipt(authorization),
        organizationMemberAuthorization: clone(job.organizationMemberAuthorization ?? null),
        ...(pacing ? { pacing } : {})
      };
    }

    // The run's pacing summary for its receipt (§4.7), from the pace history records, or null without them.
    function pacingOf(records, job) {
      if (!job.paceHistory || !Array.isArray(records)) return null;
      return PaceHistory.runSummary(withRunHistory(records, job, (run) => run));
    }

    // The stored pages of an unfinished section, checked and decoded, or null when they cannot be trusted: a page is
    // missing, out of order, or no longer matches the SHA-256 taken when it was stored.
    async function storedPages(job, section, storedSteps) {
      const records = await repository.listPages(job.collectionId, section);
      if (records.length === 0 || records.at(-1).step !== storedSteps) return null;
      const pages = [];
      for (const [index, record] of records.entries()) {
        if (typeof record?.text !== "string" || record.pageKey !== Database.pageKey(job.collectionId, section, record.step)) return null;
        if (index === 0 ? record.step !== 1 && record.checkpoint !== true : record.step !== records[index - 1].step + 1) return null;
        if (await digest(record.text) !== record.sha256) return null;
        try {
          pages.push(JSON.parse(record.text));
        } catch {
          return null;
        }
      }
      return pages;
    }

    // The saved backup a build stands on: only one the extension collected. A build handed over from a file is read
    // again in full by the next build, which claims no record removed on its word; `held` is the backup as stored,
    // which the history keeps when this build replaces it.
    async function savedBackupFor(job) {
      if (savedBackup?.jobId !== job.jobId) {
        const held = await repository.getSnapshot(job.accountId) ?? null;
        savedBackup = { jobId: job.jobId, held, snapshot: held?.source === "collected" ? held : null };
      }
      return savedBackup.snapshot;
    }

    // The most steps a section may take. A section that reads a fixed number of records a step is bounded by its
    // record cap; every other section by the fixed limit.
    function stepLimitFor(job, section, adapter) {
      const perStep = adapter?.recordsPerStep;
      const cap = job.plan.maximumRecordsBySection?.[section];
      return Number.isSafeInteger(perStep) && perStep > 0 && Number.isSafeInteger(cap) ? Math.ceil(cap / perStep) + 8 : MAXIMUM_REQUESTS_PER_SECTION;
    }

    function jobStepLimit(job) {
      return job.plan.selectedSections.reduce((total, section) => {
        const adapter = adapterFor(section);
        return Number.isSafeInteger(adapter?.recordsPerStep) ? total + stepLimitFor(job, section, adapter) : total;
      }, MAXIMUM_REQUESTS_PER_JOB);
    }

    // The finished sections a section reads, by name: this run's result, or else the saved backup's.
    async function sectionInputsFor(job, adapter) {
      if (!Array.isArray(adapter.inputs) || adapter.inputs.length === 0) return null;
      const [staged, saved] = await Promise.all([repository.getStagedRun(job.runId), savedBackupFor(job)]);
      return Object.fromEntries(adapter.inputs.map((name) => {
        const result = (staged?.results ?? []).find((candidate) => candidate?.section === name && candidate.outcome?.status === "complete");
        return [name, (result ? result.value : saved?.document ? valueAt(saved.document, name) : null) ?? null];
      }));
    }

    async function previousSectionFor(job, section, adapter) {
      // A section that carries its records forward reads the saved backup in every kind of run.
      if (job.mode !== "update" && adapter.carriesForward !== true) return null;
      const previousSnapshot = await savedBackupFor(job);
      if (!previousSnapshot?.document) return null;
      const resultSections = resultSectionsForJob(section);
      const outcomes = Object.fromEntries(resultSections.map((resultSection) => [resultSection, previousSnapshot.document.sync?.sectionOutcomes?.[resultSection] ?? null]));
      return {
        // A section the saved backup holds completely, read by the extension, is the basis of an update. The
        // version number its reader carried is not compared: a new number alone never has data read again. A
        // section taken in without a reader, such as a roster from an Orgs JSON, is read in full.
        current: resultSections.every((resultSection) => outcomes[resultSection]?.status === "complete" && typeof outcomes[resultSection]?.parserVersion === "string" && outcomes[resultSection].parserVersion !== ""),
        // Only this section's values are kept; the rest of the saved backup is released again.
        values: Object.fromEntries(resultSections.map((resultSection) => [resultSection, valueAt(previousSnapshot.document, resultSection)])),
        outcomes,
        recordCount: resultSections.reduce((total, resultSection) => total + (Number.isSafeInteger(outcomes[resultSection]?.records) ? outcomes[resultSection].records : 0), 0)
      };
    }

    // What the worker needs to take the next step of `section`. `damaged` means the section has stored steps that
    // could not be read back, so it has to be collected again from its first page.
    async function sectionContext(job, section, adapter) {
      const storedSteps = job.storedStepsBySection?.[section] ?? 0;
      if (memory && memory.jobId === job.jobId && memory.section === section && memory.storedSteps === storedSteps) return memory;
      const context = { jobId: job.jobId, section, storedSteps, state: null, damaged: false, previousSection: await previousSectionFor(job, section, adapter), inputs: await sectionInputsFor(job, adapter) };
      if (storedSteps > 0) {
        const pages = typeof adapter.rebuildState === "function" ? await storedPages(job, section, storedSteps) : null;
        if (pages) context.state = await adapter.rebuildState({ section, pages });
        else context.damaged = true;
      }
      memory = context;
      return context;
    }

    // The unfinished section of a run that is stopping, normalized as far as it got. A run that fails keeps this in
    // its staged results so the partial backup and a later continuation have it.
    async function partialResultsFor(job) {
      const section = job.plan.selectedSections[job.sectionIndex];
      const storedSteps = section ? job.storedStepsBySection?.[section] ?? 0 : 0;
      if (!section || storedSteps === 0) return [];
      const adapter = adapterFor(section);
      if (typeof adapter?.partialResults !== "function") return [];
      const context = await sectionContext(job, section, adapter);
      if (context.damaged || !context.state) return [];
      const allowed = new Set(resultSectionsForJob(section));
      const results = await adapter.partialResults({ section, cursor: clone(job.cursorBySection?.[section] ?? null), sectionState: context.state });
      return (Array.isArray(results) ? results : []).filter((parsed) => parsed && allowed.has(parsed.section) && parsed.outcome);
    }

    // A job that was cancelled while its step was in flight stays cancelled. `detail` holds what RSI answered, and
    // `requestActivities` are the failed step's request lines, which the activity log keeps (F2).
    // The actual request allowances of a job (§7.13): the plan's steps at their most requests, and the separate
    // allowances of the settings for retries, canaries and session checks, probes and status checks.
    function allowanceMaximums(job) {
      const roster = job.plan.selectedSections.some((section) => section.startsWith("organizations.members."));
      return {
        baseline: jobStepLimit(job) * MAXIMUM_REQUESTS_PER_STEP,
        retries: roster ? Pacing.requestBounds.rosterRetries : Pacing.requestBounds.accountRetries,
        canaryAndSessionChecks: Pacing.requestBounds.canaryAndSessionChecks,
        probes: Pacing.requestBounds.probes,
        statusChecks: Pacing.requestBounds.statusChecks
      };
    }

    // A stored job's pace and pending slot are checked before any arithmetic or request (§6.2, §7.14). A job stored
    // before the pace controller gets the first pace once; a state this controller cannot read stops continuably.
    async function normalizeStoredState(job) {
      let next = job;
      if (next.pace === undefined) {
        next = {
          ...next,
          pace: PaceController.initialPace(Pacing),
          pendingStep: null,
          warnings: [...(next.warnings ?? []), "PACE_STATE_MIGRATED"]
        };
      }
      const invalid = PaceController.validatePaceState(next.pace, Pacing)
        ?? (next.pendingStep === undefined || next.pendingStep === null ? null : PaceController.validatePendingStep(next.pendingStep, Pacing));
      if (invalid) return { stopped: await stopContinuable(job, "PACE_STATE_INVALID", { message: invalid }, [], "The run's stored pace could not be read.") };
      if (next.pendingStep === undefined) next = { ...next, pendingStep: null };
      // A job stored before the request counters (§7.13) has none of them: it starts them at 0, and takes its
      // allowances from its plan. Counters or allowances that are present but out of shape stop the run continuably
      // before any request; nothing is reset or taken as unlimited.
      const counterFields = ["actualRequestCount", "actualRequestsBySection", "actualRequestsByAllowance"];
      if (counterFields.every((field) => next[field] === undefined)) {
        next = { ...next, actualRequestCount: 0, actualRequestsBySection: {}, actualRequestsByAllowance: emptyAllowanceCounts(), retriedHttpRequestCount: next.retriedHttpRequestCount ?? 0 };
      }
      if (next.maximumActualRequests === undefined || next.maximumActualRequests === null) next = { ...next, maximumActualRequests: allowanceMaximums(next) };
      const counters = requestCountersProblem(next);
      if (counters) return { stopped: await stopContinuable(job, "REQUEST_COUNTERS_INVALID", { message: counters }, [], "The run's stored request counts could not be read.") };
      if (!next.paceHistory) next = { ...next, paceHistory: { historyKey: PaceHistory.runKey(next.runId), settingsFingerprint: null } };
      if (!next.paceHistory.settingsFingerprint) next = { ...next, paceHistory: { ...next.paceHistory, settingsFingerprint: await digest(canonicalJson(Pacing)) } };
      if (next === job) return { job };
      const saved = await exclusive(async () => {
        const stored = await repository.getJob(job.jobId);
        if (stored && TERMINAL.has(stored.status)) return stored;
        const merged = stored ? { ...next, ...controlled(stored, next) } : next;
        await repository.saveJob(merged);
        return merged;
      });
      return { job: saved };
    }

    // This run's pace history after `change`: its record, started when the run has none yet.
    function withRunHistory(records, job, change) {
      const existing = (records ?? []).find((record) => record.historyKey === job.paceHistory.historyKey);
      const run = existing ?? PaceHistory.startRun({
        runId: job.runId,
        accountId: job.accountId,
        runKind: job.plan.selectedSections.some((section) => section.startsWith("organizations.members.")) ? "roster" : "account",
        settingsFingerprint: job.paceHistory.settingsFingerprint,
        settingsVersion: Pacing.version,
        startedAt: job.createdAt,
        startedFactor: PaceController.initialPace(Pacing).factor
      });
      return change(run);
    }

    // The attempts of a step's request lines: accepted answers, and the class of the one that ended a refused step.
    function recordLines(run, job, section, lines, signal = null, retried = false) {
      let next = run;
      const terminal = lines.filter((line) => line.kind === "request-completed" || line.kind === "request-failed");
      terminal.forEach((line, index) => {
        const requestFamily = PaceController.requestFamily(section, line.method, routeTemplate(line.route));
        const accepted = line.kind === "request-completed" && line.responseStatus >= 200 && line.responseStatus < 300 && !(signal && index === terminal.length - 1);
        const outcome = accepted ? "accepted" : signal?.kind ?? "ambiguous";
        next = PaceHistory.recordAttempt(next, { section, requestFamily, outcome, code: accepted ? "OK" : signal?.code ?? "RSI_READ_FAILED", httpStatus: line.kind === "request-completed" ? line.responseStatus : null, elapsedMs: line.elapsedMs ?? null, factor: job.pace.factor, retried }, Pacing);
        if (accepted) next = PaceHistory.recordAccepted(next, { requestFamily, elapsedMs: line.elapsedMs, factor: job.pace.factor, canary: line.route === IDENTIFY_ROUTE }, Pacing);
      });
      return next;
    }

    // The run's history record closed, and the runs past the detailed limit folded into the aggregates (§6.8).
    function closedHistory(records, job, endedAt) {
      const run = withRunHistory(records, job, (value) => value);
      const others = (records ?? []).filter((record) => record.historyKey !== run.historyKey);
      return PaceHistory.finishRun([...others, run], job.runId, { endedAt }, Pacing);
    }

    // A stop for the time being (§7.4): fail() with a fixed message and the detail kept, so Continue can follow.
    async function stopContinuable(job, code, detail, requestActivities = [], message = STOP_MESSAGES[code]) {
      return fail(job, code, message, detail, requestActivities);
    }

    async function fail(job, code, message, detail = null, requestActivities = [], finding = null) {
      const endedAt = new Date(nowMs()).toISOString();
      const lines = safeRequestActivities(requestActivities);
      const appended = lines.length ? appendActivities(job, lines) : null;
      const failed = { ...job, status: "failed", updatedAt: endedAt, completedAt: endedAt, pendingStep: null, ...(appended ? { ...appended, lastActivity: appended.activityLog.at(-1) } : {}), failure: { code, message, ...(detail ? { detail: clone(detail) } : {}) } };
      const pendingSection = job.pendingStep?.section ?? null;
      let partialResults = [];
      try {
        partialResults = clone(await partialResultsFor(job));
      } catch {
        // The failure is reported either way; the partial backup then holds the finished sections only.
        partialResults = [];
      }
      // The failed status, the unfinished section's rows, and the run receipt are stored together.
      const outcome = await exclusive(() => repository.updateRun({
        jobId: job.jobId,
        authorizationId: job.authorizationId,
        runId: job.runId,
        withStagedRun: true,
        withPaceHistory: Boolean(job.paceHistory),
        decide: ({ job: stored, authorization, stagedRun, paceHistory }) => {
          if (stored && TERMINAL.has(stored.status)) return { outcome: { superseded: stored } };
          const runReceipt = terminalRunReceipt(failed, authorization, "failed", endedAt, pacingOf(paceHistory, job));
          const history = job.paceHistory ? closedHistory(paceHistory, job, endedAt) : { put: [], remove: [] };
          return {
            job: failed,
            ...(pendingSection ? { removePageKeys: [Database.pendingPageKey(job.collectionId, pendingSection)] } : {}),
            paceHistory: history.put,
            removePaceHistory: history.remove,
            ...(stagedRun ? { stagedRun: { ...stagedRun, results: replaceResults(stagedRun.results, partialResults), ...(finding ? { contractFindings: withContractFinding(stagedRun.contractFindings, finding) } : {}), ...(runReceipt ? { runReceipt } : {}), status: "failed", updatedAt: endedAt } } : {}),
            outcome: {}
          };
        }
      }));
      if (outcome.superseded) return outcome.superseded;
      savedBackup = null;
      await onStatus({ event: "failed", job: clone(failed), detail: clone(failed.failure) });
      return failed;
    }

    async function complete(job) {
      const completedAt = new Date(nowMs()).toISOString();
      const completed = { ...job, status: "complete", updatedAt: completedAt, completedAt, cursorBySection: {}, storedStepsBySection: {} };
      if (typeof assembleDocument !== "function") throw new Error("A canonical document assembler is required before promotion.");
      const [authorization, staged, previousSnapshot] = await Promise.all([
        repository.getAuthorization(job.authorizationId),
        repository.getStagedRun(job.runId),
        savedBackupFor(job)
      ]);
      const heldSnapshot = savedBackup?.held ?? null;
      savedBackup = null;
      if (!staged) throw new Error("The staged run is no longer stored.");
      const paceRecords = job.paceHistory && typeof repository.listPaceHistory === "function" ? await repository.listPaceHistory() : null;
      const runReceipt = terminalRunReceipt(completed, authorization, "complete", completedAt, pacingOf(paceRecords, job));
      const assembled = await assembleDocument({
        job: clone(completed),
        authorization,
        staged: runReceipt ? { ...staged, runReceipt } : staged,
        previous: previousSnapshot?.document ?? null,
        completedAt
      });
      const document = assembled?.document ?? assembled;
      if (!document || typeof document !== "object" || Array.isArray(document)) throw new Error("The canonical document assembler returned an invalid account document.");
      const history = planHistory ? await planHistory({ accountId: job.accountId, previous: heldSnapshot?.document ?? null, document, completedAt }) : null;
      const paceHistory = paceRecords ? closedHistory(paceRecords, job, completedAt) : null;
      // Once the document is the saved backup, the staged results it was assembled from are not kept a second time.
      const { results: _results, document: _document, ...stagedRecord } = staged;
      // Promotion is the point of no return, so a pause or cancel that arrived during assembly is honored first.
      const interrupted = await exclusive(async () => {
        const stored = await repository.getJob(job.jobId);
        if (stored && stored.status !== "running") return stored;
        await repository.promoteRun({
          runId: job.runId,
          accountId: job.accountId,
          collectionId: job.collectionId,
          document,
          checkpoints: staged.checkpoints ?? [],
          stagedRun: { ...stagedRecord, updatedAt: completedAt },
          job: completed,
          history,
          ...(paceHistory ? { paceHistory } : {}),
          promotedAt: completedAt
        });
        return null;
      });
      if (interrupted) return interrupted;
      memory = null;
      if (authorization) await repository.saveAuthorization({ ...authorization, consumedAt: completedAt });
      await onStatus({ event: "complete", job: clone(completed), detail: { document } });
      return completed;
    }

    // The two rules that decide a class from the canary (§7.7): an unclear canary is a limit, and the same unclear
    // answer again right after a canary that answered normally is a changed contract.
    function classify(signal, canary, lastSignal) {
      if (!signal) return null;
      if (signal.fromCanary === true && signal.kind === "ambiguous") return { ...signal, kind: "limit" };
      if (canary && signal.fromCanary !== true && signal.kind === "ambiguous" && signal.code === lastSignal?.code) return { ...signal, kind: "contract" };
      return signal;
    }

    // A refused attempt (§7.4): rule 8's one free retry, or a refusal with its wait; past the threshold the run gives
    // up for the time being (§8), or stops before its authorization ends. No page, receipt or staged result is written.
    async function refusedAttempt({ job, section, signal, result, authorization, maxFactor, pendingKey, adapter }) {
      const at = new Date(nowMs()).toISOString();
      const free = PaceController.freeRetry(job.pace, signal, { nowMs: nowMs(), random, settings: Pacing });
      const refusal = free ? null : PaceController.onRefusal(job.pace, signal, { nowMs: nowMs(), random, settings: Pacing, maxFactor, expiresAtMs: Date.parse(authorization.expiresAt) });
      const lines = safeRequestActivities(result?.requestActivities);
      if (refusal?.action === "give-up") {
        const checked = await smartCheck({ ...job, pace: refusal.pace }, adapter, authorization, section);
        return { ok: false, job: await stopContinuable(checked.job, "RSI_RATE_LIMITED", { signal, diagnosis: checked.diagnosis }, [...lines, ...checked.lines]) };
      }
      if (refusal?.action === "lifetime") return { ok: false, job: await stopContinuable({ ...job, pace: refusal.pace }, "RUN_LIFETIME_REACHED", { signal }, lines) };
      const pace = free ? free.pace : refusal.pace;
      const waitMs = free ? free.waitMs : refusal.waitMs;
      const line = safePaceActivity(free
        ? { kind: "free-retry", at, section, signal, waitMs }
        : { kind: "rate-limited", at, section, signal, waitMs, factor: pace.factor, attempt: pace.attempt });
      const terminal = lines.filter((activity) => activity.kind === "request-completed" || activity.kind === "request-failed").length;
      const waiting = {
        ...job,
        pace,
        pendingStep: null,
        pendingContract: null,
        nextEligibleAt: pace.retryNotBefore,
        retriedHttpRequestCount: (job.retriedHttpRequestCount ?? 0) + terminal,
        ...appendActivities(job, [...lines, ...(line ? [line] : [])]),
        lastActivity: line ?? lines.at(-1) ?? job.lastActivity ?? null,
        updatedAt: at
      };
      const committed = await exclusive(() => repository.updateRun({
        jobId: job.jobId,
        authorizationId: job.authorizationId,
        runId: job.runId,
        withPaceHistory: true,
        decide: ({ job: stored, authorization: storedAuthorization, paceHistory }) => {
          if (stored && TERMINAL.has(stored.status)) return { outcome: { terminal: stored.status } };
          const lease = Authorization.touchAuthorization(storedAuthorization ?? authorization, nowMs());
          const next = stored ? { ...waiting, ...controlled(stored, waiting) } : waiting;
          return {
            job: next,
            ...(job.pendingStep ? { removePageKeys: [pendingKey] } : {}),
            paceHistory: [withRunHistory(paceHistory, job, (run) => recordLines(run, job, section, lines, signal, job.pace.attempt > 0))],
            ...(lease.ok ? { authorization: lease.value } : {}),
            outcome: { status: next.status, leaseCode: lease.ok ? null : lease.code }
          };
        }
      }));
      if (committed.terminal) return { ok: false, code: "JOB_TERMINAL", status: committed.terminal };
      const stored = { ...waiting, status: committed.status };
      if (committed.leaseCode) return { ok: false, job: await fail(stored, committed.leaseCode, "The one-run authorization could not renew its bounded idle lease.") };
      await onStatus({ event: "activity", job: clone(stored), detail: clone({ section, activity: line }) });
      return { ok: true, job: await startStatusRead(stored, adapter, authorization) };
    }

    // A step that stopped at a durable request slot (§6.3): its answers so far are kept as its checksummed pending
    // phase, apart from the canonical pages, and the next slot's time is stored with them. No receipt or staged result.
    async function storePendingPhase({ job, section, result, pending, pendingKey, authorization, logicalIntervalMs, logicalStaggerMs, logicalStartedAtMs, requestsInStep }) {
      const at = new Date(nowMs()).toISOString();
      const lines = safeRequestActivities(result.requestActivities);
      const text = JSON.stringify(result.pendingPhase.journal);
      const page = { pageKey: pendingKey, collectionId: job.collectionId, section, step: 0, pending: true, checkpoint: false, text, sha256: await digest(text), storedAt: at };
      // Every request that started counts, one that later failed too; the next slot is timed from the starts.
      const started = (pending?.requestsStarted ?? 0) + requestsInStep;
      const finished = (pending?.requestsFinished ?? 0) + lines.filter((line) => line.kind === "request-completed" || line.kind === "request-failed").length;
      const pendingStep = {
        version: 1,
        section,
        attemptId: pending?.attemptId ?? `step-${job.requestCount + 1}-${logicalStartedAtMs}`,
        phase: result.pendingPhase.phase,
        nextRequestAt: new Date(result.pendingPhase.nextRequestAtMs).toISOString(),
        logicalIntervalMs,
        logicalStaggerMs,
        requestsStarted: started,
        requestsFinished: finished
      };
      const waiting = {
        ...job,
        pendingStep,
        nextEligibleAt: pendingStep.nextRequestAt,
        ...appendActivities(job, lines),
        lastActivity: lines.at(-1) ?? job.lastActivity ?? null,
        updatedAt: at
      };
      const committed = await exclusive(() => repository.updateRun({
        jobId: job.jobId,
        authorizationId: job.authorizationId,
        runId: job.runId,
        withPaceHistory: true,
        decide: ({ job: stored, authorization: storedAuthorization, paceHistory }) => {
          if (stored && TERMINAL.has(stored.status)) return { outcome: { terminal: stored.status } };
          const lease = Authorization.touchAuthorization(storedAuthorization ?? authorization, nowMs());
          const next = stored ? { ...waiting, ...controlled(stored, waiting) } : waiting;
          return {
            job: next,
            page,
            paceHistory: [withRunHistory(paceHistory, job, (run) => recordLines(run, job, section, lines))],
            ...(lease.ok ? { authorization: lease.value } : {}),
            outcome: { status: next.status, leaseCode: lease.ok ? null : lease.code }
          };
        }
      }));
      if (committed.terminal) return { ok: false, code: "JOB_TERMINAL", status: committed.terminal };
      const stored = { ...waiting, status: committed.status };
      if (committed.leaseCode) return { ok: false, job: await fail(stored, committed.leaseCode, "The one-run authorization could not renew its bounded idle lease.") };
      return { ok: true, job: stored };
    }

    // A detected change of RSI's page as public status shows it (§10.6): at most 4, three sections set aside and a stop.
    const MAXIMUM_DETECTED_CHANGES = 4;
    function withDetectedChange(job, entry) {
      return [...(job.detectedChanges ?? []), entry].slice(-MAXIMUM_DETECTED_CHANGES);
    }

    // The later sections of the plan that read `section` and have no saved copy of it to read instead: in a first build,
    // a Buybacks list set aside leaves Buy-back prices and CCU buy-back prices nothing to read (§10.2). They are set
    // aside with it, and so are the sections that read those in turn.
    async function dependentSections(job, section) {
      const saved = await savedBackupFor(job);
      const setAside = new Set([section, ...(job.setAsideSections ?? []).map((entry) => entry.section)]);
      const dependents = [];
      for (const later of job.plan.selectedSections.slice(job.sectionIndex + 1)) {
        if (setAside.has(later)) continue;
        const inputs = adapterFor(later)?.inputs;
        if (!Array.isArray(inputs)) continue;
        const missing = inputs.some((name) => setAside.has(name) && (saved?.document ? valueAt(saved.document, name) : null) == null);
        if (!missing) continue;
        setAside.add(later);
        dependents.push(later);
      }
      return dependents;
    }

    // The sections set aside because a section they read was (§10.2) are passed over when the run reaches them.
    function passSetAside(job) {
      const setAside = new Set((job.setAsideSections ?? []).map((entry) => entry.section));
      let index = job.sectionIndex;
      while (index < job.plan.selectedSections.length && setAside.has(job.plan.selectedSections[index])) index += 1;
      return index === job.sectionIndex ? job : { ...job, sectionIndex: index };
    }

    // The end of a run: the ordinary promotion, or, with a section set aside, the partial result (§10.3).
    function finish(job) {
      return (job.setAsideSections ?? []).length > 0 ? completeWithOmissions(job) : complete(job);
    }

    // A `contract` answer (§10.1): the section is set aside, waits out the quiet period for one canary and one recheck,
    // or stops the run. Profile is never set aside, and at most `setAside.maximumSections` sections are, not counting
    // those set aside with INPUT_SET_ASIDE.
    // A changed page (§10.1), in the plan's order: a refusal in the last quiet period first holds the section for one
    // canary and one recheck at the period's end; otherwise, and at that recheck, Account identity or the limit of 3
    // stops the run; otherwise the section is set aside.
    async function contractChanged({ job, section, signal, result, authorization, pendingKey, nextEligibleAt }) {
      const at = new Date(nowMs()).toISOString();
      const finding = result?.contractFinding ?? null;
      const settings = Pacing.setAside;
      const counted = (job.setAsideSections ?? []).filter((entry) => entry.code !== "INPUT_SET_ASIDE").length;
      const lines = safeRequestActivities(result?.requestActivities);
      const refusalAtMs = Date.parse(job.pace.lastRefusalAt);
      const quiet = !Number.isFinite(refusalAtMs) || nowMs() - refusalAtMs >= settings.quietMs;
      const recheck = job.pendingContract?.section === section && job.pendingContract.signal?.code === signal.code;
      if (!quiet && !recheck) {
        // A refusal came in the last quiet period: nothing more is asked of this section until its end, and then one
        // canary and one recheck.
        const recheckAt = new Date(refusalAtMs + settings.quietMs).toISOString();
        const waiting = {
          ...job,
          pendingContract: { section, signal: safeSignal(signal), finding: clone(finding), recheckAt },
          pace: { ...job.pace, canaryDue: true },
          pendingStep: null,
          nextEligibleAt: recheckAt,
          ...appendActivities(job, lines),
          lastActivity: lines.at(-1) ?? job.lastActivity ?? null,
          updatedAt: at
        };
        return commitContractStep({ job, waiting, section, lines, signal, authorization, pendingKey, event: "activity" });
      }
      // With no refusal in the quiet period, or at the recheck: Account identity, or a run that has set 3 sections aside
      // already, stops with the signal in the failure.
      if (section === "profile" || counted >= settings.maximumSections) {
        const stopped = { ...job, pendingContract: null, detectedChanges: withDetectedChange(job, { section, code: signal.code, httpStatus: signal.httpStatus ?? null, setAside: false, dependents: [], at }) };
        return { ok: false, job: await fail(stopped, result?.code ?? "ADAPTER_FAILED", result?.message ?? `The ${section} adapter failed.`, { signal }, result?.requestActivities, finding) };
      }
      const dependents = await dependentSections(job, section);
      const entries = [{ section, code: signal.code, rsiCode: signal.rsiCode ?? null, at }, ...dependents.map((dependent) => ({ section: dependent, code: "INPUT_SET_ASIDE", rsiCode: null, at }))];
      const setAsideLines = entries.map((entry) => ({ kind: "section-set-aside", section: entry.section, code: entry.code, at }));
      const httpRequestsBySection = { ...(job.httpRequestsBySection ?? {}), [section]: (job.httpRequestsBySection?.[section] ?? 0) + lines.filter((line) => line.kind === "request-completed").length };
      const requestTotalsBySection = { ...(job.requestTotalsBySection ?? {}), [section]: httpRequestsBySection[section], ...Object.fromEntries(dependents.map((dependent) => [dependent, 0])) };
      const appended = appendActivities(job, [...lines, ...setAsideLines]);
      const setAside = {
        ...job,
        sectionIndex: job.sectionIndex + 1,
        cursorBySection: without(job.cursorBySection, section),
        storedStepsBySection: without(job.storedStepsBySection, section),
        requestCount: job.requestCount + 1,
        httpRequestsBySection,
        httpRequestCount: (job.httpRequestCount ?? 0) + lines.filter((line) => line.kind === "request-completed").length,
        requestTotalsBySection,
        resolvedRequestTotalsForSections: Object.values(requestTotalsBySection).filter((total) => Number.isSafeInteger(total) && total >= 0).length,
        setAsideSections: [...(job.setAsideSections ?? []), ...entries],
        detectedChanges: withDetectedChange(job, { section, code: signal.code, httpStatus: signal.httpStatus ?? null, setAside: true, dependents, at }),
        pendingContract: null,
        // The canary before this answer, if there was one, answered normally.
        pace: { ...job.pace, canaryDue: false },
        pendingStep: null,
        nextEligibleAt,
        ...appended,
        lastActivity: appended.activityLog.at(-1) ?? job.lastActivity ?? null,
        updatedAt: at
      };
      return commitContractStep({ job, waiting: setAside, section, lines, signal, authorization, pendingKey, event: "section-set-aside", entries, finding });
    }

    // One transaction for a contract answer: the job, the section's stored pages removed when it is set aside, the
    // staged run's set-aside sections and finding, and the run's pace history. A cancel that came first wins.
    async function commitContractStep({ job, waiting, section, lines, signal, authorization, pendingKey, event, entries = null, finding = null }) {
      const committed = await exclusive(() => repository.updateRun({
        jobId: job.jobId,
        authorizationId: job.authorizationId,
        runId: job.runId,
        withStagedRun: Boolean(entries),
        withPaceHistory: true,
        decide: ({ job: stored, authorization: storedAuthorization, stagedRun, paceHistory }) => {
          if (stored && TERMINAL.has(stored.status)) return { outcome: { terminal: stored.status } };
          const lease = Authorization.touchAuthorization(storedAuthorization ?? authorization, nowMs());
          const next = stored ? { ...waiting, ...controlled(stored, waiting) } : waiting;
          const staged = entries ? stagedRun ?? { runId: job.runId, accountId: job.accountId, status: "collecting", results: [], checkpoints: [], createdAt: new Date(nowMs()).toISOString() } : null;
          return {
            job: next,
            ...(entries ? { removePages: [{ collectionId: job.collectionId, section }] } : {}),
            ...(job.pendingStep ? { removePageKeys: [pendingKey] } : {}),
            ...(staged ? { stagedRun: { ...staged, setAsideSections: [...(staged.setAsideSections ?? []), ...clone(entries)], contractFindings: withContractFinding(staged.contractFindings, finding), updatedAt: waiting.updatedAt } } : {}),
            paceHistory: [withRunHistory(paceHistory, job, (run) => recordLines(run, job, section, lines, signal, job.pace.attempt > 0))],
            ...(lease.ok ? { authorization: lease.value } : {}),
            outcome: { status: next.status, leaseCode: lease.ok ? null : lease.code }
          };
        }
      }));
      if (committed.terminal) return { ok: false, code: "JOB_TERMINAL", status: committed.terminal };
      const stored = { ...waiting, status: committed.status };
      if (committed.leaseCode) return { ok: false, job: await fail(stored, committed.leaseCode, "The one-run authorization could not renew its bounded idle lease.") };
      if (entries) {
        if (memory?.jobId === job.jobId) memory = null;
        savedBackup = null;
      }
      await onStatus({ event, job: clone(stored), detail: clone({ section, ...(entries ? { setAside: entries } : {}) }) });
      if (stored.status !== "running") return { ok: true, job: stored };
      const next = passSetAside(stored);
      if (next.sectionIndex >= next.plan.selectedSections.length) return { ok: true, job: await finish(next) };
      return { ok: true, job: next === stored ? stored : await saveStepStatus(next, "activity", {}) };
    }

    // A run that ends with a section set aside (§10.3): no promotion. The staged run keeps its results, set-aside
    // sections and findings with a partial run receipt until the dashboard confirms it saved the file; the saved
    // backup stays as it was. The worker assembles the partial document from the staged run.
    async function completeWithOmissions(job) {
      const endedAt = new Date(nowMs()).toISOString();
      const partial = { ...job, status: "partial", updatedAt: endedAt, completedAt: endedAt, cursorBySection: {}, storedStepsBySection: {}, pendingStep: null, pendingContract: null };
      savedBackup = null;
      const outcome = await exclusive(() => repository.updateRun({
        jobId: job.jobId,
        authorizationId: job.authorizationId,
        runId: job.runId,
        withStagedRun: true,
        withPaceHistory: Boolean(job.paceHistory),
        decide: ({ job: stored, authorization, stagedRun, paceHistory }) => {
          // A pause or cancel that arrived first is honored; a resumed run comes back here.
          if (stored && stored.status !== "running") return { outcome: { interrupted: stored } };
          const runReceipt = terminalRunReceipt(partial, authorization, "partial", endedAt, pacingOf(paceHistory, job));
          const history = job.paceHistory ? closedHistory(paceHistory, job, endedAt) : { put: [], remove: [] };
          return {
            job: partial,
            removePages: [{ collectionId: job.collectionId, section: null }],
            paceHistory: history.put,
            removePaceHistory: history.remove,
            ...(stagedRun ? { stagedRun: { ...stagedRun, ...(runReceipt ? { runReceipt } : {}), status: "partial", updatedAt: endedAt } } : {}),
            ...(authorization ? { authorization: { ...authorization, consumedAt: endedAt } } : {}),
            outcome: {}
          };
        }
      }));
      if (outcome.interrupted) return outcome.interrupted;
      memory = null;
      await onStatus({ event: "partial", job: clone(partial), detail: {} });
      return partial;
    }

    // Billing page 1 as this run kept it, checked against its digest; none when it is not kept or does not match.
    async function keptBillingPages(job) {
      const record = await repository.getPage(Database.pageKey(job.collectionId, KEPT_BILLING_SECTION, 1));
      if (typeof record?.text !== "string" || record.sha256 !== await digest(record.text)) return [];
      try {
        return [JSON.parse(record.text)];
      } catch {
        return [];
      }
    }

    // Keeps the Billing page 1 a billing step returned, before that step's progress is stored, so a worker that ends
    // at any later point reads it back instead of asking RSI again. An unchanged page is not written again.
    async function keepBillingPages(job, pages) {
      const page = Array.isArray(pages) ? pages.find((entry) => typeof entry?.url === "string" && typeof entry.html === "string") : null;
      if (!page) return;
      const text = JSON.stringify({ url: page.url, html: page.html, finalUrl: typeof page.finalUrl === "string" ? page.finalUrl : page.url, status: Number.isSafeInteger(page.status) ? page.status : 200 });
      const pageKey = Database.pageKey(job.collectionId, KEPT_BILLING_SECTION, 1);
      const sha256 = await digest(text);
      if ((await repository.getPage(pageKey))?.sha256 === sha256) return;
      const record = { pageKey, collectionId: job.collectionId, section: KEPT_BILLING_SECTION, step: 1, checkpoint: false, text, sha256, storedAt: new Date(nowMs()).toISOString() };
      await exclusive(() => repository.updateRun({
        jobId: job.jobId,
        decide: ({ job: stored }) => stored && !TERMINAL.has(stored.status) ? { page: record, outcome: { kept: true } } : { outcome: { kept: false } }
      }));
    }

    // Performs at most one collection step. It returns `waiting` when the job's pacing delay has not elapsed.
    async function tick(jobId) {
      if (locks.has(jobId)) return { ok: false, code: "JOB_ALREADY_RUNNING" };
      locks.add(jobId);
      try {
        let job = await repository.getJob(jobId);
        if (!job) return { ok: false, code: "JOB_NOT_FOUND" };
        if (TERMINAL.has(job.status)) return { ok: false, code: "JOB_TERMINAL", status: job.status };
        if (job.status !== "running") return { ok: false, code: "JOB_NOT_RUNNING", status: job.status };
        const normalized = await normalizeStoredState(job);
        if (normalized.stopped) return { ok: false, job: normalized.stopped };
        job = normalized.job;
        if (TERMINAL.has(job.status) || job.status !== "running") return { ok: false, code: TERMINAL.has(job.status) ? "JOB_TERMINAL" : "JOB_NOT_RUNNING", status: job.status };
        const now = nowMs();
        const eligibleAt = Date.parse(job.nextEligibleAt);
        if (Number.isFinite(eligibleAt) && eligibleAt > now) return await waitWithStatusRefresh(job, eligibleAt);

        const authorization = await repository.getAuthorization(job.authorizationId);
        const checked = Authorization.validateAuthorization(authorization, {
          runId: job.runId,
          accountId: job.accountId
        }, now);
        if (!checked.ok) {
          // An authorization that ends while the run is slowed is the planned stop of a slowed run (§7.11).
          if (checked.code === "AUTHORIZATION_EXPIRED" && job.pace.factor > 1) return { ok: false, job: await stopContinuable(job, "RUN_LIFETIME_REACHED", null) };
          return { ok: false, job: await fail(job, checked.code, "The one-run authorization is no longer valid.") };
        }
        // An authorization that names allowances must name each as a count; one from before the allowances names none.
        const authorizedBounds = authorization.maximumActualRequests;
        const authorizedProblem = authorizedBounds === undefined || authorizedBounds === null ? null : allowancesProblem(authorizedBounds, "authorization.maximumActualRequests");
        if (authorizedProblem) return { ok: false, job: await stopContinuable(job, "REQUEST_COUNTERS_INVALID", { message: authorizedProblem }, [], "The run's stored request counts could not be read.") };

        const passed = passSetAside(job);
        if (passed !== job) {
          job = await saveStepStatus(passed, "activity", {});
          if (job.status !== "running") return { ok: false, code: TERMINAL.has(job.status) ? "JOB_TERMINAL" : "JOB_NOT_RUNNING", status: job.status };
        }
        const section = job.plan.selectedSections[job.sectionIndex];
        if (!section) return { ok: true, job: await finish(job) };

        if (job.requestCount >= jobStepLimit(job) || (job.requestsBySection?.[section] ?? 0) >= stepLimitFor(job, section, adapterFor(section))) {
          return { ok: false, job: await fail(job, "REQUEST_LIMIT_EXCEEDED", `The bounded request limit was reached while collecting ${section}.`) };
        }

        const sectionAuthorization = Authorization.validateAuthorization(authorization, {
          runId: job.runId,
          accountId: job.accountId,
          section
        }, now);
        if (!sectionAuthorization.ok) return { ok: false, job: await fail(job, sectionAuthorization.code, "The section is outside the one-run authorization.") };
        const adapter = adapterFor(section);
        if (!adapter || typeof adapter.collectStep !== "function") {
          return { ok: false, job: await fail(job, "ADAPTER_UNAVAILABLE", `No accepted adapter is registered for ${section}.`) };
        }

        let context = await sectionContext(job, section, adapter);
        const restarting = context.damaged;
        if (restarting) {
          // The section's stored pages could not be read back. They are discarded and the section starts over; the
          // requests already spent on it still count toward its limit.
          await repository.deletePages(job.collectionId, section);
          job = { ...job, cursorBySection: without(job.cursorBySection, section), storedStepsBySection: without(job.storedStepsBySection, section), recordsBySection: without(job.recordsBySection, section), requestProgressBySection: without(job.requestProgressBySection, section) };
          memory = null;
        }
        const sectionStarted = restarting || (job.requestsBySection?.[section] ?? 0) === 0;
        if (sectionStarted) {
          // Pages left by an earlier attempt at this section, if any, do not belong to this one.
          if (!restarting && (job.storedStepsBySection?.[section] ?? 0) === 0) await repository.deletePages(job.collectionId, section);
          const activity = { kind: "section-started", section, at: new Date(nowMs()).toISOString() };
          job = await saveStepStatus({
            ...job,
            lastActivity: activity,
            ...appendActivities(job, [activity]),
            updatedAt: activity.at
          }, "activity", { section, activity });
          // Paused or cancelled before the first request of this step: stop without contacting RSI.
          if (job.status !== "running") return { ok: false, code: TERMINAL.has(job.status) ? "JOB_TERMINAL" : "JOB_NOT_RUNNING", status: job.status };
          if (restarting) context = await sectionContext(job, section, adapter);
        }

        const stepStartedAtMs = nowMs();
        const PACING = Pacing;
        const baseline = (section.startsWith("organizations.members.") ? PACING.organizationRosters : PACING.accountBuild.sections[section]) ?? { intervalMs: BASELINE_INTERVAL_MS, jitterMs: MAXIMUM_BASELINE_JITTER_MS, lanes: 1 };
        const laneIntervalMs = PaceController.stepIntervalMs({ baseline, planFloorMs: job.plan.minimumInterRequestDelayMs, pace: job.pace, settings: PACING, random });
        const concurrentRequestStaggerMs = Math.floor((laneIntervalMs * PACING.accountBuild.staggerPercent) / 100);
        const maxFactor = PaceController.maximumFactor(Math.max(job.plan.minimumInterRequestDelayMs, baseline.intervalMs), PACING);
        // A step already under way in durable request slots goes on with its own interval, stagger and kept answers.
        let pending = job.pendingStep?.section === section ? job.pendingStep : null;
        const pendingKey = Database.pendingPageKey(job.collectionId, section);
        let journal = null;
        if (pending) {
          const kept = typeof repository.getPage === "function" ? await repository.getPage(pendingKey) : null;
          if (kept && typeof kept.text === "string" && kept.sha256 === await digest(kept.text)) {
            journal = JSON.parse(kept.text);
          } else {
            // A pending phase that cannot be read back is dropped, and the step starts over.
            pending = null;
            job = await saveStepStatus({ ...job, pendingStep: null }, "activity", {});
          }
        }
        const logicalIntervalMs = pending ? pending.logicalIntervalMs : laneIntervalMs;
        const logicalStaggerMs = pending ? pending.logicalStaggerMs : concurrentRequestStaggerMs;
        const logicalStartedAtMs = pending ? Number(/-(\d+)$/u.exec(pending.attemptId)?.[1] ?? stepStartedAtMs) : stepStartedAtMs;
        // The time of the next step: a step that ends and a section set aside both wait this long (§7.2, §10.2).
        const nextStepAt = () => new Date(Math.max(nowMs() + 250, logicalStartedAtMs + logicalIntervalMs)).toISOString();
        const canary = !pending && job.pace.canaryDue === true;
        // Only a step with a gap inside it can need a durable slot: two lanes, the profile's and the CCU step's requests
        // one after another, or a canary before the step's own requests.
        const gapsInside = baseline.lanes > 1 || section === "profile" || section === "buybackUpgradePrices" || canary;
        const durable = pending !== null || gapsInside && logicalStaggerMs > PACING.brakes.maximumInStepWaitMs;
        // The allowance each request of this step is counted under (§7.13).
        const retrying = job.pace.attempt > 0 || job.pace.freeRetryAt !== null;
        let requestsInStep = 0;
        let allowanceReached = null;
        let requestActivityQueue = Promise.resolve();
        const onRequestActivity = (candidate) => {
          requestActivityQueue = requestActivityQueue.then(async () => {
            const activity = safeRequestStartedActivity(candidate);
            if (!activity) throw new TypeError("The adapter emitted an unsafe request-started activity.");
            requestsInStep += 1;
            const canaryRequest = canary && (activity.route === IDENTIFY_ROUTE || requestsInStep === 2 && activity.method === "GET" && activity.route === "/account/pledges");
            const allowance = canaryRequest ? "canaryAndSessionChecks" : retrying ? "retries" : "baseline";
            // The authorization's bound holds over the job's: a job never sends more than its run was authorized for.
            const bound = allowanceBound(job, authorization, allowance);
            if ((job.actualRequestsByAllowance?.[allowance] ?? 0) >= bound) {
              allowanceReached = allowance;
              throw new Error("ACTUAL_REQUEST_LIMIT_EXCEEDED");
            }
            job = await saveStepStatus({
              ...job,
              actualRequestCount: (job.actualRequestCount ?? 0) + 1,
              actualRequestsBySection: { ...(job.actualRequestsBySection ?? {}), [section]: (job.actualRequestsBySection?.[section] ?? 0) + 1 },
              actualRequestsByAllowance: { ...(job.actualRequestsByAllowance ?? {}), [allowance]: (job.actualRequestsByAllowance?.[allowance] ?? 0) + 1 },
              lastActivity: activity,
              ...appendActivities(job, [activity]),
              updatedAt: activity.at
            }, "activity", { section, activity });
            // The adapter awaits this before each request, so a cancelled job sends nothing further.
            if (TERMINAL.has(job.status)) throw new Error("The job was cancelled before this request was sent.");
          });
          return requestActivityQueue;
        };
        const storedSteps = context.storedSteps;
        const result = await adapter.collectStep({
          section,
          accountId: job.accountId,
          runId: job.runId,
          mode: job.mode,
          previousSection: context.previousSection,
          updateSignals: clone(job.updateSignals ?? {}),
          // The user asked to end this section where it stands.
          skip: (job.skipSections ?? []).includes(section),
          cursor: clone(job.cursorBySection[section] ?? null),
          sectionState: context.state,
          sectionInputs: context.inputs,
          maximumRecords: job.plan.maximumRecordsBySection[section],
          checkpoint: await repository.getCheckpoint(`${job.accountId}:${section}`),
          authorization: clone(authorization),
          // The full stagger: a gap longer than an in-step wait becomes a durable request slot (§6.3).
          concurrentRequestStaggerMs: logicalStaggerMs,
          lanes: baseline.lanes,
          canary,
          canaryAfterSignal: canary ? clone(job.pace.lastSignal) : null,
          // Billing page 1 stays cached while a later billing section of the plan will read it (§7.3, D23).
          retainBillingPage: job.plan.selectedSections.slice(job.sectionIndex + 1).some((later) => BILLING_SECTIONS.has(later)),
          // Billing page 1 as this run kept it, for a billing step: read once per run, also across a worker restart.
          retainedPages: BILLING_SECTIONS.has(section) ? await keptBillingPages(job) : [],
          requestSlots: durable ? { journal: journal ?? [] } : null,
          onRequestActivity
        }).catch((error) => {
          // A request refused past its allowance ends the step, however the adapter passes that on; the failure below
          // says which allowance it was.
          if (allowanceReached) return null;
          throw error;
        });
        try {
          await requestActivityQueue;
        } catch (error) {
          if (!TERMINAL.has(job.status) && !allowanceReached) throw error;
        }
        if (TERMINAL.has(job.status)) return { ok: false, code: "JOB_TERMINAL", status: job.status };
        if (allowanceReached) {
          return { ok: false, job: await fail(job, "ACTUAL_REQUEST_LIMIT_EXCEEDED", `The ${allowanceReached} request allowance of this run was reached while collecting ${section}.`, { allowance: allowanceReached }, result?.requestActivities) };
        }
        if (result?.ok === true && result.pendingPhase) return await storePendingPhase({ job, section, result, pending, pendingKey, authorization, logicalIntervalMs, logicalStaggerMs, logicalStartedAtMs, requestsInStep });
        if (result?.ok !== true) {
          const signal = classify(result?.signal ?? null, canary, job.pace.lastSignal);
          if (signal && REFUSAL_KINDS.has(signal.kind)) return await refusedAttempt({ job, section, signal, result, authorization, maxFactor, pendingKey, adapter });
          if (signal?.kind === "user" && Object.hasOwn(USER_STOP_CODES, signal.reason)) {
            return { ok: false, job: await stopContinuable(job, USER_STOP_CODES[signal.reason], { signal }, result?.requestActivities) };
          }
          if (signal?.kind === "contract") {
            return await contractChanged({ job, section, signal, result, authorization, pendingKey, nextEligibleAt: nextStepAt() });
          }
          return { ok: false, job: await fail(job, result?.code ?? "ADAPTER_FAILED", result?.message ?? `The ${section} adapter failed.`, signal ? { signal } : null, result?.requestActivities, result?.contractFinding ?? null) };
        }
        if (!job.accountVerifiedAt && result.accountId !== job.accountId) {
          return { ok: false, job: await fail(job, "ACCOUNT_NOT_VERIFIED", "The first accepted adapter result did not verify the authorized account binding.") };
        }
        if (BILLING_SECTIONS.has(section)) await keepBillingPages(job, result.retainedPages);
        if (result.accountId !== undefined && result.accountId !== job.accountId) {
          return { ok: false, job: await fail(job, "ACCOUNT_CHANGED", "The RSI account changed during collection.") };
        }

        const recordCount = result.recordCount;
        const previousRecordCount = job.recordsBySection?.[section] ?? 0;
        const cumulativeRecordCount = result.cumulativeRecordCount;
        const maximumRecords = job.plan.maximumRecordsBySection[section];
        const reusedPrevious = result.reusedPrevious === true;
        // A step adds to what the section holds. A step that reuses the saved section replaces it instead, so its
        // total need not continue from the rows gathered while looking for the saved section's newest entries.
        if (!Number.isSafeInteger(recordCount) || recordCount < 0
          || !Number.isSafeInteger(cumulativeRecordCount) || cumulativeRecordCount < 0
          || !reusedPrevious && cumulativeRecordCount !== previousRecordCount + recordCount
          || cumulativeRecordCount > maximumRecords) {
          return { ok: false, job: await fail(job, "RECORD_CAP_EXCEEDED", `The ${section} adapter exceeded or could not prove its authorized record count.`) };
        }

        const receipt = {
          receiptId: result.receiptId ?? `${job.runId}:${job.requestCount + 1}`,
          runId: job.runId,
          section,
          adapterVersion: adapter.version,
          parserVersion: adapter.parserVersion,
          recordCount,
          completedAt: new Date(nowMs()).toISOString()
        };
        const parserResults = result.parserResults ?? [];
        if (!Array.isArray(parserResults) || (parserResults.length > 0 && result.resultMode !== "cumulative") || (result.done && parserResults.length === 0 && !reusedPrevious)) {
          return { ok: false, job: await fail(job, "INVALID_ADAPTER_RESULT", `The ${section} adapter did not return parser results.`) };
        }
        let allowedResultSections;
        try {
          allowedResultSections = new Set(resultSectionsForJob(section));
        } catch {
          return { ok: false, job: await fail(job, "INVALID_ADAPTER_RESULT", `The ${section} adapter has no result mapping.`) };
        }
        for (const parsed of parserResults) {
          if (!parsed || typeof parsed.section !== "string" || !parsed.outcome || !allowedResultSections.has(parsed.section)) {
            return { ok: false, job: await fail(job, "INVALID_ADAPTER_RESULT", `The ${section} adapter returned an out-of-scope parser result.`) };
          }
        }
        // The page this step fetched, as the text it is stored as, with the SHA-256 that is checked when it is read back.
        const storesPage = !result.done && typeof result.page?.text === "string";
        const page = storesPage ? {
          pageKey: Database.pageKey(job.collectionId, section, storedSteps + 1),
          collectionId: job.collectionId,
          section,
          step: storedSteps + 1,
          checkpoint: result.page.checkpoint === true,
          text: result.page.text,
          sha256: await digest(result.page.text),
          storedAt: receipt.completedAt
        } : null;
        // A section confirmed unchanged leaves no result of its own; the staged run records that it was checked.
        const confirmedUnchanged = reusedPrevious && result.done === true;
        const stagedChanges = parserResults.length > 0 || Boolean(result.checkpoint) || confirmedUnchanged;
        const stagedResults = stagedChanges ? clone(parserResults) : [];

        const cursorBySection = { ...job.cursorBySection };
        if (result.done) delete cursorBySection[section];
        else cursorBySection[section] = clone(result.cursor);
        const storedStepsBySection = result.done ? without(job.storedStepsBySection, section) : { ...(job.storedStepsBySection ?? {}), ...(page ? { [section]: page.step } : {}) };
        const recordsBySection = { ...(job.recordsBySection ?? {}), [section]: cumulativeRecordCount };
        const requestsBySection = { ...(job.requestsBySection ?? {}), [section]: (job.requestsBySection?.[section] ?? 0) + 1 };
        const activities = safeRequestActivities(result.requestActivities);
        const httpRequestIncrement = activities.filter((activity) => activity.kind === "request-completed").length;
        // The step's request family and response time for the controller (§7.8): its first request's family, and the
        // median of its accepted answers' times; the retained history supplies the family's normal time (§6.8).
        const accepted = activities.filter((activity) => activity.kind === "request-completed" && activity.responseStatus >= 200 && activity.responseStatus < 300 && Number.isSafeInteger(activity.elapsedMs));
        const familyLine = accepted.find((activity) => activity.route !== IDENTIFY_ROUTE) ?? accepted[0] ?? null;
        const stepFamily = familyLine ? PaceController.requestFamily(section, familyLine.method, routeTemplate(familyLine.route)) : PaceController.requestFamily(section, "GET", "/");
        const times = accepted.map((activity) => activity.elapsedMs).sort((left, right) => left - right);
        const stepElapsedMs = times.length ? times[Math.floor(times.length / 2)] : 0;
        const retainedNormal = typeof repository.listPaceHistory === "function" ? PaceHistory.normalLatency(await repository.listPaceHistory(), stepFamily, Pacing, { exceptRunId: job.runId }) : [];
        const httpRequestsBySection = {
          ...(job.httpRequestsBySection ?? {}),
          [section]: (job.httpRequestsBySection?.[section] ?? 0) + httpRequestIncrement
        };
        const added = [...activities];
        if (result.done) added.push({
          kind: "section-completed",
          section,
          recordsTotal: cumulativeRecordCount,
          requestsTotal: httpRequestsBySection[section],
          at: receipt.completedAt
        });
        const appended = appendActivities(job, added);
        const lastActivity = appended.activityLog.at(-1) ?? job.lastActivity ?? null;
        const requestTotalsBySection = { ...(job.requestTotalsBySection ?? {}) };
        if (result.done) requestTotalsBySection[section] = httpRequestsBySection[section];
        else if (section !== "financial.ledgers" && result.requestProgress?.totalKnown === true
          && Number.isSafeInteger(result.requestProgress.total) && result.requestProgress.total >= 0) {
          requestTotalsBySection[section] = result.requestProgress.total;
        }
        const expectedSectionCount = job.baselineSectionCount ?? job.plan.selectedSections.length;
        const resolvedRequestTotalsForSections = Object.values(requestTotalsBySection).filter((total) => Number.isSafeInteger(total) && total >= 0).length;
        const httpRequestsTotal = resolvedRequestTotalsForSections === expectedSectionCount
          ? Object.values(requestTotalsBySection).reduce((total, sectionTotal) => total + sectionTotal, 0)
          : null;
        const progressed = {
          ...job,
          sectionIndex: result.done ? job.sectionIndex + 1 : job.sectionIndex,
          cursorBySection,
          storedStepsBySection,
          recordsBySection,
          requestsBySection,
          requestCount: job.requestCount + 1,
          httpRequestsBySection,
          httpRequestCount: (job.httpRequestCount ?? 0) + httpRequestIncrement,
          requestProgressBySection: {
            ...(job.requestProgressBySection ?? {}),
            [section]: clone(result.requestProgress ?? null)
          },
          requestTotalsBySection,
          updateSignals: {
            ...(job.updateSignals ?? {}),
            [section]: typeof result.changeState === "string" ? result.changeState : "changed"
          },
          resolvedRequestTotalsForSections,
          httpRequestsTotal,
          lastActivity,
          ...appended,
          accountVerifiedAt: job.accountVerifiedAt ?? receipt.completedAt,
          nextEligibleAt: nextStepAt(),
          pace: PaceController.onSuccess(job.pace, {
            requestFamily: stepFamily,
            elapsedMs: stepElapsedMs,
            historicalNormal: retainedNormal,
            nowMs: nowMs(),
            settings: Pacing,
            maxFactor
          }),
          pendingStep: null,
          // A section that answered normally has no change of RSI's page waiting to be checked again.
          pendingContract: null,
          updatedAt: receipt.completedAt
        };

        // One transaction stores everything the step produced: its page, its receipt, the renewed lease, the finished
        // section's results, and the job's new position. A cancel can arrive while the step's last request is in
        // flight. It wins: nothing from this step is stored, and the authorization the cancel revoked is not written
        // back. A pause that arrived is kept, with the step's progress saved under it. The lease is renewed on the
        // stored authorization, so a dashboard that took the run over during the step keeps it.
        const committed = await exclusive(() => repository.updateRun({
          jobId: job.jobId,
          authorizationId: job.authorizationId,
          runId: job.runId,
          withStagedRun: stagedChanges,
          withPaceHistory: true,
          decide: ({ job: stored, authorization: storedAuthorization, stagedRun, paceHistory }) => {
            if (stored && TERMINAL.has(stored.status)) return { outcome: { terminal: stored.status } };
            const runHistory = withRunHistory(paceHistory, job, (run) => PaceHistory.recordStep(recordLines(run, job, section, activities, null, retrying), { factor: progressed.pace.factor, slow: progressed.pace.warning === "slow" }));
            const lease = Authorization.touchAuthorization(storedAuthorization ?? authorization, nowMs());
            const next = stored ? { ...progressed, ...controlled(stored, progressed) } : progressed;
            const staged = stagedChanges ? stagedRun ?? { runId: job.runId, accountId: job.accountId, status: "collecting", results: [], checkpoints: [], createdAt: new Date(now).toISOString() } : null;
            return {
              // A section that ended needs none of its pages again. A step that replaced the gathered rows makes the
              // pages before it redundant.
              removePages: result.done || page?.checkpoint ? [{ collectionId: job.collectionId, section }] : [],
              page,
              receipt,
              // The step's pending phase, if it ran in durable request slots, is consumed with its result.
              ...(pending ? { removePageKeys: [pendingKey] } : {}),
              paceHistory: [runHistory],
              ...(lease.ok ? { authorization: lease.value } : {}),
              ...(staged ? {
                stagedRun: {
                  ...staged,
                  results: replaceResults(staged.results, stagedResults),
                  ...(confirmedUnchanged ? { reusedSections: [...new Set([...(staged.reusedSections ?? []), section])] } : {}),
                  ...(result.checkpoint ? { checkpoints: [...(staged.checkpoints ?? []).filter((value) => value.checkpointKey !== result.checkpoint.checkpointKey), clone(result.checkpoint)] } : {}),
                  updatedAt: receipt.completedAt
                }
              } : {}),
              job: next,
              outcome: { status: next.status, skipSections: next.skipSections ?? null, leaseCode: lease.ok ? null : lease.code }
            };
          }
        }));
        if (committed.terminal) return { ok: false, code: "JOB_TERMINAL", status: committed.terminal };
        job = { ...progressed, status: committed.status, ...(committed.skipSections ? { skipSections: committed.skipSections } : {}) };
        memory = result.done ? null : { ...context, storedSteps: page ? page.step : storedSteps, state: page ? result.sectionState ?? null : context.state };
        if (!result.done) savedBackup = null;
        if (committed.leaseCode) {
          return { ok: false, job: await fail(job, committed.leaseCode, "The one-run authorization could not renew its bounded idle lease.") };
        }
        await onStatus({ event: "progress", job: clone(job), detail: clone({ section, receipt, done: Boolean(result.done), activities, requestProgress: result.requestProgress ?? null }) });
        if (job.status === "running") job = await startStatusRead(job, adapter, authorization);
        // Paused while this step was in flight: its progress is saved and the job waits for resume.
        if (job.status !== "running") return { ok: true, job };
        const ahead = passSetAside(job);
        if (ahead.sectionIndex >= ahead.plan.selectedSections.length) return { ok: true, job: await finish(ahead) };
        return { ok: true, job };
      } catch (error) {
        const job = await repository.getJob(jobId);
        if (!job) return { ok: false, code: "RUNNER_ERROR", message: error.message };
        return { ok: false, job: await fail(job, "RUNNER_ERROR", error.message) };
      } finally {
        locks.delete(jobId);
      }
    }

    // Runs steps back to back until the job stops being runnable. The pause between steps is the job's own pacing
    // delay, so collection keeps its speed whether or not an alarm could fire. One loop per job; a second call while a
    // loop is active asks that loop for one more pass instead of starting another.
    function run(jobId) {
      const active = loops.get(jobId);
      if (active) {
        wakeRequests.add(jobId);
        return active;
      }
      const loop = (async () => {
        for (;;) {
          wakeRequests.delete(jobId);
          const outcome = await tick(jobId);
          if (outcome.waiting) {
            await sleep(Math.max(0, outcome.eligibleAt - nowMs()));
            continue;
          }
          if (outcome.ok && outcome.job?.status === "running") {
            // While a warning shows, the next pass waits through waitWithStatusRefresh, which also wakes for the status.
            if (!outcome.job.pace?.warning) await sleep(Math.max(0, Date.parse(outcome.job.nextEligibleAt) - nowMs()));
            continue;
          }
          // A resume that arrived while this pass was finishing must not be lost.
          if (wakeRequests.has(jobId)) continue;
          loops.delete(jobId);
          return outcome;
        }
      })();
      loops.set(jobId, loop);
      loop.catch(() => { loops.delete(jobId); });
      return loop;
    }

    async function setControl(jobId, command, section = null) {
      const now = new Date(nowMs()).toISOString();
      // Resume renews the idle lease of the paused run, in the same transaction (§12.4); no other control does.
      const storedJob = command === "resume" ? await repository.getJob(jobId) : null;
      const outcome = await exclusive(() => repository.updateRun({
        jobId,
        runId: null,
        authorizationId: storedJob?.status === "paused" ? storedJob.authorizationId : null,
        decide: ({ job, authorization }) => {
          if (!job) return { outcome: { ok: false, code: "JOB_NOT_FOUND" } };
          if (TERMINAL.has(job.status)) return { outcome: { ok: false, code: "JOB_TERMINAL", status: job.status } };
          let next = null;
          if (command === "pause" && job.status === "running") next = { ...job, status: "paused", updatedAt: now };
          else if (command === "resume" && job.status === "paused") {
            const pace = job.pace && PaceController.validatePaceState(job.pace, Pacing) === null ? PaceController.onResume(job.pace) : job.pace;
            const notBefore = Math.max(Date.parse(now), Date.parse(job.pace?.retryNotBefore ?? now) || 0, Date.parse(job.pendingStep?.nextRequestAt ?? now) || 0, Date.parse(job.pendingContract?.recheckAt ?? now) || 0);
            next = { ...job, status: "running", updatedAt: now, nextEligibleAt: new Date(notBefore).toISOString(), ...(pace ? { pace } : {}) };
            const lease = authorization ? Authorization.resumeLease(authorization, Date.parse(now)) : null;
            if (lease?.ok) return { job: next, authorization: lease.value, outcome: { ok: true, job: next } };
          }
          else if (command === "cancel" && ["running", "paused"].includes(job.status)) next = { ...job, status: "cancelled", updatedAt: now, completedAt: now, cursorBySection: {}, storedStepsBySection: {} };
          // Only the section being read now can be skipped: its next step ends it with what it has read.
          else if (command === "skip" && ["running", "paused"].includes(job.status) && job.plan.selectedSections[job.sectionIndex] === section) {
            next = { ...job, skipSections: [...new Set([...(job.skipSections ?? []), section])], updatedAt: now };
          }
          if (!next) return { outcome: { ok: false, code: "INVALID_CONTROL_TRANSITION", status: job.status } };
          return { job: next, outcome: { ok: true, job: next } };
        }
      }));
      if (!outcome.ok) return outcome;
      const job = outcome.job;
      if (job.status === "cancelled") {
        // A cancelled run cannot be opened or continued, so nothing it collected is kept: its stored pages and its
        // staged results go, its receipt stays, and its authorization is revoked.
        if (memory?.jobId === job.jobId) memory = null;
        savedBackup = null;
        await exclusive(() => repository.updateRun({
          jobId,
          authorizationId: job.authorizationId,
          runId: job.runId,
          withStagedRun: true,
          withPaceHistory: Boolean(job.paceHistory),
          decide: ({ authorization, stagedRun, paceHistory }) => {
            const runReceipt = terminalRunReceipt(job, authorization, "cancelled", now, pacingOf(paceHistory, job));
            const history = job.paceHistory ? closedHistory(paceHistory, job, now) : { put: [], remove: [] };
            return {
              removePages: [{ collectionId: job.collectionId, section: null }],
              paceHistory: history.put,
              removePaceHistory: history.remove,
              ...(stagedRun ? { stagedRun: { ...stagedRun, results: [], ...(runReceipt ? { runReceipt } : {}), status: "cancelled", updatedAt: now } } : {}),
              ...(authorization ? { authorization: { ...authorization, revokedAt: now } } : {}),
              outcome: {}
            };
          }
        }));
      }
      await onStatus({ event: command === "skip" ? "skip-requested" : { paused: "paused", running: "resumed", cancelled: "cancelled" }[job.status], job: clone(job), detail: {} });
      if (job.status === "running" && command !== "skip") await schedule(job, nowMs());
      return { ok: true, job };
    }

    return Object.freeze({ tick, run, actualRequestAllowances: (plan) => allowanceMaximums({ plan }), isRunning: (id) => loops.has(id), pause: (id) => setControl(id, "pause"), resume: (id) => setControl(id, "resume"), cancel: (id) => setControl(id, "cancel"), skipSection: (id, section) => setControl(id, "skip", section) });
  }

  return Object.freeze({ ACTIVITY_LIMIT, MAXIMUM_BASELINE_JITTER_MS, MAXIMUM_CONTRACT_FINDINGS, MAXIMUM_REQUESTS_PER_JOB, MAXIMUM_REQUESTS_PER_SECTION, REQUEST_ALLOWANCES, STOP_MESSAGES, createJob, createSerialRunner, merge, safePaceActivity, safeSmartCheckActivity, withContractFinding });
});
