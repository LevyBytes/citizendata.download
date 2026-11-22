import assert from "node:assert/strict";
import test from "node:test";
import { createExtensionHarness } from "../support/extension-harness.mjs";
import { AccountDocument, assertCompleteDocument } from "./service-worker-fixture-expected-counts-and-complete-document.mjs";
import { pagedThrough, resultOf } from "./service-worker-fixture-running-build-requests-and-kept-records.mjs";

test("a saved backup whose readers carried other version numbers is the basis of an update all the same", async () => {
  const harness = await createExtensionHarness({ account: { counts: { pledges: 43, buybacks: 230 } } });
  const tab = harness.openTab();
  await tab.build();
  await harness.finishJob();
  const current = resultOf(tab);

  // Put the saved backup back as a build whose readers all carried another version number would have left it.
  const exported = (await harness.popup.request("EXPORT_BACKUP")).backup;
  const [saved] = exported.stores.snapshots;
  let renumbered = 0;
  for (const outcome of Object.values(saved.document.sync.sectionOutcomes)) {
    if (typeof outcome.parserVersion !== "string") continue;
    outcome.parserVersion = "1.9.0";
    renumbered += 1;
  }
  assert.ok(renumbered >= 15);
  saved.document = await AccountDocument.stampIntegrity(saved.document);
  AccountDocument.assertValid(structuredClone(saved.document), globalThis.CITIZENDATA_ACCOUNT_SCHEMA, "A backup under other version numbers");
  assert.equal((await harness.popup.request("CLEAR_ALL")).ok, true);
  assert.equal((await harness.popup.request("IMPORT_BACKUP", { backup: exported })).ok, true);

  // Nothing changed at RSI. A version number alone has nothing read again: no list is paged through, the hangar and
  // the buy-back list are not asked for, and no buy-back page is read.
  tab.reload();
  const before = harness.rsi.requests.length;
  assert.equal((await tab.build()).status.activeJob.mode, "update");
  assert.equal((await harness.finishJob()).status, "complete");
  const requests = harness.rsi.requests.slice(before);
  assert.deepEqual(pagedThrough(requests), []);
  assert.deepEqual(requests.filter((request) => ["/account/pledges", "/api/account/buybackPledges"].includes(request.path) || request.path.startsWith("/pledge/buyback/")), []);

  const updated = resultOf(tab);
  await assertCompleteDocument(updated, harness.rsi);
  const plain = (value) => JSON.parse(JSON.stringify(value));
  assert.deepEqual(plain(updated.pledges), plain(current.pledges));
  assert.deepEqual(plain(updated.buybackDetails), plain(current.buybackDetails));
  assert.deepEqual(updated.buybacks.map((record) => record.buybackId), current.buybacks.map((record) => record.buybackId));
  assert.deepEqual(plain(updated.hangarLog), plain(current.hangarLog));
  assert.equal(updated.account.localAccountId, current.account.localAccountId);

  // The account's next logged event has both lists read, and what was read carries this extension's version.
  harness.rsi.addPledges(1);
  tab.reload();
  const beforeThird = harness.rsi.requests.length;
  await tab.build();
  await harness.finishJob();
  const third = resultOf(tab);
  await assertCompleteDocument(third, harness.rsi);
  const thirdRequests = harness.rsi.requests.slice(beforeThird);
  assert.equal(thirdRequests.filter((request) => request.path === "/account/pledges").length, Math.ceil(harness.rsi.state.pledges.length / 10));
  assert.equal(thirdRequests.filter((request) => request.path === "/api/account/buybackPledges").length, Math.ceil(harness.rsi.state.buybacks.length / 100));
  assert.deepEqual(thirdRequests.filter((request) => request.path.startsWith("/pledge/buyback/")), [], "no buy-back page is read again");
  await import("../../extension/shared/request-pacing-settings.js");
  await import("../../extension/adapters/catalog.js");
  const version = (section) => globalThis.CitizenDataAdapterCatalog.get(section).version;
  assert.deepEqual([third.sync.sectionOutcomes.pledges.parserVersion, third.sync.sectionOutcomes.buybacks.parserVersion], [version("pledges"), version("buybacks")]);
});
