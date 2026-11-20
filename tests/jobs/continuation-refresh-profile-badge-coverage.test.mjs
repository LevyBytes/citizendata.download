import assert from "node:assert/strict";
import test from "node:test";
import { Refresh, failedJob, profileValue, resultSectionsForSection } from "./continuation-refresh-loaded-with-fixture-job.mjs";

test("continuation refreshes an old completed profile before resuming the saved cursor", () => {
  const prepared = Refresh.prepare({
    failedJob: failedJob(),
    stagedResults: [
      { section: "profile", value: {}, outcome: { status: "complete", parserVersion: "1.0.0" } },
      { section: "buybacks", value: [], outcome: { status: "complete", parserVersion: "1.2.0" } }
    ],
    currentParserVersions: { profile: "1.1.0", buybacks: "1.2.0", "referrals.legacy.prospects": "1.2.0" },
    priorParserVersions: { profile: "1.0.0", buybacks: "1.2.0", "referrals.legacy.prospects": "1.2.0" },
    resultSectionsForSection
  });
  assert.deepEqual([...prepared.refreshSections], ["profile"]);
  assert.deepEqual([...prepared.selectedSections], ["profile", "referrals.legacy.prospects"]);
  assert.equal(prepared.resumeSection, "referrals.legacy.prospects");
  assert.equal(prepared.preserveResumeCursor, true);
  assert.equal(prepared.completedSectionsBeforeContinuation, 1);
  assert.equal(prepared.baselineSectionCount, 3);
});

test("matching parser versions do not hide missing badge coverage", () => {
  const prepared = Refresh.prepare({
    failedJob: failedJob(),
    stagedResults: [
      { section: "profile", value: { unlockedBadges: [] }, outcome: { status: "complete", parserVersion: "1.1.0" } },
      { section: "buybacks", value: [], outcome: { status: "complete", parserVersion: "1.2.0" } }
    ],
    currentParserVersions: { profile: "1.1.0", buybacks: "1.2.0", "referrals.legacy.prospects": "1.2.0" },
    priorParserVersions: { "referrals.legacy.prospects": "1.2.0" },
    resultSectionsForSection
  });
  assert.deepEqual([...prepared.refreshSections], ["profile"]);
});

test("current profile badge rows and primary image satisfy continuation coverage", () => {
  assert.equal(Refresh.hasProfileBadgeCoverage(profileValue()), true);
  assert.equal(Refresh.hasProfileBadgeCoverage(profileValue({ selectedBadge: { title: "Primary", images: null } })), false);
  const prepared = Refresh.prepare({
    failedJob: failedJob(),
    stagedResults: [
      { section: "profile", value: profileValue(), outcome: { status: "complete", parserVersion: "1.1.0" } },
      { section: "buybacks", value: [], outcome: { status: "complete", parserVersion: "1.2.0" } }
    ],
    currentParserVersions: { profile: "1.1.0", buybacks: "1.2.0", "referrals.legacy.prospects": "1.2.0" },
    priorParserVersions: { "referrals.legacy.prospects": "1.2.0" },
    resultSectionsForSection
  });
  assert.deepEqual([...prepared.refreshSections], []);
  assert.deepEqual([...prepared.selectedSections], ["referrals.legacy.prospects"]);
  assert.equal(prepared.completedSectionsBeforeContinuation, 2);
});
