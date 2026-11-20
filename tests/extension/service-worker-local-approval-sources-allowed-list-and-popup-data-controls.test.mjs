import assert from "node:assert/strict";
import test from "node:test";
import { createExtensionHarness, HOSTED_DASHBOARD_URL, RSI_TOKEN } from "../support/extension-harness.mjs";
import { LOCAL_DASHBOARD_URL } from "./service-worker-fixture-local-dashboard-address.mjs";

test("only a real local dashboard tab can ask for approval, and only the extension's own pages can grant it", async () => {
  const harness = await createExtensionHarness();
  const local = harness.openTab(LOCAL_DASHBOARD_URL);
  const refused = [
    await harness.openTab().hello(),
    await harness.openTab("file:///C:/Users/someone/Downloads/citizendata/docs/terms.html").hello(),
    await local.hello({ message: { dashboardPath: "/C:/elsewhere/docs/index.html" } }),
    await local.hello({ sender: { frameId: 2 } }),
    await harness.openTab(LOCAL_DASHBOARD_URL, { incognito: true }).hello()
  ];
  for (const response of refused) assert.deepEqual(response, { ok: false, code: "UNTRUSTED_DASHBOARD" });
  assert.equal(Object.keys(harness.session.get("citizendata.localPending.v1") ?? {}).length, 0);

  await local.hello();
  // A dashboard page, hosted or local, cannot send the popup's requests.
  for (const sender of [{ url: HOSTED_DASHBOARD_URL }, { url: LOCAL_DASHBOARD_URL }, { id: "ponmlkjihgfedcbaponmlkjihgfedcba" }, { url: undefined }]) {
    assert.deepEqual(await harness.popup.request("APPROVE_LOCAL_DASHBOARD", { tabId: local.id }, { sender }), { ok: false, code: "UNTRUSTED_EXTENSION_PAGE" });
    assert.deepEqual(await harness.popup.request("CLEAR_ALL", {}, { sender }), { ok: false, code: "UNTRUSTED_EXTENSION_PAGE" });
  }
  // The dashboard bridge has no request that approves a local copy.
  const hosted = harness.openTab();
  assert.equal((await hosted.request("APPROVE_LOCAL_DASHBOARD", { tabId: local.id })).ok, false);
  assert.deepEqual(harness.local.get("citizendata.localDashboards.v1") ?? [], []);
});

test("the list of allowed local dashboards is bounded and keeps the newest", async () => {
  const harness = await createExtensionHarness();
  for (let index = 1; index <= 22; index += 1) {
    const tab = harness.openTab(`file:///C:/copies/copy-${index}/docs/index.html`);
    assert.equal((await harness.approveLocalDashboard(tab)).ok, true);
    await harness.advanceBy(1000);
  }
  const approved = harness.local.get("citizendata.localDashboards.v1");
  assert.equal(approved.length, 20);
  assert.equal(approved[0].path, "/C:/copies/copy-22/docs/index.html");
  assert.ok(!approved.some((entry) => entry.path === "/C:/copies/copy-1/docs/index.html"));
  // Approving a path again moves it to the front instead of listing it twice.
  const again = harness.openTab("file:///C:/copies/copy-5/docs/index.html");
  assert.deepEqual(await again.hello(), { ok: true, approved: true });
});

test("the popup can export, restore, and clear what the extension keeps", async () => {
  const harness = await createExtensionHarness();
  const tab = harness.openTab();
  const local = harness.openTab(LOCAL_DASHBOARD_URL);
  await harness.approveLocalDashboard(local);
  await tab.build();
  await harness.finishJob();
  const exported = (await harness.popup.request("EXPORT_BACKUP")).backup;
  assert.equal(exported.stores.snapshots.length, 1);
  assert.equal(exported.stores.snapshots[0].document.pledges.length, harness.rsi.state.pledges.length);
  assert.ok(!JSON.stringify(exported).includes(RSI_TOKEN));

  const cleared = await harness.popup.request("CLEAR_ALL");
  assert.equal(cleared.ok, true);
  assert.equal(cleared.status.status, "idle");
  assert.equal(harness.state(), null);
  assert.ok(!await harness.repository.getSnapshot("SyntheticCitizen"));
  assert.equal((await harness.repository.listJobs()).length, 0);
  assert.equal(harness.local.get("citizendata.localDashboards.v1"), undefined, "local dashboard approvals are cleared too");
  assert.equal((await local.request("GET_STATUS")).code, "UNTRUSTED_DASHBOARD");
  assert.deepEqual([...harness.alarms.keys()], []);

  // A backup carrying a credential field is refused; a clean one restores the saved account.
  assert.deepEqual(await harness.popup.request("IMPORT_BACKUP", { backup: { ...exported, accessToken: "x" } }), { ok: false, code: "UNSAFE_BACKUP" });
  assert.equal((await harness.popup.request("IMPORT_BACKUP", { backup: exported })).ok, true);
  assert.ok(await harness.repository.getSnapshot("SyntheticCitizen"));
  tab.reload();
  assert.equal((await tab.build()).status.activeJob.mode, "update", "the restored backup is the baseline for the next run");
});
