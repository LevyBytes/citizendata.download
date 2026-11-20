import assert from "node:assert/strict";
import test from "node:test";
import { createExtensionHarness } from "../support/extension-harness.mjs";
import { assertCompleteDocument } from "./service-worker-fixture-expected-counts-and-complete-document.mjs";
import { LOCAL_DASHBOARD_PATH, LOCAL_DASHBOARD_URL } from "./service-worker-fixture-local-dashboard-address.mjs";
import { resultOf } from "./service-worker-fixture-running-build-requests-and-kept-records.mjs";

test("a downloaded copy is served only after its exact path is approved in the popup", async () => {
  const harness = await createExtensionHarness();
  const local = harness.openTab(LOCAL_DASHBOARD_URL);
  // Before approval the worker refuses every request, whatever the content script forwards.
  assert.equal((await local.request("GET_STATUS")).code, "UNTRUSTED_DASHBOARD");
  assert.equal((await local.build()).code, "UNTRUSTED_DASHBOARD");

  assert.deepEqual(await local.hello(), { ok: true, approved: false });
  assert.equal(local.badge, "!", "the toolbar icon marks the tab that is waiting");
  const offered = await harness.popup.request("GET_LOCAL_DASHBOARDS", { tabId: local.id });
  assert.deepEqual(offered, { ok: true, pending: { path: LOCAL_DASHBOARD_PATH }, approved: [] });
  // The popup of another tab is offered nothing.
  const hosted = harness.openTab();
  assert.equal((await harness.popup.request("GET_LOCAL_DASHBOARDS", { tabId: hosted.id })).pending, null);

  // Approval names a tab, never a path, and only a tab that is waiting.
  assert.deepEqual(await harness.popup.request("APPROVE_LOCAL_DASHBOARD", { tabId: hosted.id, path: LOCAL_DASHBOARD_PATH }), { ok: false, code: "NO_PENDING_LOCAL_DASHBOARD" });
  assert.deepEqual(await harness.popup.request("APPROVE_LOCAL_DASHBOARD", { path: LOCAL_DASHBOARD_PATH }), { ok: false, code: "NO_PENDING_LOCAL_DASHBOARD" });
  assert.equal((await local.request("GET_STATUS")).code, "UNTRUSTED_DASHBOARD");

  const approved = await harness.popup.request("APPROVE_LOCAL_DASHBOARD", { tabId: local.id });
  assert.deepEqual(approved, { ok: true, path: LOCAL_DASHBOARD_PATH });
  assert.equal(local.approvalSignals, 1, "the open tab is told so it can connect without a reload");
  assert.equal(local.badge, "");
  assert.deepEqual(await local.hello(), { ok: true, approved: true });
  assert.equal((await local.request("GET_STATUS")).ok, true);
  const listed = (await harness.popup.request("GET_LOCAL_DASHBOARDS", { tabId: local.id })).approved;
  assert.deepEqual(listed.map((entry) => entry.path), [LOCAL_DASHBOARD_PATH]);

  // The approval is for that path. A copy in another folder asks for its own.
  const other = harness.openTab("file:///C:/Users/someone/Desktop/other/docs/index.html");
  assert.equal((await other.request("GET_STATUS")).code, "UNTRUSTED_DASHBOARD");
  assert.deepEqual(await other.hello(), { ok: true, approved: false });

  // It can run a whole backup, and the approval survives a worker restart.
  harness.stopWorker();
  assert.equal((await local.build()).code, "RUN_STARTED");
  assert.equal((await harness.finishJob()).status, "complete");
  await assertCompleteDocument(resultOf(local), harness.rsi);
  assert.equal(harness.state().pendingResult.dashboardOrigin, "file://");

  // Removing the approval cuts the open tab off at its next request.
  assert.equal((await harness.popup.request("REVOKE_LOCAL_DASHBOARD", { path: LOCAL_DASHBOARD_PATH })).ok, true);
  assert.equal((await harness.popup.request("REVOKE_LOCAL_DASHBOARD", { path: LOCAL_DASHBOARD_PATH })).code, "LOCAL_DASHBOARD_NOT_APPROVED");
  assert.equal((await local.request("GET_STATUS")).code, "UNTRUSTED_DASHBOARD");
  assert.equal((await local.request("GET_COMPLETED_RESULT")).code, "UNTRUSTED_DASHBOARD");
  assert.deepEqual(await local.hello(), { ok: true, approved: false });
});

test("a local approval request counts only while its tab still shows that dashboard", async () => {
  const harness = await createExtensionHarness();
  const local = harness.openTab(LOCAL_DASHBOARD_URL);
  await local.hello();
  // The tab moved on to another file before the user opened the popup.
  local.navigate("file:///C:/Users/someone/Downloads/citizendata/docs/terms.html");
  assert.equal((await harness.popup.request("GET_LOCAL_DASHBOARDS", { tabId: local.id })).pending, null);
  assert.deepEqual(await harness.popup.request("APPROVE_LOCAL_DASHBOARD", { tabId: local.id }), { ok: false, code: "NO_PENDING_LOCAL_DASHBOARD" });
  assert.equal(local.badge, "", "the stale mark is removed");

  // A tab showing a different local copy than the one it announced is not approved either.
  const moved = harness.openTab(LOCAL_DASHBOARD_URL);
  await moved.hello();
  moved.navigate("file:///C:/Users/someone/Desktop/other/docs/index.html");
  assert.deepEqual(await harness.popup.request("APPROVE_LOCAL_DASHBOARD", { tabId: moved.id }), { ok: false, code: "NO_PENDING_LOCAL_DASHBOARD" });

  // A closed tab cannot be approved.
  const closed = harness.openTab(LOCAL_DASHBOARD_URL);
  await closed.hello();
  closed.close();
  assert.deepEqual(await harness.popup.request("APPROVE_LOCAL_DASHBOARD", { tabId: closed.id }), { ok: false, code: "NO_PENDING_LOCAL_DASHBOARD" });
  assert.deepEqual(harness.local.get("citizendata.localDashboards.v1") ?? [], []);
});
