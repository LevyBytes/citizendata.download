// Durable request slots in the CCU step (PARSER_HARDENING.md §6.3, F20): authorize, context and price-and-ships
// each at their time, across a worker restart, and a refused price-and-ships answer is kept, so the price-only
// fallback slot does not send it again.
import assert from "node:assert/strict";
import test from "node:test";
import { harness } from "../adapters/rsi-api-in-a-sandbox.mjs";
import { testClock } from "./durableslotsvirtualclock.mjs";
import { plain, SECOND, WINDOWS_MS, busiest } from "./durableslotsbuybackrun.mjs";
import { slots } from "./durableslotsphasedsteps.mjs";

const ccuInput = (staggerMs, onRequestActivity) => ({
  accountId: "VerifiedCitizen",
  runId: "run-ccu",
  concurrentRequestStaggerMs: staggerMs,
  cursor: null,
  onRequestActivity,
  sectionInputs: {
    pledges: [],
    buybacks: [{ buybackId: 1, kind: "upgrade", state: "available", title: "Upgrade - A to B", upgrade: { fromShipIdentifiers: [{ scheme: "rsi-ship", value: "101" }], toShipIdentifiers: [{ scheme: "rsi-ship", value: "202" }],
      skuIdentifiers: [{ scheme: "rsi-sku", value: "303" }] } }]
  }
});

const operationOf = (call) => {
  const body = JSON.parse(call.options.body);
  return Array.isArray(body) ? body.map((question) => question.operationName).join("+") : new URL(call.url).pathname.split("/").at(-1);
};

test("CCU: authorize, context and price-and-ships each at their time, across a worker restart", async () => {
  const clock = testClock(7_000_000);
  const starts = [];
  const staggerMs = 20 * SECOND;
  const answers = [{ success: 1 }, { success: 1 }, [{ data: { price: { nativeAmount: 2500, amount: null } } }, { data: { ships: [] } }]];
  const workers = [harness(answers, {}, { globals: clock.globals })];
  const { result, phases } = await slots(workers[0], clock, { id: "buybackUpgradePrices" }, ccuInput(staggerMs, async () => { starts.push(clock.now); }), {
    restart: () => {
      workers.push(harness(answers, {}, { globals: clock.globals }));
      return workers.at(-1);
    }
  });
  assert.deepEqual(phases, ["context", "price-and-ships"]);
  assert.deepEqual(starts, [7_000_000, 7_000_000 + staggerMs, 7_000_000 + 2 * staggerMs]);
  const fetches = workers.flatMap((fixture) => fixture.calls.filter((call) => call.kind === "fetch"));
  assert.equal(fetches.length, 3, "each request was sent once, though each worker started the step over");
  assert.deepEqual(plain(result.raw).map((row) => row.nativeAmount), [2500]);
  assert.equal(workers.flatMap((fixture) => fixture.calls.filter((call) => call.kind === "cookie")).length, 3, "the token was read only for the requests that were due");
});

test("CCU: a refused price-and-ships answer is kept, so the price-only fallback slot does not send it again", async () => {
  const clock = testClock(7_000_000);
  const starts = [];
  const staggerMs = 20 * SECOND;
  const fixture = harness([{ success: 1 }, { success: 1 }, { kind: "http-error", status: 400, body: "{}" }, [{ data: { price: { nativeAmount: 1500, amount: null } } }]], {}, { globals: clock.globals });
  const { result, phases } = await slots(fixture, clock, { id: "buybackUpgradePrices" }, ccuInput(staggerMs, async () => { starts.push(clock.now); }));
  assert.deepEqual(phases, ["context", "price-and-ships", "price-only-fallback"]);
  assert.deepEqual(fixture.calls.filter((call) => call.kind === "fetch").map(operationOf), ["setAuthToken", "setContextToken", "getPrice+ships", "getPrice"]);
  assert.deepEqual(starts, [0, 1, 2, 3].map((slot) => 7_000_000 + slot * staggerMs));
  assert.deepEqual(plain(result.raw).map((row) => row.nativeAmount), [1500]);
  for (const windowMs of WINDOWS_MS) assert.ok(busiest(starts, windowMs) <= Math.floor((windowMs - 1) / staggerMs) + 1, `window ${windowMs} ms`);
});
