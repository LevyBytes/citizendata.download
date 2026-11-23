// The test-only Chrome launch settings (audit item 9): the profile comes from its variable; a refused GPU start before
// any answer is tried again once with the software profile; nothing else is retried.
import assert from "node:assert/strict";
import test from "node:test";
import { LAUNCH_PROFILES, PROFILE_VARIABLE, chosenProfile, launchWithFallback, startThroughHandshake } from "./chrome-test-launch.mjs";

const exited = (exitCode) => Object.assign(new Error("Chrome exited before answering."), { exitCode });
// A simulated browser: its port file is there, and its handshake waits for `answer` or fails with `failHandshake`;
// `exit(code)` ends the process. `stops` counts the stops asked for.
function browser() {
  const simulated = { stops: 0 };
  simulated.exited = new Promise((resolve) => { simulated.exit = resolve; });
  const handshake = new Promise((resolve, reject) => { simulated.answer = resolve; simulated.failHandshake = reject; });
  simulated.launched = { exited: simulated.exited, handshake: () => handshake, stop: async () => { simulated.stops += 1; } };
  return simulated;
}

test("the profile is standard unless its variable names another, and an unknown name is refused", () => {
  assert.equal(chosenProfile({}), "standard");
  assert.equal(chosenProfile({ [PROFILE_VARIABLE]: "software" }), "software");
  assert.throws(() => chosenProfile({ [PROFILE_VARIABLE]: "fast" }), /must be one of standard, software/u);
});

test("a refused GPU start is tried again once with the software profile, and both launches are reported", async () => {
  for (const exitCode of [3221225506, -1073741790]) {
    const launches = [];
    const reports = [];
    const result = await launchWithFallback(async (flags, profile) => {
      launches.push(profile);
      if (profile === "standard") throw exited(exitCode);
      return flags;
    }, { profile: "standard", report: (profile, flags, why = null) => reports.push([profile, flags.length, why]) });
    assert.deepEqual(launches, ["standard", "software"]);
    assert.deepEqual(result, LAUNCH_PROFILES.software);
    assert.equal(reports.length, 2);
    assert.match(reports[1][2], new RegExp(`exited with ${exitCode}`, "u"));
  }
});

test("any other failure, or a refused start under the software profile, is not retried", async () => {
  for (const [profile, error] of [["standard", exited(1)], ["standard", new Error("Timed out")], ["software", exited(3221225506)]]) {
    let launches = 0;
    await assert.rejects(launchWithFallback(async () => { launches += 1; throw error; }, { profile }), error);
    assert.equal(launches, 1, `${profile}: ${error.message}`);
  }
});

test("Chrome that exits after its port file but before the handshake's first answer fails the start with its exit code", async () => {
  const early = browser();
  const start = startThroughHandshake(async () => early.launched, [], "standard");
  early.exit(-1073741790);
  await assert.rejects(start, (error) => error.exitCode === -1073741790);
  // A socket closed by the crash is seen before the exit; the exit code is still learned.
  const closed = browser();
  const second = startThroughHandshake(async () => closed.launched, [], "standard");
  closed.failHandshake(new Error("socket closed"));
  closed.exit(3221225506);
  await assert.rejects(second, (error) => error.message === "socket closed" && error.exitCode === 3221225506);
  // A handshake that fails while Chrome keeps running carries no exit code; every failed start is stopped.
  const running = browser();
  const third = startThroughHandshake(async () => running.launched, [], "standard", { exitWaitMs: 1 });
  running.failHandshake(new Error("no page target"));
  await assert.rejects(third, (error) => error.message === "no page target" && error.exitCode === undefined);
  assert.deepEqual([early.stops, closed.stops, running.stops], [1, 1, 1]);
});

test("a GPU exit before the handshake completes is retried once with the software profile, whose handshake is the result", async () => {
  const launched = { standard: browser(), software: browser() };
  const profiles = [];
  const result = launchWithFallback((flags, profile) => startThroughHandshake(async () => {
    profiles.push(profile);
    if (profile === "standard") launched.standard.exit(-1073741790);
    else launched.software.answer({ socket: "open" });
    return launched[profile].launched;
  }, flags, profile), { profile: "standard" });
  assert.deepEqual(await result, { socket: "open" });
  assert.deepEqual(profiles, ["standard", "software"]);
  assert.deepEqual([launched.standard.stops, launched.software.stops], [1, 0]);
});
