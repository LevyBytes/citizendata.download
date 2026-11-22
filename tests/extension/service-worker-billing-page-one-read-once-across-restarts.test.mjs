// Billing page 1 is read once per run (PARSER_HARDENING.md §7.3, D23), also when Chrome ends the worker between the
// billing sections: the runner keeps the page with the run's stored pages and gives it back to a restarted worker.
import assert from "node:assert/strict";
import test from "node:test";
import { createExtensionHarness } from "../support/extension-harness.mjs";
import { assertCompleteDocument } from "./service-worker-fixture-expected-counts-and-complete-document.mjs";
import { kept, resultOf } from "./service-worker-fixture-running-build-requests-and-kept-records.mjs";

const BILLING = ["financial.balances", "financial.billingTotal", "financial.orders", "financial.subscriptions"];
const pageOneReads = (harness) => harness.rsi.requests.filter((request) => request.method === "GET" && request.path === "/account/billing" && (request.page ?? 1) === 1).length;

test("a worker ended after each billing section reads Billing page 1 once in the whole run", async () => {
  const harness = await createExtensionHarness();
  const tab = harness.openTab();
  await tab.build();
  const sectionsOf = () => harness.state().activeJobId ? kept(harness).jobs.find((job) => job.jobId === harness.state().activeJobId) : null;
  let restarts = 0;
  for (const section of BILLING) {
    // Until the section has ended: the job has moved past it.
    await harness.advance(() => {
      const job = sectionsOf();
      return !job || job.plan.selectedSections.indexOf(section) < job.sectionIndex;
    });
    if (!sectionsOf()) break;
    assert.ok(kept(harness).pages.some((page) => page.section === "kept.billingPage1"), `Billing page 1 is kept after ${section}`);
    harness.stopWorker();
    restarts += 1;
    await tab.status();
  }
  assert.equal(restarts, BILLING.length, "the worker was ended after every billing section");
  assert.equal((await harness.finishJob()).status, "complete");
  await assertCompleteDocument(resultOf(tab), harness.rsi);
  assert.equal(pageOneReads(harness), 1, "Billing page 1 was read once");
  assert.deepEqual(kept(harness).pages, [], "the kept page goes with the run's other pages");
});
