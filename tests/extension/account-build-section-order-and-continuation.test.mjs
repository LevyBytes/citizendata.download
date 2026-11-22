// The canonical Account Data section order (PARSER_HARDENING.md §4.8): account identity first, then Hangar Log,
// then the rest, in the dashboard's default plan, in the extension's plan check, and in the requests of a fresh
// build and of an Update.
import assert from "node:assert/strict";
import test from "node:test";
import { createExtensionHarness } from "../support/extension-harness.mjs";
import { Plans, ORDER, HANGAR_LOG_PATH, planFor } from "./accountbuildsectionorder.mjs";

const Model = globalThis.CitizenDataDashboardModel;

// Requests that belong to account identity: the identify call, the dossier page and the profile's GraphQL calls.
const IDENTITY_PATHS = new Set(["/api/spectrum/auth/identify", "/en/citizens/SyntheticCitizen", "/graphql"]);

// Every request before Hangar Log's last page is an identity request or a Hangar Log page, and identity's requests
// all come before Hangar Log's first page.
function assertHangarLogDirectlyAfterIdentity(requests) {
  const paths = requests.map((request) => request.path);
  const firstLog = paths.indexOf(HANGAR_LOG_PATH);
  const lastLog = paths.lastIndexOf(HANGAR_LOG_PATH);
  assert.ok(firstLog > 0, "Hangar Log was read");
  assert.deepEqual(paths.slice(0, firstLog).filter((item) => !IDENTITY_PATHS.has(item)), [], "only identity is read before Hangar Log");
  assert.deepEqual(paths.slice(firstLog, lastLog + 1).filter((item) => item !== HANGAR_LOG_PATH), [], "nothing else is read while Hangar Log is being read");
  assert.ok(paths.slice(lastLog + 1).every((item) => item !== HANGAR_LOG_PATH));
}

test("the dashboard proposes every account section in the canonical order, identity first and Hangar Log second", () => {
  const plan = Model.buildDefaultPlan();
  assert.deepEqual(plan.selectedSections, ORDER);
  assert.deepEqual(plan.selectedSections.slice(0, 2), ["profile", "hangarLog"]);
  assert.equal(plan.minimumInterRequestDelayMs, 900);
  assert.equal(Plans.validatePlan(plan).ok, true);
  // An extension that names a higher floor gets it; a lower or missing one leaves the dashboard's own.
  assert.equal(Model.buildDefaultPlan({ pacing: { accountPlanFloorMs: 1200 } }).minimumInterRequestDelayMs, 1200);
  assert.equal(Model.buildDefaultPlan({ pacing: { accountPlanFloorMs: 500 } }).minimumInterRequestDelayMs, 900);
  assert.equal(Model.buildDefaultPlan({}).minimumInterRequestDelayMs, 900);
});

test("the extension accepts an account plan only as an order-preserving part of the canonical order", () => {
  assert.equal(Plans.validatePlan(planFor(ORDER)).ok, true);
  // A continuation may leave finished sections out, as long as the rest keep their order.
  assert.equal(Plans.validatePlan(planFor(["hangarLog", "financial.ledgers", "buybackUpgradePrices"])).ok, true);
  assert.equal(Plans.validatePlan(planFor(["pledges"])).ok, true);
  const today = ["profile", "financial.balances", "financial.billingTotal", "financial.ledgers", "financial.orders", "financial.subscriptions", "hangarLog", ...ORDER.slice(7)];
  for (const sections of [today, ["hangarLog", "profile"], ["buybacks", "pledges"], [...ORDER.slice(0, 14).reverse()]]) {
    const result = Plans.validatePlan(planFor(sections));
    assert.equal(result.ok, false, sections.join(", "));
    assert.equal(result.code, "NONCANONICAL_SECTION_ORDER");
  }
  // A repeated or unknown section keeps its own refusal.
  assert.equal(Plans.validatePlan(planFor(["profile", "profile"])).code, "DUPLICATE_SECTION");
  assert.equal(Plans.validatePlan(planFor(["profile", "referrals.legacy.prospects"])).code, "UNKNOWN_SECTION");
  // A roster plan keeps the order the user checked.
  const roster = Plans.validatePlan(planFor(["organizations.members.ZED", "organizations.members.ALPHA"], Plans.ORGANIZATION_ROSTER_MINIMUM_DELAY_MS));
  assert.equal(roster.ok, true, roster.message);
  assert.deepEqual([...roster.value.selectedSections], ["organizations.members.ZED", "organizations.members.ALPHA"]);
});

test("a reordered plan is declined before any request to RSI", async () => {
  const harness = await createExtensionHarness();
  const tab = harness.openTab();
  const before = harness.rsi.requests.length;
  const declined = await tab.request("PROPOSE_BUILD", planFor(["hangarLog", "profile"]));
  assert.equal(declined.ok, false);
  assert.equal(declined.code, "NONCANONICAL_SECTION_ORDER");
  assert.equal(harness.rsi.requests.length, before, "nothing was sent to RSI");
  assert.equal(harness.state()?.activeJobId ?? null, null);
});

test("a fresh build and an Update both read identity first, then all of Hangar Log, then the rest", async () => {
  const harness = await createExtensionHarness();
  const tab = harness.openTab();
  const fresh = await tab.build();
  assert.equal(fresh.ok, true, fresh.message);
  assert.equal(fresh.status.activeJob.mode, "baseline");
  const freshStart = 0;
  assert.equal((await harness.finishJob()).status, "complete");
  const freshRequests = harness.rsi.requests.slice(freshStart);
  assertHangarLogDirectlyAfterIdentity(freshRequests);
  const freshDocument = tab.events.findLast((event) => event.result)?.result;
  assert.deepEqual(freshDocument.sync.runs.at(-1).selectedSections, ORDER, "the run receipt records the canonical sequence");

  await tab.request("ACKNOWLEDGE_RESULT", { runId: harness.state().lastCompletedRunId });
  tab.reload();
  const updateStart = harness.rsi.requests.length;
  const update = await tab.build();
  assert.equal(update.ok, true, update.message);
  assert.equal(update.status.activeJob.mode, "update");
  assert.equal((await harness.finishJob()).status, "complete");
  assertHangarLogDirectlyAfterIdentity(harness.rsi.requests.slice(updateStart));
});
