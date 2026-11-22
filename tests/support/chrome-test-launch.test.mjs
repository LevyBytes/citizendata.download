// The test-only Chrome launch settings (audit item 9): the profile comes from its variable; a refused GPU start before
// any answer is tried again once with the software profile; nothing else is retried.
import assert from "node:assert/strict";
import test from "node:test";
import { LAUNCH_PROFILES, PROFILE_VARIABLE, chosenProfile, launchWithFallback } from "./chrome-test-launch.mjs";

const exited = (exitCode) => Object.assign(new Error("Chrome exited before answering."), { exitCode });

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
