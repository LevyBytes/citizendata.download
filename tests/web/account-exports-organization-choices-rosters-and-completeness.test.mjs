import assert from "node:assert/strict";
import test from "node:test";
import { organizationFixture } from "./account-exports-fixture-organizations.mjs";
import { Exports, native } from "./account-exports-loaded-with-fixture-account.mjs";

test("organization choices include parsed rosters only and preserve exact SIDs", () => {
  const document = organizationFixture();
  document.organizations.members.push({ recordKey: "lowercase", organizationSid: "test" });
  document.organizations.members.push({ recordKey: "spaces", organizationSid: " TEST " });
  assert.deepEqual(Exports.listOrganizationRosters(document), [
    { sid: "TEST", name: "TEST", recordCount: 2 },
    { sid: "MMHC", name: "Million Mile High Club", recordCount: 1 },
    { sid: "test", name: "test", recordCount: 1 },
    { sid: " TEST ", name: " TEST ", recordCount: 1 }
  ]);
  assert.deepEqual(Exports.listOrganizationRosters({ organizations: { memberships: document.organizations.memberships, members: [] } }), []);
  assert.deepEqual(Exports.listOrganizationRosters({}), []);
  assert.deepEqual(Exports.listOrganizationRosters(null), []);
});

test("organization exports retain only the selected source membership and roster", () => {
  const document = organizationFixture();
  for (const sid of ["TEST", "MMHC"]) {
    const selection = { preset: "organization-members", organizationSid: sid };
    const result = native(document, selection);
    assert.deepEqual(result, { organizations: {
      organizationSid: sid,
      memberships: document.organizations.memberships.filter(item => item.sid === sid),
      members: document.organizations.members.filter(item => item.organizationSid === sid)
    } });
    assert.equal(Exports.inspectExport(document, selection).recordCount, sid === "TEST" ? 2 : 1);
    assert.match(Exports.createExport(document, selection).fileName, new RegExp(`^citizendata-organization-members-${sid}-\\d{4}-\\d{2}-\\d{2}-\\d{6}-\\d{3}Z\\.json$`, "u"));
    for (const key of ["account", "profile", "pledges", "referrals", "financial", "sync", "integrity"]) assert.equal(Object.hasOwn(result, key), false);
  }
});

test("organization export preserves every selected row beyond pagination, including duplicates and redacted fields", () => {
  const document = organizationFixture();
  const rows = Array.from({ length: 61 }, (_, index) => ({ recordKey: `test-${index}`, organizationSid: "TEST", handle: `Person${61 - index}`, custom: { index } }));
  rows.push({ ...rows[0] });
  rows.push({ recordKey: "redacted", organizationSid: "TEST", visibility: "restricted", handle: null, displayName: null, rank: null, rankStars: null, roles: [], membershipType: null, images: [], observation: { retained: true } });
  document.organizations.members = [rows[0], document.organizations.members[1], ...rows.slice(1)];
  document.organizations.memberships.push({ ...document.organizations.memberships[0] });
  const selection = { preset: "organization-members", organizationSid: "TEST" };
  const result = native(document, selection);
  assert.deepEqual(result.organizations.members, rows);
  assert.deepEqual(result.organizations.memberships, document.organizations.memberships.filter(item => item.sid === "TEST"));
  assert.equal(Exports.inspectExport(document, selection).recordCount, 63);
});

test("known empty per-organization runs are eligible only with an existing source members array", () => {
  const document = { organizations: { members: [] }, sync: { organizationMemberOutcomes: {
    EMPTY: { status: "complete" }, PARTIAL: { status: "partial" }, SKIPPED: { status: "skipped" }, NOTRUN: { status: "notRun" }, FAILED: { status: "failed" }
  } } };
  assert.deepEqual(Exports.listOrganizationRosters(document), [{ sid: "EMPTY", name: "EMPTY", recordCount: 0 }, { sid: "PARTIAL", name: "PARTIAL", recordCount: 0 }]);
  for (const sid of ["EMPTY", "PARTIAL"]) {
    const selection = { preset: "organization-members", organizationSid: sid };
    assert.deepEqual(native(document, selection), { organizations: { organizationSid: sid, members: [] } });
    assert.equal(Exports.inspectExport(document, selection).recordCount, 0);
  }
  for (const sid of ["SKIPPED", "NOTRUN", "FAILED"]) assert.equal(Exports.inspectExport(document, { preset: "organization-members", organizationSid: sid }).canExport, false);
  delete document.organizations.members;
  assert.deepEqual(Exports.listOrganizationRosters(document), []);
  assert.equal(Exports.inspectExport(document, { preset: "organization-members", organizationSid: "EMPTY" }).canExport, false);
});

test("per-org completeness is independent of membership outcomes and keeps example warnings", () => {
  const document = organizationFixture();
  document.sync.sectionOutcomes["organizations.members"] = { status: "complete" };
  document.sync.sectionOutcomes["organizations.memberships"] = { status: "failed" };
  const selected = { preset: "organization-members", organizationSid: "TEST" };
  assert.deepEqual(Exports.inspectExport(document, selected).warnings, []);
  assert.deepEqual(Exports.inspectExport(document, { ...selected, organizationSid: "MMHC" }).warnings, ["Partial source"]);
  for (const status of ["partial", "failed", "skipped", "notRun"]) {
    document.sync.organizationMemberOutcomes.TEST.status = status;
    const result = Exports.inspectExport(document, selected);
    assert.equal(result.canExport, true);
    assert.deepEqual(result.warnings, ["Partial source"]);
  }
  delete document.sync.organizationMemberOutcomes.TEST;
  assert.deepEqual(Exports.inspectExport(document, selected).warnings, ["Completeness unknown"]);
  assert.deepEqual(Exports.inspectExport(document, { ...selected, example: true }).warnings, ["Example data"]);
});
