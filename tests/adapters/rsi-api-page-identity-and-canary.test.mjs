// The canary (PARSER_HARDENING.md §5.4): before a step whose last attempt was unclear, the run's own identify call
// tells a limit, a lost session and another account from a changed page. Each outcome of the canary table, and the
// bounded session check after an unclear identify.
import assert from "node:assert/strict";
import test from "node:test";
import { harness } from "./rsi-api-in-a-sandbox.mjs";
import { failure } from "./rsiapicanaryandpageidentity.mjs";

const IDENTIFIED = { success: 1, data: { member: { id: 7, nickname: "VerifiedCitizen" } } };

const HANGAR_LOG_PAGE = { success: 1, data: { rendered: "<div class=\"pledge-log-entry\">row</div>", page: 1, pagecount: 1 } };

const UNCLEAR_POST = { kind: "ambiguous", code: "RSI_API_HTTP_403", method: "POST", route: "/api/account/pledgeLog" };

const canaryStep = (signal = UNCLEAR_POST) => ({ accountId: "VerifiedCitizen", cursor: null, canary: true, canaryAfterSignal: signal, concurrentRequestStaggerMs: 0 });

const routes = (calls) => calls.filter((call) => call.kind === "fetch").map((call) => `${call.options.method} ${new URL(call.url).pathname}`);

test("the authorized handle answers: RSI serves this session, and the step's own requests follow", async () => {
  const { api, calls } = harness([IDENTIFIED, HANGAR_LOG_PAGE]);
  const result = await api.collectStep({ id: "hangarLog" }, canaryStep());
  assert.equal(result.done, true);
  assert.deepEqual(routes(calls), ["POST /api/spectrum/auth/identify", "POST /api/account/pledgeLog"]);
  // The canary's request is a line of the step like any other.
  assert.deepEqual([...result.requestActivities].map((line) => line.route), ["/api/spectrum/auth/identify", "/api/account/pledgeLog"]);
});

test("another handle answers: the account changed, and nothing else is asked", async () => {
  const { api, calls } = harness([{ success: 1, data: { member: { id: 8, nickname: "SomeoneElse" } } }]);
  const error = await failure(api.collectStep({ id: "hangarLog" }, canaryStep()));
  assert.deepEqual([error.message, error.signal.kind, error.signal.reason, error.signal.fromCanary], ["ACCOUNT_CHANGED", "user", "account-changed", true]);
  assert.deepEqual(routes(calls), ["POST /api/spectrum/auth/identify"]);
});

test("a limit or a passing failure at the canary fails the step with the canary's own signal", async () => {
  for (const [response, code, kind] of [
    [{ kind: "http-error", status: 429, body: "", headers: { "retry-after": "120" } }, "RSI_API_HTTP_429", "limit"],
    [{ kind: "http-error", status: 500, body: "" }, "RSI_API_HTTP_500", "transient"],
    [{ success: 0, code: "ErrTooManyRequests" }, "RSI_IDENTIFY_RESPONSE_REJECTED_ERRTOOMANYREQUESTS", "limit"]
  ]) {
    const { api, calls } = harness([response]);
    const error = await failure(api.collectStep({ id: "hangarLog" }, canaryStep()));
    assert.deepEqual([error.message, error.signal.kind, error.signal.fromCanary], [code, kind, true], code);
    assert.deepEqual(routes(calls), ["POST /api/spectrum/auth/identify"], `${code}: the step's own request is not sent`);
  }
  const { api } = harness([{ kind: "http-error", status: 429, body: "", headers: { "retry-after": "120" } }]);
  assert.equal((await failure(api.collectStep({ id: "hangarLog" }, canaryStep()))).signal.retryAfterMs, 120000);
});

test("a signed-out session at the canary is the user's", async () => {
  const error = await failure(harness([{ kind: "http-error", status: 401, body: "" }]).api.collectStep({ id: "hangarLog" }, canaryStep()));
  assert.deepEqual([error.signal.kind, error.signal.reason, error.signal.fromCanary], ["user", "signed-out", true]);
  const noCookie = await failure(harness([], {}, { signedOut: true }).api.collectStep({ id: "hangarLog" }, canaryStep()));
  assert.deepEqual([noCookie.signal.code, noCookie.signal.fromCanary], ["RSI_SIGNED_OUT", true]);
});

test("an unclear canary after an unclear JSON answer reads the hangar once: a recognized hangar lets the step go on", async () => {
  const { api, calls } = harness(
    [{ kind: "http-error", status: 403, body: "" }, { kind: "html", body: "<div class=\"list-items\"></div>" }, HANGAR_LOG_PAGE],
    { pledges: { raw: [{ pledgeId: 1, title: "Package" }], pageCount: 1 } }
  );
  const result = await api.collectStep({ id: "hangarLog" }, canaryStep());
  assert.equal(result.done, true);
  assert.deepEqual(routes(calls), ["POST /api/spectrum/auth/identify", "GET /account/pledges", "POST /api/account/pledgeLog"]);
  assert.equal(calls.find((call) => call.kind === "fetch" && call.url.includes("/account/pledges")).options.credentials, "include");
});

test("the session check finds the sign-in page, or an unreadable hangar: signed out, or still unclear", async () => {
  const signedOut = harness([{ kind: "http-error", status: 403, body: "" }, { kind: "html", body: "<h1>Restricted Area</h1><p>Authorized Personnel Only</p><p>You must be authenticated to reach this area.</p>" }]);
  const out = await failure(signedOut.api.collectStep({ id: "hangarLog" }, canaryStep()));
  assert.deepEqual([out.signal.kind, out.signal.reason, out.signal.fromCanary], ["user", "signed-out", true]);
  const unreadable = harness([{ kind: "http-error", status: 403, body: "" }, { kind: "html", body: "<main>other</main>" }], { pledges: { raw: [], pageCount: 1 } });
  const unclear = await failure(unreadable.api.collectStep({ id: "hangarLog" }, canaryStep()));
  assert.deepEqual([unclear.message, unclear.signal.kind, unclear.signal.fromCanary], ["RSI_API_HTTP_403", "ambiguous", true]);
  assert.deepEqual(routes(unreadable.calls), ["POST /api/spectrum/auth/identify", "GET /account/pledges"]);
});

test("no session check follows an unclear canary after an unclear page answer: the unclear canary is the step's signal", async () => {
  const { api, calls } = harness([{ kind: "http-error", status: 403, body: "" }]);
  const error = await failure(api.collectStep({ id: "hangarLog" }, canaryStep({ kind: "ambiguous", code: "RSI_PAGE_NOT_RECOGNIZED", method: "GET", route: "/account/billing" })));
  assert.deepEqual([error.signal.kind, error.signal.fromCanary], ["ambiguous", true]);
  assert.deepEqual(routes(calls), ["POST /api/spectrum/auth/identify"]);
});
