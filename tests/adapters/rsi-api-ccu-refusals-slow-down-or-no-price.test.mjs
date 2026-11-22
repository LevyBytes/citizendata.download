// CCU buyback prices when RSI refuses (PARSER_HARDENING.md §5.5, §13.7, F11): a 429, 5xx or a 403 at the store's
// fixed addresses refuses the step with its signal, so it is tried again and no price is marked missing; a refusal
// inside HTTP 200 with a limit's words is a limit; 400, 404, 409, 422 or a changed content type is "no price", as
// before; any other refusal of the store session or the price keeps its reason.
import assert from "node:assert/strict";
import test from "node:test";
import { harness } from "./rsi-api-in-a-sandbox.mjs";

const plain = (value) => JSON.parse(JSON.stringify(value));
const BUYBACK = { buybackId: 1, kind: "upgrade", state: "available", title: "Upgrade - A to B", upgrade: { fromShipIdentifiers: [{ scheme: "rsi-ship", value: "101" }], toShipIdentifiers: [{ scheme: "rsi-ship", value: "202" }],
  skuIdentifiers: [{ scheme: "rsi-sku", value: "303" }] } };
// The section's first step, which opens the store session, and a later one, which finds it open.
const firstStep = () => ({ accountId: "VerifiedCitizen", runId: "run-first", concurrentRequestStaggerMs: 0, cursor: null, sectionInputs: { pledges: [], buybacks: [BUYBACK] } });
const laterStep = () => ({ ...firstStep(), runId: "run-later", cursor: { raw: [{ key: "other", unavailable: true, reason: "NO_PRICE", shipsAsked: [101, 202] }] } });
const status = (code) => ({ kind: "http-error", status: code, body: { success: 0 } });
const collect = (responses, input) => harness(responses).api.collectStep({ id: "buybackUpgradePrices" }, input);
const failure = (promise) => promise.then(() => assert.fail("the step did not refuse"), (error) => error);
const reasons = (result) => plain(result.raw).filter((row) => row.key !== "other").map((row) => row.reason ?? "PRICED");

test("a 429, 502, 503, 504 or 500 at any store call refuses the step with its class, so no price is marked missing", async () => {
  for (const [code, kind] of [[429, "limit"], [502, "limit"], [503, "limit"], [504, "limit"], [500, "transient"]]) {
    const atAuth = await failure(collect([status(code)], firstStep()));
    assert.deepEqual([atAuth.signal.kind, atAuth.signal.code, atAuth.signal.route], [kind, `RSI_UPGRADE_PRICE_HTTP_${code}`, "/api/account/v2/setAuthToken"], `setAuthToken ${code}`);
    const atContext = await failure(collect([status(code)], laterStep()));
    assert.deepEqual([atContext.signal.kind, atContext.signal.route], [kind, "/api/ship-upgrades/setContextToken"], `setContextToken ${code}`);
    const atPrice = await failure(collect([{ success: 1 }, status(code)], laterStep()));
    assert.deepEqual([atPrice.signal.kind, atPrice.signal.route], [kind, "/pledge-store/api/upgrade/graphql"], `price ${code}`);
  }
});

test("a 403 at the store's fixed addresses is unclear until the canary, never a missing price", async () => {
  const error = await failure(collect([{ success: 1 }, status(403)], laterStep()));
  assert.deepEqual([error.signal.kind, error.signal.code], ["ambiguous", "RSI_UPGRADE_PRICE_HTTP_403"]);
});

test("a limit inside an HTTP 200 answer of setAuthToken refuses the step instead of leaving every price unread (F11)", async () => {
  const error = await failure(collect([{ success: 0, code: "ErrRateLimit", msg: "Too many requests" }], firstStep()));
  assert.deepEqual([error.signal.kind, error.signal.rsiCode], ["limit", "ErrRateLimit"]);
  // Any other refusal of the session leaves the step's prices unread with AUTH_REFUSED, as before.
  const refused = await collect([{ success: 0, code: "ErrNotAllowed", msg: "Not allowed" }], firstStep());
  assert.deepEqual(reasons(refused), ["AUTH_REFUSED"]);
});

test("a limit inside an HTTP 200 answer of setContextToken or the price refuses the step; another refusal keeps its reason", async () => {
  const atContext = await failure(collect([{ success: 0, code: "ErrRateLimit", msg: "rate limited" }], laterStep()));
  assert.equal(atContext.signal.kind, "limit");
  const atPrice = await failure(collect([{ success: 1 }, [{ errors: [{ message: "Too many requests, try again later" }] }]], laterStep()));
  assert.deepEqual([atPrice.signal.kind, atPrice.signal.code], ["limit", "RSI_GRAPHQL_REJECTED"]);
  const context = await collect([{ success: 0, code: "ErrNotAllowed" }, { success: 0, code: "ErrNotAllowed" }, { success: 0, code: "ErrNotAllowed" }], laterStep());
  assert.deepEqual(reasons(context), ["CONTEXT_REFUSED"]);
  const price = await collect([{ success: 1 }, [{ errors: [{ message: "Field failed" }] }, { data: { ships: [] } }], [{ errors: [{ message: "Field failed" }] }]], laterStep());
  assert.deepEqual(reasons(price), ["PRICE_REFUSED"]);
});

test("400, 404, 409, 422 or a changed content type at a store call is no price, as before", async () => {
  for (const code of [400, 404, 409, 422]) {
    const result = await collect([{ success: 1 }, status(code), status(code)], laterStep());
    assert.deepEqual(reasons(result), [`HTTP_${code}`], `price ${code}`);
  }
  const changed = await collect([{ success: 1 }, { kind: "json", body: "<html></html>", contentType: "text/html" }, { kind: "json", body: "<html></html>", contentType: "text/html" }], laterStep());
  assert.deepEqual(reasons(changed), ["CONTENT_TYPE_CHANGED"]);
  // A proven price is still read.
  const priced = await collect([{ success: 1 }, [{ data: { price: { nativeAmount: 2500, amount: null } } }, { data: { ships: [] } }]], laterStep());
  assert.deepEqual(reasons(priced), ["PRICED"]);
});
