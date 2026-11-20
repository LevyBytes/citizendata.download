import assert from "node:assert/strict";
import test from "node:test";
import { Download, Organizations, account, build, collectRoster, history, keptBuilds, keptOrganizations, plain, savedFile } from "./build-history-loaded-with-fixture-builds-and-rosters.mjs";

test("with the history on, the collected rosters are kept as one Orgs JSON that each build keeps current", async () => {
  const { harness, tab } = await account();
  // Off: a collected roster is carried in the latest build, and nothing is kept beside it.
  await harness.popup.request("SET_BUILD_HISTORY", { enabled: false });
  await collectRoster(harness, tab);
  assert.deepEqual((await history(harness)).copies, []);

  // Turned on: the rosters the latest build already carries are kept at once.
  const on = plain(await harness.popup.request("SET_BUILD_HISTORY", { enabled: true }));
  const [orgs] = keptOrganizations(on);
  assert.equal(on.copies.length, 1, JSON.stringify(on.copies));
  assert.deepEqual([orgs.kind, orgs.historyId.endsWith(":organizations"), orgs.storedBytes < orgs.fileBytes, on.storedBytes], ["organizations", true, true, orgs.storedBytes]);
  assert.match(orgs.fileName, /^citizendata-organizations-[A-Za-z0-9_-]+-\d{4}-\d{2}-\d{2}-\d{6}-\d{3}Z\.json$/u);
  // The kept file is an Organization JSON the dashboard accepts, holding the whole roster.
  const file = await savedFile(harness, orgs.historyId);
  const document = JSON.parse(file.text);
  await Organizations.accept(document);
  assert.equal(file.text, Download.serialize(document));
  assert.equal(document.members.length, harness.rsi.state.members.length);
  assert.deepEqual(document.rosterIndex.map((roster) => [roster.organizationSid, roster.status, roster.memberCount]), [["SYNTH", "complete", harness.rsi.state.members.length]]);
  assert.equal(Buffer.byteLength(file.text), orgs.fileBytes);

  // A changed account build keeps the earlier build and leaves the Orgs JSON as it is.
  harness.rsi.addPledges(1);
  await build(harness, tab);
  const afterBuild = await history(harness);
  assert.equal(keptBuilds(afterBuild).length, 1);
  assert.deepEqual(keptOrganizations(afterBuild), [orgs]);

  // The roster collected again replaces the kept Orgs JSON; there is still one.
  await collectRoster(harness, tab);
  const afterRoster = await history(harness);
  const [updated] = keptOrganizations(afterRoster);
  assert.equal(keptOrganizations(afterRoster).length, 1);
  assert.equal(updated.historyId, orgs.historyId);
  assert.ok(updated.exportedAt > orgs.exportedAt && updated.archivedAt > orgs.archivedAt, JSON.stringify([orgs, updated]));
  const again = JSON.parse((await savedFile(harness, orgs.historyId)).text);
  await Organizations.accept(again);
  assert.ok(again.rosterIndex[0].updatedAt > document.rosterIndex[0].updatedAt);

  // The number of builds to keep never removes it.
  await harness.popup.request("SET_BUILD_HISTORY", { keep: 1 });
  harness.rsi.addPledges(1);
  await build(harness, tab);
  harness.rsi.addPledges(1);
  await build(harness, tab);
  const limited = await history(harness);
  assert.deepEqual([keptBuilds(limited).length, keptOrganizations(limited).length], [1, 1]);

  // Off: it stays as it was and is no longer updated. It is deleted by itself, or with everything kept.
  await harness.popup.request("SET_BUILD_HISTORY", { enabled: false });
  await collectRoster(harness, tab);
  assert.deepEqual(keptOrganizations(await history(harness)), keptOrganizations(limited));
  const deleted = plain(await harness.popup.request("DELETE_BUILD_HISTORY_COPY", { historyId: orgs.historyId }));
  assert.deepEqual([keptBuilds(deleted).length, keptOrganizations(deleted).length], [1, 0]);
  await harness.popup.request("SET_BUILD_HISTORY", { enabled: true });
  assert.equal(keptOrganizations(await history(harness)).length, 1, "turning the history on keeps the rosters of the latest build again");
  const cleared = plain(await harness.popup.request("CLEAR_BUILD_HISTORY"));
  assert.deepEqual([cleared.copies, cleared.storedBytes], [[], 0]);
  // The rosters themselves are still carried by the latest build.
  assert.equal([...harness.repository.inspect().snapshots.values()][0].document.organizations.members.length, harness.rsi.state.members.length);
});
