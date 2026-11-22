// Setting a section aside (PARSER_HARDENING.md §10.1, §10.2, §10.6): a changed page outside Account identity is set
// aside and the build reads the rest; Account identity is never set aside; at most three sections are, and the next
// change stops the run; in a first build the sections that read a set-aside list are set aside with it, without
// counting, and in an update they read the saved backup's list.
import assert from "node:assert/strict";
import test from "node:test";
import { CHANGED, contractRun, plain } from "./runner-fixture-contract-sections.mjs";

test("a changed page sets its section aside without asking for it again, and the build reads the rest", async () => {
  const { state, repository, job, drive } = await contractRun(["profile", "pledges", "hangarLog"], { pledges: [CHANGED] });
  const ended = await drive();
  assert.equal(ended.status, "partial");
  assert.equal(ended.failure, null);
  assert.deepEqual(state.calls.map((call) => call.section), ["profile", "pledges", "hangarLog"], "the set-aside section is asked once");
  assert.deepEqual(plain(ended.setAsideSections).map((entry) => [entry.section, entry.code, entry.rsiCode]), [["pledges", "RSI_PAGE_CONTRACT_CHANGED", null]]);
  assert.deepEqual(plain(ended.detectedChanges).map((entry) => [entry.section, entry.code, entry.httpStatus, entry.setAside, entry.dependents]), [["pledges", "RSI_PAGE_CONTRACT_CHANGED", 410, true, []]]);
  // W-18's line in the log.
  assert.ok(plain(ended.activityLog).some((line) => line.kind === "section-set-aside" && line.section === "pledges" && line.code === "RSI_PAGE_CONTRACT_CHANGED"));
  // The staged run keeps the set-aside section and its finding once; the section's stored pages are gone.
  const staged = await repository.getStagedRun(job.runId);
  assert.deepEqual(plain(staged.setAsideSections).map((entry) => entry.section), ["pledges"]);
  assert.deepEqual(plain(staged.contractFindings).map((finding) => [finding.section, finding.code]), [["pledges", "RSI_PAGE_CONTRACT_CHANGED"]]);
  assert.deepEqual(plain(await repository.listPages(job.collectionId, "pledges")), []);
});

test("Account identity is never set aside: its changed page stops the run, and the stop is published", async () => {
  const { state, repository, job, drive } = await contractRun(["profile", "pledges"], { profile: [CHANGED] });
  const ended = await drive();
  assert.equal(ended.status, "failed");
  assert.equal(ended.failure.detail.signal.kind, "contract");
  assert.deepEqual(state.calls.map((call) => call.section), ["profile"]);
  assert.deepEqual(plain(ended.setAsideSections ?? []), []);
  assert.deepEqual(plain(ended.detectedChanges).map((entry) => [entry.section, entry.setAside]), [["profile", false]]);
  assert.deepEqual(plain((await repository.getStagedRun(job.runId)).contractFindings).map((finding) => finding.section), ["profile"]);
});

test("at most three sections are set aside; the fourth change stops the run, and the four are published", async () => {
  const sections = ["profile", "pledges", "hangarLog", "buybacks", "financial.balances", "financial.orders"];
  const { state, drive } = await contractRun(sections, { pledges: [CHANGED], hangarLog: [CHANGED], buybacks: [CHANGED], "financial.balances": [CHANGED] });
  const ended = await drive();
  assert.equal(ended.status, "failed");
  assert.equal(ended.failure.detail.signal.code, "RSI_PAGE_CONTRACT_CHANGED");
  assert.deepEqual(plain(ended.setAsideSections).map((entry) => entry.section), ["pledges", "hangarLog", "buybacks"]);
  assert.deepEqual(plain(ended.detectedChanges).map((entry) => [entry.section, entry.setAside]), [["pledges", true], ["hangarLog", true], ["buybacks", true], ["financial.balances", false]]);
  assert.ok(!state.calls.some((call) => call.section === "financial.orders"), "nothing after the stop is read");
});

test("in a first build the sections that read a set-aside list are set aside with it, are never asked, and do not count", async () => {
  const sections = ["profile", "buybacks", "pledges", "hangarLog", "buybackDetails", "buybackUpgradePrices"];
  const { state, repository, job, drive } = await contractRun(sections, { buybacks: [CHANGED], pledges: [CHANGED], hangarLog: [CHANGED] });
  const ended = await drive();
  assert.equal(ended.status, "partial", "three counted sections reach the limit without passing it");
  assert.deepEqual(state.calls.map((call) => call.section), ["profile", "buybacks", "pledges", "hangarLog"]);
  assert.deepEqual(plain(ended.setAsideSections).map((entry) => [entry.section, entry.code]), [
    ["buybacks", "RSI_PAGE_CONTRACT_CHANGED"],
    ["buybackDetails", "INPUT_SET_ASIDE"],
    ["buybackUpgradePrices", "INPUT_SET_ASIDE"],
    ["pledges", "RSI_PAGE_CONTRACT_CHANGED"],
    ["hangarLog", "RSI_PAGE_CONTRACT_CHANGED"]
  ]);
  assert.deepEqual(plain(ended.detectedChanges).map((entry) => [entry.section, entry.dependents]), [["buybacks", ["buybackDetails", "buybackUpgradePrices"]], ["pledges", []], ["hangarLog", []]]);
  assert.deepEqual(plain(ended.activityLog).filter((line) => line.kind === "section-set-aside").map((line) => [line.section, line.code]), [
    ["buybacks", "RSI_PAGE_CONTRACT_CHANGED"],
    ["buybackDetails", "INPUT_SET_ASIDE"],
    ["buybackUpgradePrices", "INPUT_SET_ASIDE"],
    ["pledges", "RSI_PAGE_CONTRACT_CHANGED"],
    ["hangarLog", "RSI_PAGE_CONTRACT_CHANGED"]
  ]);
  assert.equal(plain((await repository.getStagedRun(job.runId)).setAsideSections).length, 5);
});

test("in an update the sections that read a set-aside list read the saved backup's list, as before", async () => {
  const savedList = [{ recordKey: "buyback:1", buybackId: 1 }];
  const saved = { buybacks: savedList, pledges: [], sync: { sectionOutcomes: {} } };
  const { state, drive } = await contractRun(["profile", "buybacks", "buybackDetails"], { buybacks: [CHANGED] }, { mode: "update", saved });
  const ended = await drive();
  assert.equal(ended.status, "partial");
  assert.deepEqual(plain(ended.setAsideSections).map((entry) => entry.section), ["buybacks"]);
  const details = state.calls.find((call) => call.section === "buybackDetails");
  assert.deepEqual(details.inputs, { buybacks: savedList });
  assert.deepEqual(plain(ended.detectedChanges)[0].dependents, []);
});
