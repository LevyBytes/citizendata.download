// The order of PARSER_HARDENING.md §10.1, as the plan writes it: a changed page is set aside only while there was no
// refusal in the quiet period, fewer than 3 sections are set aside and the section is not Account identity. Otherwise,
// with a refusal in the quiet period, the section first waits for one canary and one recheck, Account identity and a
// run at the limit included; at the limit of 3, or for Account identity, the run stops, without a refusal at once and
// otherwise when the recheck finds the same change.
import assert from "node:assert/strict";
import test from "node:test";
import { CHANGED, LIMIT, contractRun, plain } from "./runner-fixture-contract-sections.mjs";
import { pacingSettings } from "./runner-under-test.mjs";

const QUIET_MS = pacingSettings.setAside.quietMs;
const SECTIONS_AT_LIMIT = ["pledges", "hangarLog", "buybacks"];

async function changedAfterRefusal(sections, script, section) {
  const run = await contractRun(sections, script);
  const pending = await run.drive(80, (job) => job.pendingContract);
  assert.equal(pending.status, "running", `${section}: the run did not stop within the quiet period`);
  assert.equal(pending.pendingContract?.section, section);
  assert.equal(pending.pendingContract.recheckAt, new Date(Date.parse(pending.pace.lastRefusalAt) + QUIET_MS).toISOString());
  const asked = run.state.calls.filter((call) => call.section === section).length;
  const ended = await run.drive(80);
  const calls = run.state.calls.filter((call) => call.section === section);
  return { run, pending, ended, recheck: calls.at(-1), asked, calls: calls.length };
}

test("without a refusal in the quiet period, Account identity stops the run at once", async () => {
  const { state, drive } = await contractRun(["profile", "pledges"], { profile: [CHANGED] });
  const ended = await drive();
  assert.deepEqual([ended.status, ended.pendingContract ?? null, ended.failure.detail.signal.kind], ["failed", null, "contract"]);
  assert.deepEqual(state.calls.map((call) => call.section), ["profile"]);
});

test("with a refusal in the quiet period, Account identity first waits for its recheck, then the same change stops the run", async () => {
  const { pending, ended, recheck, asked, calls } = await changedAfterRefusal(["profile", "pledges"], { profile: [LIMIT, CHANGED, CHANGED] }, "profile");
  assert.equal(asked, 2, "the refused attempt and the change");
  assert.deepEqual([recheck.canary, recheck.at >= Date.parse(pending.pendingContract.recheckAt), calls], [true, true, 3]);
  assert.deepEqual([ended.status, ended.failure.detail.signal.kind, ended.pendingContract ?? null], ["failed", "contract", null]);
  assert.deepEqual(plain(ended.detectedChanges).map((entry) => [entry.section, entry.setAside]), [["profile", false]]);
});

test("at the limit of 3 with a refusal in the quiet period, the fourth change waits for its recheck before the stop", async () => {
  const sections = ["profile", ...SECTIONS_AT_LIMIT, "financial.balances", "financial.orders"];
  const script = Object.fromEntries([...SECTIONS_AT_LIMIT.map((section) => [section, [CHANGED]]), ["financial.balances", [LIMIT, CHANGED, CHANGED]]]);
  const { run, pending, ended, recheck } = await changedAfterRefusal(sections, script, "financial.balances");
  assert.deepEqual(plain(pending.setAsideSections).map((entry) => entry.section), SECTIONS_AT_LIMIT);
  assert.deepEqual([recheck.canary, recheck.at >= Date.parse(pending.pendingContract.recheckAt)], [true, true]);
  assert.deepEqual([ended.status, ended.failure.detail.signal.code], ["failed", "RSI_PAGE_CONTRACT_CHANGED"]);
  assert.ok(!run.state.calls.some((call) => call.section === "financial.orders"), "nothing after the stop is read");
});

test("below the limit with a refusal in the quiet period, the section waits for its recheck and is then set aside", async () => {
  const { run, ended, calls } = await changedAfterRefusal(["profile", "pledges", "hangarLog"], { pledges: [LIMIT, CHANGED, CHANGED] }, "pledges");
  assert.equal(calls, 3);
  assert.deepEqual([ended.status, plain(ended.setAsideSections).map((entry) => entry.section)], ["partial", ["pledges"]]);
  assert.ok(run.state.calls.some((call) => call.section === "hangarLog"));
});

test("without a refusal in the quiet period, a section below the limit is set aside at once", async () => {
  const { state, drive } = await contractRun(["profile", "pledges", "hangarLog"], { pledges: [CHANGED] });
  const ended = await drive();
  assert.deepEqual([ended.status, plain(ended.setAsideSections).map((entry) => entry.section)], ["partial", ["pledges"]]);
  assert.equal(state.calls.filter((call) => call.section === "pledges").length, 1);
});
