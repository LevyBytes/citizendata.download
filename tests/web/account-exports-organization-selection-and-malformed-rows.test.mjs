import assert from "node:assert/strict";
import test from "node:test";
import { organizationFixture } from "./account-exports-fixture-organizations.mjs";
import { Exports, deepFreeze, native } from "./account-exports-loaded-with-fixture-account.mjs";

test("organization selection rejects missing or invalid SIDs without falling back", () => {
  const document = organizationFixture();
  for (const organizationSid of [undefined, null, "", 4, {}, "test", " TEST ", "NOTPARSED", "UNKNOWN"]) {
    const selected = { preset: "organization-members", organizationSid };
    assert.equal(Exports.inspectExport(document, selected).canExport, false);
    assert.throws(() => Exports.createExport(document, selected), /Choose an organization/u);
  }
  assert.equal(Exports.inspectExport(document, { preset: "organization-members", organizationSid: "TEST", format: "hangar-link" }).canExport, false);
});

test("rosters without memberships retain their SID and do not fabricate membership arrays", () => {
  const document = { organizations: { members: [{ recordKey: "solo", organizationSid: "SOLO", displayName: "Solo" }] } };
  assert.deepEqual(Exports.listOrganizationRosters(document), [{ sid: "SOLO", name: "SOLO", recordCount: 1 }]);
  assert.deepEqual(native(document, { preset: "organization-members", organizationSid: "SOLO" }), { organizations: { organizationSid: "SOLO", members: document.organizations.members } });
});

test("custom export includes exactly one chosen organization alongside selected sections", () => {
  const document = organizationFixture();
  const selected = { preset: "custom", sections: ["organization-members", "hangar", "organization-members"], organizationSid: "MMHC" };
  const result = native(document, selected);
  assert.deepEqual(Object.keys(result), ["pledges", "organizations"]);
  assert.deepEqual(result.pledges, document.pledges);
  assert.deepEqual(result.organizations, native(document, { preset: "organization-members", organizationSid: "MMHC" }).organizations);
  assert.equal(Exports.inspectExport(document, selected).recordCount, 2);
  assert.equal(Exports.inspectExport(document, { ...selected, organizationSid: undefined }).canExport, false);
  assert.equal(Exports.inspectExport(document, { preset: "custom", sections: ["hangar"], organizationSid: "INVALID" }).canExport, true);
});

test("organization exports preserve frozen inputs and sanitize filenames without normalizing selection", () => {
  const document = organizationFixture();
  const sid = "../TEST:Archive?*";
  document.organizations.members.push({ recordKey: "odd-sid", organizationSid: sid });
  deepFreeze(document);
  const selection = deepFreeze({ preset: "organization-members", organizationSid: sid });
  const before = JSON.stringify(document);
  const result = Exports.createExport(document, selection);
  assert.match(result.fileName, /^citizendata-organization-members-TEST-Archive-\d{4}-\d{2}-\d{2}-\d{6}-\d{3}Z\.json$/u);
  assert.equal(JSON.parse(result.text).organizations.members[0].organizationSid, sid);
  assert.equal(JSON.stringify(document), before);
  assert.equal(Exports.listOrganizationRosters(document).length, 3);
});

test("malformed selected organization rows reject export while unrelated data is omitted", () => {
  const selected = { preset: "organization-members", organizationSid: "TEST" };
  for (const mutate of [
    document => { document.organizations.memberships = null; },
    document => { document.organizations.members[0].recordKey = ""; },
    document => { document.organizations.members[0].roles = [4]; },
    document => { document.organizations.members[0].rankStars = -1; },
    document => { document.organizations.members[0].images = {}; },
    document => { document.organizations.members[0].handle = 4; }
  ]) {
    const document = organizationFixture();
    mutate(document);
    assert.equal(Exports.inspectExport(document, selected).canExport, false);
  }
  const document = organizationFixture();
  document.organizations.members[1].roles = [4];
  document.organizations.members[1].unrelatedInvalidValue = undefined;
  document.financial = null;
  assert.equal(Exports.inspectExport(document, selected).canExport, true);
});

test("both bundled example organization rosters export with example warnings", () => {
  const document = globalThis.CITIZENDATA_DEMO_DATA;
  assert.deepEqual(Exports.listOrganizationRosters(document).map(roster => roster.sid), ["TEST", "MMHC"]);
  for (const organizationSid of ["TEST", "MMHC"]) {
    const selected = { preset: "organization-members", organizationSid, example: true };
    const inspection = Exports.inspectExport(document, selected);
    assert.equal(inspection.canExport, true, inspection.errors.join(" "));
    assert.deepEqual(inspection.warnings, ["Example data"]);
    assert.deepEqual(native(document, selected).organizations.members, document.organizations.members.filter(member => member.organizationSid === organizationSid));
  }
});
