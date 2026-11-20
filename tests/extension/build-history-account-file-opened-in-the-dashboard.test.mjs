import assert from "node:assert/strict";
import test from "node:test";
import { createExtensionHarness } from "../support/extension-harness.mjs";
import { SMALL, account, build, history, keptBuilds, plain } from "./build-history-loaded-with-fixture-builds-and-rosters.mjs";

test("an account file opened in the dashboard is kept when the extension holds no build of the account, or an older one", async () => {
  // Two finished builds of one account, made by another installation.
  const source = await account();
  const first = source.first;
  const firstBuildRequests = source.harness.rsi.requests.length;
  source.harness.rsi.addPledges(1);
  const second = await build(source.harness, source.tab);

  // A fresh installation holds nothing. The page hands over the file its user opened, and the extension keeps it,
  // whole and unchanged, without asking RSI for anything.
  const harness = await createExtensionHarness({ account: SMALL });
  const tab = harness.openTab();
  assert.deepEqual(plain(await tab.request("KEEP_BUILD", { document: first })), { ok: true, kept: true, replaced: false });
  assert.equal(harness.rsi.requests.length, 0, "taking in a file asks RSI for nothing");
  assert.deepEqual(plain(await harness.openTab().request("GET_LATEST_BUILD")).result, first);
  const saved = [...harness.repository.inspect().snapshots.values()];
  assert.deepEqual(saved.map((snapshot) => [snapshot.accountId, snapshot.runId, snapshot.document.integrity.contentHash]), [[first.account.handle, first.sync.runs.at(-1).runId, first.integrity.contentHash]]);

  // The same file again changes nothing.
  assert.deepEqual(plain(await tab.request("KEEP_BUILD", { document: first })), { ok: true, kept: false, reason: "SAME_BUILD" });
  assert.deepEqual((await history(harness)).copies, []);

  // A newer build of the account replaces the one held, which goes to the build history like any replaced build.
  assert.deepEqual(plain(await tab.request("KEEP_BUILD", { document: second })), { ok: true, kept: true, replaced: true });
  assert.deepEqual(plain(await tab.request("GET_LATEST_BUILD")).result, second);
  assert.deepEqual(keptBuilds(await history(harness)).map((copy) => copy.exportedAt), [first.exportedAt]);

  // An older build never replaces a newer one.
  assert.deepEqual(plain(await tab.request("KEEP_BUILD", { document: first })), { ok: true, kept: false, reason: "NEWER_BUILD_HELD" });
  assert.deepEqual(plain(await tab.request("GET_LATEST_BUILD")).result, second);
  assert.equal(harness.repository.inspect().snapshots.size, 1);

  // The next build is an update of the build that was handed over: it keeps the file's local account identifier,
  // reads less than a first build, and opens no buy-back page, because the file already holds every item's detail.
  const buybackPages = (requests) => requests.filter((request) => JSON.stringify(request).includes("/pledge/buyback/")).length;
  assert.ok(buybackPages(source.harness.rsi.requests.slice(0, firstBuildRequests)) > 0);
  const before = harness.rsi.requests.length;
  const third = await build(harness, tab);
  const update = harness.rsi.requests.slice(before);
  assert.equal(third.account.localAccountId, first.account.localAccountId);
  assert.ok(update.length < firstBuildRequests, `${update.length} requests after a hand-over, ${firstBuildRequests} for a first build`);
  assert.equal(buybackPages(update), 0);
});
