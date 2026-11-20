import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { loadClassicScripts } from "../extension/load-classic-script.mjs";
import { root } from "./repository-root.mjs";

test("current prospects are collected once and populate both canonical ladder views", async () => {
  const sourceRecords = [{ recordKey: "prospect-1", displayName: "Prospect", handle: "Prospect" }];
  const rsiApi = {
    async collectStep(descriptor) {
      assert.equal(descriptor.id, "referrals.current.prospects");
      return {
        raw: sourceRecords,
        done: true,
        complete: true,
        pagesOrBatches: 1,
        warnings: [],
        requestActivities: [],
        requestProgress: { completed: 1, total: 1, totalKnown: true, subphase: null },
        sourceUrls: ["https://robertsspaceindustries.com/referral-program"]
      };
    },
    clearTransientCaches() {}
  };
  const parsers = {
    async parseReferrals(raw, context, metadata) {
      return {
        section: `referrals.${metadata.ladder}.${metadata.kind}`,
        value: raw.map((record) => ({ ...record })),
        outcome: {
          status: "complete",
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
  const adapter = context.CitizenDataLiveRuntime.createAdapter({
    id: "referrals.current.prospects",
    parser: "parseReferrals",
    parserOptions: { ladder: "current", kind: "prospects", sharedProspects: true },
    version: "1.3.0"
  });
  const result = await adapter.collectStep({ accountId: "Citizen", runId: "run", cursor: null, maximumRecords: 10 });
  assert.deepEqual(Array.from(result.parserResults, entry => entry.section), ["referrals.current.prospects", "referrals.legacy.prospects"]);
  assert.equal(JSON.stringify(result.parserResults.map(entry => entry.value)), JSON.stringify([sourceRecords, sourceRecords]));
  for (const entry of result.parserResults) {
    assert.match(entry.outcome.warnings.at(-1), /collected it once/u);
    assert.deepEqual(Array.from(entry.outcome.sourceUrls), ["https://robertsspaceindustries.com/referral-program"]);
  }
});
