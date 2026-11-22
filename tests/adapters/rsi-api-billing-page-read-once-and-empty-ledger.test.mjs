// The billing page once a run (PARSER_HARDENING.md §13.1, D23): page 1 stays cached from Account balances until the
// last billing section of the plan ends, Financial ledgers in between, and clearTransientCaches keeps only the
// addresses it is told to keep. The empty ledger (§13.2, D24): the one shape of RSI's paged answers it accepts.
import assert from "node:assert/strict";
import test from "node:test";
import { createExtensionHarness } from "../support/extension-harness.mjs";
import { EMPTY_LEDGER_ANSWER } from "../support/synthetic-rsi/answer-shapes-and-paging.mjs";
import { harness } from "./rsi-api-in-a-sandbox.mjs";

const BILLING_PAGE_1 = "https://robertsspaceindustries.com/account/billing?page=1&pagesize=100";

test("a build reads billing page 1 once for Account balances, Billing total, Billing orders and Subscriptions", async () => {
  const extension = await createExtensionHarness();
  const tab = extension.openTab();
  await tab.build();
  const finished = await extension.finishJob();
  assert.equal(finished.status, "complete");
  const job = await extension.repository.getJob(extension.state().lastTerminalJobId);
  const order = job.plan.selectedSections;
  // Financial ledgers runs between the billing sections.
  assert.ok(order.indexOf("financial.balances") < order.indexOf("financial.ledgers") && order.indexOf("financial.ledgers") < order.indexOf("financial.subscriptions"));
  const firstPages = extension.rsi.requests.filter((request) => request.path === "/account/billing" && request.page === 1);
  assert.equal(firstPages.length, 1, "three requests fewer a build");
  const document = tab.events.find((event) => event.result)?.result;
  for (const section of ["financial.balances", "financial.billingTotal", "financial.orders", "financial.subscriptions"]) {
    assert.equal(document.sync.sectionOutcomes[section].status, "complete", section);
  }
});

test("clearTransientCaches keeps the addresses it is told to keep and drops every other", async () => {
  const page = (title) => ({ kind: "html", body: `<html><title>${title}</title><div class="credits"><div class="credit-line"></div></div><div class="list-items"></div></html>` });
  const parsed = { "financial.balances": { raw: { storeCredit: { amount: "0", unit: "USD" }, uec: null, rec: null } }, pledges: { raw: [{ pledgeId: 1, title: "Package" }], pageCount: 1 } };
  const { api, calls } = harness([page("Billing"), page("Hangar"), page("Hangar")], parsed);
  const input = { accountId: "VerifiedCitizen", cursor: null, concurrentRequestStaggerMs: 0 };
  await api.collectStep({ id: "financial.balances" }, input);
  await api.collectStep({ id: "pledges" }, input);
  api.clearTransientCaches({ retain: [BILLING_PAGE_1] });
  await api.collectStep({ id: "financial.balances" }, input);
  await api.collectStep({ id: "pledges" }, input);
  const fetched = calls.filter((call) => call.kind === "fetch").map((call) => new URL(call.url).pathname);
  assert.deepEqual(fetched, ["/account/billing", "/account/pledges", "/account/pledges"], "the kept billing page is read from the cache; the hangar page is asked again");
});

// The empty ledger (§13.2, D24): page 1 with a page count of 0 and a rendered string is one page with no row; a row
// under it is a changed contract; every other shape is handled as before, and only the ledgers accept it.
const LEDGER_INPUT = { accountId: "VerifiedCitizen", cursor: null, concurrentRequestStaggerMs: 0 };
const ledgerAnswer = (data) => ({ kind: "json", body: { success: 1, code: "OK", msg: "OK", data } });
const failureOf = (promise) => promise.then(() => assert.fail("the step did not fail"), (error) => error);

test("the stand-in answer of an empty ledger ends that ledger with no row, and the run goes on to the next ledger", async () => {
  const { api } = harness([structuredClone({ kind: "json", body: EMPTY_LEDGER_ANSWER })], { ledger: { raw: [] } });
  const step = await api.collectStep({ id: "financial.ledgers" }, LEDGER_INPUT);
  assert.equal(step.done, false);
  assert.equal(step.nextPage, 1);
  assert.equal(step.interactiveState.ledgerIndex, 1, "the next ledger is read next");
  assert.deepEqual(JSON.parse(JSON.stringify(step.raw.storeCredit)), []);
});

test("a row under a page count of 0 is a changed contract", async () => {
  const { api } = harness([ledgerAnswer({ page: 1, pagecount: 0, rendered: "<div></div>" })], { ledger: { raw: [{ rawTimestamp: "now", amount: "1.00", rawDetail: "Credit" }] } });
  const error = await failureOf(api.collectStep({ id: "financial.ledgers" }, LEDGER_INPUT));
  assert.deepEqual([error.signal.kind, error.signal.code], ["contract", "RSI_LEDGER_PAGE_COUNT_INVALID"]);
});

test("every other shape with a page count of 0 is handled as before, and only the ledgers read one as empty", async () => {
  for (const data of [{ page: 1, pagecount: 0 }, { page: 2, pagecount: 0, rendered: "" }, { page: 1, pagecount: "none", rendered: "" }]) {
    const { api } = harness([ledgerAnswer(data)], { ledger: { raw: [] } });
    const error = await failureOf(api.collectStep({ id: "financial.ledgers" }, LEDGER_INPUT));
    assert.equal(error.signal.kind, "contract", JSON.stringify(data));
    assert.match(error.signal.code, /^RSI_LEDGER_/u, JSON.stringify(data));
  }
  // The ledger's second page with a count of 0 is not the empty ledger.
  const later = harness([ledgerAnswer({ page: 2, pagecount: 0, rendered: "" })], { ledger: { raw: [] } });
  const error = await failureOf(later.api.collectStep({ id: "financial.ledgers" }, { ...LEDGER_INPUT, cursor: { page: 2, interactiveState: { ledgerIndex: 0, batches: 1 } } }));
  assert.equal(error.signal.code, "RSI_LEDGER_PAGE_COUNT_INVALID");
  // The Hangar Log does not accept the shape.
  const log = harness([ledgerAnswer({ page: 1, pagecount: 0, rendered: "" })], { hangarLog: { raw: [] } });
  const logError = await failureOf(log.api.collectStep({ id: "hangarLog" }, LEDGER_INPUT));
  assert.equal(logError.signal.code, "RSI_HANGAR_LOG_PAGE_COUNT_INVALID");
});

test("a build of an account whose ledgers are all empty finishes, each ledger read once", async () => {
  const extension = await createExtensionHarness({ account: { counts: { storeCredit: 0, uec: 0, rec: 0 } } });
  const tab = extension.openTab();
  await tab.build();
  assert.equal((await extension.finishJob()).status, "complete");
  const document = tab.events.find((event) => event.result)?.result;
  assert.equal(document.sync.sectionOutcomes["financial.creditLedgers.storeCredit"].status, "complete");
  for (const key of ["storeCredit", "uec", "rec"]) assert.deepEqual(document.financial.creditLedgers[key], [], key);
  for (const path of ["/api/account/creditLog", "/api/account/uecLog", "/api/account/recLog"]) {
    assert.equal(extension.rsi.requests.filter((request) => request.path === path).length, 1, path);
  }
});
