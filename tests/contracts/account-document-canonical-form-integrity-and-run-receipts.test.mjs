import assert from "node:assert/strict";
import test from "node:test";
import { baseAccountDocument, observedAt } from "../fixtures/account-document.mjs";
import { accountSchema, api } from "./account-document-contract-under-test.mjs";

test("canonicalization is deterministic and sorts object keys", () => {
  assert.equal(api.canonicalize({ z: 1, a: [true, null, "x"] }), '{"a":[true,null,"x"],"z":1}');
  assert.throws(() => api.canonicalize("\ud800"), /unpaired high surrogate/u);
  const sparse = [];
  sparse.length = 1;
  assert.throws(() => api.canonicalize(sparse), /cannot contain holes/u);
});

test("full account acceptance verifies schema and SHA-256 integrity", async () => {
  const document = baseAccountDocument();
  const stamped = await api.stampIntegrity(document);
  assert.match(stamped.integrity.contentHash, /^[a-f0-9]{64}$/u);
  assert.equal(await api.verifyIntegrity(stamped), true);
  assert.equal((await api.acceptAccountDocument(stamped, accountSchema)).account.localAccountId, document.account.localAccountId);

  const tampered = structuredClone(stamped);
  tampered.generator.version = "0.1.1";
  assert.equal(await api.verifyIntegrity(tampered), false);
  await assert.rejects(() => api.acceptAccountDocument(tampered, accountSchema), { code: "INTEGRITY_VERIFICATION_FAILED" });
});

test("run receipts retain the exact local dashboard origin without accepting local file paths", async () => {
  const document = baseAccountDocument();
  document.sync.runs = [{
    runId: "11111111-1111-4111-8111-111111111111",
    status: "failed",
    startedAt: observedAt,
    endedAt: observedAt,
    selectedSections: ["profile"],
    authorization: {
      authorizationId: "22222222-2222-4222-8222-222222222222",
      authorizedAt: observedAt,
      expiresAt: "2026-11-17T18:00:00Z",
      localAccountId: document.account.localAccountId,
      dashboardOrigin: "file://",
      bridgeSessionId: "33333333-3333-4333-8333-333333333333",
      planHash: "a".repeat(64),
      selectedSections: ["profile"],
      maximumRecordsBySection: { profile: 1 },
      minimumInterRequestDelayMs: 900,
      extensionVersion: "0.42.1",
      parserVersions: { profile: "1.0.0" },
      oneRunOnly: true
    },
    organizationMemberAuthorization: null
  }];
  const stamped = await api.stampIntegrity(document);
  assert.equal(api.validateWithSchema(stamped, accountSchema).valid, true);

  const hosted = structuredClone(stamped);
  hosted.sync.runs[0].authorization.dashboardOrigin = "https://citizendata.download";
  assert.equal(api.validateWithSchema(hosted, accountSchema).valid, true);

  for (const rejectedOrigin of ["file:///C:/Users/someone/Downloads/citizendata/docs", "http://citizendata.download", "chrome-extension://example"]) {
    const invalid = structuredClone(stamped);
    invalid.sync.runs[0].authorization.dashboardOrigin = rejectedOrigin;
    assert.equal(api.validateWithSchema(invalid, accountSchema).valid, false, rejectedOrigin);
  }
});
