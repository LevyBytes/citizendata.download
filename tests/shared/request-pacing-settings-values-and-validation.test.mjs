// The request pacing settings (shared/request-pacing-settings.js): today's values, the canonical section order in
// both section structures and the catalog, the two synced copies, and the fingerprint. Both synced copies are
// loaded, each in its own context.
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { loadClassicScripts } from "../extension/load-classic-script.mjs";
import { root, load, shared, ORDER, withValue } from "./requestpacingsettingsundertest.mjs";

const extensionCopy = await load("extension", "shared", "request-pacing-settings.js");

const dashboardCopy = await load("docs", "scripts", "request-pacing-settings.js");

const TWO_LANES = new Set(["profile", "hangarLog", "pledges", "buybacks", "buybackDetails"]);

test("the settings hold today's pace as the fastest baseline and the brakes of the plan, valid and deeply frozen", () => {
  const { settings } = shared;
  assert.equal(shared.validationMessage, null);
  assert.equal(settings.version, 1);
  assert.equal(settings.accountBuild.requestTimeoutMs, 25000);
  assert.equal(settings.accountBuild.staggerPercent, 50);
  for (const id of ORDER) {
    assert.deepEqual({ ...settings.accountBuild.sections[id] }, { intervalMs: 900, jitterMs: 200, lanes: TWO_LANES.has(id) ? 2 : 1 }, id);
  }
  assert.deepEqual({ ...settings.organizationRosters }, { intervalMs: 10000, jitterPercent: 15, lanes: 1 });
  assert.deepEqual({ ...settings.images }, { startGapMinimumMs: 100, startGapMaximumMs: 200, concurrency: 4, attempts: 3, retryMinimumMs: 750, retryMaximumMs: 1750, controlImageReuseMs: 10000, maximumRefusedAttemptsPerImage: 8 });
  assert.deepEqual({ ...settings.runStart }, { identifyRetryBudgetMs: 45000, coolDownMs: 60000 });
  assert.deepEqual({ ...settings.brakes }, {
    startSlowerPercent: 100, speedUpPercent: 20, speedUpEveryMs: 20000,
    retestFirstMs: 300000, retestMaximumMs: 1200000,
    slowDownPercent: 100, maximumIntervalMs: 120000, maximumInStepWaitMs: 10000,
    firstWaitMs: 5000, maximumWaitMs: 300000, wallMarginPercent: 25, slowedJitterPercent: 15,
    latencyRatio: 2, latencyMinimumMs: 1000, latencyBrakeMaximumPercent: 100,
    freeRetryQuietMs: 600000,
    giveUpAfterRefusingMs: 1800000, coolDownMs: 300000, lifetimeMarginMs: 60000
  });
  assert.deepEqual({ ...settings.setAside }, { quietMs: 600000, maximumSections: 3 });
  assert.deepEqual({ ...settings.smartCheck }, { statusFeedUrl: "https://status.robertsspaceindustries.com/index.json", statusPageCacheMs: 300000, statusTimeoutMs: 5000 });
  assert.deepEqual({ ...settings.history }, { detailedRuns: 100, maximumSignalBuckets: 64, maximumLatencySamplesPerRequestFamily: 25 });
  assert.deepEqual({ ...settings.requestBounds }, { accountRetries: 256, rosterRetries: 64, canaryAndSessionChecks: 128, probes: 1, statusChecks: 72 });
  assert.deepEqual([...Object.keys(settings)], ["version", "accountBuild", "organizationRosters", "images", "runStart", "brakes", "setAside", "smartCheck", "history", "requestBounds"]);
  assert.ok(Object.isFrozen(settings) && Object.isFrozen(settings.accountBuild.sections.profile) && Object.isFrozen(settings.accountBuild.sectionOrder) && Object.isFrozen(settings.brakes));
});

test("every account section is named exactly once in both section structures, identity first and Hangar Log second", () => {
  const { settings } = shared;
  assert.deepEqual([...settings.accountBuild.sectionOrder], ORDER);
  assert.deepEqual([...Object.keys(settings.accountBuild.sections)].sort(), [...ORDER].sort());
  assert.equal(new Set(settings.accountBuild.sectionOrder).size, 15);
  assert.deepEqual([...settings.accountBuild.sectionOrder.slice(0, 2)], ["profile", "hangarLog"]);
});

test("the catalog, the dashboard's collection list and both section structures name the same 15 sections once each", async () => {
  const context = await loadClassicScripts([
    path.join(root, "extension", "shared", "request-pacing-settings.js"),
    path.join(root, "extension", "adapters", "catalog.js")
  ]);
  const catalogIds = context.CitizenDataAdapterCatalog.adapters.map((adapter) => adapter.id);
  const dashboard = await loadClassicScripts([
    path.join(root, "docs", "scripts", "request-pacing-settings.js"),
    path.join(root, "docs", "scripts", "dashboard-model.js")
  ]);
  const model = dashboard.CitizenDataDashboardModel;
  const dashboardIds = ORDER.filter((id) => model.collectionSectionPresentation(id).label !== "Account backup");
  for (const list of [catalogIds, dashboardIds, Object.keys(shared.settings.accountBuild.sections), [...shared.settings.accountBuild.sectionOrder]]) {
    assert.equal(list.length, 15);
    assert.equal(new Set(list).size, 15);
    assert.deepEqual([...list].sort(), [...ORDER].sort());
  }
  assert.equal(context.CitizenDataAdapterCatalog.get("buybackDetails").recordsPerStep, shared.settings.accountBuild.sections.buybackDetails.lanes);
  assert.equal(context.CitizenDataAdapterCatalog.get("organizations.members.TEST").minimumInterRequestDelayMs, shared.settings.organizationRosters.intervalMs);
});

test("the two synced copies are the source byte for byte in behaviour: same values, same verdicts, same fingerprint", async () => {
  for (const copy of [extensionCopy, dashboardCopy]) {
    assert.deepEqual(JSON.parse(JSON.stringify(copy.settings)), JSON.parse(JSON.stringify(shared.settings)));
    assert.equal(copy.validationMessage, null);
    assert.equal(await copy.settingsFingerprint(), await shared.settingsFingerprint());
  }
});

test("the fingerprint is the SHA-256 of sorted-key JSON, encoded as UTF-8, whatever the key order", async () => {
  const vector = { b: [1, { d: "é", c: true }], a: null };
  for (const api of [shared, extensionCopy, dashboardCopy]) {
    assert.equal(api.canonicalSettingsJson(vector), '{"a":null,"b":[1,{"c":true,"d":"é"}]}');
    assert.equal(await api.settingsFingerprint(vector), "8c07b33d327d4b77db8eec4d6e5a348de9b1060c05bf4e8be071a4ece713bde5");
    assert.equal(await api.settingsFingerprint({ a: null, b: [1, { c: true, d: "é" }] }), await api.settingsFingerprint(vector));
  }
  assert.match(await shared.settingsFingerprint(), /^[0-9a-f]{64}$/u);
  assert.notEqual(await shared.settingsFingerprint(withValue(["accountBuild", "sections", "profile", "intervalMs"], 901)), await shared.settingsFingerprint());
});
