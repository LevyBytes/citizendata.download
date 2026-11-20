import assert from "node:assert/strict";
import test from "node:test";
import { History, organizations } from "./build-history-loaded-with-fixture-backups.mjs";

test("the Orgs JSON is kept as the file the dashboard saves for it, and only while the history is on", async () => {
  await import("../../docs/scripts/file-timestamp.js");
  await import("../../docs/scripts/canonical-download.js");
  const Download = globalThis.CitizenDataCanonicalDownload;
  const first = organizations("2026-11-19T01:02:03.456Z");
  const on = { enabled: true, keep: 5 };
  for (const refused of [{ settings: { enabled: false, keep: 5 } }, { accountId: "" }, { organizations: null }, { organizations: [] }]) {
    assert.equal(await History.planOrganizations({ settings: on, accountId: "citizen-1", organizations: first, archivedAt: "2026-11-19T01:02:04.000Z", ...refused }), null);
  }
  const kept = await History.planOrganizations({ settings: on, accountId: "citizen-1", organizations: first, archivedAt: "2026-11-19T01:02:04.000Z" });
  assert.deepEqual({ ...kept.entry, fingerprint: null, storedBytes: null }, {
    historyId: "citizen-1:organizations", kind: "organizations", accountId: "citizen-1", handle: "Example Citizen", exportedAt: first.exportedAt, archivedAt: "2026-11-19T01:02:04.000Z",
    fingerprint: null, fileName: Download.organizationFileName(first), fileBytes: Buffer.byteLength(Download.serialize(first)), storedBytes: null, organizations: 1, members: 2
  });
  assert.equal(kept.entry.fileName, "citizendata-organizations-Example-Citizen-2026-11-19-010203-456Z.json");
  assert.equal(History.organizationsFileName(first), Download.organizationFileName(first));
  assert.deepEqual([kept.data.historyId, History.isOrganizations(kept.entry), History.isOrganizations({ historyId: "x" })], ["citizen-1:organizations", true, false]);
  assert.equal(Buffer.from(await History.unpack(kept.data.gzipBase64)).toString("utf8"), Download.serialize(first));

  // The same rosters read again at another time are the kept ones; changed rosters, or the same rosters collected
  // again, replace them under the same identifier.
  const reread = organizations("2026-11-20T00:00:00.000Z", ["a", "b"], first.exportedAt);
  assert.equal(await History.planOrganizations({ settings: on, accountId: "citizen-1", organizations: reread, entries: [kept.entry], archivedAt: "2026-11-20T00:00:01.000Z" }), null);
  const grown = await History.planOrganizations({ settings: on, accountId: "citizen-1", organizations: organizations("2026-11-20T00:00:00.000Z", ["a", "b", "c"], first.exportedAt), entries: [kept.entry], archivedAt: "2026-11-20T00:00:01.000Z" });
  assert.deepEqual([grown.entry.historyId, grown.entry.members, grown.entry.fingerprint !== kept.entry.fingerprint], ["citizen-1:organizations", 3, true]);
  const collectedAgain = await History.planOrganizations({ settings: on, accountId: "citizen-1", organizations: organizations("2026-11-20T00:00:00.000Z"), entries: [kept.entry], archivedAt: "2026-11-20T00:00:01.000Z" });
  assert.equal(collectedAgain.entry.historyId, "citizen-1:organizations");
  // Another account's Orgs JSON is its own record.
  assert.equal((await History.planOrganizations({ settings: on, accountId: "citizen-2", organizations: first, entries: [kept.entry], archivedAt: "2026-11-20T00:00:01.000Z" })).entry.historyId, "citizen-2:organizations");
});

test("the kept Orgs JSON is not an earlier build: it is never counted against the number to keep", async () => {
  const orgs = (await History.planOrganizations({ settings: { enabled: true, keep: 1 }, accountId: "citizen-1", organizations: organizations("2026-11-19T01:02:03.456Z"), archivedAt: "2026-11-19T01:02:04.000Z" })).entry;
  const earlier = { historyId: "citizen-1:2026-11-01T00:00:00.000Z", accountId: "citizen-1", exportedAt: "2026-11-01T00:00:00.000Z" };
  const previous = { exportedAt: "2026-11-10T00:00:00.000Z", account: { handle: "Example Citizen" }, pledges: [{ pledgeId: 1 }] };
  const document = { exportedAt: "2026-11-20T00:00:00.000Z", account: { handle: "Example Citizen" }, pledges: [{ pledgeId: 1 }, { pledgeId: 2 }] };
  const planned = await History.plan({ settings: { enabled: true, keep: 1 }, accountId: "citizen-1", previous, document, entries: [orgs, earlier], archivedAt: "2026-11-20T00:00:01.000Z" });
  assert.equal(planned.add.entry.historyId, "citizen-1:2026-11-10T00:00:00.000Z");
  // The one older build goes; the Orgs JSON, although the newest record of the account, stays.
  assert.deepEqual(planned.remove, [earlier.historyId]);
});
