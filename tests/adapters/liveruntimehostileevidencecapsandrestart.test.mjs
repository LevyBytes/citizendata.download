// Malformed-row evidence under pressure (PARSER_HARDENING.md §5.7): hostile values are copied without running them,
// the anomaly and record caps hold, and a section rebuilt from its stored pages after a restart gives the same values
// and evidence.
import assert from "node:assert/strict";
import test from "node:test";
import { plain, realmBuild, runtime, pledge, rows, step } from "./liveruntimeandparsersinonerealm.mjs";

test("hostile evidence is copied from its own data only: no getter or toJSON runs, and what JSON cannot hold is null", async () => {
  const hostile = `(() => {
    const value = { pledgeId: 9, title: null, nan: NaN, toJSON() { return "replaced"; } };
    globalThis.getterCalls = 0;
    Object.defineProperty(value, "secret", { enumerable: true, get() { globalThis.getterCalls += 1; return "read"; } });
    const cyclic = { pledgeId: 10, title: null };
    cyclic.self = cyclic;
    return [{ pledgeId: 1, title: "Pledge 1", items: [] }, value, cyclic];
  })()`;
  let realmGetterCalls = null;
  const adapter = await runtime([(build) => {
    const raw = build(hostile);
    realmGetterCalls = () => build("globalThis.getterCalls");
    return { raw };
  }]);
  const result = await step(adapter);
  assert.equal(result.ok, true, result.message);
  const anomalies = plain(result.parserResults[0].anomalies);
  assert.equal(realmGetterCalls(), 0, "the getter never ran");
  assert.deepEqual(anomalies[0].raw, { pledgeId: 9, title: null, nan: null, toJSON: null });
  assert.equal(anomalies[1].raw, null, "a cycle cannot be kept");
});

test("more than 1,000 anomalies in one page, or 10,000 in a section, stop the section; it is never read as a limit", async () => {
  const many = (count) => Array.from({ length: count }, (_, index) => ({ recordIndex: index + 1, issueCode: "X", message: "m", raw: null }));
  const over = await step(await runtime([rows([pledge(1)], { rawAnomalies: many(1001) })]));
  assert.deepEqual([over.ok, over.code, over.signal ?? null], [false, "ANOMALY_LIMIT_EXCEEDED", null]);
  assert.equal((await step(await runtime([rows([pledge(1)], { rawAnomalies: many(1000) })]))).ok, true);
  const earlier = Array.from({ length: 9999 }, (_, index) => ({ anomalyKey: `pledges:${index + 1}:9`, section: "pledges", recordIndex: index + 1 }));
  const full = await step(await runtime([rows([pledge(1)], { rawAnomalies: many(2) })]), 100, { sectionState: { raw: [], sourceUrls: [], anomalies: earlier } });
  assert.deepEqual([full.ok, full.code], [false, "ANOMALY_LIMIT_EXCEEDED"]);
});

test("the record cap counts accepted and rejected source rows together", async () => {
  const result = await step(await runtime([rows([pledge(1), pledge(2, { title: null }), pledge(3)])]), 2);
  assert.deepEqual([result.ok, result.code], [false, "RECORD_CAP_EXCEEDED"]);
});

test("an unfinished section rebuilt from its stored pages after a restart gives the same partial values and evidence", async () => {
  const raw = [pledge(1), pledge(2, { title: null }), pledge(3, { items: [{ name: null }] })];
  const adapter = await runtime([rows(raw, { done: false, complete: false, nextPage: 2, rawAnomalies: [{ recordIndex: 7, issueCode: "COLLECTOR_FLAG", message: "flagged", raw: { kept: true } }] })]);
  const first = await step(adapter);
  assert.equal(first.ok, true);
  assert.equal(first.done, false);
  const inMemory = await adapter.partialResults({ cursor: first.cursor, sectionState: first.sectionState });
  // A restarted worker has only the stored page text.
  const rebuilt = adapter.rebuildState({ pages: [realmBuild(first.page.text)] });
  const afterRestart = await adapter.partialResults({ cursor: first.cursor, sectionState: rebuilt });
  assert.deepEqual(plain(afterRestart), plain(inMemory));
  assert.deepEqual(plain(afterRestart[0].value).map((record) => record.pledgeId), [1, 3]);
  assert.deepEqual(plain(afterRestart[0].anomalies).map((anomaly) => anomaly.issueCode).sort(), ["COLLECTOR_FLAG", "PARSER_REJECTED_NESTED_ROW", "PARSER_REJECTED_RECORD"]);
  assert.equal(afterRestart[0].outcome.status, "partial");
});
