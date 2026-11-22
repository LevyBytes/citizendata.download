// A referral row RSI sends out of shape is kept as evidence (PARSER_HARDENING.md §5.7). When the normalized data
// holds a record under the row's own id, its proven identity is retained there and the evidence says so; a row the
// parser rejects, or one without an id, is evidence only. No evidence record is dropped.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { loadClassicScripts } from "../extension/load-classic-script.mjs";
import { root } from "./repository-root.mjs";

const plain = (value) => JSON.parse(JSON.stringify(value));
const SOURCE_URL = "https://robertsspaceindustries.com/en/referral";
const liveRuntimeSource = await readFile(path.join(root, "extension", "adapters", "live-runtime.js"), "utf8");

// The live runtime over the real parsers, with a stand-in collector that answers one page of prospects.
async function prospectsStep(raw, rawAnomalies) {
  const rsiApi = {
    async collectStep() {
      return { done: true, complete: true, pagesOrBatches: 1, warnings: [], requestActivities: [], requestProgress: null, sourceUrls: [SOURCE_URL], raw: build(raw), rawAnomalies: build(rawAnomalies) };
    },
    clearTransientCaches() {}
  };
  const context = await loadClassicScripts([
    path.join(root, "extension", "shared", "account-document.js"),
    path.join(root, "extension", "adapters", "normalization.js"),
    path.join(root, "extension", "adapters", "pure-parsers.js")
  ], { crypto: globalThis.crypto, TextEncoder, Uint8Array, CitizenDataRsiApi: rsiApi });
  const build = (value) => vm.runInContext(`(${JSON.stringify(value)})`, context);
  vm.runInContext(liveRuntimeSource, context, { filename: "live-runtime.js" });
  const adapter = context.CitizenDataLiveRuntime.createAdapter({ id: "referrals.current.prospects", parser: "parseReferrals", version: "0.42.1", parserOptions: { ladder: "current", kind: "prospects" } });
  return adapter.collectStep({ accountId: "Citizen", runId: "run", cursor: null, maximumRecords: 100 });
}

// A row as the collector maps it for the parser (rsi-api.js referralRaw), and its evidence as the collector keeps it.
const mapped = (recordKey, displayName, handle, dateRaw) => ({ recordKey, displayName, handle, displayNameRaw: displayName, nicknameRaw: handle, dateRaw, dateLabel: "enlistedOn", dateSortKey: dateRaw, images: [] });
const evidence = (recordIndex, issues, source) => ({ recordIndex, pageOrBatch: 1, issueCode: `RSI_REFERRAL_RECORD_${issues}`, message: `current prospects page 1 row ${recordIndex} contained unexpected RSI source values and was retained for review.`,
  raw: source, retainedInNormalizedData: false });

test("a malformed row kept under its own id is evidence retained in the normalized data; the others are evidence only", async () => {
  const raw = [
    mapped("prospect-good", "Good", "good", "2024-01-01"),
    mapped("prospect-kept", null, null, "2024-02-02"),
    mapped("prospect-rejected", "Rejected", "rejected", null),
    mapped(null, "Unnamed", "unnamed", "2024-04-04")
  ];
  const rawAnomalies = [
    evidence(2, "DISPLAY_NAME_TYPE_NUMBER_NICKNAME_NULL", { id: "prospect-kept", displayName: 42, nickname: null, enlistedOn: "2024-02-02" }),
    evidence(3, "ENLISTED_ON_NULL", { id: "prospect-rejected", displayName: "Rejected", nickname: "rejected", enlistedOn: null }),
    evidence(4, "ID_MISSING", { displayName: "Unnamed", nickname: "unnamed", enlistedOn: "2024-04-04" })
  ];
  const result = await prospectsStep(raw, rawAnomalies);
  assert.equal(result.ok, true, result.message);
  const [prospects] = plain(result.parserResults);
  const keys = prospects.value.map((record) => record.recordKey);
  assert.ok(keys.includes("prospect-good") && keys.includes("prospect-kept") && !keys.includes("prospect-rejected"), JSON.stringify(keys));
  assert.equal(keys.length, 3, "the row without an id is kept under a key of its own, not a proven identity");
  const flags = Object.fromEntries(prospects.anomalies.filter((entry) => entry.issueCode.startsWith("RSI_REFERRAL_RECORD_")).map((entry) => [entry.issueCode, entry.retainedInNormalizedData]));
  assert.deepEqual(flags, {
    RSI_REFERRAL_RECORD_DISPLAY_NAME_TYPE_NUMBER_NICKNAME_NULL: true,
    RSI_REFERRAL_RECORD_ENLISTED_ON_NULL: false,
    RSI_REFERRAL_RECORD_ID_MISSING: false
  });
  // Every evidence record is kept, one for each row, with RSI's exact values; the parser's rejection of row 3 is the
  // same row's record and does not replace it.
  assert.deepEqual(prospects.anomalies.map((entry) => [entry.recordIndex, entry.raw.id ?? null]), [[2, "prospect-kept"], [3, "prospect-rejected"], [4, null]]);
  assert.equal(new Set(prospects.anomalies.map((entry) => entry.anomalyKey)).size, 3);
});
