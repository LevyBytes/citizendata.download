// Seeded sequences of runs (PARSER_HARDENING.md §4.7, §6.8): each new run starts with fresh live state while the
// earlier runs' accepted response times stay available.
import assert from "node:assert/strict";
import test from "node:test";
import { extension, History, settings, plain, T0, at, FAMILY, start, attempt, FINGERPRINT } from "./pacehistoryundertest.mjs";

const Pace = extension.CitizenDataPaceController;

test("seeded runs: each new run starts at factor 2 with no wall, wait or warning, while earlier accepted times stay available", () => {
  let seed = 20261121;
  const random = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  let records = [];
  const startedPaces = [];
  for (let index = 0; index < 120; index += 1) {
    const runId = `run-${String(index).padStart(3, "0")}`;
    // Two settings fingerprints: the history keeps observations made under either.
    let run = start(runId, at(index * 3600000), "VerifiedCitizen", index < 60 ? FINGERPRINT : "a".repeat(64));
    let pace = Pace.initialPace(settings);
    startedPaces.push(pace);
    const historicalNormal = History.normalLatency(records, FAMILY, settings, { exceptRunId: runId });
    let now = T0 + index * 3600000;
    for (let request = 0; request < 30; request += 1) {
      if (random() < 0.1) {
        const outcome = Pace.onRefusal(pace, { kind: "limit", code: "RSI_HTML_HTTP_429", retryAfterMs: null }, { nowMs: now, random, settings, maxFactor: 120000 / 900, expiresAtMs: Number.MAX_SAFE_INTEGER });
        pace = outcome.pace;
        run = History.recordAttempt(run, attempt("limit", { factor: pace.factor }), settings);
        now += outcome.waitMs;
      } else {
        const elapsedMs = 200 + Math.floor(random() * 400);
        pace = Pace.onSuccess(pace, { requestFamily: FAMILY, elapsedMs, historicalNormal, nowMs: now, settings, maxFactor: 120000 / 900 });
        run = History.recordAttempt(run, attempt("accepted", { factor: pace.factor }), settings);
        run = History.recordAccepted(run, { requestFamily: FAMILY, elapsedMs, factor: pace.factor }, settings);
        run = History.recordStep(run, { factor: pace.factor, slow: pace.warning === "slow" });
        now += 1500;
      }
    }
    records = [...records.filter((record) => record.historyKey !== run.historyKey), run];
    const { put, remove } = History.finishRun(records, runId, { endedAt: new Date(now).toISOString() }, settings);
    const byKey = new Map(records.map((record) => [record.historyKey, record]));
    for (const key of remove) byKey.delete(key);
    for (const record of put) byKey.set(record.historyKey, record);
    records = [...byKey.values()];
  }
  // Live state never carries over: every run started from the same first pace.
  for (const pace of startedPaces) assert.deepEqual(plain(pace), plain(Pace.initialPace(settings)));
  // The history is bounded: the newest 100 runs in detail, the rest folded into two aggregates.
  assert.equal(records.filter((record) => record.kind === "run").length, settings.history.detailedRuns);
  assert.deepEqual(records.filter((record) => record.kind === "aggregate").map((record) => record.historyKey).sort(), ["account:verifiedcitizen", "connection"]);
  assert.equal(records.find((record) => record.historyKey === "connection").runs, 20);
  for (const record of records) assert.equal(History.validateRecord(record, settings), null, record.historyKey);
  // Observations are kept: the next run's normal time comes from accepted samples only, within their range.
  const normal = History.normalLatency(records, FAMILY, settings, { exceptRunId: "run-next" });
  assert.equal(normal.length, settings.history.maximumLatencySamplesPerRequestFamily);
  assert.ok(normal.every((sample) => sample >= 200 && sample < 600));
  assert.ok(JSON.stringify(records).length < 2000000, "the whole history stays small");
});
