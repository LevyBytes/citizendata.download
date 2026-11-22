import assert from "node:assert/strict";
import test from "node:test";
import { createExtensionHarness } from "../support/extension-harness.mjs";
import { assertCompleteDocument } from "./service-worker-fixture-expected-counts-and-complete-document.mjs";
import { kept, resultOf } from "./service-worker-fixture-running-build-requests-and-kept-records.mjs";

test("a failed run keeps its stored pages for the continuation, and an incomplete run is removed once a later run ends", async () => {
  const harness = await createExtensionHarness();
  const tab = harness.openTab();
  // A 401 signs the session out and stops the run; a 410 would set the section aside (§10.1), and a passing 500 or 503 would be retried (§6.4 rule 8, §7.4).
  harness.rsi.failNext((request) => request.path === "/api/account/buybackPledges" && request.page === 2, { status: 401 });
  await tab.build();
  assert.equal((await harness.finishJob()).status, "failed");
  const failed = kept(harness);
  // The first page of buy-backs is stored once, and the partial result was staged with the failure. Billing page 1,
  // read before Buybacks, is kept beside them for the run's later billing sections (§7.3, D23).
  const sectionPages = failed.pages.filter((page) => page.section !== "kept.billingPage1");
  assert.deepEqual(sectionPages.map((page) => [page.section, page.step, JSON.parse(page.text).raw.length]), [["buybacks", 1, 100]]);
  assert.deepEqual(failed.pages.filter((page) => page.section === "kept.billingPage1").map((page) => JSON.parse(page.text).url), ["https://robertsspaceindustries.com/account/billing?page=1&pagesize=100"]);
  assert.deepEqual(failed.stagedRuns[0].results.filter((result) => result.outcome.status !== "complete").map((result) => [result.section, result.outcome.status, result.value.length]), [["buybacks", "partial", 100]]);
  assert.equal(failed.jobs[0].storedStepsBySection.buybacks, 1);

  // The continuation is a new run that takes over the failed run's collection, so it reads the stored page back
  // instead of asking RSI for it again.
  const continued = await tab.request("CONTINUE_PARTIAL");
  assert.equal(continued.code, "RUN_STARTED", continued.message);
  const continuing = kept(harness).jobs.find((job) => job.status === "running");
  assert.equal(continuing.collectionId, failed.jobs[0].collectionId);
  assert.notEqual(continuing.runId, failed.jobs[0].runId);
  assert.equal((await harness.finishJob()).status, "complete");
  await assertCompleteDocument(resultOf(tab), harness.rsi);
  const after = kept(harness);
  assert.deepEqual(after.pages, []);
  // The failed run is out of reach now, so its job and its staged results are gone.
  assert.deepEqual(after.jobs.map((job) => job.status), ["complete"]);
  assert.deepEqual(after.stagedRuns.map((staged) => staged.status), ["promoted"]);
  assert.deepEqual((await harness.popup.request("LIST_INCOMPLETE_RUNS")).runs, []);

  // A run that fails and is not continued is removed when the next build ends, however that build ends.
  await tab.request("ACKNOWLEDGE_RESULT", { runId: harness.state().lastCompletedRunId });
  tab.reload();
  harness.rsi.addPledges(30);
  // A 401 signs the session out and stops the run; a 410 would set the section aside (§10.1), and a passing 500 or 503 would be retried (§6.4 rule 8, §7.4).
  harness.rsi.failNext((request) => request.path === "/account/pledges" && request.page === 4, { status: 401 });
  await tab.build();
  assert.equal((await harness.finishJob()).status, "failed");
  assert.equal(kept(harness).pages.filter((page) => page.section === "pledges").length, 2);
  tab.reload();
  assert.equal((await tab.build()).code, "RUN_STARTED");
  await harness.advance(() => harness.rsi.requests.at(-1).path === "/account/pledges");
  assert.equal((await tab.request("GET_PARTIAL_RESULT")).ok, true, "the failed run can still be opened while the next one runs");
  assert.equal((await tab.request("CANCEL")).ok, true);
  await harness.advanceBy(5000);
  const superseded = kept(harness);
  assert.deepEqual(superseded.jobs.map((job) => job.status).sort(), ["cancelled", "complete"]);
  assert.deepEqual(superseded.pages, []);
  assert.deepEqual(superseded.stagedRuns.map((staged) => staged.status), ["cancelled"]);
  assert.equal((await tab.request("GET_PARTIAL_RESULT")).code, "NO_PARTIAL_RESULT");
});
