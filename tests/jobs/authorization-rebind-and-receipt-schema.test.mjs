import assert from "node:assert/strict";
import test from "node:test";
import { acceptedInput, authorization, proposal } from "./authorization-loaded-with-fixture-proposal.mjs";

test("rebind requires explicit review, replaces only the exact dashboard binding, and cannot revive an expired idle lease", () => {
  const created = authorization.createAuthorization(proposal(), acceptedInput({ runTtlMs: 60_000, idleTtlMs: 20_000 })).value;
  const request = authorization.createRebindRequest(created, {
    rebindId: "55555555-5555-4555-8555-555555555555",
    jobId: "job-1",
    dashboardOrigin: "https://citizendata.download",
    dashboardPath: "/review",
    dashboardTabId: 9,
    bridgeSessionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    nowMs: 10_000
  });
  assert.equal(authorization.rebindRequestIsCurrent(request, 10_001), true);
  const rebound = authorization.rebindAuthorization(created, request, 11_000);
  assert.equal(rebound.ok, true);
  assert.equal(rebound.value.bridgeSessionId, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
  assert.equal(rebound.value.dashboardPath, "/review");
  assert.equal(authorization.validateAuthorization(rebound.value, { bridgeSessionId: created.bridgeSessionId }, 11_001).code, "AUTHORIZATION_BINDING_MISMATCH");
  assert.equal(authorization.validateAuthorization(rebound.value, { bridgeSessionId: request.bridgeSessionId }, 11_001).ok, true);
  assert.throws(() => authorization.createRebindRequest(created, {
    rebindId: "66666666-6666-4666-8666-666666666666",
    jobId: "job-1",
    dashboardOrigin: "https://citizendata.download",
    dashboardPath: "/",
    dashboardTabId: 10,
    bridgeSessionId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    nowMs: 22_001
  }), /expired/u);
});

test("run authorization receipt is the exact closed schema projection", () => {
  const created = authorization.createAuthorization(proposal(), acceptedInput()).value;
  assert.deepEqual(Object.keys(authorization.runAuthorizationReceipt(created)).sort(), [
    "authorizationId",
    "authorizedAt",
    "bridgeSessionId",
    "dashboardOrigin",
    "expiresAt",
    "extensionVersion",
    "localAccountId",
    "maximumRecordsBySection",
    "minimumInterRequestDelayMs",
    "oneRunOnly",
    "parserVersions",
    "planHash",
    "selectedSections"
  ]);
});
