import assert from "node:assert/strict";
import test from "node:test";
import { Protocol, bridgeSessionId, nonce, requestId } from "./protocol-under-test.mjs";

test("requests a dashboard may send, and events it may receive, are a closed list", () => {
  assert.deepEqual(Object.keys(Protocol.REQUEST_TYPES).sort(), [
    "ACKNOWLEDGE_RESULT", "ADD_IMAGE_PACE_RUN", "CANCEL", "CHECK_RSI_STATUS", "CONTINUE_PARTIAL", "DISCOVER_CURRENT_ACCOUNT", "GET_ACCOUNT_BUILD", "GET_COMPLETED_RESULT", "GET_IMAGE_PACE_HISTORY", "GET_KEPT_IMAGES",
    "GET_KEPT_IMAGE_FILES", "GET_LATEST_BUILD", "GET_PARTIAL_RESULT", "GET_STATUS", "KEEP_BUILD", "KEEP_IMAGES", "KEEP_ORGANIZATIONS", "LIST_ACCOUNTS", "PAUSE", "PROPOSE_BUILD", "PROPOSE_ORGANIZATION_ROSTER",
    "REMOVE_ACCOUNT", "REQUEST_REBIND", "RESUME", "SELECT_ACCOUNT", "SKIP_CCU_PRICES"
  ]);
  assert.deepEqual(Object.keys(Protocol.EVENT_TYPES).sort(), ["BRIDGE_READY", "LOCAL_APPROVAL_REQUIRED", "RESPONSE", "RESULT", "STATUS"]);
  const base = { requestId, bridgeSessionId, nonce };
  assert.equal(Protocol.validatePageEnvelope(Protocol.makeEnvelope({ ...base, type: Protocol.REQUEST_TYPES.GET_COMPLETED_RESULT }), { bridgeSessionId, nonce }).ok, true);
  assert.equal(Protocol.validatePageEnvelope(Protocol.makeEnvelope({ ...base, type: Protocol.REQUEST_TYPES.ACKNOWLEDGE_RESULT, payload: { runId: "33333333-3333-4333-8333-333333333333" } }), { bridgeSessionId, nonce }).ok, true);
  // Kept images are asked for and handed over by identifier and content. A payload that names an address is refused
  // like any other, so the page can never tell the extension where to fetch from.
  assert.equal(Protocol.validatePageEnvelope(Protocol.makeEnvelope({
    ...base, type: Protocol.REQUEST_TYPES.KEEP_IMAGES,
    payload: { files: [{ assetId: "a".repeat(64), contentHash: "b".repeat(64), mediaType: "image/png", pixelWidth: 1, pixelHeight: 1, fetchedAt: "2026-11-19T00:00:00.000Z", base64: "AAAA" }] }
  }), { bridgeSessionId, nonce }).ok, true);
  assert.equal(
    Protocol.validatePageEnvelope(Protocol.makeEnvelope({ ...base, type: Protocol.REQUEST_TYPES.KEEP_IMAGES, payload: { files: [{ assetId: "a".repeat(64), sourceUrl: "https://example.invalid/a.png" }] } }), { bridgeSessionId, nonce }).code,
    "FORBIDDEN_PAYLOAD_FIELD"
  );
  // An account file handed over to be kept records the addresses its data was read from, so it is the one payload
  // that may hold them. It is the document and nothing beside it, it holds no secret field, and no other request
  // gains the exception.
  const keep = (payload) => Protocol.validatePageEnvelope(Protocol.makeEnvelope({ ...base, type: Protocol.REQUEST_TYPES.KEEP_BUILD, payload }), { bridgeSessionId, nonce });
  assert.equal(keep({ document: { schemaVersion: 1, buybackDetails: [{ buybackId: 1, sourceUrl: "https://robertsspaceindustries.com/pledge/buyback/1" }] } }).ok, true);
  for (const payload of [null, [], {}, { document: null }, { document: [] }, { document: {}, sourceUrl: "https://example.invalid/" }, { document: {}, method: "POST" }, { document: { profile: { cookie: "x" } } }, { document: { rawHtml: "<p>" } }]) {
    assert.equal(keep(payload).code, "FORBIDDEN_PAYLOAD_FIELD", JSON.stringify(payload));
  }
  assert.equal(Protocol.validatePageEnvelope(Protocol.makeEnvelope({ ...base, type: Protocol.REQUEST_TYPES.PROPOSE_BUILD, payload: { document: { sourceUrl: "https://example.invalid/" } } }), { bridgeSessionId, nonce }).code, "FORBIDDEN_PAYLOAD_FIELD");
  // An Orgs JSON handed over to be kept is held to the same shape.
  const keepOrganizations = (payload) => Protocol.validatePageEnvelope(Protocol.makeEnvelope({ ...base, type: Protocol.REQUEST_TYPES.KEEP_ORGANIZATIONS, payload }), { bridgeSessionId, nonce });
  assert.equal(keepOrganizations({ document: { documentType: "CitizenDataOrganizations", members: [{ avatarUrl: "https://robertsspaceindustries.com/a.png" }] } }).ok, true);
  for (const payload of [null, {}, { document: {}, sourceUrl: "https://example.invalid/" }, { organizations: {} }, { document: { cookie: "x" } }]) assert.equal(keepOrganizations(payload).code, "FORBIDDEN_PAYLOAD_FIELD", JSON.stringify(payload));
  // A page cannot delete the kept images either.
  assert.equal(Protocol.validatePageEnvelope(Protocol.makeEnvelope({ ...base, type: "CLEAR_KEPT_IMAGES" }), { bridgeSessionId, nonce }).ok, false);
  // A page cannot approve a local dashboard: that request exists only for the extension's own popup.
  assert.equal(Protocol.validatePageEnvelope(Protocol.makeEnvelope({ ...base, type: "APPROVE_LOCAL_DASHBOARD" }), { bridgeSessionId, nonce }).ok, false);
  assert.equal(Protocol.validatePageEnvelope(Protocol.makeEnvelope({ ...base, type: "LOCAL_DASHBOARD_HELLO" }), { bridgeSessionId, nonce }).ok, false);
});

test("valid build proposal envelope is accepted", () => {
  const envelope = Protocol.makeEnvelope({
    type: Protocol.REQUEST_TYPES.PROPOSE_BUILD,
    requestId,
    bridgeSessionId,
    nonce,
    payload: {
      selectedSections: ["profile"],
      maximumRecordsBySection: { profile: 1 },
      minimumInterRequestDelayMs: 5000
    }
  });
  assert.equal(Protocol.validatePageEnvelope(envelope, { bridgeSessionId, nonce }).ok, true);
});

test("organization-roster request is typed and carries only the selected SID", () => {
  const envelope = Protocol.makeEnvelope({
    type: Protocol.REQUEST_TYPES.PROPOSE_ORGANIZATION_ROSTER,
    requestId,
    bridgeSessionId,
    nonce,
    payload: { organizationSid: "TEST" }
  });
  assert.equal(Protocol.validatePageEnvelope(envelope, { bridgeSessionId, nonce }).ok, true);
  assert.equal(Protocol.validatePageEnvelope({ ...envelope, payload: { organizationSid: "TEST", url: "https://example.invalid" } }).code, "FORBIDDEN_PAYLOAD_FIELD");
});

test("protocol rejects nonce mismatch, unknown fields, and request authority", () => {
  const base = Protocol.makeEnvelope({ type: Protocol.REQUEST_TYPES.GET_STATUS, requestId, bridgeSessionId, nonce });
  assert.equal(Protocol.validatePageEnvelope(base, { bridgeSessionId, nonce: `${nonce}x` }).code, "NONCE_MISMATCH");
  assert.equal(Protocol.validatePageEnvelope({ ...base, extra: true }).code, "UNEXPECTED_ENVELOPE_FIELD");
  assert.equal(Protocol.validatePageEnvelope({ ...base, payload: { url: "https://example.invalid" } }).code, "FORBIDDEN_PAYLOAD_FIELD");
  assert.equal(Protocol.validatePageEnvelope({ ...base, payload: { authorizationHeader: "secret" } }).code, "FORBIDDEN_PAYLOAD_FIELD");
});

test("normalized output URLs and authorization receipts are not mistaken for credentials", () => {
  assert.equal(Protocol.containsSecretField({ sourceLinks: [{ url: "https://robertsspaceindustries.com/en/account/pledges" }] }), false);
  assert.equal(Protocol.containsSecretField({ authorization: { authorizedAt: "2026-11-17T00:00:00Z" } }), false);
  assert.equal(Protocol.containsSecretField({ accessToken: "secret" }), true);
  assert.equal(Protocol.containsSecretField({ responseHeaders: { setCookie: "secret" } }), true);
});

test("public capabilities reflect whether executable adapters are registered", () => {
  const capabilities = Protocol.publicCapabilities();
  assert.equal(capabilities.loadJson, true);
  assert.equal(capabilities.buildJson, false);
  assert.equal(capabilities.accountCollection, false);
  assert.match(capabilities.reason, /no account collection adapters/iu);
  assert.equal(capabilities.offlineMediaPackage, false);
  assert.equal(Protocol.publicCapabilities({ offlineMediaPackage: true }).offlineMediaPackage, true);
  const ready = Protocol.publicCapabilities({ adapters: [{}], organizationRosterCollection: true });
  assert.equal(ready.buildJson, true);
  assert.equal(ready.accountCollection, true);
  assert.equal(ready.organizationRosterCollection, true);
});
