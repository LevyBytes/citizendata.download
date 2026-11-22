// Each bound the request pacing settings validator holds (shared/request-pacing-settings.js): at both ends, one
// past each, and between two whole numbers.
import assert from "node:assert/strict";
import test from "node:test";
import { shared, withValue } from "./requestpacingsettingsundertest.mjs";

test("each bound the validator holds, at both ends, one past each, and between two whole numbers", () => {
  const validate = shared.validateRequestPacingSettings;
  // Each case: the key, its bounds, and the other values that must move with it for the case to test this key alone.
  const longestInterval = [["brakes", "maximumIntervalMs"], 3600000];
  const bounds = [
    [["accountBuild", "requestTimeoutMs"], 5000, 30000],
    [["accountBuild", "staggerPercent"], 1, 100],
    [["accountBuild", "sections", "hangarLog", "intervalMs"], 250, 120000],
    [["accountBuild", "sections", "hangarLog", "jitterMs"], 0, 2000],
    [["accountBuild", "sections", "hangarLog", "lanes"], 1, 2],
    [["organizationRosters", "intervalMs"], 250, 120000],
    [["organizationRosters", "jitterPercent"], 0, 50],
    [["organizationRosters", "lanes"], 1, 2],
    [["images", "concurrency"], 2, 4],
    [["images", "attempts"], 1, 3],
    [["images", "controlImageReuseMs"], 1000, 60000],
    [["images", "maximumRefusedAttemptsPerImage"], 1, 20],
    [["runStart", "identifyRetryBudgetMs"], 0, 55000],
    [["runStart", "coolDownMs"], 0, 3600000],
    [["brakes", "startSlowerPercent"], 0, 1000],
    [["brakes", "latencyBrakeMaximumPercent"], 0, 1000],
    [["brakes", "speedUpPercent"], 1, 100],
    [["brakes", "slowDownPercent"], 1, 1000],
    [["brakes", "wallMarginPercent"], 0, 100],
    [["brakes", "slowedJitterPercent"], 0, 50],
    [["brakes", "speedUpEveryMs"], 1000, 600000],
    [["brakes", "retestFirstMs"], 10000, 86400000, [[["brakes", "retestMaximumMs"], 86400000]]],
    [["brakes", "retestMaximumMs"], 10000, 86400000, [[["brakes", "retestFirstMs"], 10000]]],
    [["brakes", "maximumIntervalMs"], 1000, 3600000, [[["organizationRosters", "intervalMs"], 1000]]],
    [["brakes", "maximumInStepWaitMs"], 250, 25000],
    [["brakes", "firstWaitMs"], 1000, 3600000, [[["brakes", "maximumWaitMs"], 3600000]]],
    [["brakes", "maximumWaitMs"], 1000, 3600000, [[["brakes", "firstWaitMs"], 1000]]],
    [["brakes", "latencyMinimumMs"], 100, 30000],
    [["brakes", "freeRetryQuietMs"], 0, 3600000],
    [["brakes", "giveUpAfterRefusingMs"], 60000, 21600000],
    [["brakes", "coolDownMs"], 0, 3600000],
    [["brakes", "lifetimeMarginMs"], 0, 600000],
    [["setAside", "quietMs"], 0, 3600000],
    [["setAside", "maximumSections"], 0, 10],
    [["smartCheck", "statusPageCacheMs"], 60000, 3600000],
    [["smartCheck", "statusTimeoutMs"], 1000, 10000],
    [["history", "detailedRuns"], 1, 100],
    [["history", "maximumSignalBuckets"], 8, 256],
    [["history", "maximumLatencySamplesPerRequestFamily"], 5, 100],
    ...["accountRetries", "rosterRetries", "canaryAndSessionChecks", "probes", "statusChecks"].map((key) => [["requestBounds", key], 0, 10000])
  ];
  for (const [keys, minimum, maximum, also = []] of bounds) {
    // The validator names a section by its id in brackets, since ids hold dots.
    const name = keys[1] === "sections" ? `accountBuild.sections["${keys[2]}"].${keys[3]}` : keys.join(".");
    const pattern = (text) => new RegExp(`${name.replace(/[.[\]]/gu, "\\$&")} must be ${text}`, "u");
    // An interval reaches the top of its range only when the longest interval the brakes allow reaches it too.
    const moves = keys.at(-1) === "intervalMs" ? [...also, longestInterval] : also;
    assert.equal(validate(withValue(keys, minimum, moves)), null, `${name} at its minimum`);
    assert.equal(validate(withValue(keys, maximum, moves)), null, `${name} at its maximum`);
    assert.match(validate(withValue(keys, minimum - 1, moves)), pattern(`from ${minimum} to ${maximum}`), `${name} below`);
    assert.match(validate(withValue(keys, maximum + 1, moves)), pattern(`from ${minimum} to ${maximum}`), `${name} above`);
    assert.match(validate(withValue(keys, minimum + 0.5, moves)), pattern("a whole number"), `${name} not whole`);
  }
  // An interval of 90 for 900 is the typo the lower bound is there for.
  assert.match(validate(withValue(["accountBuild", "sections", "profile", "intervalMs"], 90)), /must be from 250 to 120000/u);
  // A section may hold its jitter as a share of its interval instead.
  const shareOfInterval = withValue(["accountBuild", "sections", "profile"], { intervalMs: 900, jitterPercent: 50, lanes: 2 });
  assert.equal(validate(shareOfInterval), null);
  assert.match(validate(withValue(["accountBuild", "sections", "profile"], { intervalMs: 900, jitterPercent: 51, lanes: 2 })), /must be from 0 to 50/u);
});
