// The image hosts' own pace history (PARSER_HARDENING.md §14, criterion 20): with no history an image run starts at
// factor 2 with no live penalty and says so in its receipt; a loaded Images ZIP's receipt seeds the next run, whose
// controller is given the earlier accepted response times; a malformed history, or the account's, is never used.
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { baseAccountDocument } from "../fixtures/account-document.mjs";
import { loadClassicScripts } from "../extension/load-classic-script.mjs";
import { imageHost, virtualTime, policy } from "./media-materializer-in-a-sandbox.mjs";
import { plain, entry, imagesFor } from "./mediamaterializerimageentries.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const context = await loadClassicScripts([
  ...["schema/account-export.schema.js", "schema/offline-package.schema.js"].map((name) => path.join(root, "docs", name)),
  ...["account-document.js", "file-timestamp.js", "zip-store.js", "safe-json.js", "media-file-names.js", "request-pacing-settings.js", "pace-controller.js", "pace-history.js", "media-materializer.js", "media-package-builder.js",
    "media-package-reader.js"].map((name) => path.join(root, "docs", "scripts", name))
], { URL, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, DataView, Blob, crypto: globalThis.crypto, structuredClone, setTimeout, DOMException });
const History = context.CitizenDataPaceHistory;
const settings = context.CITIZENDATA_REQUEST_PACING;
const Pace = context.CitizenDataPaceController;
const FAMILY = Pace.requestFamily("images", "GET", "/{image}");
context.accountSource = JSON.stringify(baseAccountDocument());
const account = await context.CitizenDataAccountDocument.stampIntegrity(vm.runInContext("JSON.parse(accountSource)", context));
const packagePolicy = vm.runInContext(`(${JSON.stringify({ ...policy, allowedImageHosts: ["media.robertsspaceindustries.com"] })})`, context);
const time = virtualTime();
const host = imageHost({ time, images: imagesFor(6) });
// What the controller was given as the image family's normal, at each accepted answer.
const given = [];
const paceController = { ...Pace, onSuccess: (pace, input) => { given.push(input.historicalNormal === null ? null : plain(input.historicalNormal)); return Pace.onSuccess(pace, input); } };
const materializeIn = (indexes, history, runId) => context.CitizenDataMediaMaterializer.materialize(vm.runInContext(`(${JSON.stringify(indexes.map(entry))})`, context), packagePolicy, {
  fetcher: host.fetcher, sleep: time.sleep, nowMs: time.nowMs, now: time.now, random: () => 0.5, paceController, runId, history: history === undefined ? undefined : vm.runInContext(`(${JSON.stringify(history)})`, context)
});
const build = (materialized) => context.CitizenDataMediaPackage.buildArchive({ accountDocument: account, materialized, policy: packagePolicy, generatedAt: time.now(), startedAt: time.now(), endedAt: time.now(), version: "0.42.1" });
const openReceipt = async (built) => (await context.CitizenDataMediaPackageReader.open(new Blob([built.archive]))).manifest.materializationReceipt;

const first = await materializeIn([0, 1, 2, 3, 4], undefined, "first-run");
const firstReceipt = await openReceipt(await build(first));

test("with no history the run starts at factor 2, uses no earlier times, and its receipt says so", () => {
  assert.deepEqual(plain(first.paceHistory).source, "none");
  assert.deepEqual([first.paceHistory.priorAggregate, plain(first.paceHistory.acceptedSamples)], [null, []]);
  assert.equal(first.pacing.startedFactor, 2);
  assert.deepEqual(given.splice(0), first.pacing.acceptedRequests > 0 ? Array(first.pacing.acceptedRequests).fill(null) : []);
  assert.deepEqual([first.imageRun.runKind, first.imageRun.account, first.paceHistory.aggregate.historyKey, first.paceHistory.aggregate.runs], ["images", "images", "images", 1]);
  // The receipt carries the provenance and the pacing summary, and the package opens against the schema.
  assert.deepEqual(plain(firstReceipt.paceHistory), plain(first.paceHistory));
  assert.equal(firstReceipt.pacing.settingsFingerprint, first.pacing.settingsFingerprint);
  assert.equal(JSON.stringify(firstReceipt.paceHistory).includes("http"), false, "no address in the history");
});

test("a loaded Images ZIP seeds the next run: its accepted times reach the controller and its receipt names the package", async () => {
  const fromPackage = History.imageHistoryFromReceipt(firstReceipt, settings);
  assert.ok(fromPackage);
  const samples = plain(first.imageRun.latency[FAMILY].samples);
  assert.ok(samples.length >= 5, `${samples.length} samples`);
  const second = await materializeIn([5], [{ source: "package", record: plain(fromPackage) }], "second-run");
  assert.equal(second.paceHistory.source, "package");
  assert.deepEqual(plain(second.paceHistory.priorAggregate), { runs: 1, acceptedRequests: first.pacing.acceptedRequests, refusedRequests: 0, retriedRequests: 0, slowSteps: first.pacing.slowSteps });
  assert.deepEqual(plain(second.paceHistory.acceptedSamples), samples);
  assert.deepEqual(given.splice(0), [samples], "the controller was given the earlier accepted times");
  assert.equal(second.paceHistory.aggregate.runs, 2);
  assert.equal(second.pacing.startedFactor, 2, "history never sets the starting factor");
  // A package written before the provenance existed gives its pacing summary's counts, and no times.
  const older = History.imageHistoryFromReceipt({ ...plain(firstReceipt), paceHistory: undefined }, settings);
  assert.deepEqual([older.aggregate.runs, older.aggregate.acceptedRequests, plain(History.imageNormalLatency(older, FAMILY, settings))], [1, first.pacing.acceptedRequests, []]);
});

test("a malformed history, or the account's, is not used; the next valid source is", async () => {
  const valid = plain(History.imageHistoryFromReceipt(firstReceipt, settings));
  const malformed = { ...valid, aggregate: { ...valid.aggregate, latency: { "GET https://media.robertsspaceindustries.com/x in images": { samples: [1], fastestAcceptedFactor: 1 } } } };
  const account = { historyKey: "connection", kind: "aggregate", version: 1, runs: 1, acceptedRequests: 9, refusedRequests: 0, retriedRequests: 0, slowSteps: 0, signalCounts: [], latency: {}, updatedAt: null };
  for (const record of [malformed, account, { historyKey: "images" }]) {
    const run = await materializeIn([5], [{ source: "extension", record }], "third-run");
    assert.deepEqual([run.paceHistory.source, run.paceHistory.priorAggregate], ["none", null]);
  }
  const fallback = await materializeIn([5], [{ source: "extension", record: malformed }, { source: "package", record: valid }], "fourth-run");
  assert.equal(fallback.paceHistory.source, "package");
  given.splice(0);
});
