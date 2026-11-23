// The image run's provenance (PARSER_HARDENING.md §4.7, §14): the settings fingerprint and pace summary survive
// the package's opening and a delta update.
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { baseAccountDocument } from "../fixtures/account-document.mjs";
import { loadClassicScripts } from "../extension/load-classic-script.mjs";
import { imageHost, virtualTime, policy } from "./media-materializer-in-a-sandbox.mjs";
import { plain, entry, imagesFor } from "./mediamaterializerimageentries.mjs";

test("the settings fingerprint and pace summary survive the package's opening and a delta update", async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const context = await loadClassicScripts([
    ...["schema/account-export.schema.js", "schema/offline-package.schema.js"].map((name) => path.join(root, "docs", name)),
    ...["account-document.js", "file-timestamp.js", "zip-store.js", "safe-json.js", "media-file-names.js", "request-pacing-settings.js", "pace-controller.js", "pace-history.js", "media-materializer.js", "media-package-builder.js",
      "media-package-reader.js"].map((name) => path.join(root, "docs", "scripts", name))
  ], { URL, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, DataView, Blob, crypto: globalThis.crypto, structuredClone, setTimeout, DOMException });
  context.accountSource = JSON.stringify(baseAccountDocument());
  const account = await context.CitizenDataAccountDocument.stampIntegrity(vm.runInContext("JSON.parse(accountSource)", context));
  const packagePolicy = vm.runInContext(`(${JSON.stringify({ ...policy, allowedImageHosts: ["media.robertsspaceindustries.com"] })})`, context);
  const time = virtualTime();
  const host = imageHost({ time, images: imagesFor(2) });
  const materializeIn = async (entries) => context.CitizenDataMediaMaterializer.materialize(vm.runInContext(`(${JSON.stringify(entries)})`, context), packagePolicy, { fetcher: host.fetcher, sleep: time.sleep, nowMs: time.nowMs, now: time.now,
    random: () => 0.5 });
  const build = (materialized) => context.CitizenDataMediaPackage.buildArchive({ accountDocument: account, materialized, policy: packagePolicy, generatedAt: time.now(), startedAt: time.now(), endedAt: time.now(), version: "0.42.2" });
  const first = await materializeIn([entry(0)]);
  const built = await build(first);
  const opened = await context.CitizenDataMediaPackageReader.open(new Blob([built.archive]));
  assert.deepEqual(plain(opened.manifest.materializationReceipt.pacing), plain(first.pacing));
  // A delta update reads only the new image; its own package carries its own run's summary under the same settings.
  const delta = await context.CitizenDataMediaPackageReader.prepareDelta(vm.runInContext(`(${JSON.stringify([entry(0), entry(1)])})`, context), opened);
  assert.deepEqual([delta.reused.assets.length, delta.pending.length], [1, 1]);
  const second = await materializeIn(plain(delta.pending));
  const next = await build({ assets: [...delta.reused.assets, ...second.assets], files: [...delta.reused.files, ...second.files], totalBytes: second.totalBytes + 100, downloadedBytes: second.downloadedBytes, refusedAttempts: second.refusedAttempts,
    pacing: second.pacing });
  const reopened = await context.CitizenDataMediaPackageReader.open(new Blob([next.archive]));
  assert.equal(reopened.manifest.materializationReceipt.pacing.settingsFingerprint, first.pacing.settingsFingerprint);
  assert.equal(reopened.manifest.materializationReceipt.pacing.acceptedRequests, 1);
  // An older package, without the summary, is still read.
  const older = await build({ ...first, pacing: undefined });
  assert.equal((await context.CitizenDataMediaPackageReader.open(new Blob([older.archive]))).manifest.materializationReceipt.pacing, undefined);
});
