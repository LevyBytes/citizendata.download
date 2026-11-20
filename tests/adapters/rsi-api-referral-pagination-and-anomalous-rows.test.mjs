import assert from "node:assert/strict";
import test from "node:test";
import { harness } from "./rsi-api-in-a-sandbox.mjs";

test("referral pagination adapts when RSI returns fewer rows than requested", async () => {
  const entries = Array.from({ length: 9 }, (_, index) => ({
    id: `id-${index}`,
    displayName: `Citizen ${index}`,
    nickname: `Citizen${index}`,
    avatar: "/avatar.jpg",
    enlistedOn: index === 8 ? "2026-02-30T00:00:00Z" : "2026-01-01T00:00:00Z",
    convertedOn: null
  }));
  const descriptor = { id: "referrals.legacy.prospects", parserOptions: { ladder: "legacy", kind: "prospects" } };
  const firstHarness = harness([[{ data: { referralRecruitsList: { recruitsCount: 0, prospectsCount: 20, data: entries } } }]]);
  const first = await firstHarness.api.collectStep(descriptor, { cursor: null });
  assert.equal(first.done, false);
  assert.equal(first.interactiveState.pageSize, 9);
  assert.equal(first.nextPage, 2);
  assert.ok(first.raw.slice(0, 8).every((record) => record.dateSortKey === "2026-01-01"));
  assert.equal(first.raw[8].dateRaw, "2026-02-30T00:00:00Z");
  assert.equal(first.raw[8].dateSortKey, null);
  assert.ok(first.raw.every((record) => record.relatedUrls.some((url) => url.endsWith(`/en/citizens/${record.handle}`))));
  assert.deepEqual([...first.sourceUrls], ["https://robertsspaceindustries.com/en/referral", "https://robertsspaceindustries.com/graphql"]);
  assert.equal(JSON.parse(firstHarness.calls.find((call) => call.kind === "fetch").options.body)[0].variables.limit, 100);

  const secondHarness = harness([[{ data: { referralRecruitsList: { recruitsCount: 0, prospectsCount: 20, data: entries } } }]]);
  const second = await secondHarness.api.collectStep(descriptor, { cursor: { page: 2, interactiveState: { pageSize: 9 } } });
  assert.equal(second.done, false);
  assert.equal(second.nextPage, 3);
});

test("referral rows with unexpected source values are retained with exact anomaly evidence", async () => {
  const descriptor = { id: "referrals.legacy.prospects", parserOptions: { ladder: "legacy", kind: "prospects" } };
  const sourceRow = { id: "legacy-redacted", displayName: "", nickname: null, avatar: null, enlistedOn: "2016-01-02T03:04:05Z", convertedOn: null };
  const response = [[{ data: { referralRecruitsList: {
    recruitsCount: 4582,
    prospectsCount: 3827,
    data: [sourceRow]
  } } }]];
  const retained = harness(response);
  const result = await retained.api.collectStep(descriptor, { cursor: { page: 29, interactiveState: { pageSize: 100 } } });
  assert.equal(result.raw[0].recordKey, "legacy-redacted");
  assert.equal(result.raw[0].displayName, null);
  assert.equal(result.raw[0].handle, null);
  assert.equal(result.raw[0].displayNameRaw, "");
  assert.equal(result.raw[0].nicknameRaw, null);
  assert.equal(result.raw[0].relatedUrls.length, 0);
  assert.equal(result.rawAnomalies.length, 1);
  assert.equal(result.rawAnomalies[0].recordIndex, 2801);
  assert.equal(result.rawAnomalies[0].issueCode, "RSI_REFERRAL_RECORD_DISPLAY_NAME_EMPTY_NICKNAME_NULL");
  assert.deepEqual(JSON.parse(JSON.stringify(result.rawAnomalies[0].raw)), sourceRow);
  assert.equal(result.rawAnomalies[0].retainedInNormalizedData, true);
  assert.match(result.warnings[0], /exact raw evidence was retained/u);
});
