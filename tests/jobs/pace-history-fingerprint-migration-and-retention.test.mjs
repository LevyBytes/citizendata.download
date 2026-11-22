// The retained pace history (shared/pace-history.js, PARSER_HARDENING.md §4.7, §6.8): the settings fingerprint
// each run records, what an attempt and an accepted answer add, and the bounded signal buckets. Both synced copies
// are loaded.
import assert from "node:assert/strict";
import test from "node:test";
import { loadClassicScripts } from "../extension/load-classic-script.mjs";
import { files, extension, History, settings, plain, FINGERPRINT, at, FAMILY, small, start, attempt } from "./pacehistoryundertest.mjs";

const dashboard = await loadClassicScripts(files(["docs", "scripts"]), { crypto: globalThis.crypto, TextEncoder, Uint8Array });

test("a run records the settings fingerprint it ran under, the same in both copies, and its summary has the fields of §4.7", async () => {
  assert.match(FINGERPRINT, /^[0-9a-f]{64}$/u);
  assert.equal(await dashboard.CitizenDataRequestPacing.settingsFingerprint(), FINGERPRINT);
  // The fixed vector both copies are tested against.
  const vector = { b: [1, { d: "é", c: true }], a: null };
  for (const pacing of [extension.CitizenDataRequestPacing, dashboard.CitizenDataRequestPacing]) {
    assert.equal(await pacing.settingsFingerprint(vector), "8c07b33d327d4b77db8eec4d6e5a348de9b1060c05bf4e8be071a4ece713bde5");
  }
  const run = start("run-1");
  assert.equal(History.validateRecord(run, settings), null);
  assert.deepEqual(plain(History.runSummary(run)), {
    controllerVersion: 1, settingsVersion: 1, settingsFingerprint: FINGERPRINT, startedFactor: 2,
    acceptedRequests: 0, refusedRequests: 0, retriedRequests: 0, slowSteps: 0, maximumFactor: 2, finalFactor: 2, signalCounts: []
  });
  assert.deepEqual(plain(start("run-1")), plain(dashboard.CitizenDataPaceHistory.startRun({ runId: "run-1", accountId: "VerifiedCitizen", runKind: "account", settingsFingerprint: FINGERPRINT, settingsVersion: 1, startedAt: at(0), startedFactor: 2 })));
});

test("an attempt adds its class, code and status to bounded buckets, never an RSI message; past the bound they share OTHER", () => {
  let run = start("run-1");
  run = History.recordAttempt(run, attempt("accepted"), settings);
  run = History.recordAttempt(run, { ...attempt("limit"), rsiMessage: "Too many requests from 203.0.113.9", retried: false }, settings);
  run = History.recordAttempt(run, { ...attempt("limit"), factor: 4, retried: true }, settings);
  run = History.recordAttempt(run, attempt("user", { code: "RSI_SIGNED_OUT", httpStatus: null }), settings);
  const summary = plain(History.runSummary(run));
  assert.deepEqual([summary.acceptedRequests, summary.refusedRequests, summary.retriedRequests, summary.maximumFactor, summary.finalFactor], [1, 2, 1, 4, 2]);
  assert.deepEqual(summary.signalCounts, [
    { section: "pledges", kind: "limit", code: "RSI_HTML_HTTP_429", httpStatus: 429, count: 2 },
    { section: "pledges", kind: "user", code: "RSI_SIGNED_OUT", httpStatus: null, count: 1 }
  ]);
  assert.ok(!JSON.stringify(run).includes("Too many") && !JSON.stringify(run).includes("203.0.113.9"), "no RSI message or address is kept");
  // Twelve distinct combinations under a bound of 8: seven by name, sorted, and one OTHER bucket with the rest.
  const bounded = small({ maximumSignalBuckets: 8 });
  let busy = start("run-2");
  for (let index = 0; index < 12; index += 1) busy = History.recordAttempt(busy, attempt("limit", { section: `financial.s${String(index).padStart(2, "0")}` }), bounded);
  const counts = plain(busy.pacing.signalCounts);
  assert.equal(counts.length, 8);
  assert.deepEqual(counts.slice(0, 7).map((bucket) => bucket.section), ["financial.s00", "financial.s01", "financial.s02", "financial.s03", "financial.s04", "financial.s05", "financial.s06"]);
  assert.deepEqual(counts[7], { section: "OTHER", kind: "OTHER", code: "OTHER", httpStatus: null, count: 5 });
  assert.equal(counts.reduce((total, bucket) => total + bucket.count, 0), 12, "nothing is dropped");
  assert.equal(History.validateRecord(busy, bounded), null);
});

test("accepted answers keep their whole response time at factors 1 to 2, newest last; canaries, probes and status checks do not", () => {
  const bounded = small({ maximumLatencySamplesPerRequestFamily: 5 });
  let run = start("run-1");
  for (let index = 0; index < 7; index += 1) run = History.recordAccepted(run, { requestFamily: FAMILY, elapsedMs: 100 + index, factor: 1.5 }, bounded);
  run = History.recordAccepted(run, { requestFamily: FAMILY, elapsedMs: 999, factor: 3 }, bounded);
  for (const flag of ["canary", "probe", "statusCheck"]) run = History.recordAccepted(run, { requestFamily: FAMILY, elapsedMs: 5000, factor: 1, [flag]: true }, bounded);
  run = History.recordAccepted(run, { requestFamily: FAMILY, elapsedMs: 1.5, factor: 1 }, bounded);
  assert.deepEqual(plain(run.latency[FAMILY]), { samples: [102, 103, 104, 105, 106], fastestAcceptedFactor: 1.5 });
  assert.equal(History.validateRecord(run, bounded), null);
  // A slow step counts, and the factor the controller left the run at is the run's final one.
  const stepped = History.recordStep(History.recordStep(run, { factor: 3, slow: true }), { factor: 1.2, slow: false });
  assert.deepEqual([stepped.pacing.slowSteps, stepped.pacing.maximumFactor, stepped.pacing.finalFactor], [1, 3, 1.2]);
});
