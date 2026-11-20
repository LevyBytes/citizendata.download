import assert from "node:assert/strict";
import test from "node:test";
import { harness } from "./rsi-api-in-a-sandbox.mjs";

test("pledges and billing use fixed credentialed HTML routes without token headers", async () => {
  const { api, calls, messages } = harness([
    { kind: "html", body: "<main>pledges</main>" },
    { kind: "html", body: "<main>billing</main>" }
  ], {
    pledges: { raw: [{ pledgeId: 1, title: "Package" }], pageCount: 1 },
    "financial.balances": { raw: { storeCredit: { amount: "0", unit: "USD" }, uec: null, rec: null } }
  });
  const pledges = await api.collectStep({ id: "pledges" }, { accountId: "VerifiedCitizen", cursor: null });
  const balances = await api.collectStep({ id: "financial.balances" }, { accountId: "VerifiedCitizen", cursor: null });
  assert.equal(pledges.done, true);
  assert.equal(balances.done, true);
  assert.deepEqual([...pledges.sourceUrls], ["https://robertsspaceindustries.com/account/pledges?page=1&product-type="]);
  assert.deepEqual([...balances.sourceUrls], ["https://robertsspaceindustries.com/account/billing?page=1&pagesize=100"]);
  assert.deepEqual(calls.filter((call) => call.kind === "fetch").map((call) => new URL(call.url).pathname), ["/account/pledges", "/account/billing"]);
  assert.ok(calls.filter((call) => call.kind === "fetch").every((call) => call.options.method === "GET" && !("X-Rsi-Token" in call.options.headers)));
  assert.deepEqual(messages.map((message) => message.fragmentType), ["pledges", "financial.balances"]);
});

test("buybacks use RSI's fixed authenticated JSON POST contract and preserve observed pagination", async () => {
  const { api, calls, messages } = harness([
    { success: 1, data: { rendered: "<article class=\"pledge\"></article>", page: 1, pagecount: 2 } }
  ], { buybacks: { raw: [{ buybackId: 5, title: "Example" }] } });
  const result = await api.collectStep({ id: "buybacks" }, { cursor: null });
  assert.equal(result.done, false);
  assert.equal(result.nextPage, 2);
  const request = calls.find((call) => call.kind === "fetch");
  const requestUrl = new URL(request.url);
  assert.equal(requestUrl.pathname, "/api/account/buybackPledges");
  assert.equal(requestUrl.search, "");
  assert.equal(request.options.method, "POST");
  assert.equal(request.options.headers["X-Rsi-Token"], "transient-test-token");
  assert.equal(request.options.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(request.options.body), { page: 1, pagesize: 100 });
  assert.equal(messages[0].fragmentType, "buybacks");
  assert.deepEqual([...result.sourceUrls], [
    "https://robertsspaceindustries.com/account/buy-back-pledges?page=1&pagesize=100",
    "https://robertsspaceindustries.com/api/account/buybackPledges"
  ]);
});

test("buyback POST API rejects HTTP, bounded response, and page mismatches", async () => {
  const httpFailure = harness([{ kind: "http-error", status: 400, body: { success: 0 } }]);
  await assert.rejects(httpFailure.api.collectStep({ id: "buybacks" }, { cursor: { page: 2 } }), /RSI_BUYBACKS_HTTP_400/u);
  const rejected = harness([{ success: 0, code: "Too_Many_Requests", data: { rendered: "", page: 2, pagecount: 16 } }]);
  await assert.rejects(rejected.api.collectStep({ id: "buybacks" }, { cursor: { page: 2 } }), /RSI_BUYBACKS_RESPONSE_REJECTED_TOO_MANY_REQUESTS/u);
  const mismatch = harness([{ success: 1, code: "OK", data: { rendered: "", page: 1, pagecount: 16 } }]);
  await assert.rejects(mismatch.api.collectStep({ id: "buybacks" }, { cursor: { page: 2 } }), /RSI_BUYBACKS_PAGE_MISMATCH_REQUESTED_2_OBSERVED_1/u);
});
