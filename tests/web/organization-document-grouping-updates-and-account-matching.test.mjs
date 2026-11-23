import assert from "node:assert/strict";
import test from "node:test";
import { Organizations, account, context, member } from "./organization-document-loaded-with-fixture-account.mjs";

test("organization document groups one flat member list with deterministic roster offsets", async () => {
  const source = account();
  const result = structuredClone(source);
  result.organizations.members = [member("TEST", "a"), member("TEST", "b"), member("MMHC", "c")];
  const document = await Organizations.merge({ accountDocument: source, resultDocument: result, selectedSids: ["TEST", "MMHC"], exportedAt: "2026-11-18T01:02:03.004Z", generatorVersion: "0.42.2" });
  assert.deepEqual(JSON.parse(JSON.stringify(document.rosterIndex.map(({ organizationSid, memberStart, memberCount }) => ({ organizationSid, memberStart, memberCount })))), [
    { organizationSid: "TEST", memberStart: 0, memberCount: 2 },
    { organizationSid: "MMHC", memberStart: 2, memberCount: 1 }
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(Organizations.membersFor(document, "MMHC").map((entry) => entry.recordKey))), ["c"]);
  assert.equal(await context.CitizenDataAccountDocument.verifyIntegrity(document), true);
});

test("organization update replaces selected slices and preserves unselected slices", async () => {
  const source = account();
  const baselineResult = structuredClone(source);
  baselineResult.organizations.members = [member("TEST", "old-test"), member("MMHC", "old-mmhc")];
  const previous = await Organizations.merge({ accountDocument: source, resultDocument: baselineResult, selectedSids: ["TEST", "MMHC"], exportedAt: "2026-11-18T01:00:00.000Z" });
  const updateResult = structuredClone(source);
  updateResult.organizations.members = [member("TEST", "new-test")];
  const updated = await Organizations.merge({ accountDocument: source, previous, resultDocument: updateResult, selectedSids: ["TEST"], exportedAt: "2026-11-18T02:00:00.000Z" });
  assert.deepEqual(JSON.parse(JSON.stringify(Organizations.membersFor(updated, "TEST").map((entry) => entry.recordKey))), ["new-test"]);
  assert.deepEqual(JSON.parse(JSON.stringify(Organizations.membersFor(updated, "MMHC").map((entry) => entry.recordKey))), ["old-mmhc"]);
});

test("files of one account match by handle, whatever local identifier the extension drew for each", async () => {
  const first = { localAccountId: "00000000-0000-4000-8000-000000000001", handle: "Pilot" };
  // A build made after the extension's data was cleared, or by another installation: a new identifier, the same handle.
  assert.equal(Organizations.sameAccount(first, { localAccountId: "00000000-0000-4000-8000-000000000002", handle: "pilot " }), true);
  assert.equal(Organizations.sameAccount(first, { localAccountId: first.localAccountId, handle: "Pilot" }), true);
  // Another handle is another account, even under the same identifier.
  assert.equal(Organizations.sameAccount(first, { localAccountId: first.localAccountId, handle: "AnotherPilot" }), false);
  assert.equal(Organizations.sameAccount(first, { localAccountId: "00000000-0000-4000-8000-000000000002", handle: "AnotherPilot" }), false);
  // A file that names no handle is matched by its identifier, and two files that name neither match nothing.
  assert.equal(Organizations.sameAccount(first, { localAccountId: first.localAccountId, handle: null }), true);
  assert.equal(Organizations.sameAccount(first, { localAccountId: "00000000-0000-4000-8000-000000000002", handle: null }), false);
  assert.equal(Organizations.sameAccount({ localAccountId: null, handle: null }, { localAccountId: null, handle: null }), false);
  assert.equal(Organizations.sameAccount(null, undefined), false);

  // An Orgs JSON kept from the earlier build is carried into the later one.
  const source = account();
  const previous = await Organizations.merge({ accountDocument: source, selectedSids: [], exportedAt: "2026-11-18T01:00:00.000Z" });
  const rebuilt = account();
  rebuilt.account.localAccountId = "00000000-0000-4000-8000-000000000099";
  const merged = await Organizations.merge({ accountDocument: rebuilt, previous, exportedAt: "2026-11-18T02:00:00.000Z" });
  assert.equal(merged.account.localAccountId, "00000000-0000-4000-8000-000000000099");
});

test("organization document rejects a different account and noncontiguous ranges", async () => {
  const source = account();
  const previous = await Organizations.merge({ accountDocument: source, selectedSids: [], exportedAt: "2026-11-18T01:00:00.000Z" });
  const other = account();
  other.account.localAccountId = "00000000-0000-4000-8000-000000000099";
  other.account.handle = "AnotherPilot";
  await assert.rejects(Organizations.merge({ accountDocument: other, previous }), /different account/u);
  const invalid = structuredClone(previous);
  invalid.rosterIndex[1].memberStart = 4;
  assert.throws(() => Organizations.validate(invalid), /noncontiguous/u);
});
