import assert from "node:assert/strict";
import test from "node:test";
import { harness } from "./rsi-api-in-a-sandbox.mjs";

test("update mode reuses an unchanged Hangar Log, and with it the hangar and the buy-back list", async () => {
  const rows = [
    { rawTimestamp: "now", subjectId: 1, subjectName: "One", kind: "created", rawDetail: "One", parsed: { recognized: true } },
    { rawTimestamp: "then", subjectId: 2, subjectName: "Two", kind: "created", rawDetail: "Two", parsed: { recognized: true } }
  ];
  const { api, calls } = harness([
    { success: 1, data: { rendered: "<div>log</div>", page: 1, pagecount: 4 } },
    { kind: "html", body: "<main>pledges</main>" },
    { success: 1, data: { rendered: "<div>buybacks</div>", page: 1, pagecount: 1 } }
  ], { hangarLog: { raw: rows }, pledges: { raw: [{ pledgeId: 1 }], pageCount: 1 }, buybacks: { raw: [{ buybackId: 2 }] } });
  const previousSection = { current: true, recordCount: rows.length, values: { hangarLog: rows.map((row) => ({ ...row, observation: { relatedUrls: [] } })) } };
  const log = await api.collectStep({ id: "hangarLog" }, { mode: "update", cursor: null, previousSection });
  assert.equal(log.reusePrevious, true);
  assert.equal(log.changeState, "unchanged");
  const earlierPledges = { current: true, recordCount: 883, values: { pledges: [{ recordKey: "pledge" }] } };
  const earlierBuybacks = { current: true, recordCount: 1583, values: { buybacks: [{ recordKey: "buyback" }] } };
  // While the log holds nothing new, the earlier build's lists are kept and neither list is asked for.
  const pledges = await api.collectStep({ id: "pledges" }, { mode: "update", cursor: null, previousSection: earlierPledges, updateSignals: { hangarLog: "unchanged" } });
  const buybacks = await api.collectStep({ id: "buybacks" }, { mode: "update", cursor: null, previousSection: earlierBuybacks, updateSignals: { hangarLog: "unchanged" } });
  assert.deepEqual([pledges.reusePrevious, pledges.done, pledges.changeState, pledges.previousRecordCount], [true, true, "unchanged", 883]);
  assert.deepEqual([buybacks.reusePrevious, buybacks.done, buybacks.changeState, buybacks.previousRecordCount], [true, true, "unchanged", 1583]);
  assert.equal(calls.filter((call) => call.kind === "fetch").length, 1);
  // A log with a new entry has both lists read in full.
  const readPledges = await api.collectStep({ id: "pledges" }, { mode: "update", cursor: null, previousSection: earlierPledges, updateSignals: { hangarLog: "changed" } });
  const readBuybacks = await api.collectStep({ id: "buybacks" }, { mode: "update", cursor: null, previousSection: earlierBuybacks, updateSignals: { hangarLog: "changed" } });
  assert.deepEqual([readPledges.reusePrevious, readPledges.done, JSON.parse(JSON.stringify(readPledges.raw))], [undefined, true, [{ pledgeId: 1 }]]);
  assert.deepEqual([readBuybacks.reusePrevious, readBuybacks.done, JSON.parse(JSON.stringify(readBuybacks.raw))], [undefined, true, [{ buybackId: 2 }]]);
  assert.equal(calls.filter((call) => call.kind === "fetch").length, 3);
});

test("update mode merges new Hangar Log rows through the prior exact anchor", async () => {
  const oldRows = [
    { rawTimestamp: "old-1", subjectId: 1, subjectName: "One", kind: "created", rawDetail: "One", parsed: { recognized: true }, observation: { relatedUrls: [] } },
    { rawTimestamp: "old-2", subjectId: 2, subjectName: "Two", kind: "created", rawDetail: "Two", parsed: { recognized: true }, observation: { relatedUrls: [] } }
  ];
  const newRow = { rawTimestamp: "new", subjectId: 3, subjectName: "New", kind: "created", rawDetail: "New", parsed: { recognized: true } };
  const { api } = harness([
    { success: 1, data: { rendered: "<div>log</div>", page: 1, pagecount: 4 } }
  ], { hangarLog: { raw: [newRow, ...oldRows] } });
  const result = await api.collectStep({ id: "hangarLog" }, { mode: "update", cursor: null, previousSection: { current: true, recordCount: 2, values: { hangarLog: oldRows } } });
  assert.equal(result.done, true);
  assert.equal(result.snapshot, true);
  assert.equal(result.changeState, "changed");
  assert.equal(result.raw.length, 3);
});
