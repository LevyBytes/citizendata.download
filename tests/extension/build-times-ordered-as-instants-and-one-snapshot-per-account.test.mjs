// Builds are ordered by the instant their exportedAt names, not by its text (shared/account-document.js); a file
// dated more than five minutes past the extension's clock is refused and adds nothing; and an account has one
// snapshot whatever the letter case of its handle, which a build of the account finds and replaces.
import assert from "node:assert/strict";
import test from "node:test";
import { createExtensionHarness } from "../support/extension-harness.mjs";
import { AccountDocument, SMALL, account, build, plain } from "./build-history-loaded-with-fixture-builds-and-rosters.mjs";

// The instant `ms` written with an offset of `minutes` from UTC.
const withOffset = (ms, minutes) => {
  const sign = minutes < 0 ? "-" : "+";
  const offset = Math.abs(minutes);
  return `${new Date(ms + minutes * 60000).toISOString().slice(0, 23)}${sign}${String(Math.floor(offset / 60)).padStart(2, "0")}:${String(offset % 60).padStart(2, "0")}`;
};
const dated = async (document, exportedAt, change = () => {}) => {
  const copy = structuredClone(document);
  copy.exportedAt = exportedAt;
  change(copy);
  return AccountDocument.stampIntegrity(copy);
};

test("the comparison reads instants: offsets, the text order they upset, and times that are not valid", () => {
  const at = Date.parse("2026-11-22T12:00:00Z");
  assert.equal(AccountDocument.compareExportedAt("2026-11-22T12:00:00Z", withOffset(at, 120)), 0);
  assert.equal(AccountDocument.compareExportedAt(withOffset(at + 3600000, -180), "2026-11-22T12:00:00Z"), 1, "later, though its text sorts first");
  assert.equal(AccountDocument.compareExportedAt(withOffset(at - 3600000, 180), "2026-11-22T12:00:00Z"), -1, "earlier, though its text sorts last");
  assert.equal(AccountDocument.compareExportedAt("not a time", "2026-11-22T12:00:00Z"), -1);
  assert.equal(AccountDocument.compareExportedAt("2026-13-01T00:00:00Z", "not a time either"), 0);
  assert.equal(AccountDocument.FUTURE_EXPORT_ALLOWANCE_MS, 300000);
  assert.equal(AccountDocument.exportedInTheFuture(new Date(at + 300000).toISOString(), at), false);
  assert.equal(AccountDocument.exportedInTheFuture(new Date(at + 300001).toISOString(), at), true);
});

test("a handed-over file is placed by its instant: the same instant, a later one and an earlier one", async () => {
  const { first } = await account();
  const harness = await createExtensionHarness({ account: SMALL });
  const tab = harness.openTab();
  const at = Date.parse(first.exportedAt);
  assert.equal(plain(await tab.request("KEEP_BUILD", { document: first })).kept, true);
  const reason = async (exportedAt) => plain(await tab.request("KEEP_BUILD", { document: await dated(first, exportedAt) }));
  assert.equal((await reason(withOffset(at, 120))).reason, "SAME_BUILD");
  assert.equal((await reason(withOffset(at - 3600000, 180))).reason, "NEWER_BUILD_HELD");
  assert.deepEqual(await reason(withOffset(at + 60000, -180)), { ok: true, kept: true, replaced: true });
});

test("a file dated more than five minutes ahead of the extension's clock is refused, and nothing of it is kept", async () => {
  const { first } = await account();
  const harness = await createExtensionHarness({ account: SMALL });
  const tab = harness.openTab();
  const now = Date.parse("2026-11-01T12:00:00.000Z");
  const refused = plain(await tab.request("KEEP_BUILD", { document: await dated(first, new Date(now + 360000).toISOString()) }));
  assert.deepEqual([refused.ok, refused.code], [false, "FUTURE_BUILD"]);
  const listed = plain(await tab.request("LIST_ACCOUNTS"));
  assert.deepEqual([listed.accounts, listed.selectedKey, harness.repository.inspect().snapshots.size], [[], null, 0]);
  assert.equal(plain(await tab.request("KEEP_BUILD", { document: await dated(first, new Date(now + 240000).toISOString()) })).kept, true, "within the allowance");
});

test("a file whose handle differs only in letter case is the same account: the next build finds it and keeps one snapshot", async () => {
  const { first } = await account();
  const harness = await createExtensionHarness({ account: SMALL });
  const tab = harness.openTab();
  const lower = first.account.handle.toLowerCase();
  const file = await dated(first, first.exportedAt, (copy) => {
    copy.account.handle = lower;
    if (copy.profile?.handle) copy.profile.handle = lower;
  });
  assert.equal(plain(await tab.request("KEEP_BUILD", { document: file })).kept, true);
  const own = await build(harness, tab);
  const snapshots = [...harness.repository.inspect().snapshots.values()];
  assert.deepEqual(snapshots.map((snapshot) => snapshot.accountId), [first.account.handle]);
  // A handed-over build is read again in full, so the build is a baseline; it found the file under the other letter
  // case, since it keeps the file's local account identifier.
  const jobs = [...harness.repository.inspect().jobs.values()].map((job) => [job.mode, job.accountId]);
  assert.deepEqual(jobs, [["baseline", first.account.handle]]);
  assert.equal(own.account.localAccountId, file.account.localAccountId);
});
