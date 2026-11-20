(function initializeCitizenDataRunner(root, factory) {
  "use strict";

  const api = factory(root.CitizenDataAuthorization, root.CitizenDataDatabase);
  root.CitizenDataRunner = api;
  if (typeof module === "object" && module?.exports) module.exports = factory(require("../shared/authorization.js"), require("../storage/database.js"));
})(globalThis, function createCitizenDataRunner(Authorization, Database) {
  "use strict";

  const TERMINAL = new Set(["cancelled", "failed", "complete"]);
  const MAXIMUM_REQUESTS_PER_JOB = 4096;
  const MAXIMUM_REQUESTS_PER_SECTION = 2048;
  const MAXIMUM_BASELINE_JITTER_MS = 200;
  const ACTIVITY_LIMIT = 20;

  function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  }

  function safeRequestStartedActivity(value) {
    if (!value || value.kind !== "request-started" || !["GET", "POST"].includes(value.method)
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
      updateSignals: {},
      accountVerifiedAt: null,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      failure: null,
      warnings: []
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
    function controlled(stored) {
      return { status: stored.status, ...(Array.isArray(stored.skipSections) ? { skipSections: stored.skipSections } : {}) };
    }

    // A pause, resume, cancel, or skip can arrive while a step is in flight. The step owns its progress fields; the
    // stored record owns the status. A cancelled job records nothing further.
    async function saveStepStatus(job, event, detail = {}) {
      const saved = await exclusive(async () => {
        const stored = await repository.getJob(job.jobId);
        if (stored && TERMINAL.has(stored.status)) return stored;
        const next = stored ? { ...job, ...controlled(stored) } : job;
        await repository.saveJob(next);
        return next;
      });
      if (!TERMINAL.has(saved.status)) await onStatus({ event, job: clone(saved), detail: clone(detail) });
      return saved;
    }

    function terminalRunReceipt(job, authorization, status, endedAt) {
      if (!authorization) return null;
      return {
        runId: job.runId,
        status,
        startedAt: job.createdAt,
        endedAt,
        selectedSections: [...job.plan.selectedSections],
        authorization: Authorization.runAuthorizationReceipt(authorization),
        organizationMemberAuthorization: clone(job.organizationMemberAuthorization ?? null)
      };
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

    async function savedBackupFor(job) {
      if (savedBackup?.jobId !== job.jobId) savedBackup = { jobId: job.jobId, snapshot: await repository.getSnapshot(job.accountId) ?? null };
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

    // A job that was cancelled while its step was in flight stays cancelled.
    async function fail(job, code, message) {
      const endedAt = new Date(nowMs()).toISOString();
      const failed = { ...job, status: "failed", updatedAt: endedAt, completedAt: endedAt, failure: { code, message } };
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
        decide: ({ job: stored, authorization, stagedRun }) => {
          if (stored && TERMINAL.has(stored.status)) return { outcome: { superseded: stored } };
          const runReceipt = terminalRunReceipt(failed, authorization, "failed", endedAt);
          return {
            job: failed,
            ...(stagedRun ? { stagedRun: { ...stagedRun, results: replaceResults(stagedRun.results, partialResults), ...(runReceipt ? { runReceipt } : {}), status: "failed", updatedAt: endedAt } } : {}),
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
      savedBackup = null;
      if (!staged) throw new Error("The staged run is no longer stored.");
      const assembled = await assembleDocument({
        job: clone(completed),
        authorization,
        staged,
        previous: previousSnapshot?.document ?? null,
        completedAt
      });
      const document = assembled?.document ?? assembled;
      if (!document || typeof document !== "object" || Array.isArray(document)) throw new Error("The canonical document assembler returned an invalid account document.");
      const history = planHistory ? await planHistory({ accountId: job.accountId, previous: previousSnapshot?.document ?? null, document, completedAt }) : null;
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

    // Performs at most one collection step. It returns `waiting` when the job's pacing delay has not elapsed.
    async function tick(jobId) {
      if (locks.has(jobId)) return { ok: false, code: "JOB_ALREADY_RUNNING" };
      locks.add(jobId);
      try {
        let job = await repository.getJob(jobId);
        if (!job) return { ok: false, code: "JOB_NOT_FOUND" };
        if (TERMINAL.has(job.status)) return { ok: false, code: "JOB_TERMINAL", status: job.status };
        if (job.status !== "running") return { ok: false, code: "JOB_NOT_RUNNING", status: job.status };
        const now = nowMs();
        const eligibleAt = Date.parse(job.nextEligibleAt);
        if (Number.isFinite(eligibleAt) && eligibleAt > now) return { ok: true, waiting: true, eligibleAt };

        const authorization = await repository.getAuthorization(job.authorizationId);
        const checked = Authorization.validateAuthorization(authorization, {
          runId: job.runId,
          accountId: job.accountId
        }, now);
        if (!checked.ok) return { ok: false, job: await fail(job, checked.code, "The one-run authorization is no longer valid.") };

        const section = job.plan.selectedSections[job.sectionIndex];
        if (!section) return { ok: true, job: await complete(job) };

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
            activityLog: [...(job.activityLog ?? []), activity].slice(-ACTIVITY_LIMIT),
            updatedAt: activity.at
          }, "activity", { section, activity });
          // Paused or cancelled before the first request of this step: stop without contacting RSI.
          if (job.status !== "running") return { ok: false, code: TERMINAL.has(job.status) ? "JOB_TERMINAL" : "JOB_NOT_RUNNING", status: job.status };
          if (restarting) context = await sectionContext(job, section, adapter);
        }

        const stepStartedAtMs = nowMs();
        const delay = job.plan.minimumInterRequestDelayMs;
        const jitterMaximum = delay === 900 ? MAXIMUM_BASELINE_JITTER_MS : Math.floor(delay * 0.15);
        const randomUnit = Math.max(0, Math.min(1, random()));
        const jitter = delay === 900
          ? Math.min(jitterMaximum, Math.floor((jitterMaximum + 1) * randomUnit))
          : Math.floor(jitterMaximum * randomUnit);
        const laneIntervalMs = delay + jitter;
        let requestActivityQueue = Promise.resolve();
        const onRequestActivity = (candidate) => {
          requestActivityQueue = requestActivityQueue.then(async () => {
            const activity = safeRequestStartedActivity(candidate);
            if (!activity) throw new TypeError("The adapter emitted an unsafe request-started activity.");
            job = await saveStepStatus({
              ...job,
              lastActivity: activity,
              activityLog: [...(job.activityLog ?? []), activity].slice(-ACTIVITY_LIMIT),
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
          concurrentRequestStaggerMs: Math.floor(laneIntervalMs / 2),
          onRequestActivity
        });
        try {
          await requestActivityQueue;
        } catch (error) {
          if (!TERMINAL.has(job.status)) throw error;
        }
        if (TERMINAL.has(job.status)) return { ok: false, code: "JOB_TERMINAL", status: job.status };
        if (!result || result.ok !== true) {
          return { ok: false, job: await fail(job, result?.code ?? "ADAPTER_FAILED", result?.message ?? `The ${section} adapter failed.`) };
        }
        if (!job.accountVerifiedAt && result.accountId !== job.accountId) {
          return { ok: false, job: await fail(job, "ACCOUNT_NOT_VERIFIED", "The first accepted adapter result did not verify the authorized account binding.") };
        }
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
        const activities = (Array.isArray(result.requestActivities) ? result.requestActivities : []).filter((activity) => activity?.kind === "request-completed");
        const httpRequestIncrement = activities.length;
        const httpRequestsBySection = {
          ...(job.httpRequestsBySection ?? {}),
          [section]: (job.httpRequestsBySection?.[section] ?? 0) + httpRequestIncrement
        };
        const activityLog = [...(job.activityLog ?? []), ...activities];
        if (result.done) activityLog.push({
          kind: "section-completed",
          section,
          recordsTotal: cumulativeRecordCount,
          requestsTotal: httpRequestsBySection[section],
          at: receipt.completedAt
        });
        const lastActivity = activityLog.at(-1) ?? job.lastActivity ?? null;
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
          activityLog: activityLog.slice(-ACTIVITY_LIMIT),
          accountVerifiedAt: job.accountVerifiedAt ?? receipt.completedAt,
          nextEligibleAt: new Date(Math.max(nowMs() + 250, stepStartedAtMs + laneIntervalMs)).toISOString(),
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
          decide: ({ job: stored, authorization: storedAuthorization, stagedRun }) => {
            if (stored && TERMINAL.has(stored.status)) return { outcome: { terminal: stored.status } };
            const lease = Authorization.touchAuthorization(storedAuthorization ?? authorization, nowMs());
            const next = stored ? { ...progressed, ...controlled(stored) } : progressed;
            const staged = stagedChanges ? stagedRun ?? { runId: job.runId, accountId: job.accountId, status: "collecting", results: [], checkpoints: [], createdAt: new Date(now).toISOString() } : null;
            return {
              // A section that ended needs none of its pages again. A step that replaced the gathered rows makes the
              // pages before it redundant.
              removePages: result.done || page?.checkpoint ? [{ collectionId: job.collectionId, section }] : [],
              page,
              receipt,
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
        // Paused while this step was in flight: its progress is saved and the job waits for resume.
        if (job.status !== "running") return { ok: true, job };
        if (job.sectionIndex >= job.plan.selectedSections.length) return { ok: true, job: await complete(job) };
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
            await sleep(Math.max(0, Date.parse(outcome.job.nextEligibleAt) - nowMs()));
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
      const outcome = await exclusive(() => repository.updateRun({
        jobId,
        runId: null,
        decide: ({ job }) => {
          if (!job) return { outcome: { ok: false, code: "JOB_NOT_FOUND" } };
          if (TERMINAL.has(job.status)) return { outcome: { ok: false, code: "JOB_TERMINAL", status: job.status } };
          let next = null;
          if (command === "pause" && job.status === "running") next = { ...job, status: "paused", updatedAt: now };
          else if (command === "resume" && job.status === "paused") next = { ...job, status: "running", updatedAt: now, nextEligibleAt: now };
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
          decide: ({ authorization, stagedRun }) => {
            const runReceipt = terminalRunReceipt(job, authorization, "cancelled", now);
            return {
              removePages: [{ collectionId: job.collectionId, section: null }],
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

    return Object.freeze({ tick, run, isRunning: (id) => loops.has(id), pause: (id) => setControl(id, "pause"), resume: (id) => setControl(id, "resume"), cancel: (id) => setControl(id, "cancel"), skipSection: (id, section) => setControl(id, "skip", section) });
  }

  return Object.freeze({ ACTIVITY_LIMIT, MAXIMUM_BASELINE_JITTER_MS, MAXIMUM_REQUESTS_PER_JOB, MAXIMUM_REQUESTS_PER_SECTION, createJob, createSerialRunner, merge });
});
