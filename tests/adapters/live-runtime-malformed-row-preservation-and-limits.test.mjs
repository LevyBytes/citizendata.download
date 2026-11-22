// Malformed rows never cost a section its good rows (PARSER_HARDENING.md §5.7): rows rejected one by one keep their
// source order and exact evidence, a collection-only failure keeps every row, and a malformed nested row leaves only
// its own place, in the whole list as well.
import assert from "node:assert/strict";
import test from "node:test";
import { plain, SOURCE_URL, runtime, pledge, rows, step } from "./liveruntimeandparsersinonerealm.mjs";

test("malformed first, middle and last rows are kept as evidence while the good rows keep their source order", async () => {
  const raw = [pledge(1, { title: null }), pledge(2), pledge(3, { title: 7 }), pledge(4), pledge(5, { title: "" })];
  const result = await step(await runtime([rows(raw)]));
  assert.equal(result.ok, true, result.message);
  assert.deepEqual(plain(result.parserResults[0].value).map((record) => record.pledgeId), [2, 4]);
  const anomalies = plain(result.parserResults[0].anomalies);
  assert.deepEqual(anomalies.map((anomaly) => [anomaly.recordIndex, anomaly.issueCode, anomaly.retainedInNormalizedData]), [[1, "PARSER_REJECTED_RECORD", false], [3, "PARSER_REJECTED_RECORD", false], [5, "PARSER_REJECTED_RECORD", false]]);
  assert.deepEqual(anomalies[1].raw, raw[2], "the exact source row is kept");
  assert.deepEqual(anomalies[0].sourceUrls, [SOURCE_URL]);
  assert.match(result.parserResults[0].outcome.warnings.at(-1), /3 parser anomaly records retained/u);
});

test("every row malformed: the section keeps no rows and every row's evidence", async () => {
  const result = await step(await runtime([rows([pledge(1, { title: null }), pledge(2, { title: null })])]));
  assert.equal(result.ok, true);
  assert.deepEqual(plain(result.parserResults[0].value), []);
  assert.deepEqual(plain(result.parserResults[0].anomalies).map((anomaly) => anomaly.recordIndex), [1, 2]);
});

test("a collection-only failure keeps every separately readable row and one collection anomaly", async () => {
  // Two rows with one key are each readable alone; together they break the uniqueness of the list.
  const result = await step(await runtime([rows([pledge(1, { recordKey: "same" }), pledge(2, { recordKey: "same" })])]));
  assert.equal(result.ok, true);
  assert.deepEqual(plain(result.parserResults[0].value).map((record) => record.pledgeId), [1, 2]);
  assert.deepEqual(plain(result.parserResults[0].anomalies).map((anomaly) => [anomaly.issueCode, anomaly.retainedInNormalizedData]), [["PARSER_REJECTED_COLLECTION", true]]);
});

test("a malformed nested row leaves only its own place: the record stays, with the other nested rows", async () => {
  const items = [{ name: "Ship" }, { name: null }, { name: "Paint", quantity: 0 }, { name: "Hangar" }];
  const result = await step(await runtime([rows([pledge(1, { items }), pledge(2)])]));
  assert.equal(result.ok, true, result.message);
  const [first] = plain(result.parserResults[0].value);
  assert.deepEqual(first.items.map((item) => item.name), ["Ship", "Hangar"]);
  const anomalies = plain(result.parserResults[0].anomalies);
  assert.deepEqual(anomalies.map((anomaly) => [anomaly.recordIndex, anomaly.issueCode, anomaly.anomalyKey]), [
    [1, "PARSER_REJECTED_NESTED_ROW", "pledges:1:1:items.1"],
    [1, "PARSER_REJECTED_NESTED_ROW", "pledges:1:1:items.2"]
  ]);
  assert.deepEqual(anomalies[0].raw, { name: null });
});

test("nested rows keep their record's place in the whole list when another record is rejected", async () => {
  const result = await step(await runtime([rows([pledge(1, { title: null }), pledge(2, { items: [{ name: "Ship" }, { name: null }] })])]));
  const anomalies = plain(result.parserResults[0].anomalies);
  assert.deepEqual(anomalies.map((anomaly) => [anomaly.recordIndex, anomaly.issueCode]), [[1, "PARSER_REJECTED_RECORD"], [2, "PARSER_REJECTED_NESTED_ROW"]]);
  assert.deepEqual(plain(result.parserResults[0].value)[0].items.map((item) => item.name), ["Ship"]);
});
