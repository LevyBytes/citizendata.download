import assert from "node:assert/strict";
import test from "node:test";
import { AccountDocument, Assembler, account, complete, now, profile } from "./document-assembler-loaded-with-fixture-sections.mjs";

test("assembler maps section results into one stamped account document", async () => {
  const anomaly = {
    anomalyKey: "profile:1:1",
    section: "profile",
    recordIndex: 1,
    pageOrBatch: 1,
    issueCode: "PARSER_REJECTED_RECORD",
    message: "Unexpected source value retained.",
    raw: { unexpected: true },
    retainedInNormalizedData: false,
    observedAt: now,
    sourceUrls: []
  };
  const assembled = await Assembler.assemble({ account, exportedAt: now, results: [{ section: "profile", value: profile, outcome: complete, anomalies: [anomaly] }] });
  assert.equal(assembled.document.profile.handle, "Citizen");
  assert.equal(assembled.document.sync.sectionOutcomes.profile.status, "complete");
  assert.deepEqual(assembled.document.dataQuality.anomalies, [anomaly]);
  assert.equal(await AccountDocument.verifyIntegrity(assembled.document), true);
  AccountDocument.assertValid(assembled.document, globalThis.CITIZENDATA_ACCOUNT_SCHEMA);
});

test("partial reruns retain a previous complete section", async () => {
  const baseline = await Assembler.assemble({ account, exportedAt: now, results: [{ section: "profile", value: profile, outcome: complete }] });
  const partial = { ...complete, status: "partial", warnings: ["Page failed"] };
  const rerun = await Assembler.assemble({ account, exportedAt: "2026-11-17T13:00:00.000Z", previous: baseline.document, results: [{ section: "profile", value: { ...profile, displayName: "Partial replacement" }, outcome: partial }] });
  assert.equal(rerun.document.profile.displayName, "Citizen");
  assert.deepEqual(rerun.retainedSections, ["profile"]);
  assert.equal(rerun.document.sync.sectionOutcomes.profile.status, "complete");
  assert.equal(await AccountDocument.verifyIntegrity(rerun.document), true);
});
