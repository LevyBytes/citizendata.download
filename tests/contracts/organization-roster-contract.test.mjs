import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

await import("../../shared/account-document.js");

const api = globalThis.CitizenDataAccountDocument;
const schema = JSON.parse(await readFile(new URL("../../schema/account-export.schema.json", import.meta.url), "utf8"));
const observedAt = "2026-11-17T12:00:00Z";

function authorization(selectedSections) {
  return {
    authorizationId: "00000000-0000-4000-8000-000000000010",
    authorizedAt: observedAt,
    expiresAt: "2026-11-17T12:15:00Z",
    localAccountId: "00000000-0000-4000-8000-000000000001",
    dashboardOrigin: "https://citizendata.download",
    bridgeSessionId: "00000000-0000-4000-8000-000000000020",
    planHash: "a".repeat(64),
    selectedSections,
    maximumRecordsBySection: Object.fromEntries(selectedSections.map((section) => [section, 50000])),
    minimumInterRequestDelayMs: selectedSections.some((section) => section.startsWith("organizations.members.")) ? 10000 : 2500,
    extensionVersion: "0.1.0",
    parserVersions: Object.fromEntries(selectedSections.map((section) => [section, "1.0.0"])),
    oneRunOnly: true
  };
}

function receipt(selectedSections, organizationMemberAuthorization) {
  return {
    runId: "00000000-0000-4000-8000-000000000030",
    status: "complete",
    startedAt: observedAt,
    endedAt: observedAt,
    selectedSections,
    authorization: authorization(selectedSections),
    organizationMemberAuthorization
  };
}

function rosterAuthorization(organizations = [{ sid: "TEST", observedMemberCount: 24652, maximumRecords: 50000 }]) {
  return {
    authorizationId: "00000000-0000-4000-8000-000000000040",
    parentAuthorizationId: "00000000-0000-4000-8000-000000000010",
    authorizedAt: observedAt,
    organizations,
    extensionVersion: "0.1.0",
    parserVersion: "1.0.0",
    minimumInterActionDelayMs: 10000,
    oneRunOnly: true
  };
}

function validate(value) {
  return api.validateWithSchema(value, schema.$defs.runReceipt, { rootSchema: schema });
}

test("dynamic organization roster receipts require their separate authorization", () => {
  const section = "organizations.members.TEST";
  assert.equal(validate(receipt([section], rosterAuthorization())).valid, true);
  assert.equal(validate(receipt([section], null)).valid, false);
});

test("one authorization receipt can cover a selected multi-organization job without inventing unknown counts", () => {
  const sections = ["organizations.members.TEST", "organizations.members.MMHC"];
  const authorization = rosterAuthorization([
    { sid: "TEST", observedMemberCount: 24652, maximumRecords: 50000 },
    { sid: "MMHC", observedMemberCount: null, maximumRecords: 50000 }
  ]);
  const checked = validate(receipt(sections, authorization));
  assert.equal(checked.valid, true, JSON.stringify(checked.errors));
});

test("baseline receipts keep organization-member authorization null", () => {
  const baseline = validate(receipt(["profile"], null));
  assert.equal(baseline.valid, true, JSON.stringify(baseline.errors));
  assert.equal(validate(receipt(["profile"], rosterAuthorization())).valid, false);
});
