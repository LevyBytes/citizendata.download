// A build handed over from a file is kept as it is, but is no basis for the extension's next build: that build reads
// every section from RSI, so nothing the file alone holds survives it. Records, titles, outcomes, reader versions,
// dates and removal candidates written into a file are gone, and no record is claimed removed on the file's word.
// The synthetic RSI of the test harness answers for RSI.
import assert from "node:assert/strict";
import test from "node:test";
import { createExtensionHarness } from "../support/extension-harness.mjs";
import { AccountDocument, SMALL, account, build, plain } from "./build-history-loaded-with-fixture-builds-and-rosters.mjs";

const later = (iso, minutes) => new Date(Date.parse(iso) + minutes * 60000).toISOString();
const crafted = async (document, change) => {
  const copy = structuredClone(document);
  copy.exportedAt = later(document.exportedAt, 1);
  change(copy);
  return AccountDocument.stampIntegrity(copy);
};
async function firstBuildAfter(file) {
  const harness = await createExtensionHarness({ account: SMALL });
  const tab = harness.openTab();
  assert.equal(plain(await tab.request("KEEP_BUILD", { document: file })).kept, true);
  const snapshot = [...harness.repository.inspect().snapshots.values()][0];
  assert.equal(snapshot.source, "handed-over");
  const next = await build(harness, tab);
  return { harness, tab, next };
}

test("a forged copy of the account's own backup leaves nothing of its forgery in the next build", async () => {
  const { first } = await account();
  const file = await crafted(first, (copy) => {
    const forged = structuredClone(copy.pledges[0]);
    forged.pledgeId = 987654321;
    forged.title = "FORGED PLEDGE";
    copy.pledges.push(forged);
    copy.pledges[1].title = "ALTERED TITLE";
    copy.sync.sectionOutcomes.pledges.records = copy.pledges.length;
    copy.sync.sectionOutcomes.pledges.parserVersion = "forged-reader";
  });
  const { harness, next } = await firstBuildAfter(file);
  assert.equal(next.pledges.some((pledge) => pledge.pledgeId === 987654321 || pledge.title === "FORGED PLEDGE" || pledge.title === "ALTERED TITLE"), false);
  assert.deepEqual(next.pledges.map((pledge) => pledge.pledgeId).sort(), first.pledges.map((pledge) => pledge.pledgeId).sort());
  assert.notEqual(next.sync.sectionOutcomes.pledges.parserVersion, "forged-reader");
  assert.ok(harness.rsi.requests.some((request) => JSON.stringify(request).includes("/account/pledges")), "the pledges were read from RSI");
  // The extension's own build is the basis from now on.
  assert.equal([...harness.repository.inspect().snapshots.values()][0].source, "collected");
});

test("a file made up from the handle alone leaves no record and no removal claim in the next build", async () => {
  const { first } = await account();
  const file = await crafted(first, (copy) => {
    copy.hangarLog = [];
    copy.sync.sectionOutcomes.hangarLog.records = 0;
    const forged = structuredClone(copy.pledges[0]);
    forged.pledgeId = 912345678;
    forged.title = "FABRICATED PLEDGE";
    copy.pledges = [forged];
    copy.sync.sectionOutcomes.pledges.records = 1;
  });
  const { harness, tab, next } = await firstBuildAfter(file);
  const claims = (document) => JSON.stringify(document).includes("912345678") || JSON.stringify(document).includes("FABRICATED PLEDGE");
  assert.equal(claims(next), false);
  assert.ok(next.hangarLog.length > 0, "the Hangar Log was read from RSI");
  // Nor in the update after it, which stands on the extension's own build.
  assert.equal(claims(await build(harness, tab)), false);
});
