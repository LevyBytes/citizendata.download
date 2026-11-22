// The pace controller under a throttle (PARSER_HARDENING.md §6.6 B): the wall holds the pace until the re-test,
// and a refusal during the re-test moves the wall down while the re-tests wait 10, 20, then 20 minutes.
import assert from "node:assert/strict";
import test from "node:test";
import { Pace, settings, T0, interval, accepted, refused, close, acceptUntil } from "./pacecontrollerundertest.mjs";

test("B. a throttle: refused at 1 and 2, accepted at 4; the wall holds the pace until the re-test, which passes", () => {
  let pace = Pace.atBaseline(settings);
  let now = T0;
  const first = refused(pace, now);
  assert.deepEqual([first.pace.factor, first.pace.wall, first.waitMs, first.action, first.pace.warning], [2, 1, 3750, "wait", "limited"]);
  assert.ok(first.waitMs >= 2500 && first.waitMs <= 5000);
  now += first.waitMs;
  const second = refused(first.pace, now);
  assert.deepEqual([second.pace.factor, second.pace.wall, second.waitMs], [4, 2, 7500]);
  now += second.waitMs;
  pace = accepted(second.pace, now);
  assert.equal(interval(900, pace.factor), 3600, "the retry at 4 is accepted at 3,600 ms");
  // 20 s and 40 s later, then held at 2 × 1.25 until the re-test.
  ({ pace, now } = acceptUntil(pace, now, 900, (state) => state.factor < 3.4));
  close(pace.factor, 3.33);
  ({ pace, now } = acceptUntil(pace, now, 900, (state) => state.factor < 2.8));
  close(pace.factor, 2.78);
  ({ pace, now } = acceptUntil(pace, now, 900, (state) => state.factor <= 2.5));
  assert.equal(pace.factor, 2.5);
  assert.equal(interval(900, pace.factor), 2250);
  const heldAt = now;
  ({ pace, now } = acceptUntil(pace, now, 900, (state) => state.factor < 2.5));
  assert.ok(now >= Date.parse(pace.retestAt) - 30000 && now - heldAt > 200000, "the pace holds until the re-test");
  close(pace.factor, 2.08);
  ({ pace, now } = acceptUntil(pace, now, 900, (state) => state.factor < 2));
  close(pace.factor, 1.74);
  ({ pace, now } = acceptUntil(pace, now, 900, (state) => state.factor < 1.7));
  close(pace.factor, 1.45);
  assert.equal(pace.wall, 2);
  // 20 s below the wall with no refusal: the wall is forgotten and the warning clears.
  ({ pace, now } = acceptUntil(pace, now, 900, (state) => state.wall === null));
  close(pace.factor, 1.21);
  assert.deepEqual([pace.warning, pace.retestAfterMs, pace.retestAt], [null, settings.brakes.retestFirstMs, null]);
  ({ now } = acceptUntil(pace, now, 900, (state) => state.factor === 1));
  const minutes = (now - T0) / 60000;
  assert.ok(minutes > 6 && minutes < 7, `today's schedule again after ${minutes} minutes`);
});

test("B. a refusal during the re-test is a failed re-test: the wall moves down, and the re-tests wait 10, 20, then 20 minutes", () => {
  let pace = refused(Pace.atBaseline(settings), T0).pace;
  let now = T0 + 3750;
  pace = refused(pace, now).pace;
  now += 7500;
  ({ pace, now } = acceptUntil(pace, now, 900, (state) => state.factor < 1.75 && state.factor < state.wall));
  close(pace.factor, 1.74);
  const failed = refused(pace, now);
  close(failed.pace.wall, 1.74);
  close(failed.pace.factor, 3.47);
  assert.equal(failed.pace.retestAfterMs, 600000);
  ({ pace } = acceptUntil(failed.pace, now + failed.waitMs, 900, (state) => state.factor <= state.wall * 1.25 + 1e-9));
  close(pace.factor, 2.17);
  // Each failed re-test doubles the wait, to at most 20 minutes.
  const waits = [];
  let state = { ...Pace.atBaseline(settings), wall: 2, factor: 1.5, retestAt: new Date(T0).toISOString() };
  for (let index = 0; index < 4; index += 1) {
    state = refused(state, T0).pace;
    waits.push(state.retestAfterMs / 60000);
    state = { ...state, factor: state.wall - 0.1 };
  }
  assert.deepEqual(waits, [10, 20, 20, 20]);
  assert.equal(refused(Pace.atBaseline(settings), T0).pace.retestAfterMs / 60000, 5, "the first re-test comes after 5 minutes");
});
