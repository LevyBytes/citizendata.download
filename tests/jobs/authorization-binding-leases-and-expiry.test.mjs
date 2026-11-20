import assert from "node:assert/strict";
import test from "node:test";
import { acceptedInput, authorization, proposal } from "./authorization-loaded-with-fixture-proposal.mjs";

test("authorization requires host permission, account binding, and receipt identity", () => {
  const base = acceptedInput();
  assert.equal(authorization.createAuthorization(proposal(), { ...base, permissionGranted: false }).code, "HOST_PERMISSION_REQUIRED");
  assert.equal(authorization.createAuthorization(proposal(), { ...base, accountId: "" }).code, "ACCOUNT_BINDING_REQUIRED");
  assert.equal(authorization.createAuthorization(proposal(), { ...base, localAccountId: "not-a-uuid" }).code, "INVALID_LOCAL_ACCOUNT_ID");
  assert.equal(authorization.createAuthorization(proposal(), { ...base, planHash: "bad" }).code, "INVALID_PLAN_HASH");
});

test("authorization is bound to run, account, dashboard session, and selected section", () => {
  const result = authorization.createAuthorization(proposal(), acceptedInput());
  assert.equal(result.ok, true);
  assert.equal(authorization.validateAuthorization(result.value, { runId: result.value.runId, accountId: "account-1", section: "profile" }, 3000).ok, true);
  assert.equal(authorization.validateAuthorization(result.value, { runId: "different" }, 3000).code, "AUTHORIZATION_BINDING_MISMATCH");
  assert.equal(authorization.validateAuthorization(result.value, { section: "pledges" }, 3000).code, "SECTION_NOT_AUTHORIZED");
  assert.equal(authorization.validateAuthorization({ ...result.value, consumedAt: new Date(3000).toISOString() }, {}, 3000).code, "AUTHORIZATION_CONSUMED");
});

test("an accepted run outlives the short proposal while remaining bounded by hard and idle leases", () => {
  const result = authorization.createAuthorization(proposal(), acceptedInput({ runTtlMs: 60_000, idleTtlMs: 20_000 }));
  assert.equal(result.ok, true);
  assert.equal(authorization.proposalIsCurrent(proposal(), 11_001), false);
  assert.equal(authorization.validateAuthorization(result.value, {}, 15_000).ok, true);
  assert.equal(authorization.validateAuthorization(result.value, {}, 22_001).code, "AUTHORIZATION_IDLE_EXPIRED");

  const touched = authorization.touchAuthorization(result.value, 18_000);
  assert.equal(touched.ok, true);
  assert.equal(authorization.validateAuthorization(touched.value, {}, 37_999).ok, true);
  assert.equal(authorization.validateAuthorization(touched.value, {}, 38_000).code, "AUTHORIZATION_IDLE_EXPIRED");
  assert.equal(authorization.validateAuthorization({ ...touched.value, idleExpiresAt: new Date(61_999).toISOString() }, {}, 62_000).code, "AUTHORIZATION_EXPIRED");
});

test("expired proposals cannot be authorized", () => {
  assert.equal(authorization.createAuthorization(proposal(), acceptedInput({ nowMs: 11_001 })).code, "PROPOSAL_EXPIRED");
});
