// Slow answers and the invariants of the pace controller (PARSER_HARDENING.md §6.7): slow answers brake to at most
// 100 % slower and clear when fast again; the factor is never below 1, the plan floor holds, and Resume never
// counts paused time as good.
import assert from "node:assert/strict";
import test from "node:test";
import { Pace, settings, T0, ACCOUNT_MAX, TIMEOUT, accepted, close, LIMIT } from "./pacecontrollerundertest.mjs";

test("slow answers: over twice their normal time and over a second, they brake to at most 100 % slower and clear when fast again", () => {
  const family = "GET /account/pledges in pledges";
  const step = (pace, nowMs, elapsedMs, historicalNormal = null) => Pace.onSuccess(pace, { requestFamily: family, elapsedMs, historicalNormal, nowMs, settings, maxFactor: ACCOUNT_MAX });
  let pace = Pace.atBaseline(settings);
  let now = T0;
  // The first five accepted answers are this run's normal: 400 ms.
  for (let index = 0; index < 5; index += 1) { pace = step(pace, now, 400); now += 1000; }
  // Answers of 1,200 ms: over twice 400 and over 1 s. The recent time is the median of the last five answers, so the
  // third such answer makes it slow.
  for (let index = 0; index < 2; index += 1) { pace = step(pace, now, 1200); now += 1000; }
  assert.equal(pace.warning, null, "two slow answers of the last five are not yet their median");
  pace = step(pace, now, 1200);
  now += 1000;
  assert.equal(pace.warning, "slow");
  // Each full 20 s period multiplies the factor by 1.2, up to 2.
  now += 20000;
  pace = step(pace, now, 1200);
  close(pace.factor, 1.2);
  now += 60000;
  pace = step(pace, now, 1200);
  assert.equal(pace.factor, 2);
  now += 60000;
  pace = step(pace, now, 1200);
  assert.equal(pace.factor, 2, "slow answers alone never brake past 100 % slower");
  // Not slow when the recent median is under 1 s, even at three times the normal.
  let quick = Pace.atBaseline(settings);
  for (let index = 0; index < 5; index += 1) quick = step(quick, T0 + index * 1000, 300);
  for (let index = 0; index < 5; index += 1) quick = step(quick, T0 + 5000 + index * 1000, 900);
  assert.equal(quick.warning, null);
  // The first step that is not slow clears the warning, and the speed-up continues.
  for (let index = 0; index < 5; index += 1) { pace = step(pace, now, 400); now += 1000; }
  assert.equal(pace.warning, null);
  // Five retained historical samples are the normal instead of this run's first five.
  let historical = Pace.atBaseline(settings);
  for (let index = 0; index < 5; index += 1) historical = step(historical, T0 + index * 1000, 1200, [500, 500, 500, 500, 500]);
  assert.equal(historical.warning, "slow");
  // A "limited" warning stays while answers are slow.
  assert.equal(step({ ...pace, warning: "limited" }, now, 400).warning, "limited");
});

test("§6.7: the factor is never below 1, the plan floor holds, and Resume never counts paused time as good", () => {
  let seed = 7;
  const random = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  let pace = Pace.initialPace(settings);
  let now = T0;
  for (let index = 0; index < 2000; index += 1) {
    if (random() < 0.08) pace = Pace.onRefusal(pace, random() < 0.5 ? LIMIT : TIMEOUT, { nowMs: now, random, settings, maxFactor: ACCOUNT_MAX, expiresAtMs: Number.MAX_SAFE_INTEGER }).pace;
    else pace = accepted(pace, now);
    assert.ok(pace.factor >= 1 && pace.factor <= ACCOUNT_MAX, `factor ${pace.factor}`);
    const step = Pace.stepIntervalMs({ baseline: settings.accountBuild.sections.pledges, planFloorMs: 900, pace, settings, random });
    assert.ok(step >= 900 && step <= settings.brakes.maximumIntervalMs * 1.15 + 1);
    now += Math.floor(random() * 30000);
  }
  // A plan that asks for more than the baseline slows every step.
  assert.ok(Pace.stepIntervalMs({ baseline: settings.accountBuild.sections.pledges, planFloorMs: 2000, pace: Pace.atBaseline(settings), settings, random: () => 0 }) >= 2000);
  const resumed = Pace.onResume({ ...Pace.atBaseline(settings), goodSince: new Date(T0).toISOString(), periodsUsed: 4 });
  assert.deepEqual([resumed.goodSince, resumed.periodsUsed], [null, 0]);
  // The image run's start gap is the baseline's at factor 1, stretched with the factor, and never past the longest.
  const images = settings.images;
  assert.equal(Pace.startGapMs({ baseline: images, pace: { factor: 1 }, settings, random: () => 0 }), 100);
  assert.equal(Pace.startGapMs({ baseline: images, pace: { factor: 2 }, settings, random: () => 0.99999 }), 399);
  assert.equal(Pace.startGapMs({ baseline: images, pace: { factor: 10000 }, settings, random: () => 1 }), settings.brakes.maximumIntervalMs);
  assert.equal(Pace.maximumFactor(900, settings), ACCOUNT_MAX);
  assert.equal(Pace.maximumFactor(images.startGapMaximumMs, settings), 600);
});
