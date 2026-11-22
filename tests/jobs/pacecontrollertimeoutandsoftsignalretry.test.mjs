// One timeout and other soft signals (PARSER_HARDENING.md §6.6 D, rule 8): a timeout during the start ramp is
// retried once with nothing else changed, and a soft signal is retried once only under rule 8's three conditions.
import assert from "node:assert/strict";
import test from "node:test";
import { Pace, settings, T0, LIMIT, TIMEOUT, middle, accepted, refused, close, acceptUntil } from "./pacecontrollerundertest.mjs";

test("D. one timeout during the start ramp is retried once with nothing else changed; a second one at that retry is a refusal", () => {
  let pace = Pace.initialPace(settings);
  let now = T0;
  ({ pace, now } = acceptUntil(pace, now, 900, (state) => state.factor < 1.7));
  close(pace.factor, 1.67);
  const timeoutAt = now;
  const free = Pace.freeRetry(pace, TIMEOUT, { nowMs: now, random: middle, settings });
  assert.equal(free.waitMs, 3750);
  assert.ok(free.waitMs >= 2500 && free.waitMs <= 5000);
  for (const key of ["factor", "wall", "warning", "attempt", "refusingSince", "canaryDue"]) assert.deepEqual(free.pace[key], pace[key], key);
  assert.equal(free.pace.retryNotBefore, new Date(now + 3750).toISOString());
  // The second timeout before a stored step is a refusal: wall 1.67, held at 2.08, the warning for about 6 minutes.
  assert.equal(Pace.freeRetry(free.pace, TIMEOUT, { nowMs: now + 3750, random: middle, settings }), null);
  const second = refused(free.pace, timeoutAt + 3750, TIMEOUT);
  close(second.pace.wall, 1.67);
  const held = acceptUntil(second.pace, timeoutAt + 3750 + second.waitMs, 900, (state) => state.factor <= state.wall * 1.25 + 1e-9);
  close(held.pace.factor, 2.08);
  const cleared = acceptUntil(held.pace, held.now, 900, (state) => state.warning === null);
  const minutes = (cleared.now - timeoutAt) / 60000;
  assert.ok(minutes > 5.5 && minutes < 6.5, `the warning showed for about ${minutes} minutes`);
});

test("rule 8: a soft signal is retried once only with no refusal in 10 minutes, no stretch of refusals and no retry in use", () => {
  const ready = Pace.atBaseline(settings);
  const free = (pace, signal = TIMEOUT, nowMs = T0) => Pace.freeRetry(pace, signal, { nowMs, random: middle, settings });
  // Soft: a transient signal, or the unclear network failure. A limit and any other unclear answer are refusals at once.
  assert.notEqual(free(ready), null);
  assert.notEqual(free(ready, { kind: "ambiguous", code: "RSI_NETWORK_OR_REDIRECT", retryAfterMs: null }), null);
  assert.notEqual(free(ready, { kind: "transient", code: "RSI_HTML_HTTP_500", retryAfterMs: null }), null);
  assert.equal(free(ready, LIMIT), null);
  assert.equal(free(ready, { kind: "ambiguous", code: "RSI_API_HTTP_403", retryAfterMs: null }), null);
  // Condition 1: a limit or transient refusal in the last 10 minutes.
  assert.equal(free({ ...ready, lastRefusalAt: new Date(T0 - 9 * 60000).toISOString() }), null);
  assert.notEqual(free({ ...ready, lastRefusalAt: new Date(T0 - 10 * 60000).toISOString() }), null);
  // Condition 2: a stretch of refusals with no accepted answer since.
  assert.equal(free({ ...ready, refusingSince: new Date(T0).toISOString() }), null);
  // Condition 3: the one retry is in use until the next stored step clears it.
  const used = free(ready).pace;
  assert.equal(free(used), null);
  assert.equal(accepted(used, T0 + 5000).freeRetryAt, null);
  assert.notEqual(free(accepted(used, T0 + 5000), TIMEOUT, T0 + 6000), null);
  // The wait is the first of rule 6, and never shorter than Retry-After.
  assert.equal(free(ready, { ...TIMEOUT, retryAfterMs: 30000 }).waitMs, 30000);
  // An unclear refusal makes the next step's canary due; a limit does not.
  assert.equal(refused(ready, T0, { kind: "ambiguous", code: "RSI_API_HTTP_403", retryAfterMs: null }).pace.canaryDue, true);
  assert.equal(refused(ready, T0).pace.canaryDue, false);
  assert.equal(refused(ready, T0, { kind: "ambiguous", code: "RSI_API_HTTP_403", retryAfterMs: null }).pace.lastRefusalAt, null, "an unclear answer is not a limit or transient refusal");
});
