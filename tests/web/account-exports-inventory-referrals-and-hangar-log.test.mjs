import assert from "node:assert/strict";
import test from "node:test";
import { Exports, fixture, native } from "./account-exports-loaded-with-fixture-account.mjs";

test("native inventory scopes retain exact selected records and omit account wrappers", () => {
  const document = fixture();
  for (const [inventoryScope, keys] of [["hangar", ["pledges"]], ["buybacks", ["buybacks"]], ["both", ["pledges", "buybacks"]]]) {
    const selection = { preset: "inventory", inventoryScope };
    const result = native(document, selection);
    assert.deepEqual(Object.keys(result), keys);
    for (const key of keys) assert.deepEqual(result[key], document[key]);
    const inspection = Exports.inspectExport(document, selection);
    assert.equal(inspection.canExport, true);
    assert.equal(inspection.recordCount, keys.length);
    assert.deepEqual(inspection.errors, []);
    assert.deepEqual(inspection.warnings, ["Completeness unknown"]);
  }
});

test("exports include all records beyond pagination, without sorting or deduplication", () => {
  const document = fixture();
  document.pledges = Array.from({ length: 61 }, (_, index) => ({ recordKey: `p-${index}`, title: index % 2 ? "Filtered out" : "Shown" }));
  document.pledges.push({ ...document.pledges[0] });
  const selection = { preset: "inventory", inventoryScope: "hangar" };
  assert.deepEqual(native(document, selection).pledges, document.pledges);
  assert.equal(Exports.inspectExport(document, selection).recordCount, 62);
});

test("referral selectors preserve ladder nesting, all four lists, and unknown dates", () => {
  const document = fixture();
  assert.deepEqual(native(document, { preset: "referrals" }), { referrals: document.referrals });
  assert.equal(Exports.inspectExport(document, { preset: "referrals" }).recordCount, 4);
  for (const referralLadder of ["both", "current", "legacy"]) for (const referralKind of ["both", "prospects", "recruits"]) {
    const result = native(document, { preset: "referrals", referralLadder, referralKind });
    const ladders = referralLadder === "both" ? ["current", "legacy"] : [referralLadder];
    const kinds = referralKind === "both" ? ["prospects", "recruits"] : [referralKind];
    assert.deepEqual(Object.keys(result.referrals), ladders);
    for (const ladder of ladders) {
      assert.deepEqual(Object.keys(result.referrals[ladder]), kinds);
      for (const kind of kinds) assert.deepEqual(result.referrals[ladder][kind], document.referrals[ladder][kind]);
    }
  }
});

test("referral exports retain matching raw anomaly evidence", () => {
  const document = fixture();
  const redacted = {
    recordKey: "legacy-redacted",
    displayName: null,
    handle: null,
    displayNameRaw: "",
    nicknameRaw: null,
    dateLabel: "enlistedOn",
    dateRaw: "2016-01-02T03:04:05Z",
    dateSortKey: "2016-01-02",
    images: []
  };
  document.referrals.legacy.prospects.push(redacted);
  const anomaly = {
    anomalyKey: "referrals.legacy.prospects:2805:29",
    section: "referrals.legacy.prospects",
    recordIndex: 2805,
    pageOrBatch: 29,
    issueCode: "RSI_REFERRAL_RECORD_DISPLAY_NAME_EMPTY_NICKNAME_NULL",
    message: "Unexpected source identity retained.",
    raw: { id: "legacy-redacted", displayName: "", nickname: null },
    retainedInNormalizedData: true,
    observedAt: "2026-11-18T12:47:55-08:00",
    sourceUrls: ["https://robertsspaceindustries.com/graphql"]
  };
  document.dataQuality = { anomalies: [anomaly, { ...anomaly, anomalyKey: "pledges:1:1", section: "pledges" }] };
  const result = native(document, { preset: "referrals", referralLadder: "legacy", referralKind: "prospects" });
  assert.deepEqual(result.referrals.legacy.prospects.at(-1), redacted);
  assert.deepEqual(result.dataQuality.anomalies, [anomaly]);
  assert.ok(Exports.inspectExport(document, { preset: "referrals", referralLadder: "legacy", referralKind: "prospects" }).warnings.includes("1 raw data warning"));
});

test("raw Hangar Log exports only scrolling facts, retaining repeated entries and text", () => {
  const document = fixture();
  document.hangarLog.push({ ...document.hangarLog[0], occurrenceOrdinal: 2 });
  document.hangarLog.push({ rawTimestamp: "Unknown time", subjectId: null, subjectName: null, rawDetail: "Unclassified activity" });
  const result = native(document, { preset: "hangar-log" });
  assert.equal(result.length, 3);
  assert.deepEqual(Object.keys(result[0]), ["rawTimestamp", "subjectId", "subjectName", "rawDetail"]);
  assert.deepEqual(result[0], result[1]);
  assert.equal(result[0].rawDetail, document.hangarLog[0].rawDetail);
  assert.equal(result[2].subjectId, null);
  assert.equal(Exports.inspectExport(document, { preset: "hangar-log" }).recordCount, 3);
});
