// Retained pace history over time (PARSER_HARDENING.md §4.7, §6.8): finished runs past the detailed limit fold into
// the aggregates without losing a count, and a stored record is checked before use.
import assert from "node:assert/strict";
import test from "node:test";
import { History, settings, plain, at, FAMILY, small, start, attempt } from "./pacehistoryundertest.mjs";

test("the finished runs past the detailed limit fold, oldest first, into the connection's and their account's aggregates", () => {
  const bounded = small({ detailedRuns: 2, maximumLatencySamplesPerRequestFamily: 5 });
  let records = [];
  const totals = { accepted: 0, refused: 0 };
  for (let index = 0; index < 5; index += 1) {
    let run = start(`run-${index}`, at(index * 60000), index % 2 === 0 ? "VerifiedCitizen" : "OtherCitizen");
    for (let request = 0; request <= index; request += 1) {
      run = History.recordAttempt(run, attempt("accepted"), bounded);
      run = History.recordAccepted(run, { requestFamily: FAMILY, elapsedMs: 100 * index + request, factor: 1 }, bounded);
      totals.accepted += 1;
    }
    run = History.recordAttempt(run, attempt("limit"), bounded);
    totals.refused += 1;
    records = [...records.filter((record) => record.historyKey !== run.historyKey), run];
    const { put, remove } = History.finishRun(records, run.runId, { endedAt: at(index * 60000 + 30000) }, bounded);
    const byKey = new Map(records.map((record) => [record.historyKey, record]));
    for (const key of remove) byKey.delete(key);
    for (const record of put) byKey.set(record.historyKey, record);
    records = [...byKey.values()];
    for (const record of records) assert.equal(History.validateRecord(record, bounded), null, record.historyKey);
  }
  const runs = records.filter((record) => record.kind === "run").map((record) => record.runId).sort();
  assert.deepEqual(runs, ["run-3", "run-4"], "the two newest runs keep their detail");
  const connection = records.find((record) => record.historyKey === "connection");
  assert.equal(connection.runs, 3);
  // No count is lost: the aggregate and the kept runs together hold every request.
  const kept = records.filter((record) => record.kind === "run");
  assert.equal(connection.acceptedRequests + kept.reduce((total, run) => total + run.pacing.acceptedRequests, 0), totals.accepted);
  assert.equal(connection.refusedRequests + kept.reduce((total, run) => total + run.pacing.refusedRequests, 0), totals.refused);
  assert.equal(connection.signalCounts[0].count, 3);
  // The aggregate keeps the newest response times of the folded runs, newest last.
  assert.deepEqual(plain(connection.latency[FAMILY].samples), [100, 101, 200, 201, 202]);
  const verified = records.find((record) => record.historyKey === "account:verifiedcitizen");
  const other = records.find((record) => record.historyKey === "account:othercitizen");
  assert.deepEqual([verified.runs, other.runs], [2, 1]);
  // The normal response time: the aggregate's samples, then each kept run's, without the run that asks.
  assert.deepEqual(plain(History.normalLatency(records, FAMILY, bounded)), [400, 401, 402, 403, 404]);
  assert.deepEqual(plain(History.normalLatency(records, FAMILY, bounded, { exceptRunId: "run-4" })), [202, 300, 301, 302, 303]);
  assert.deepEqual(plain(History.normalLatency(records, "POST /other in pledges", bounded)), []);
});

test("a stored record is checked before use: an unknown key, a future version or a malformed bucket is refused", () => {
  const run = start("run-1");
  for (const [change, pattern] of [
    [{ version: 2 }, /version must be 1/u],
    [{ extra: true }, /extra is not known/u],
    [{ runKind: "image" }, /runKind must be account, roster or images/u],
    [{ account: "Has Space" }, /account must be a handle/u],
    [{ startedAt: "soon" }, /startedAt must be an ISO time/u],
    [{ pacing: { ...run.pacing, settingsFingerprint: "ABC" } }, /settingsFingerprint must be 64 lower-case hexadecimal characters/u],
    [{ pacing: { ...run.pacing, signalCounts: [{ section: "pledges", kind: "accepted", code: "OK", httpStatus: 200, count: 1 }] } }, /is not a valid bucket/u],
    [{ pacing: { ...run.pacing, acceptedRequests: -1 } }, /acceptedRequests must be a whole number/u],
    [{ latency: { [FAMILY]: { samples: [1.5], fastestAcceptedFactor: null } } }, /whole response times/u]
  ]) {
    assert.match(History.validateRecord({ ...run, ...change }, settings), pattern, JSON.stringify(change));
  }
  assert.equal(History.validateRecord(History.emptyAggregate("connection"), settings), null);
  assert.match(History.validateRecord({ ...History.emptyAggregate("connection"), historyKey: "elsewhere" }, settings), /not a valid aggregate key/u);
  assert.match(History.validateRecord(null, settings), /must be an object with a history key/u);
});
