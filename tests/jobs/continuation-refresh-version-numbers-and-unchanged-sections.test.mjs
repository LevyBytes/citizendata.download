import assert from "node:assert/strict";
import test from "node:test";
import { Refresh, failedJob, profileValue, resultSectionsForSection } from "./continuation-refresh-loaded-with-fixture-job.mjs";

test("a new version number alone does not restart an unfinished section", () => {
  const prepared = Refresh.prepare({
    failedJob: failedJob(),
    stagedResults: [
      { section: "profile", value: profileValue(), outcome: { status: "complete", parserVersion: "1.1.0" } },
      { section: "buybacks", value: [], outcome: { status: "complete", parserVersion: "1.2.0" } }
    ],
    currentParserVersions: { profile: "1.1.0", buybacks: "1.2.0", "referrals.legacy.prospects": "1.2.0" },
    priorParserVersions: { "referrals.legacy.prospects": "1.1.0" },
    resultSectionsForSection
  });
  assert.equal(prepared.preserveResumeCursor, true);
});

test("a section the stopped run confirmed unchanged is not collected again, whatever version number its reader carries now", () => {
  // The stopped update found buy-backs unchanged, so it staged no buy-back result; the saved backup holds them.
  const input = {
    failedJob: failedJob(),
    stagedResults: [{ section: "profile", value: profileValue(), outcome: { status: "complete", parserVersion: "1.1.0" } }],
    currentParserVersions: { profile: "1.1.0", buybacks: "1.2.0", "referrals.legacy.prospects": "1.2.0" },
    priorParserVersions: { profile: "1.1.0", buybacks: "1.2.0", "referrals.legacy.prospects": "1.2.0" },
    resultSectionsForSection
  };
  assert.deepEqual([...Refresh.prepare(input).refreshSections], ["buybacks"], "without that record the section has to be read again");
  const confirmed = Refresh.prepare({ ...input, reusedSections: ["buybacks"] });
  assert.deepEqual([[...confirmed.refreshSections], [...confirmed.selectedSections], confirmed.completedSectionsBeforeContinuation], [[], ["referrals.legacy.prospects"], 2]);
  // The reader's version number changed after the run stopped. That alone has nothing collected again.
  const renumbered = Refresh.prepare({ ...input, reusedSections: ["buybacks"], currentParserVersions: { ...input.currentParserVersions, buybacks: "1.3.0" } });
  assert.deepEqual([...renumbered.refreshSections], []);
  // Nor does a finished section whose result was staged under another number.
  const staged = Refresh.prepare({ ...input, stagedResults: [...input.stagedResults, { section: "buybacks", value: [], outcome: { status: "complete", parserVersion: "0.9.0" } }] });
  assert.deepEqual([...staged.refreshSections], []);
});
