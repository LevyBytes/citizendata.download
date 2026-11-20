import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { loadClassicScripts } from "../extension/load-classic-script.mjs";
import { root } from "./repository-root.mjs";

test("a step that does not end the section returns its page to store and the merged state, and the last step normalizes once", async () => {
  let step = 0;
  const rsiApi = {
    async collectStep() {
      step += 1;
      return step === 1
        ? {
          raw: [{ pledgeId: 1, title: "First" }], done: false, nextPage: 2, interactiveState: { pageCount: 2 }, complete: false, pagesOrBatches: 1, warnings: [],
          requestActivities: [], requestProgress: { completed: 1, total: 2, totalKnown: true, subphase: null },
          sourceUrls: ["https://robertsspaceindustries.com/en/account/pledges?page=1"]
        }
        : {
          raw: [{ pledgeId: 2, title: "Second" }], done: true, nextPage: null, interactiveState: null, complete: true, pagesOrBatches: 2, warnings: [],
          requestActivities: [], requestProgress: { completed: 2, total: 2, totalKnown: true, subphase: null },
          sourceUrls: ["https://robertsspaceindustries.com/en/account/pledges?page=2"]
        };
    },
    clearTransientCaches() {}
  };
  let parses = 0;
  const parsers = {
    async parsePledges(raw, context, metadata) {
      parses += 1;
      return { section: "pledges", value: raw, outcome: { status: metadata.complete ? "complete" : "partial", endedAt: context.observedAt, pagesOrBatches: metadata.pagesOrBatches, warnings: metadata.warnings, sourceUrls: metadata.sourceUrls } };
    }
  };
  const context = await loadClassicScripts([path.join(root, "extension", "adapters", "live-runtime.js")], {
    CitizenDataPureParsers: parsers,
    CitizenDataRsiApi: rsiApi
  });
  const plain = (value) => JSON.parse(JSON.stringify(value));
  const adapter = context.CitizenDataLiveRuntime.createAdapter({ id: "pledges", parser: "parsePledges", version: "1.0.0" });
  const first = await adapter.collectStep({ accountId: "Citizen", runId: "run", cursor: null, sectionState: null, maximumRecords: 10 });
  assert.equal(first.done, false);
  assert.equal(parses, 0, "an unfinished section is not normalized");
  assert.deepEqual(plain(first.parserResults), []);
  assert.deepEqual([first.recordCount, first.cumulativeRecordCount], [1, 1]);
  // The stored position holds no rows; the page is handed over as text holding only what this step fetched.
  assert.deepEqual(Object.keys(first.cursor).sort(), ["interactiveState", "lastStep", "page"]);
  assert.equal(first.cursor.page, 2);
  assert.equal(first.page.checkpoint, false);
  assert.deepEqual(JSON.parse(first.page.text), { raw: [{ pledgeId: 1, title: "First" }], snapshot: false, sourceUrls: ["https://robertsspaceindustries.com/en/account/pledges?page=1"], anomalies: [] });
  assert.deepEqual(plain(first.sectionState), { raw: [{ pledgeId: 1, title: "First" }], sourceUrls: ["https://robertsspaceindustries.com/en/account/pledges?page=1"], anomalies: [] });
  // A worker that starts over rebuilds the same state from the stored page.
  assert.deepEqual(plain(adapter.rebuildState({ pages: [JSON.parse(first.page.text)] })), plain(first.sectionState));

  // A run that stops here normalizes the unfinished section for its partial backup, as of the last step.
  const partial = await adapter.partialResults({ cursor: first.cursor, sectionState: first.sectionState });
  assert.equal(partial.length, 1);
  assert.equal(partial[0].outcome.status, "partial");
  assert.equal(partial[0].outcome.endedAt, first.cursor.lastStep.observedAt);
  assert.deepEqual(plain(partial[0].value).map((record) => record.pledgeId), [1]);
  assert.deepEqual(plain(await adapter.partialResults({ cursor: null, sectionState: null })), []);
  parses = 0;

  const second = await adapter.collectStep({ accountId: "Citizen", runId: "run", cursor: first.cursor, sectionState: first.sectionState, maximumRecords: 10 });
  assert.equal(second.done, true);
  assert.equal(parses, 1, "the whole section is normalized once, when it ends");
  assert.equal(second.page, undefined);
  assert.equal(second.cursor, null);
  assert.deepEqual([second.recordCount, second.cumulativeRecordCount], [1, 2]);
  assert.deepEqual([...second.parserResults[0].outcome.sourceUrls], [
    "https://robertsspaceindustries.com/en/account/pledges?page=1",
    "https://robertsspaceindustries.com/en/account/pledges?page=2"
  ]);
  assert.deepEqual([...second.parserResults[0].value].map((record) => record.pledgeId), [1, 2]);
});
