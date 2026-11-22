// RSI's status feed when "slow" first shows, and a slow feed (PARSER_HARDENING.md §7.5, D13): one read at the step
// that shows it, and a feed that does not answer never holds up a wait or a step.
import assert from "node:assert/strict";
import test from "node:test";
import { CACHE_MS, harness } from "./runnerstatusfeedwarningharness.mjs";

test("\"slow\" first shows: one read at the step that shows it", async () => {
  const { state, tick } = await harness();
  let current;
  for (let index = 0; index < 5; index += 1) current = await tick();
  state.elapsedMs = 2_500;
  for (let index = 0; index < 5 && current.pace.warning !== "slow"; index += 1) current = await tick();
  assert.equal(current.pace.warning, "slow");
  assert.equal(state.reads.length, 1, "one read when slow first shows");
  await tick();
  assert.equal(state.reads.length, 1, "none more inside the cache period");
});

test("a slow feed never holds up a step: the run goes on while the read is unanswered, and no second read starts", async () => {
  const { state, tick } = await harness();
  state.feed = () => new Promise(() => {});
  await tick();
  state.refusing = true;
  await tick();
  state.refusing = false;
  let current;
  const from = state.clock;
  for (let index = 0; index < 400 && state.clock < from + 2 * CACHE_MS; index += 1) current = await tick();
  assert.ok(current.requestCount > 10, `${current.requestCount} steps stored`);
  assert.equal(state.reads.length, 1, "one read under way at a time");
  assert.equal(current.pace.statusPage, null);
});
