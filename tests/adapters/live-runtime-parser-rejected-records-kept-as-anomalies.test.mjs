import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { loadClassicScripts } from "../extension/load-classic-script.mjs";
import { root } from "./repository-root.mjs";

test("live runtime retains parser-rejected records as anomalies and continues valid neighbors", async () => {
  const sourceRecords = [
    { pledgeId: 1, title: "First" },
    { pledgeId: 2, title: null, unexpected: { preserved: true } },
    { pledgeId: 3, title: "Third" }
  ];
  const rsiApi = {
    async collectStep() {
      return {
        raw: sourceRecords,
        done: true,
        complete: true,
        pagesOrBatches: 1,
        warnings: [],
        requestActivities: [],
        requestProgress: { completed: 1, total: 1, totalKnown: true, subphase: null },
        sourceUrls: ["https://robertsspaceindustries.com/en/account/pledges?page=1"]
      };
    },
    clearTransientCaches() {}
  };
  const parsers = {
    async parsePledges(raw, context, metadata) {
      const bad = raw.findIndex((record) => typeof record.title !== "string");
      if (bad >= 0) throw new TypeError(`pledges[${bad}].title must be nonempty text.`);
      return {
        section: "pledges",
        value: raw.map((record) => ({ ...record })),
        outcome: {
          status: metadata.complete ? "complete" : "partial",
          parserVersion: context.parserVersion,
          startedAt: context.firstObservedAt,
          endedAt: context.observedAt,
          records: raw.length,
          pagesOrBatches: metadata.pagesOrBatches,
          warnings: metadata.warnings,
          sourceUrls: metadata.sourceUrls
        }
      };
    }
  };
  const context = await loadClassicScripts([path.join(root, "extension", "adapters", "live-runtime.js")], {
    CitizenDataPureParsers: parsers,
    CitizenDataRsiApi: rsiApi
  });
  const adapter = context.CitizenDataLiveRuntime.createAdapter({ id: "pledges", parser: "parsePledges", version: "1.0.0" });
  const result = await adapter.collectStep({ accountId: "Citizen", runId: "run", cursor: null, maximumRecords: 10 });
  assert.equal(result.ok, true);
  assert.equal(result.done, true);
  assert.deepEqual(Array.from(result.parserResults[0].value, (record) => record.pledgeId), [1, 3]);
  assert.match(result.parserResults[0].outcome.warnings.at(-1), /collection continued/u);
  assert.equal(result.parserResults[0].anomalies.length, 1);
  assert.equal(result.parserResults[0].anomalies[0].recordIndex, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(result.parserResults[0].anomalies[0].raw)), sourceRecords[1]);
  assert.equal(result.parserResults[0].anomalies[0].retainedInNormalizedData, false);
});
