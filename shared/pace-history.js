// The retained pace history (PARSER_HARDENING.md §4.7, §6.8): what each run's requests met, kept after the run so a
// later run knows how long RSI's answers normally take.
//
// `npm run sync:schemas` copies this file byte for byte to extension/shared/pace-history.js and
// docs/scripts/pace-history.js. It is pure: each function takes records and returns new ones, and the extension's
// repository writes them in the same transaction as the job event that caused them.
//
// The history is diagnostic. It supplies normal response times only; it never sets a new run's starting pace, wall,
// wait, warning or cool-down. No token, cookie, header value, response body, address or RSI message enters it.
//
// Records, each under its `historyKey`:
//   "connection"         every run's counts and response times, once its detailed record has aged out;
//   "account:<handle>"   the same for one account, by its handle in lower case;
//   "run:<runId>"        one run's detailed record. The newest `history.detailedRuns` finished runs keep theirs.
//   "images"             the image hosts' own history (§14): an aggregate and the newest `history.detailedRuns` image
//                        runs, in one record of its own kind, which no account function reads or folds.
(function exposePaceHistory(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.CitizenDataPaceHistory = api;
})(typeof globalThis === "object" ? globalThis : this, () => {
  "use strict";

  // The layout of a history record. A change of layout changes this number.
  const HISTORY_VERSION = 1;
  // The pace controller's layout the summaries describe (shared/pace-controller.js CONTROLLER_VERSION).
  const CONTROLLER_VERSION = 1;
  const CONNECTION_KEY = "connection";
  // The classes of §5.2 an attempt can end in, and "accepted".
  const OUTCOMES = Object.freeze(["accepted", "limit", "transient", "ambiguous", "user", "contract"]);
  const REFUSALS = Object.freeze(["limit", "transient", "ambiguous"]);
  const RUN_KINDS = Object.freeze(["account", "roster", "images"]);
  const IMAGES_KEY = "images";
  const OTHER = "OTHER";
  // Request families one record can name: sections times their few fixed routes, with room to spare.
  const MAXIMUM_REQUEST_FAMILIES = 64;
  const MAXIMUM_ELAPSED_MS = 600000;
  const COUNTER_LIMIT = Number.MAX_SAFE_INTEGER;
  const NAME = /^[A-Za-z0-9._:/-]{1,120}$/u;
  // A request family (rule 5): the method, the fixed route template and the section, as "POST /route in section". The
  // section comes last, so no family name ends with a route such as setAuthToken, which a backup check reads as a secret.
  const REQUEST_FAMILY = /^(?:GET|POST) \/[A-Za-z0-9._~!$&'()*+,;=:@%/{}-]{0,200} in [A-Za-z0-9._-]{1,80}$/u;
  const CODE = /^[A-Z0-9_]{1,80}$/u;
  const FINGERPRINT = /^[0-9a-f]{64}$/u;

  const accountKey = (handle) => `account:${String(handle).toLowerCase()}`;
  const runKey = (runId) => `run:${runId}`;

  function emptyCounts() {
    return { acceptedRequests: 0, refusedRequests: 0, retriedRequests: 0, slowSteps: 0 };
  }

  // An aggregate: the counts and response times of every run merged into it.
  function emptyAggregate(historyKey) {
    return { historyKey, kind: "aggregate", version: HISTORY_VERSION, runs: 0, ...emptyCounts(), signalCounts: [], latency: {}, updatedAt: null };
  }

  // A run's detailed record, at its start: no requests yet, at the factor it starts with.
  function startRun({ runId, accountId, runKind, settingsFingerprint, settingsVersion, startedAt, startedFactor }) {
    return {
      historyKey: runKey(runId),
      kind: "run",
      version: HISTORY_VERSION,
      runId,
      account: String(accountId).toLowerCase(),
      runKind,
      startedAt,
      endedAt: null,
      pacing: {
        controllerVersion: CONTROLLER_VERSION,
        settingsVersion,
        settingsFingerprint,
        startedFactor,
        ...emptyCounts(),
        maximumFactor: startedFactor,
        finalFactor: startedFactor,
        signalCounts: []
      },
      latency: {}
    };
  }

  // Signal counts sorted by section, kind, code and status, at most `limit` of them: the combinations past the limit are
  // counted together in one OTHER bucket, which carries no RSI message.
  function boundedSignalCounts(counts, limit) {
    const byKey = new Map();
    for (const bucket of counts) {
      const key = JSON.stringify([bucket.section, bucket.kind, bucket.code, bucket.httpStatus]);
      const existing = byKey.get(key);
      byKey.set(key, existing ? { ...existing, count: existing.count + bucket.count } : { ...bucket });
    }
    const order = (left, right) => left.section.localeCompare(right.section) || left.kind.localeCompare(right.kind) || left.code.localeCompare(right.code) || (left.httpStatus ?? 0) - (right.httpStatus ?? 0);
    const named = [...byKey.values()].filter((bucket) => bucket.section !== OTHER).sort(order);
    const other = [...byKey.values()].find((bucket) => bucket.section === OTHER)?.count ?? 0;
    if (named.length + (other > 0 ? 1 : 0) <= limit) return other > 0 ? [...named, otherBucket(other)] : named;
    const kept = named.slice(0, limit - 1);
    const merged = named.slice(limit - 1).reduce((total, bucket) => total + bucket.count, other);
    return [...kept, otherBucket(merged)];
  }

  function otherBucket(count) {
    return { section: OTHER, kind: OTHER, code: OTHER, httpStatus: null, count };
  }

  // One request family's retained response times: accepted answers at factors 1 to 2, newest last.
  function addSample(latency, requestFamily, elapsedMs, factor, settings) {
    const entry = latency[requestFamily] ?? { samples: [], fastestAcceptedFactor: null };
    const samples = factor <= 2 ? [...entry.samples, elapsedMs].slice(-settings.history.maximumLatencySamplesPerRequestFamily) : entry.samples;
    const fastestAcceptedFactor = entry.fastestAcceptedFactor === null ? factor : Math.min(entry.fastestAcceptedFactor, factor);
    if (!Object.hasOwn(latency, requestFamily) && Object.keys(latency).length >= MAXIMUM_REQUEST_FAMILIES) return latency;
    return { ...latency, [requestFamily]: { samples, fastestAcceptedFactor } };
  }

  // One request that ended (§6.8): its class, code and status counted, never its RSI message. A canary, probe or status
  // check is counted with the rest; only `recordAccepted` decides what joins the response times.
  function recordAttempt(run, attempt, settings) {
    const pacing = run.pacing;
    const refused = REFUSALS.includes(attempt.outcome);
    const signalCounts = attempt.outcome === "accepted" ? pacing.signalCounts : boundedSignalCounts([...pacing.signalCounts, {
      section: attempt.section, kind: attempt.outcome, code: attempt.code, httpStatus: attempt.httpStatus ?? null, count: 1
    }], settings.history.maximumSignalBuckets);
    return {
      ...run,
      pacing: {
        ...pacing,
        acceptedRequests: pacing.acceptedRequests + (attempt.outcome === "accepted" ? 1 : 0),
        refusedRequests: pacing.refusedRequests + (refused ? 1 : 0),
        retriedRequests: pacing.retriedRequests + (attempt.retried === true ? 1 : 0),
        maximumFactor: Math.max(pacing.maximumFactor, attempt.factor),
        finalFactor: attempt.factor,
        signalCounts
      }
    };
  }

  // An accepted answer of an ordinary request: its whole response time joins its family's distribution. Canaries,
  // probes and status checks answer other questions than a section's, so their times are not kept.
  function recordAccepted(run, { requestFamily, elapsedMs, factor, canary = false, probe = false, statusCheck = false }, settings) {
    if (canary || probe || statusCheck || !Number.isSafeInteger(elapsedMs) || elapsedMs < 0 || elapsedMs > MAXIMUM_ELAPSED_MS) return run;
    return { ...run, latency: addSample(run.latency, requestFamily, elapsedMs, factor, settings) };
  }

  // A stored step: the factor the controller left the run at, and whether its answers were slow.
  function recordStep(run, { factor, slow }) {
    return { ...run, pacing: { ...run.pacing, slowSteps: run.pacing.slowSteps + (slow ? 1 : 0), maximumFactor: Math.max(run.pacing.maximumFactor, factor), finalFactor: factor } };
  }

  // The fixed run summary of §4.7, for the run receipt and the image manifest.
  function runSummary(run) {
    const { pacing } = run;
    return {
      controllerVersion: pacing.controllerVersion,
      settingsVersion: pacing.settingsVersion,
      settingsFingerprint: pacing.settingsFingerprint,
      startedFactor: pacing.startedFactor,
      acceptedRequests: pacing.acceptedRequests,
      refusedRequests: pacing.refusedRequests,
      retriedRequests: pacing.retriedRequests,
      slowSteps: pacing.slowSteps,
      maximumFactor: pacing.maximumFactor,
      finalFactor: pacing.finalFactor,
      signalCounts: pacing.signalCounts.map((bucket) => ({ ...bucket }))
    };
  }

  // A run's counts and response times merged into an aggregate. Nothing is dropped: past the bounds, counts join the
  // OTHER bucket and the oldest response times give way to newer ones.
  function mergeInto(aggregate, run, settings) {
    const latency = { ...aggregate.latency };
    let merged = latency;
    for (const [family, entry] of Object.entries(run.latency)) {
      const existing = merged[family] ?? { samples: [], fastestAcceptedFactor: null };
      if (!Object.hasOwn(merged, family) && Object.keys(merged).length >= MAXIMUM_REQUEST_FAMILIES) continue;
      const fastest = [existing.fastestAcceptedFactor, entry.fastestAcceptedFactor].filter((value) => value !== null);
      merged = { ...merged, [family]: { samples: [...existing.samples, ...entry.samples].slice(-settings.history.maximumLatencySamplesPerRequestFamily), fastestAcceptedFactor: fastest.length ? Math.min(...fastest) : null } };
    }
    return {
      ...aggregate,
      runs: aggregate.runs + 1,
      acceptedRequests: aggregate.acceptedRequests + run.pacing.acceptedRequests,
      refusedRequests: aggregate.refusedRequests + run.pacing.refusedRequests,
      retriedRequests: aggregate.retriedRequests + run.pacing.retriedRequests,
      slowSteps: aggregate.slowSteps + run.pacing.slowSteps,
      signalCounts: boundedSignalCounts([...aggregate.signalCounts, ...run.pacing.signalCounts], settings.history.maximumSignalBuckets),
      latency: merged,
      updatedAt: run.endedAt
    };
  }

  // The end of a run: its record is closed, and the finished runs past `history.detailedRuns` are folded, oldest first,
  // into the connection's and their account's aggregates. Returns the records to write and the keys to remove.
  function finishRun(records, runId, { endedAt }, settings) {
    const byKey = new Map(records.map((record) => [record.historyKey, record]));
    const run = byKey.get(runKey(runId));
    if (!run) return { put: [], remove: [] };
    byKey.set(run.historyKey, { ...run, endedAt });
    const finished = [...byKey.values()].filter((record) => record.kind === "run" && record.endedAt !== null)
      .sort((left, right) => left.endedAt.localeCompare(right.endedAt) || left.runId.localeCompare(right.runId));
    const aged = finished.slice(0, Math.max(0, finished.length - settings.history.detailedRuns));
    const touched = new Set([run.historyKey]);
    for (const old of aged) {
      for (const key of [CONNECTION_KEY, accountKey(old.account)]) {
        byKey.set(key, mergeInto(byKey.get(key) ?? emptyAggregate(key), old, settings));
        touched.add(key);
      }
      byKey.delete(old.historyKey);
      touched.delete(old.historyKey);
    }
    return { put: [...touched].map((key) => byKey.get(key)), remove: aged.map((old) => old.historyKey) };
  }

  // The retained response times of one request family, newest last: the connection's aggregate first, then each kept
  // run's, oldest run first, leaving out the run that asks. At most `history.maximumLatencySamplesPerRequestFamily`.
  function normalLatency(records, requestFamily, settings, { exceptRunId = null } = {}) {
    const aggregate = records.find((record) => record.historyKey === CONNECTION_KEY);
    const runs = records.filter((record) => record.kind === "run" && record.runId !== exceptRunId)
      .sort((left, right) => left.startedAt.localeCompare(right.startedAt) || left.runId.localeCompare(right.runId));
    const samples = [...(aggregate?.latency[requestFamily]?.samples ?? []), ...runs.flatMap((run) => run.latency[requestFamily]?.samples ?? [])];
    return samples.slice(-settings.history.maximumLatencySamplesPerRequestFamily);
  }

  // The image hosts' history (§14): its own record, never the account's. An image run that ends joins its newest
  // detailed runs; the runs past `history.detailedRuns` are folded, oldest first, into its aggregate.
  function emptyImageHistory() {
    return { historyKey: IMAGES_KEY, kind: "images", version: HISTORY_VERSION, aggregate: emptyAggregate(IMAGES_KEY), runs: [] };
  }

  function finishImageRun(history, run, { endedAt }, settings) {
    const base = history ?? emptyImageHistory();
    const runs = [...base.runs.filter((entry) => entry.runId !== run.runId), { ...run, endedAt }]
      .sort((left, right) => left.endedAt.localeCompare(right.endedAt) || left.runId.localeCompare(right.runId));
    const aged = runs.slice(0, Math.max(0, runs.length - settings.history.detailedRuns));
    return { ...base, aggregate: aged.reduce((aggregate, old) => mergeInto(aggregate, old, settings), base.aggregate), runs: runs.slice(aged.length) };
  }

  // The image history as one aggregate: every detailed run folded in, for a package receipt.
  function imageAggregate(history, settings) {
    return history.runs.reduce((aggregate, run) => mergeInto(aggregate, run, settings), history.aggregate);
  }

  // The counts the image history held before a run, for its receipt.
  function imagePriorCounts(history, settings) {
    const { runs, acceptedRequests, refusedRequests, retriedRequests, slowSteps } = imageAggregate(history, settings);
    return { runs, acceptedRequests, refusedRequests, retriedRequests, slowSteps };
  }

  // The image family's retained response times, newest last: the aggregate's, then each detailed run's.
  function imageNormalLatency(history, requestFamily, settings) {
    if (!history) return [];
    const samples = [...(history.aggregate.latency[requestFamily]?.samples ?? []), ...history.runs.flatMap((run) => run.latency[requestFamily]?.samples ?? [])];
    return samples.slice(-settings.history.maximumLatencySamplesPerRequestFamily);
  }

  // A loaded Images ZIP's receipt as image history: its `paceHistory.aggregate`, or, in a receipt written before it,
  // the counts of its pacing summary alone. Null when neither passes its checks.
  function imageHistoryFromReceipt(receipt, settings) {
    const aggregate = receipt?.paceHistory?.aggregate;
    if (aggregate && validateRecord(aggregate, settings) === null && aggregate.historyKey === IMAGES_KEY) return { ...emptyImageHistory(), aggregate };
    const pacing = receipt?.pacing;
    if (!isObject(pacing)) return null;
    const counts = checkCounts(pacing, "pacing") ?? checkSignalCounts(pacing.signalCounts, "pacing.signalCounts", settings);
    if (counts !== null || !isTime(receipt.endedAt)) return null;
    const { acceptedRequests, refusedRequests, retriedRequests, slowSteps } = pacing;
    const signalCounts = pacing.signalCounts.map((bucket) => ({ ...bucket }));
    return { ...emptyImageHistory(), aggregate: { ...emptyAggregate(IMAGES_KEY), runs: 1, acceptedRequests, refusedRequests, retriedRequests, slowSteps, signalCounts, updatedAt: receipt.endedAt } };
  }

  // Null when `record` is an image history this module wrote, or the message of the first rule that fails.
  function validateImageHistory(record, settings) {
    const keys = exactKeys(record, ["historyKey", "kind", "version", "aggregate", "runs"], IMAGES_KEY);
    if (keys) return keys;
    if (record.historyKey !== IMAGES_KEY || record.kind !== "images" || record.version !== HISTORY_VERSION) return "images is not an image history record.";
    if (record.aggregate?.historyKey !== IMAGES_KEY) return "images.aggregate must be the image hosts' aggregate.";
    const aggregate = validateRecord(record.aggregate, settings);
    if (aggregate) return aggregate;
    if (!Array.isArray(record.runs) || record.runs.length > settings.history.detailedRuns) return `images.runs must hold at most ${settings.history.detailedRuns} runs.`;
    for (const run of record.runs) {
      if (run?.runKind !== "images") return "images.runs holds a run that is not an image run.";
      const problem = validateRecord(run, settings);
      if (problem) return problem;
      if (run.endedAt === null) return `${run.historyKey}: an image run in the history must have ended.`;
    }
    return null;
  }

  // The checks of a stored history record. Each returns null, or the message of the first rule that fails.
  function isObject(value) {
    // A plain object of any realm: its prototype is an Object.prototype, or it has none.
    if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === null || Object.getPrototypeOf(prototype) === null;
  }

  function exactKeys(value, keys, name) {
    if (!isObject(value)) return `${name} must be an object.`;
    for (const key of keys) if (!Object.hasOwn(value, key)) return `${name}.${key} is missing.`;
    for (const key of Object.keys(value)) if (!keys.includes(key)) return `${name}.${key} is not known.`;
    return null;
  }

  function isCount(value) {
    return Number.isSafeInteger(value) && value >= 0 && value <= COUNTER_LIMIT;
  }

  function isTime(value) {
    return typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(Date.parse(value)).toISOString() === value;
  }

  function isFactor(value) {
    return typeof value === "number" && Number.isFinite(value) && value >= 1;
  }

  function checkSignalCounts(counts, name, settings) {
    if (!Array.isArray(counts) || counts.length > settings.history.maximumSignalBuckets) return `${name} must hold at most ${settings.history.maximumSignalBuckets} buckets.`;
    for (const [index, bucket] of counts.entries()) {
      const keys = exactKeys(bucket, ["section", "kind", "code", "httpStatus", "count"], `${name}[${index}]`);
      if (keys) return keys;
      const other = bucket.section === OTHER && bucket.kind === OTHER && bucket.code === OTHER && bucket.httpStatus === null;
      const named = NAME.test(bucket.section) && bucket.section !== OTHER && OUTCOMES.includes(bucket.kind) && bucket.kind !== "accepted" && CODE.test(bucket.code)
        && (bucket.httpStatus === null || Number.isSafeInteger(bucket.httpStatus) && bucket.httpStatus >= 100 && bucket.httpStatus <= 599);
      if (!other && !named) return `${name}[${index}] is not a valid bucket.`;
      if (!Number.isSafeInteger(bucket.count) || bucket.count < 1) return `${name}[${index}].count must be a whole number of at least 1.`;
    }
    return null;
  }

  function checkLatency(latency, name, settings) {
    if (!isObject(latency)) return `${name} must be an object.`;
    const families = Object.keys(latency);
    if (families.length > MAXIMUM_REQUEST_FAMILIES) return `${name} holds more than ${MAXIMUM_REQUEST_FAMILIES} request families.`;
    for (const family of families) {
      const label = `${name}["${family.slice(0, 40)}"]`;
      if (!REQUEST_FAMILY.test(family)) return `${label} is not a valid request family.`;
      const keys = exactKeys(latency[family], ["samples", "fastestAcceptedFactor"], label);
      if (keys) return keys;
      const { samples, fastestAcceptedFactor } = latency[family];
      if (!Array.isArray(samples) || samples.length > settings.history.maximumLatencySamplesPerRequestFamily || samples.some((sample) => !Number.isSafeInteger(sample) || sample < 0 || sample > MAXIMUM_ELAPSED_MS)) {
        return `${label}.samples must hold at most ${settings.history.maximumLatencySamplesPerRequestFamily} whole response times.`;
      }
      if (fastestAcceptedFactor !== null && !isFactor(fastestAcceptedFactor)) return `${label}.fastestAcceptedFactor must be a factor or null.`;
    }
    return null;
  }

  function checkCounts(value, name) {
    const failed = Object.keys(emptyCounts()).find((key) => !isCount(value[key]));
    return failed ? `${name}.${failed} must be a whole number of at least 0.` : null;
  }

  // Null when `record` is a history record this module wrote, or the message of the first rule that fails.
  function validateRecord(record, settings) {
    if (!isObject(record) || typeof record.historyKey !== "string") return "A pace history record must be an object with a history key.";
    if (record.version !== HISTORY_VERSION) return `${record.historyKey}: version must be ${HISTORY_VERSION}.`;
    const name = record.historyKey.slice(0, 80);
    if (record.kind === "aggregate") {
      const keys = exactKeys(record, ["historyKey", "kind", "version", "runs", "acceptedRequests", "refusedRequests", "retriedRequests", "slowSteps", "signalCounts", "latency", "updatedAt"], name);
      if (keys) return keys;
      if (record.historyKey !== CONNECTION_KEY && record.historyKey !== IMAGES_KEY && !/^account:[a-z0-9_-]{1,60}$/u.test(record.historyKey)) return `${name} is not a valid aggregate key.`;
      if (!isCount(record.runs)) return `${name}.runs must be a whole number of at least 0.`;
      if (record.updatedAt !== null && !isTime(record.updatedAt)) return `${name}.updatedAt must be an ISO time or null.`;
      return checkCounts(record, name) ?? checkSignalCounts(record.signalCounts, `${name}.signalCounts`, settings) ?? checkLatency(record.latency, `${name}.latency`, settings);
    }
    if (record.kind !== "run") return `${name}.kind must be aggregate or run.`;
    const keys = exactKeys(record, ["historyKey", "kind", "version", "runId", "account", "runKind", "startedAt", "endedAt", "pacing", "latency"], name);
    if (keys) return keys;
    if (typeof record.runId !== "string" || !NAME.test(record.runId) || record.historyKey !== runKey(record.runId)) return `${name}.runId must name the record's run.`;
    if (typeof record.account !== "string" || !/^[a-z0-9_-]{1,60}$/u.test(record.account)) return `${name}.account must be a handle in lower case.`;
    if (!RUN_KINDS.includes(record.runKind)) return `${name}.runKind must be account, roster or images.`;
    if (!isTime(record.startedAt)) return `${name}.startedAt must be an ISO time.`;
    if (record.endedAt !== null && !isTime(record.endedAt)) return `${name}.endedAt must be an ISO time or null.`;
    const pacing = record.pacing;
    const pacingKeys = exactKeys(pacing, ["controllerVersion", "settingsVersion", "settingsFingerprint", "startedFactor", "acceptedRequests", "refusedRequests", "retriedRequests", "slowSteps", "maximumFactor", "finalFactor", "signalCounts"], `${name}.pacing`);
    if (pacingKeys) return pacingKeys;
    if (pacing.controllerVersion !== CONTROLLER_VERSION || pacing.settingsVersion !== 1) return `${name}.pacing names an unknown controller or settings version.`;
    if (typeof pacing.settingsFingerprint !== "string" || !FINGERPRINT.test(pacing.settingsFingerprint)) return `${name}.pacing.settingsFingerprint must be 64 lower-case hexadecimal characters.`;
    for (const key of ["startedFactor", "maximumFactor", "finalFactor"]) if (!isFactor(pacing[key])) return `${name}.pacing.${key} must be a factor of at least 1.`;
    return checkCounts(pacing, `${name}.pacing`) ?? checkSignalCounts(pacing.signalCounts, `${name}.pacing.signalCounts`, settings) ?? checkLatency(record.latency, `${name}.latency`, settings);
  }

  return Object.freeze({
    HISTORY_VERSION,
    CONNECTION_KEY,
    IMAGES_KEY,
    OUTCOMES,
    accountKey,
    runKey,
    emptyAggregate,
    startRun,
    recordAttempt,
    recordAccepted,
    recordStep,
    runSummary,
    finishRun,
    normalLatency,
    validateRecord,
    emptyImageHistory,
    finishImageRun,
    imageAggregate,
    imagePriorCounts,
    imageNormalLatency,
    imageHistoryFromReceipt,
    validateImageHistory
  });
});
