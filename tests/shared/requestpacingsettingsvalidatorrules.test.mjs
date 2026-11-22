// The request pacing settings validator's rules (shared/request-pacing-settings.js): missing, extra and versioned
// keys, the canonical section order, the image gaps and retry waits, the latency ratio, and the rules across
// paired keys.
import assert from "node:assert/strict";
import test from "node:test";
import { shared, ORDER, withValue } from "./requestpacingsettingsundertest.mjs";

test("a missing key, an extra key and a wrong version are refused, naming the key", () => {
  const validate = shared.validateRequestPacingSettings;
  assert.match(validate(withValue(["version"], 2)), /^version must be 1/u);
  assert.match(validate(withValue(["runStart"], undefined)), /settings\.runStart is missing/u);
  assert.match(validate({ ...JSON.parse(JSON.stringify(shared.settings)), extra: 1 }), /settings\.extra is not a known setting/u);
  assert.match(validate(withValue(["images", "extra"], 8)), /images\.extra is not a known setting/u);
  for (const group of ["brakes", "setAside", "smartCheck", "history", "requestBounds"]) {
    assert.match(validate(withValue([group], undefined)), new RegExp(`settings\\.${group} is missing`, "u"));
    assert.match(validate(withValue([group, "extra"], 1)), new RegExp(`${group}\\.extra is not a known setting`, "u"));
  }
  assert.match(validate(withValue(["brakes", "freeRetryQuietMs"], undefined)), /brakes\.freeRetryQuietMs is missing/u);
  assert.match(validate(withValue(["accountBuild", "sections", "profile", "jitterMs"], undefined)), /exactly one of jitterMs and jitterPercent/u);
  assert.match(validate(withValue(["accountBuild", "sections", "profile", "jitterPercent"], 10)), /exactly one of jitterMs and jitterPercent/u);
  assert.match(validate(withValue(["accountBuild", "sections", "profile", "speed"], 1)), /\.speed is not a known setting/u);
  assert.match(validate(withValue(["accountBuild", "sections", "pledges"], undefined)), /accountBuild\.sections\.pledges is missing/u);
  assert.match(validate(withValue(["accountBuild", "sections", "extraSection"], { intervalMs: 900, jitterMs: 200, lanes: 1 })), /extraSection is not a known setting/u);
  assert.match(validate(withValue(["accountBuild", "requestTimeoutMs"], 2.5e4 + 0.5)), /requestTimeoutMs must be a whole number/u);
});

test("the section order is exactly the canonical one: none missing, none repeated, none moved", () => {
  const validate = shared.validateRequestPacingSettings;
  assert.equal(validate(withValue(["accountBuild", "sectionOrder"], ORDER)), null);
  const moved = [ORDER[0], ...ORDER.slice(2, 7), ORDER[1], ...ORDER.slice(7)];
  for (const order of [moved, ORDER.slice(1), [...ORDER, "profile"], [...ORDER.slice(0, 14), "pledges"], "profile"]) {
    assert.match(validate(withValue(["accountBuild", "sectionOrder"], order)), /accountBuild\.sectionOrder must/u);
  }
});

test("the image gaps and retry waits hold their bounds, and each minimum is at most its maximum", () => {
  const validate = shared.validateRequestPacingSettings;
  for (const [key, minimum, maximum] of [["startGapMinimumMs", 50, 120000], ["startGapMaximumMs", 50, 120000], ["retryMinimumMs", 100, 60000], ["retryMaximumMs", 100, 60000]]) {
    assert.match(validate(withValue(["images", key], minimum - 1)), new RegExp(`images\\.${key} must be from ${minimum} to ${maximum}`, "u"));
    assert.match(validate(withValue(["images", key], maximum + 1)), new RegExp(`images\\.${key} must be from ${minimum} to ${maximum}`, "u"));
  }
  const gaps = JSON.parse(JSON.stringify(shared.settings));
  gaps.images.startGapMinimumMs = 300;
  assert.match(validate(gaps), /startGapMinimumMs must be at most images\.startGapMaximumMs/u);
  const retries = JSON.parse(JSON.stringify(shared.settings));
  retries.images.retryMinimumMs = 2000;
  assert.match(validate(retries), /retryMinimumMs must be at most images\.retryMaximumMs/u);
});

test("the latency ratio is a number from 1.1 to 10 that need not be whole", () => {
  const validate = shared.validateRequestPacingSettings;
  for (const value of [1.1, 2.5, 10]) assert.equal(validate(withValue(["brakes", "latencyRatio"], value)), null, String(value));
  for (const value of [1.09, 10.01]) assert.match(validate(withValue(["brakes", "latencyRatio"], value)), /brakes\.latencyRatio must be from 1\.1 to 10/u, String(value));
  assert.match(validate(withValue(["brakes", "latencyRatio"], "2")), /brakes\.latencyRatio must be a number/u);
});

test("the paired brake values, the intervals and the status address keep their rules across keys", () => {
  const validate = shared.validateRequestPacingSettings;
  assert.match(validate(withValue(["brakes", "retestFirstMs"], 1200001)), /brakes\.retestFirstMs must be at most brakes\.retestMaximumMs/u);
  assert.match(validate(withValue(["brakes", "firstWaitMs"], 300001)), /brakes\.firstWaitMs must be at most brakes\.maximumWaitMs/u);
  // No baseline interval is longer than the longest interval the brakes allow.
  assert.match(validate(withValue(["brakes", "maximumIntervalMs"], 9999)), /organizationRosters\.intervalMs must be at most brakes\.maximumIntervalMs/u);
  assert.match(validate(withValue(["accountBuild", "sections", "pledges", "intervalMs"], 20000, [[["brakes", "maximumIntervalMs"], 15000]])), /accountBuild\.sections\["pledges"\]\.intervalMs must be at most brakes\.maximumIntervalMs/u);
  assert.equal(validate(withValue(["brakes", "maximumIntervalMs"], 10000)), null);
  // The status check reads only RSI's status host.
  assert.equal(validate(withValue(["smartCheck", "statusFeedUrl"], "https://status.robertsspaceindustries.com/other.json")), null);
  for (const address of ["https://example.com/index.json", "http://status.robertsspaceindustries.com/index.json", "https://status.robertsspaceindustries.com.example.com/", 7]) {
    assert.match(validate(withValue(["smartCheck", "statusFeedUrl"], address)), /smartCheck\.statusFeedUrl must be an address that starts with https:\/\/status\.robertsspaceindustries\.com\//u, String(address));
  }
});
