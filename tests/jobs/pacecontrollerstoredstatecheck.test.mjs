// A stored pace state is checked before the pace controller uses it (PARSER_HARDENING.md §6): today's states pass,
// and an unknown key, version or out-of-range value is refused.
import assert from "node:assert/strict";
import test from "node:test";
import { Pace, settings, T0, accepted, refused } from "./pacecontrollerundertest.mjs";

test("a stored pace state is checked before use: today's states pass, and an unknown key, version or out-of-range value is refused", () => {
  const ok = Pace.initialPace(settings);
  assert.equal(Pace.validatePaceState(ok, settings), null);
  const afterRefusal = refused(Pace.atBaseline(settings), T0, { kind: "limit", code: "RSI_API_HTTP_429", httpStatus: 429, rsiCode: null, rsiMessage: null, retryAfterMs: 30000, reason: null, method: "POST", route: "/api/account/pledgeLog", page: 1,
    elapsedMs: 120, fromCanary: false }).pace;
  assert.equal(Pace.validatePaceState(afterRefusal, settings), null);
  assert.equal(Pace.validatePaceState(accepted(ok, T0), settings), null);
  for (const [change, pattern] of [
    [{ version: 2 }, /pace\.version must be 1/u],
    [{ extra: 1 }, /pace\.extra is not known/u],
    [{ factor: 0.5 }, /pace\.factor must be a number/u],
    [{ factor: 601 }, /pace\.factor must be a number/u],
    [{ factor: Number.NaN }, /pace\.factor must be a number/u],
    [{ goodSince: "yesterday" }, /pace\.goodSince must be an ISO time/u],
    [{ attempt: -1 }, /pace\.attempt must be a whole number/u],
    [{ warning: "busy" }, /pace\.warning must be/u],
    [{ retestAfterMs: 1 }, /pace\.retestAfterMs must be a whole number/u],
    [{ lastSignal: { kind: "limit" } }, /pace\.lastSignal\.code is missing/u],
    [{ latency: { byRequestFamily: { "a b": { first: [], recent: [] } } } }, /not a valid request family/u],
    [{ latency: { byRequestFamily: { "GET /account/pledges in pledges": { first: [1, 2, 3, 4, 5, 6], recent: [] } } } }, /at most 5 whole response times/u],
    [{ wall: 2, retestAt: null }, /pace\.retestAt must be set while pace\.wall is/u]
  ]) {
    assert.match(Pace.validatePaceState({ ...ok, ...change }, settings), pattern, JSON.stringify(change));
  }
  assert.match(Pace.validatePaceState(null, settings), /pace must be an object/u);
  const { lastSignal: _lastSignal, ...missing } = ok;
  assert.match(Pace.validatePaceState(missing, settings), /pace\.lastSignal is missing/u);
});
