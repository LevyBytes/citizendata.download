import assert from "node:assert/strict";
import test from "node:test";

await import("../../extension/adapters/catalog.js");
test("the adapter catalog exposes every baseline section to the live runtime, each reader with the extension's one version", async () => {
  const catalog = globalThis.CitizenDataAdapterCatalog;
  assert.ok(catalog.adapters.length >= 12);
  const { readFile } = await import("node:fs/promises");
  const extensionVersion = JSON.parse(await readFile(new URL("../../extension/manifest.json", import.meta.url), "utf8")).version;
  assert.deepEqual([...new Set(catalog.adapters.map((adapter) => adapter.version))], [extensionVersion]);
  assert.ok(catalog.adapters.every(adapter => !("enabled" in adapter) && !("fixtureStatus" in adapter)));
  assert.equal(catalog.get("hangarLog").route, "/api/account/pledgeLog");
  assert.equal(catalog.get("buybacks").route, "/api/account/buybackPledges");
  assert.equal(catalog.get("referrals.current.prospects").parserOptions.sharedProspects, true);
  assert.equal(catalog.get("referrals.legacy.prospects"), null);
  assert.ok(catalog.adapters.every(adapter => adapter.transport === "background"));
  assert.equal(catalog.get("financial.billingTotal").route, "/account/billing");
});

test("organization roster catalog entries are fixed from strict SIDs and separately authorized", () => {
  const catalog = globalThis.CitizenDataAdapterCatalog;
  const adapter = catalog.get("organizations.members.TEST");
  assert.equal(adapter.route, "/api/orgs/getOrgMembers");
  assert.equal(adapter.transport, "background");
  assert.equal(adapter.section, "organizations.members.TEST");
  assert.deepEqual(adapter.parserOptions, { organizationSid: "TEST" });
  assert.equal(adapter.separateAuthorization, true);
  assert.equal(adapter.minimumInterRequestDelayMs, 10000);
  assert.equal("enabled" in adapter, false);
  assert.equal(catalog.get("organizations.members.test"), null);
  assert.equal(catalog.get("organizations.members.../TEST"), null);
});
