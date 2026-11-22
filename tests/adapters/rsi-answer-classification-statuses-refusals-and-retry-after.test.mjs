// The classes of RSI's answers (PARSER_HARDENING.md §5.1, §5.2): statuses, JSON refusals, the limit words, the
// Retry-After header and bounded text. The rows raised inside rsi-api.js (the cookie, the sign-in page, redirects,
// time-outs, page identity) are tested with the collectors.
import assert from "node:assert/strict";
import test from "node:test";
import { Answers, plain } from "./rsianswerclassesundertest.mjs";

test("statuses: 2xx accepted, 429 and 502 to 504 limits, other 5xx passing, 401 the user's, 403 and 404 unclear only at a fixed address", () => {
  const at = (status, fixedAddress = true) => Answers.classifyStatus({ status, fixedAddress });
  for (const status of [200, 204, 299]) assert.equal(at(status), "ok", status);
  for (const status of [429, 502, 503, 504]) assert.equal(at(status), "limit", status);
  for (const status of [500, 501, 505, 599]) assert.equal(at(status), "transient", status);
  assert.equal(at(401), "user");
  assert.equal(at(403), "ambiguous");
  assert.equal(at(404), "ambiguous");
  assert.equal(at(403, false), "contract");
  assert.equal(at(404, false), "contract");
  for (const status of [400, 405, 409, 410, 418, 422, 451]) assert.equal(at(status), "contract", status);
  assert.equal(Answers.classifyStatus({ status: Number.NaN }), "ambiguous");
  assert.equal(Answers.classifyStatus({ status: 302 }), "ambiguous");
});

test("a JSON refusal is a limit when its code or message carries a limit's words, and unclear otherwise; RSI's code and message are kept bounded", () => {
  assert.deepEqual(plain(Answers.classifyJsonRefusal({ success: 0, code: "ErrRateLimited", msg: "Slow down" })), { kind: "limit", rsiCode: "ErrRateLimited", rsiMessage: "Slow down" });
  assert.equal(Answers.classifyJsonRefusal({ success: 0, code: "ErrSomething", msg: "Too many requests, try again later" }).kind, "limit");
  assert.equal(Answers.classifyJsonRefusal({ success: false, code: "QuotaExceeded" }).kind, "limit");
  assert.deepEqual(plain(Answers.classifyJsonRefusal({ success: 0, code: "ErrNotAuthenticated" })), { kind: "ambiguous", rsiCode: "ErrNotAuthenticated", rsiMessage: null });
  // A code outside RSI's known shape is not kept; a long or controlling message is cut and cleaned.
  const odd = Answers.classifyJsonRefusal({ success: 0, code: "bad code!", msg: `line one\nline\u0007two ${"x".repeat(400)}` });
  assert.equal(odd.rsiCode, null);
  assert.equal(odd.rsiMessage.length, 160);
  assert.ok(odd.rsiMessage.startsWith("line one line two "));
  assert.deepEqual(plain(Answers.classifyJsonRefusal(null)), { kind: "ambiguous", rsiCode: null, rsiMessage: null });
});

test("the limit words are one pattern, tested on codes, messages and GraphQL errors", () => {
  for (const text of ["rate limit", "RATE_LIMIT", "ratelimited", "too many", "TooManyRequests", "throttled", "slow down", "try again", "quota", "exceeded", "server busy", "captcha"]) {
    assert.match(text, Answers.LIMIT_PATTERN, text);
  }
  for (const text of ["ErrNotAuthenticated", "not found", "invalid page", "ErrPageOutOfRange"]) assert.doesNotMatch(text, Answers.LIMIT_PATTERN, text);
});

test("Retry-After is whole seconds or an HTTP date, never negative, at most a day, and null when it says neither", () => {
  const now = Date.parse("2026-11-21T12:00:00.000Z");
  assert.equal(Answers.parseRetryAfter("30", now), 30000);
  assert.equal(Answers.parseRetryAfter(" 0 ", now), 0);
  assert.equal(Answers.parseRetryAfter("999999999", now), 24 * 60 * 60 * 1000);
  assert.equal(Answers.parseRetryAfter("Sat, 21 Nov 2026 12:01:00 GMT", now), 60000);
  assert.equal(Answers.parseRetryAfter("Sat, 21 Nov 2026 11:00:00 GMT", now), 0);
  assert.equal(Answers.parseRetryAfter("Mon, 30 Nov 2026 12:00:00 GMT", now), 24 * 60 * 60 * 1000);
  for (const value of ["", "soon", "not a date", null, undefined, 30]) assert.equal(Answers.parseRetryAfter(value, now), null, String(value));
});

test("bounded text: control characters become spaces, white space is folded, the result is cut, and nothing is null", () => {
  assert.equal(Answers.bounded("  a\tb\r\nc\u0000d\u0085e\u009fz  ", 160), "a b c d e z");
  assert.equal(Answers.bounded("abcdef", 3), "abc");
  assert.equal(Answers.bounded("😀😀😀", 2), "😀😀");
  assert.equal(Answers.bounded(" \n\t ", 160), null);
  assert.equal(Answers.bounded(42, 160), null);
  assert.equal(Answers.bounded(null, 160), null);
});
