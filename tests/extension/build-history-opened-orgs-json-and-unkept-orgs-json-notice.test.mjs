import assert from "node:assert/strict";
import test from "node:test";
import { createExtensionHarness } from "../support/extension-harness.mjs";
import { AccountDocument, Organizations, SMALL, account, build, collectRoster, history, keptBuilds, keptOrganizations, plain } from "./build-history-loaded-with-fixture-builds-and-rosters.mjs";

test("an Orgs JSON opened in the dashboard puts its rosters into the build the extension keeps", async () => {
  // Another installation made a build and collected a roster. The dashboard saves them as two files: an account
  // file without rosters and an Orgs JSON.
  const source = await account();
  const withRoster = await collectRoster(source.harness, source.tab);
  assert.ok(withRoster.organizations.members.length > 0);
  const accountFile = async (document) => {
    const copy = structuredClone(document);
    delete copy.organizations.members;
    copy.sync.organizationMemberOutcomes = {};
    return AccountDocument.stampIntegrity(copy);
  };
  const first = await accountFile(withRoster);
  const orgs = await Organizations.fromAccountDocument({ accountDocument: withRoster });

  const harness = await createExtensionHarness({ account: SMALL });
  const tab = harness.openTab();
  const keep = async (document) => plain(await tab.request("KEEP_ORGANIZATIONS", { document }));
  const latest = async () => plain(await tab.request("GET_LATEST_BUILD")).result;

  // Rosters belong to a build of the account: without one they are not taken in.
  assert.deepEqual([(await keep(orgs)).ok, (await keep(orgs)).code], [false, "NO_BUILD_HELD"]);
  assert.deepEqual(plain(await tab.request("KEEP_BUILD", { document: first })), { ok: true, kept: true, replaced: false });
  assert.deepEqual(keptOrganizations(await history(harness)), []);

  // With the build held, the rosters go into it, and they are kept as an Orgs JSON as after a roster run.
  assert.deepEqual(await keep(orgs), { ok: true, kept: true, rosters: 1 });
  const held = await latest();
  assert.deepEqual(held.organizations.members, withRoster.organizations.members);
  assert.deepEqual([held.exportedAt, held.pledges.length, await AccountDocument.verifyIntegrity(structuredClone(held))], [first.exportedAt, first.pledges.length, true]);
  assert.deepEqual([held.sync.organizationMemberOutcomes.SYNTH.status, held.sync.organizationMemberOutcomes.SYNTH.parserVersion, held.sync.organizationMemberOutcomes.SYNTH.records], ["complete", null, withRoster.organizations.members.length]);
  const told = await history(harness);
  assert.deepEqual([keptOrganizations(told).length, keptBuilds(told).length, told.organizationsProblem], [1, 0, null]);

  // The same file again changes nothing, and the account file of the same build is still the same build.
  assert.deepEqual(await keep(orgs), { ok: true, kept: false, reason: "NOTHING_NEWER" });
  assert.deepEqual(plain(await tab.request("KEEP_BUILD", { document: first })), { ok: true, kept: false, reason: "SAME_BUILD" });
  assert.deepEqual((await latest()).organizations.members, withRoster.organizations.members);

  // A file that was changed, and a file of another account, are not taken in.
  const changed = structuredClone(orgs);
  changed.members[0].displayName = "Changed";
  assert.equal((await keep(changed)).code, "INVALID_ORGANIZATIONS");
  const other = structuredClone(orgs);
  other.account.handle = "SomeoneElse";
  assert.equal((await keep(await AccountDocument.stampIntegrity(other))).code, "NO_BUILD_HELD");
  await harness.popup.request("SET_BUILD_HISTORY", { enabled: false });
  assert.equal((await keep(orgs)).code, "BUILD_HISTORY_OFF");
  await harness.popup.request("SET_BUILD_HISTORY", { enabled: true });

  // A newer account file, saved without rosters as every account file is, replaces the build and keeps its rosters.
  source.harness.rsi.addPledges(1);
  const second = await accountFile(await build(source.harness, source.tab));
  assert.equal(second.organizations.members, undefined);
  assert.deepEqual(plain(await tab.request("KEEP_BUILD", { document: second })), { ok: true, kept: true, replaced: true });
  const replaced = await latest();
  assert.deepEqual([replaced.exportedAt, replaced.pledges.length, await AccountDocument.verifyIntegrity(structuredClone(replaced))], [second.exportedAt, first.pledges.length + 1, true]);
  assert.deepEqual(replaced.organizations.members, withRoster.organizations.members);
  assert.equal(harness.rsi.requests.length, 0, "taking in files asks RSI for nothing");
});

test("an Orgs JSON that cannot be kept never stops a build, and the popup is told", async () => {
  const { harness, tab } = await account();
  await harness.popup.request("SET_BUILD_HISTORY", { enabled: true });
  const working = harness.repository;
  let failing = true;
  harness.repository = Object.freeze({ ...working, saveHistoryCopy: async (copy) => { if (failing) throw new Error("The history store could not be written."); return working.saveHistoryCopy(copy); } });
  await harness.restartBrowser();
  const result = await collectRoster(harness, tab);
  failing = false;
  assert.equal(result.organizations.members.length, harness.rsi.state.members.length);
  assert.equal([...working.inspect().snapshots.values()][0].document.organizations.members.length, harness.rsi.state.members.length);
  const told = await history(harness);
  // The roster run changed the account data, so the build before it is kept as usual; only the Orgs JSON is missing.
  assert.deepEqual([keptOrganizations(told), keptBuilds(told).length, told.problem], [[], 1, null]);
  assert.deepEqual(told.organizationsProblem, { at: told.organizationsProblem.at, exportedAt: result.exportedAt });

  // The next build keeps the Orgs JSON and clears the notice.
  harness.rsi.addPledges(1);
  await build(harness, tab);
  const after = await history(harness);
  assert.deepEqual([keptOrganizations(after).length, after.organizationsProblem], [1, null]);
});
