// The pace controller under a ban (PARSER_HARDENING.md §6.6 C): the waits and factors of the table, then the
// give-up 26 minutes in, and a ban that ends at minute 20.
import assert from "node:assert/strict";
import test from "node:test";
import { Pace, settings, T0, LIMIT, interval, accepted, refused, close, acceptUntil } from "./pacecontrollerundertest.mjs";

test("C. a ban: the waits and factors of the table, then the give-up 26 minutes in, after 13 refused requests", () => {
  let pace = Pace.atBaseline(settings);
  let now = T0;
  const rows = [];
  let outcome;
  for (;;) {
    outcome = refused(pace, now);
    rows.push({ wait: outcome.waitMs, factor: outcome.pace.factor });
    pace = outcome.pace;
    if (outcome.action !== "wait") break;
    now += outcome.waitMs;
  }
  assert.equal(outcome.action, "give-up");
  assert.equal(rows.length, 13);
  assert.ok((now - T0) / 60000 > 26 && (now - T0) / 60000 < 27);
  assert.deepEqual(rows.slice(0, 8).map((row) => row.wait), [3750, 7500, 15000, 30000, 60000, 120000, 225000, 225000]);
  assert.deepEqual(rows.slice(0, 7).map((row) => row.factor), [2, 4, 8, 16, 32, 64, 128]);
  close(rows[7].factor, 133.33);
  // Every wait lies in its range: [ceiling / 2, ceiling] of 5 s, 10 s, 20 s ... 5 min.
  for (const [attempt, ceiling] of [[0, 5000], [1, 10000], [6, 300000], [12, 300000]]) {
    assert.equal(Pace.waitMs(attempt, LIMIT, settings.brakes, () => 0), ceiling / 2);
    assert.equal(Pace.waitMs(attempt, LIMIT, settings.brakes, () => 1), ceiling);
  }
  // A Retry-After is a minimum, never a reason to come back sooner; one that is too long gives up at once.
  assert.equal(Pace.waitMs(0, { ...LIMIT, retryAfterMs: 60000 }, settings.brakes, () => 1), 60000);
  assert.equal(refused(Pace.atBaseline(settings), T0, { ...LIMIT, retryAfterMs: 2 * 3600000 }).action, "give-up");
});

test("C. a ban that ends at minute 20: accepted at factor 133, then 45 and 31, and today's schedule about 9 minutes later", () => {
  let pace = Pace.atBaseline(settings);
  let now = T0;
  while (now - T0 < 20 * 60000) {
    const outcome = refused(pace, now);
    pace = outcome.pace;
    now += outcome.waitMs;
  }
  const firstAcceptedAt = now;
  const factors = [];
  for (let index = 0; index < 3; index += 1) {
    pace = accepted(pace, now);
    factors.push(pace.factor);
    now += interval(900, pace.factor);
  }
  close(factors[0], 133.33);
  assert.equal(Math.round(factors[1]), 45);
  assert.equal(Math.round(factors[2]), 31);
  ({ now } = acceptUntil(pace, now, 900, (state) => state.factor === 1));
  const minutes = (now - firstAcceptedAt) / 60000;
  assert.ok(minutes > 8.5 && minutes < 9.5, `today's schedule again ${minutes} minutes after the first accepted answer`);
});
