// The class each failed page answer carries (PARSER_HARDENING.md §5.2, §5.5): limits, passing failures, the user's
// matters, unclear and changed answers; a missing session cookie is the user's; and the step's error is the
// extension's own object. Each step here gets one sandbox.
import assert from "node:assert/strict";
import test from "node:test";
import { harness } from "./rsi-api-in-a-sandbox.mjs";
import { plain, ACCOUNT, failure } from "./rsiapifailedstep.mjs";

test("page answers carry their classes: limits, passing failures, the user's matters, unclear and changed answers", async () => {
  const at = async (response, id = "financial.balances") => failure(harness([response]).api.collectStep({ id }, ACCOUNT));
  const cases = [
    [{ kind: "http-error", status: 503, body: "" }, "RSI_HTML_HTTP_503", "limit"],
    [{ kind: "http-error", status: 500, body: "" }, "RSI_HTML_HTTP_500", "transient"],
    [{ kind: "http-error", status: 403, body: "" }, "RSI_HTML_HTTP_403", "ambiguous"],
    [{ kind: "http-error", status: 404, body: "" }, "RSI_HTML_HTTP_404", "ambiguous"],
    [{ kind: "http-error", status: 401, body: "" }, "RSI_HTML_HTTP_401", "user"],
    [{ kind: "http-error", status: 410, body: "" }, "RSI_HTML_HTTP_410", "contract"],
    [{ kind: "html", body: "<h1>Restricted Area</h1><p>Authorized Personnel Only</p><p>You must be authenticated to reach this area.</p>" }, "RSI_SESSION_NOT_AUTHENTICATED", "user"],
    [{ kind: "html", body: "<main></main>", finalUrl: "https://robertsspaceindustries.com/connect?jumpto=/account/billing" }, "RSI_SESSION_NOT_AUTHENTICATED", "user"],
    [{ kind: "html", body: "<main></main>", finalUrl: "https://www.google.com/recaptcha/api2/challenge" }, "RSI_CHECK_IN_BROWSER", "user"],
    [{ kind: "html", body: "<main></main>", finalUrl: "https://example.com/elsewhere" }, "RSI_HTML_REDIRECTED_OFF_ORIGIN", "ambiguous"],
    [{ kind: "html", body: "{}", contentType: "application/json" }, "RSI_HTML_CONTENT_TYPE_CHANGED", "ambiguous"]
  ];
  for (const [response, code, kind] of cases) {
    const error = await at(response);
    assert.deepEqual([error.message, error.signal.kind], [code, kind], code);
  }
  assert.equal((await at(cases[4][0])).signal.reason, "signed-out");
  assert.equal((await at(cases[8][0])).signal.reason, "check-in-browser");
  // A buy-back's own page can be gone: its 403 is a changed contract, not unclear.
  const gone = await failure(harness([{ kind: "http-error", status: 403, body: "" }]).api.collectStep({ id: "buybackDetails" }, { ...ACCOUNT, sectionInputs: { buybacks: [{ buybackId: 5, kind: "ordinary", state: "available", title: "Package", items: [],
    sourceLinks: [{ kind: "detail", url: "https://robertsspaceindustries.com/pledge/buyback/5" }] }] } }));
  assert.deepEqual([gone.message, gone.signal.kind], ["RSI_HTML_HTTP_403", "contract"]);
});

test("a missing session cookie is the user's: signed out, with the words a user already sees", async () => {
  const { api, calls } = harness([], {}, { signedOut: true });
  const error = await failure(api.collectStep({ id: "hangarLog" }, ACCOUNT));
  assert.equal(error.message, "Sign in to RSI, then click Build JSON again.");
  assert.deepEqual([error.signal.kind, error.signal.code, error.signal.reason], ["user", "RSI_SIGNED_OUT", "signed-out"]);
  assert.deepEqual(calls.filter((call) => call.kind === "fetch"), [], "nothing is sent without the cookie");
});

test("the step's error is the extension's own object: a foreign thrown value is wrapped as its cause and never changed", async () => {
  const foreign = Object.freeze(new Error("RSI_MARKUP_PARSE_FAILED"));
  const { api } = harness([{ kind: "html", body: "<main>billing</main>" }], { "financial.balances": () => { throw foreign; } });
  const error = await failure(api.collectStep({ id: "financial.balances" }, ACCOUNT));
  assert.notEqual(error, foreign);
  assert.equal(error.cause, foreign);
  assert.equal(error.message, "RSI_MARKUP_PARSE_FAILED");
  assert.equal(Object.hasOwn(foreign, "requestActivities"), false);
  assert.deepEqual(plain(error.requestActivities).map((line) => [line.kind, line.route]), [["request-completed", "/account/billing"]]);
});
