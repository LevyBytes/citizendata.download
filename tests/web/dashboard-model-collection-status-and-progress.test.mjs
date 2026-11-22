import assert from "node:assert/strict";
import test from "node:test";
import { Model } from "./dashboard-scripts-under-test.mjs";

test("collection status maps every bridge, active, and terminal condition", () => {
  const job = { status: "running", currentSection: "buybacks", failure: null };
  const status = { status: "running", activeJob: job, requiresRebind: false };
  assert.equal(Model.collectionStatusPresentation(status, { bridgeConnected: false }).badge, "DISCONNECTED");
  assert.equal(Model.collectionStatusPresentation(status, { bridgeConnected: true, connecting: true }).badge, "CONNECTING");
  assert.equal(Model.collectionStatusPresentation({ ...status, requiresRebind: true }, { bridgeConnected: true }).badge, "RECONNECT REQUIRED");
  for (const [value, badge] of [["running", "COLLECTING"], ["paused", "PAUSED"], ["complete", "COMPLETED"], ["failed", "FAILED"], ["cancelled", "CANCELLED"]]) {
    assert.equal(Model.collectionStatusPresentation({ ...status, activeJob: { ...job, status: value } }, { bridgeConnected: true }).badge, badge);
  }
  const continuable = Model.collectionStatusPresentation({
    ...status,
    continuable: true,
    activeJob: { ...job, status: "failed", failure: { code: "RSI_READ_FAILED", message: "RSI_BUYBACKS_PAGE_MISMATCH_REQUESTED_2_OBSERVED_1" } }
  }, { bridgeConnected: true });
  assert.equal(continuable.badge, "READY TO CONTINUE");
  assert.equal(continuable.operation, "Continue backup from Buybacks");
  assert.match(continuable.summary, /page 2 cursor are preserved/u);
  assert.match(continuable.historyMessage, /requested Buybacks page 2, but RSI returned page 1/u);
  assert.equal(continuable.technicalMessage, "RSI_READ_FAILED: RSI_BUYBACKS_PAGE_MISMATCH_REQUESTED_2_OBSERVED_1");
  assert.equal(continuable.tone, "warning");
  assert.equal(Model.collectionStatusPresentation({ status: "idle", activeJob: null }, { bridgeConnected: true }).badge, "CONNECTED");
  const rosterComplete = Model.collectionStatusPresentation({ activeJob: { status: "complete", jobKind: "organizationData", currentSection: null } }, { bridgeConnected: true });
  assert.equal(rosterComplete.operation, "Organization Data complete");
  assert.match(rosterComplete.summary, /Organization JSON/u);
  const rosterCancelled = Model.collectionStatusPresentation({ activeJob: { status: "cancelled", jobKind: "organizationData", currentSection: "organizations.members.TEST" } }, { bridgeConnected: true });
  assert.equal(rosterCancelled.operation, "Organization Data cancelled");
});

test("collection section and progress presentation preserve exact baseline semantics", () => {
  assert.deepEqual(Model.collectionSectionPresentation("financial.ledgers"), {
    operation: "Reading financial ledgers",
    label: "Financial ledgers",
    summary: "Reading Store Credit, UEC, and REC ledger histories."
  });
  assert.equal(Model.collectionSectionPresentation("organizations.members.TEST").operation, "Reading the TEST member roster");
  const progress = Model.collectionProgress({
    sectionCount: 13,
    completedSections: 8,
    currentSection: "buybacks",
    httpRequestCount: 505,
    httpRequestsTotal: null,
    resolvedRequestTotalsForSections: 9,
    requestProgressBySection: { buybacks: { completed: 1, total: 16, totalKnown: true, subphase: null } }
  });
  assert.equal(progress.currentPosition, 9);
  assert.equal(progress.completedSections, 8);
  assert.equal(progress.overallText, "8 of 13 sections completed");
  assert.equal(progress.httpRequestCount, 505);
  assert.equal(progress.httpText, "505 RSI requests completed");
  assert.deepEqual(progress.requestProgress, { label: "Buybacks", completed: 1, total: 16, percent: 6.25, text: "1 of 16 RSI requests", indeterminate: false });
  assert.deepEqual(
    Model.collectionProgress({ status: "running", sectionCount: 13, completedSections: 8, currentSection: "buybacks", requestProgressBySection: { buybacks: { completed: 1, total: null, totalKnown: false } } }).requestProgress,
    { label: "Buybacks", completed: 0, total: null, percent: null, text: "Discovering request total...", indeterminate: true }
  );
  assert.equal(Model.collectionProgress({ sectionCount: 13, completedSections: 13, currentSection: null, httpRequestCount: 600, httpRequestsTotal: 600, resolvedRequestTotalsForSections: 13 }).httpText, "600 of 600 RSI requests completed");
  assert.equal(Model.collectionProgress({ sectionCount: 13, completedSections: 13, currentSection: null }).overallPercent, 100);
  assert.equal(Model.collectionProgress({
    status: "running", sectionCount: 1, completedSections: 0, currentSection: "organizations.members.TEST",
    requestProgressBySection: { "organizations.members.TEST": { completed: 1, total: 771, totalKnown: true } }
  }).requestProgress.label, "Roster pages");
});

test("safe activity presentation uses only closed progress fields", () => {
  assert.equal(Model.safeActivityPresentation({ kind: "section-started", section: "buybacks", at: "2026-11-18T15:00:00.000Z" }).message, "Starting Buybacks.");
  assert.equal(Model.safeActivityPresentation({ kind: "section-completed", section: "hangarLog", recordsTotal: 7164, requestsTotal: 287, at: "2026-11-18T15:00:00.000Z" }).message, "Completed Hangar Log · 7164 records in 287 RSI requests.");
  assert.equal(Model.safeActivityPresentation({ kind: "request-started", method: "GET", route: "/api/account/buybackPledges", page: 2, pageCount: null, at: "2026-11-18T15:00:00.000Z" }).message, "Requesting GET /api/account/buybackPledges · page 2.");
  assert.equal(
    Model.safeActivityPresentation({ kind: "request-completed", method: "GET", route: "/api/account/buybackPledges", page: 2, pageCount: 16, responseStatus: 200, recordsReceived: 100, elapsedMs: 741, at: "2026-11-18T15:00:00.000Z" }).message,
    "Received GET /api/account/buybackPledges · page 2 of 16 · HTTP 200 · 100 records · 741 ms."
  );
  assert.equal(Model.safeActivityPresentation({ kind: "request-completed", method: "DELETE", route: "/api/path?token=secret" }).message, "Received REQUEST allowed RSI route.");
  assert.equal(Model.safeActivityPresentation({ kind: "unknown" }), null);
});

test("a stop's technical detail names the HTTP status, RSI's code and RSI's message, continuable or not (criterion 7)", () => {
  const signal = { kind: "limit", code: "RSI_API_HTTP_429", httpStatus: 429, rsiCode: "ErrRateLimited", rsiMessage: "Too many requests <b>now</b>" };
  const failure = { code: "RSI_RATE_LIMITED", message: "RSI is limiting requests.", detail: { signal } };
  const expected = "RSI_RATE_LIMITED: RSI is limiting requests. | HTTP status 429 | RSI code ErrRateLimited | RSI message: Too many requests b now /b";
  assert.equal(Model.stopTechnicalDetail(failure), expected);
  const continuable = Model.collectionStatusPresentation({ status: "failed", continuable: true, requiresRebind: false, activeJob: { status: "failed", currentSection: "storeCredit", failure } }, { bridgeConnected: true });
  assert.equal(continuable.badge, "READY TO CONTINUE");
  assert.equal(continuable.technicalMessage, expected);
  assert.equal(Model.stopTechnicalDetail({ code: "RSI_SIGNED_OUT", message: "RSI_SIGNED_OUT" }), "RSI_SIGNED_OUT");
});
