// The pace controller (shared/pace-controller.js, PARSER_HARDENING.md §6.6 A): RSI limits nothing, so every run
// starts at factor 2 and reaches today's schedule; the step interval of each factor of the table. Both synced
// copies are loaded.
import assert from "node:assert/strict";
import test from "node:test";
import { load, Pace, settings, T0, interval, accepted } from "./pacecontrollerundertest.mjs";

const dashboard = await load(["docs", "scripts"]);

const plain = (value) => JSON.parse(JSON.stringify(value));

test("A. RSI limits nothing: every run starts at factor 2 and reaches today's schedule about 80 seconds after its first answer", () => {
  const first = Pace.initialPace(settings);
  assert.equal(first.factor, 2);
  assert.deepEqual(plain(first), plain(dashboard.CitizenDataPaceController.initialPace(dashboard.CITIZENDATA_REQUEST_PACING)));
  // The account build: the factors of the table, step by step.
  const seen = [];
  let pace = first;
  let now = T0;
  while (pace.factor > 1) {
    pace = accepted(pace, now);
    if (seen.at(-1)?.factor !== pace.factor) seen.push({ seconds: (now - T0) / 1000, factor: pace.factor });
    now += interval(900, pace.factor);
  }
  assert.deepEqual(seen.map((entry) => Number(entry.factor.toFixed(3))), [2, 1.667, 1.389, 1.157, 1]);
  assert.deepEqual(seen.map((entry) => Math.round(entry.seconds / 20) * 20), [0, 20, 40, 60, 80]);
  assert.ok(seen.at(-1).seconds > 80 && seen.at(-1).seconds < 82, `the account build reached factor 1 at ${seen.at(-1).seconds} s`);
  // The roster run, one step every 10 to 20 seconds, reaches it after about 90 seconds.
  let roster = Pace.initialPace(settings);
  let rosterNow = T0;
  for (;;) {
    roster = Pace.onSuccess(roster, { requestFamily: "roster", elapsedMs: 50, historicalNormal: null, nowMs: rosterNow, settings, maxFactor: 12 });
    if (roster.factor === 1) break;
    rosterNow += interval(10000, roster.factor);
  }
  assert.ok((rosterNow - T0) / 1000 > 89 && (rosterNow - T0) / 1000 < 92, `the roster run reached factor 1 at ${(rosterNow - T0) / 1000} s`);
});

test("A. the step interval of each factor of the table, and today's interval and jitter at factor 1", () => {
  const baseline = settings.accountBuild.sections.hangarLog;
  const at = (factor, u) => Pace.stepIntervalMs({ baseline, planFloorMs: 900, pace: { factor }, settings, random: () => u });
  for (const [factor, low, high] of [[2, 1800, 2069], [1.6667, 1500, 1724], [1.3889, 1250, 1436], [1.1574, 1042, 1197], [1, 900, 1100]]) {
    assert.equal(at(factor, 0), low, `factor ${factor} at its lowest`);
    assert.equal(at(factor, 0.99999), high, `factor ${factor} at its highest`);
  }
  // Today's runner.js: 900 + min(200, floor(201 u)); any other interval + floor(floor(interval × 15 / 100) u).
  const today = (delay, u) => delay === 900 ? delay + Math.min(200, Math.floor(201 * u)) : delay + Math.floor(Math.floor((delay * 15) / 100) * u);
  for (const u of [0, 0.1, 0.5, 0.995, 1]) {
    assert.equal(at(1, u), today(900, u), `900 ms at ${u}`);
    assert.equal(Pace.stepIntervalMs({ baseline: settings.organizationRosters, planFloorMs: 10000, pace: { factor: 1 }, settings, random: () => u }), today(10000, u), `10,000 ms at ${u}`);
    assert.equal(Pace.stepIntervalMs({ baseline, planFloorMs: 1200, pace: { factor: 1 }, settings, random: () => u }), today(1200, u), `a plan floor of 1,200 ms at ${u}`);
  }
  // The stagger stays half the interval, and the lanes do not change with the factor.
  assert.equal(Math.floor((at(2, 0) * settings.accountBuild.staggerPercent) / 100), 900);
  // No interval is longer than the longest the brakes allow.
  assert.equal(at(500, 0.99999), settings.brakes.maximumIntervalMs + Math.floor(Math.floor((settings.brakes.maximumIntervalMs * 15) / 100) * 0.99999));
});
