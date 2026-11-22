import assert from "node:assert/strict";
import test from "node:test";
import { createExtensionHarness, HOSTED_DASHBOARD_URL } from "../support/extension-harness.mjs";
import { runningBuild } from "./service-worker-fixture-running-build-requests-and-kept-records.mjs";

test("status reports progress the dashboard can show, with a bounded activity log", async () => {
  const { harness, tab } = await runningBuild({}, 14);
  const status = await tab.status();
  assert.equal(status.status, "running");
  assert.equal(status.hasActiveJob, true);
  const job = status.activeJob;
  assert.equal(job.jobKind, "accountData");
  assert.equal(job.sectionCount, 15);
  assert.ok(job.completedSections >= 1 && job.completedSections < 14);
  assert.equal(job.currentSection, job.selectedSections[job.sectionIndex]);
  assert.ok(job.httpRequestCount >= 10);
  assert.equal(job.httpRequestsTotal, null, "the total is unknown until every section reported its own");
  assert.ok(Object.keys(job.requestsBySection).length >= 1);
  assert.ok(job.activityLog.length > 0 && job.activityLog.length <= 20);
  for (const activity of job.activityLog) {
    assert.ok(["section-started", "request-started", "request-completed", "section-completed"].includes(activity.kind));
    // Activity names a fixed route and page only; it never carries a query string, a body, or a header.
    assert.deepEqual(Object.keys(activity).filter((key) => !["kind", "section", "method", "route", "page", "pageCount", "responseStatus", "recordsReceived", "recordsTotal", "requestsTotal", "retryAfterMs", "elapsedMs", "at", "seq"].includes(key)), []);
    if (activity.route) assert.match(activity.route, /^\/[A-Za-z0-9/_-]+$/u);
  }
  const finished = await harness.finishJob();
  assert.equal(finished.status, "complete");
  const final = await tab.status();
  assert.equal(final.hasActiveJob, false);
  assert.equal(final.activeJob.status, "complete");
  assert.equal(final.activeJob.httpRequestsTotal, harness.rsi.requests.length - 1, "every request but the account identification belongs to a section");
});

test("requests are served only to the hosted dashboard's top frame in a normal window", async () => {
  const harness = await createExtensionHarness();
  const tab = harness.openTab();
  const refusals = {
    "another extension": await tab.request("GET_STATUS", null, { sender: { id: "ponmlkjihgfedcbaponmlkjihgfedcba" } }),
    "a frame inside the page": await tab.request("GET_STATUS", null, { sender: { frameId: 3 } }),
    "an incognito window": await harness.openTab(HOSTED_DASHBOARD_URL, { incognito: true }).request("GET_STATUS"),
    "a page that is not the dashboard": await harness.openTab("https://example.invalid/").request("GET_STATUS"),
    "a look-alike host": await harness.openTab("https://citizendata.download.example.invalid/").request("GET_STATUS"),
    "the dashboard over plain http": await harness.openTab("http://citizendata.download/").request("GET_STATUS"),
    "a message naming an origin its tab does not have": await harness.openTab("https://example.invalid/").request("GET_STATUS", null, { message: { dashboardOrigin: "https://citizendata.download", dashboardPath: "/" } }),
    "a message naming a path its tab does not have": await tab.request("GET_STATUS", null, { message: { dashboardPath: "/elsewhere" } }),
    "a sender with no tab": await tab.request("GET_STATUS", null, { sender: { tab: undefined } })
  };
  for (const [who, response] of Object.entries(refusals)) assert.equal(response.code, "UNTRUSTED_DASHBOARD", who);
  assert.equal((await tab.request("GET_STATUS")).ok, true);
  // None of the refused senders could start anything.
  assert.equal((await harness.openTab("https://example.invalid/").build()).code, "UNTRUSTED_DASHBOARD");
  assert.equal(harness.rsi.requests.length, 0);
});

test("a request is accepted once, and a bridge session keeps the nonce it started with", async () => {
  const harness = await createExtensionHarness();
  const tab = harness.openTab();
  const requestId = "9ce964ad-d251-4a39-a28e-7f0a66ef3fa2";
  assert.equal((await tab.request("GET_STATUS", null, { envelope: { requestId } })).ok, true);
  assert.equal((await tab.request("GET_STATUS", null, { envelope: { requestId } })).code, "REPLAYED_REQUEST");
  assert.equal((await tab.request("GET_STATUS", null, { envelope: { nonce: "f".repeat(72) } })).code, "NONCE_MISMATCH");
  assert.equal((await tab.request("GET_STATUS", null, { envelope: { protocolVersion: 1 } })).code, "PROTOCOL_MISMATCH");
  assert.equal((await tab.request("GET_STATUS", null, { envelope: { extra: true } })).code, "UNEXPECTED_ENVELOPE_FIELD");
  assert.equal((await tab.request("GET_STATUS")).ok, true);
  // The record of used request identifiers survives a worker restart.
  harness.stopWorker();
  assert.equal((await tab.request("GET_STATUS", null, { envelope: { requestId } })).code, "REPLAYED_REQUEST");
});
