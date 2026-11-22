// GraphQL errors beside data in the CCU price steps (PARSER_HARDENING.md §5.7): a proven price beside an error is
// kept with the error as evidence; a limit's words refuse the step, in getPrice and in the token operations.
import assert from "node:assert/strict";
import test from "node:test";
import { harness } from "./rsi-api-in-a-sandbox.mjs";
import { plain, ERROR, LIMIT, failure } from "./rsiapipartialgraphql.mjs";

// One CCU buy-back whose price is read in one step, after the store upgrade session was opened in an earlier step.
function ccuInput() {
  return {
    accountId: "VerifiedCitizen",
    runId: "run-ccu",
    concurrentRequestStaggerMs: 0,
    cursor: { raw: [{ key: "other", unavailable: true, reason: "NO_PRICE", shipsAsked: [101, 202] }] },
    sectionInputs: {
      pledges: [],
      buybacks: [
        { buybackId: 1, kind: "upgrade", state: "available", title: "Upgrade - A to B", upgrade: { fromShipIdentifiers: [{ scheme: "rsi-ship", value: "101" }], toShipIdentifiers: [{ scheme: "rsi-ship", value: "202" }], skuIdentifiers: [{ scheme: "rsi-sku",
          value: "303" }] } },
        { buybackId: 2, kind: "upgrade", state: "available", title: "Upgrade - C to D", upgrade: { fromShipIdentifiers: [{ scheme: "rsi-ship", value: "404" }], toShipIdentifiers: [{ scheme: "rsi-ship", value: "505" }], skuIdentifiers: [{ scheme: "rsi-sku",
          value: "606" }] } }
      ]
    }
  };
}

test("getPrice: a proven price beside an error is kept with the error as evidence; a limit's words refuse the step", async () => {
  const context = { success: 1 };
  const kept = await harness([context, [{ data: { price: { nativeAmount: 2500, amount: null } }, errors: [ERROR] }, { data: { ships: [] } }]]).api.collectStep({ id: "buybackUpgradePrices" }, ccuInput());
  const priced = plain(kept.raw).filter((row) => row.nativeAmount !== undefined);
  assert.equal(priced.length, 1, JSON.stringify(plain(kept.raw)));
  assert.equal(priced[0].nativeAmount, 2500);
  assert.ok(plain(kept.rawAnomalies).some((anomaly) => anomaly.issueCode === "GRAPHQL_PARTIAL_ERROR" && anomaly.raw.operation === "getPrice"));
  const limited = await failure(harness([context, [{ errors: [LIMIT] }]]).api.collectStep({ id: "buybackUpgradePrices" }, ccuInput()));
  assert.deepEqual([limited.message, limited.signal.kind], ["RSI_GRAPHQL_REJECTED", "limit"]);
  // An error without a price leaves that upgrade without a price, as before.
  const refused = await harness([context, [{ errors: [ERROR] }, { data: { ships: [] } }], [{ errors: [ERROR] }]]).api.collectStep({ id: "buybackUpgradePrices" }, ccuInput());
  assert.ok(plain(refused.raw).some((row) => row.reason === "PRICE_REFUSED"));
});

test("setAuthToken and setContextToken: a refusal with a limit's words is a limit, any other leaves the price unread", async () => {
  const limited = await failure(harness([{ success: 0, code: "ErrRateLimit", msg: "rate limited" }]).api.collectStep({ id: "buybackUpgradePrices" }, ccuInput()));
  assert.deepEqual([limited.signal.kind, limited.signal.rsiCode], ["limit", "ErrRateLimit"]);
  const refused = await harness([{ success: 0, code: "ErrNotAllowed" }, { success: 0, code: "ErrNotAllowed" }]).api.collectStep({ id: "buybackUpgradePrices" }, { ...ccuInput(), runId: "run-ccu" });
  assert.ok(plain(refused.raw).some((row) => row.reason === "CONTEXT_REFUSED"));
});
