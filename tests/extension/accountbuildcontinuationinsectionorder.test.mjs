// A continuation in the canonical section order (PARSER_HARDENING.md §4.8): it keeps every finished result, runs
// only its unfinished Account Data sections, in that order, resumes a partial section at its stored position, and
// leaves a roster's order as checked.
import assert from "node:assert/strict";
import test from "node:test";
import { createExtensionHarness } from "../support/extension-harness.mjs";
import { extension, Plans, ORDER, HANGAR_LOG_PATH, planFor } from "./accountbuildsectionorder.mjs";

const Refresh = extension.CitizenDataContinuationRefresh;

// A failed job of the given plan, stopped at `sectionIndex`, whose finished sections RSI confirmed unchanged unless
// they are named in `stale`.
function prepared(selectedSections, sectionIndex, stale = []) {
  const finished = selectedSections.slice(0, sectionIndex);
  return Refresh.prepare({
    failedJob: { plan: { selectedSections }, sectionIndex },
    stagedResults: [],
    reusedSections: finished.filter((section) => !stale.includes(section)),
    currentParserVersions: Object.fromEntries(selectedSections.map((section) => [section, "1"])),
    priorParserVersions: {},
    resultSectionsForSection: {}
  });
}

test("a continuation runs only its unfinished Account Data sections, in the canonical order, and a roster keeps its order", () => {
  // A job failed before the canonical order, at Financial ledgers: identity and two billing sections were finished.
  const before = ["profile", "financial.balances", "financial.billingTotal", "financial.ledgers", "financial.orders", "financial.subscriptions", "hangarLog", ...ORDER.slice(7)];
  const continued = prepared(before, 3);
  assert.deepEqual([...continued.selectedSections], ORDER.filter((section) => before.slice(3).includes(section)));
  assert.deepEqual([...continued.selectedSections].slice(0, 2), ["hangarLog", "financial.ledgers"]);
  assert.equal(continued.resumeSection, "financial.ledgers", "the partial cursor stays with its own section");
  assert.equal(Plans.validatePlan(planFor([...continued.selectedSections])).ok, true);
  // A finished section read again for its parser version joins at its canonical place; the others are not read.
  const refreshed = prepared(before, 3, ["financial.balances"]);
  assert.deepEqual([...refreshed.selectedSections].slice(0, 3), ["hangarLog", "financial.balances", "financial.ledgers"]);
  assert.ok(!refreshed.selectedSections.includes("profile") && !refreshed.selectedSections.includes("financial.billingTotal"));
  // A roster continuation keeps the order the user checked.
  const roster = prepared(["organizations.members.ZED", "organizations.members.ALPHA"], 0);
  assert.deepEqual([...roster.selectedSections], ["organizations.members.ZED", "organizations.members.ALPHA"]);
});

test("a continued build keeps every finished section and resumes the unfinished one at its stored page", async () => {
  const harness = await createExtensionHarness();
  const tab = harness.openTab();
  // RSI signs the session out at the third page of Buybacks, so the run stops in Buybacks.
  harness.rsi.failNext((request) => request.path === "/api/account/buybackPledges" && request.page === 3, { status: 401 });
  await tab.build();
  assert.equal((await harness.finishJob()).status, "failed");
  const failed = await harness.repository.getJob(harness.state().lastTerminalJobId);
  assert.equal(failed.plan.selectedSections[failed.sectionIndex], "buybacks");
  const stoppedAt = failed.cursorBySection.buybacks.page;
  const start = harness.rsi.requests.length;
  assert.equal((await tab.request("CONTINUE_PARTIAL")).code, "RUN_STARTED");
  const job = await harness.repository.getJob(harness.state().activeJobId);
  assert.deepEqual([...job.plan.selectedSections], ORDER.slice(ORDER.indexOf("buybacks")));
  assert.equal((await harness.finishJob()).status, "complete");
  const requests = harness.rsi.requests.slice(start);
  // Nothing of a finished section is read again: after the identify call, Buybacks resumes where it stopped.
  assert.equal(requests[0].path, "/api/spectrum/auth/identify");
  assert.deepEqual([requests[1].path, requests[1].page], ["/api/account/buybackPledges", stoppedAt]);
  for (const path of [HANGAR_LOG_PATH, "/account/pledges", "/en/citizens/SyntheticCitizen"]) assert.ok(!requests.some((request) => request.path === path), path);
  const document = tab.events.findLast((event) => event.result)?.result;
  assert.ok(document.pledges.length > 0 && document.hangarLog.length > 0, "the finished sections' records are in the document");
});
