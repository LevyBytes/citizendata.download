// RSI's status feed while a warning shows (PARSER_HARDENING.md §7.5, D13): the runner reads it once when "limited"
// first shows and again every 5 minutes while a warning still shows, and never with no warning. Each read is
// reserved under statusChecks before it is sent.
import assert from "node:assert/strict";
import test from "node:test";
import { CACHE_MS, harness } from "./runnerstatusfeedwarningharness.mjs";

const plain = (value) => JSON.parse(JSON.stringify(value));

const gapsOf = (times) => times.slice(1).map((time, index) => time - times[index]);

test("no warning, no read: a run RSI answers at its normal time never asks the status feed", async () => {
  const { state, tick } = await harness();
  let current;
  for (let index = 0; index < 12; index += 1) current = await tick();
  assert.equal(current.pace.warning, null);
  assert.equal(current.requestCount, 12);
  assert.deepEqual(state.reads, []);
  assert.equal(current.actualRequestsByAllowance.statusChecks, 0);
  assert.equal(current.pace.statusPage, null);
});

test("\"limited\" first shows: one read at the refusal, reserved first and merged into the job, logged as a smart-check line", async () => {
  const { state, repository, tick } = await harness();
  await tick();
  state.refusing = true;
  const refusedAt = state.clock;
  const refused = await tick();
  assert.equal(refused.pace.warning, "limited");
  assert.deepEqual(state.reads, [refusedAt], "one read, at the refusal");
  assert.equal(refused.actualRequestsByAllowance.statusChecks, 1, "the read is reserved under its own allowance");
  const merged = await repository.getJob(refused.jobId);
  assert.deepEqual(plain(merged.pace.statusPage), { status: "issue", reason: null, components: [{ name: "Platform", state: "degraded performance" }], httpStatus: 200, checkedAt: new Date(refusedAt).toISOString() });
  // The next refused attempt, inside the cache period, reads nothing, and its write keeps the merged result.
  const next = await tick();
  assert.equal(state.reads.length, 1);
  assert.equal(next.pace.statusPage.checkedAt, new Date(refusedAt).toISOString());
  const lines = next.activityLog.filter((line) => line.kind === "smart-check");
  assert.deepEqual(plain(lines).map((line) => [line.check, line.outcome, line.httpStatus, line.at]), [["status-page", "issue", 200, new Date(refusedAt).toISOString()]]);
  const seqs = plain(next.activityLog).map((line) => line.seq);
  assert.deepEqual(seqs, [...new Set(seqs)].sort((left, right) => left - right), "no activity number is used twice");
});

test("while a warning still shows, the feed is read again every 5 minutes, at refused attempts and at stored steps", async () => {
  // Refused attempts: RSI refuses for four cache periods; its waits grow, so attempts come further apart.
  const refusing = await harness();
  await refusing.tick();
  refusing.state.refusing = true;
  let current;
  const refusingUntil = refusing.state.clock + 4 * CACHE_MS;
  while (refusing.state.clock < refusingUntil) current = await refusing.tick();
  assert.equal(current.pace.warning, "limited");
  assert.ok(refusing.state.reads.length >= 3, `${refusing.state.reads.length} reads`);
  assert.ok(gapsOf(refusing.state.reads).every((gap) => gap >= CACHE_MS), `gaps ${gapsOf(refusing.state.reads)}`);
  assert.equal(current.actualRequestsByAllowance.statusChecks, refusing.state.reads.length);
  // Stored steps: RSI answers, slowly, for more than two cache periods.
  const slow = await harness();
  for (let index = 0; index < 5; index += 1) await slow.tick();
  slow.state.elapsedMs = 2_500;
  const slowFrom = slow.state.clock;
  for (let index = 0; index < 600 && slow.state.clock < slowFrom + 2 * CACHE_MS + 60_000; index += 1) current = await slow.tick();
  assert.equal(current.pace.warning, "slow");
  assert.ok(slow.state.reads.length >= 3, `${slow.state.reads.length} reads`);
  assert.ok(gapsOf(slow.state.reads).every((gap) => gap >= CACHE_MS), `gaps ${gapsOf(slow.state.reads)}`);
  assert.equal(current.actualRequestsByAllowance.statusChecks, slow.state.reads.length);
});
