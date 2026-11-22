// A failed step says what RSI answered (PARSER_HARDENING.md F2, F3, F4, §5.2, §5.5): its request lines stay with the
// error, and RSI's own code and message are kept, for pages, JSON, GraphQL, identify and roster answers. Each step
// here gets one sandbox.
import assert from "node:assert/strict";
import test from "node:test";
import { harness } from "./rsi-api-in-a-sandbox.mjs";
import { plain, ACCOUNT, failure } from "./rsiapifailedstep.mjs";

test("a refused page keeps its request lines, its status and RSI's Retry-After (F2)", async () => {
  const { api } = harness([{ kind: "http-error", status: 429, body: "Too Many Requests", headers: { "Retry-After": "30" } }]);
  const error = await failure(api.collectStep({ id: "hangarLog" }, ACCOUNT));
  assert.equal(error.message, "RSI_API_HTTP_429");
  assert.equal(error.signal.kind, "limit");
  assert.equal(error.signal.httpStatus, 429);
  assert.equal(error.signal.retryAfterMs, 30000);
  assert.deepEqual([error.signal.method, error.signal.route, error.signal.page], ["POST", "/api/account/pledgeLog", 1]);
  assert.equal(error.requestActivities.length, 1);
  const [line] = plain(error.requestActivities);
  assert.deepEqual([line.kind, line.method, line.route, line.page, line.responseStatus, line.retryAfterMs], ["request-completed", "POST", "/api/account/pledgeLog", 1, 429, 30000]);
});

test("a time-out and a network failure each leave a request-failed line and their class", async () => {
  const timedOut = await failure(harness([{ kind: "throw", name: "AbortError" }]).api.collectStep({ id: "hangarLog" }, ACCOUNT));
  assert.equal(timedOut.message, "RSI_REQUEST_TIMEOUT");
  assert.equal(timedOut.signal.kind, "transient");
  assert.deepEqual(plain(timedOut.requestActivities).map((line) => [line.kind, line.route, line.error]), [["request-failed", "/api/account/pledgeLog", "TIMEOUT"]]);
  const network = await failure(harness([{ kind: "throw", name: "TypeError" }]).api.collectStep({ id: "hangarLog" }, ACCOUNT));
  assert.equal(network.message, "RSI_NETWORK_OR_REDIRECT");
  assert.equal(network.signal.kind, "ambiguous");
  assert.equal(network.cause.cause.name, "TypeError", "the browser's TypeError is kept as the cause");
  assert.deepEqual(plain(network.requestActivities).map((line) => [line.kind, line.error]), [["request-failed", "NETWORK"]]);
});

test("a JSON refusal is checked before the data, so RSI's code and message are kept (F3)", async () => {
  const limited = await failure(harness([{ success: 0, code: "ErrRateLimited", msg: "Too many requests\nslow down", data: null }]).api.collectStep({ id: "financial.ledgers" }, ACCOUNT));
  assert.equal(limited.message, "RSI_LEDGER_RESPONSE_REJECTED_ERRRATELIMITED");
  assert.deepEqual([limited.signal.kind, limited.signal.rsiCode, limited.signal.rsiMessage], ["limit", "ErrRateLimited", "Too many requests slow down"]);
  // Before, an answer without data hid RSI's code as RSI_HANGAR_LOG_MISSING_DATA.
  const refused = await failure(harness([{ success: 0, code: "ErrSomething" }]).api.collectStep({ id: "hangarLog" }, ACCOUNT));
  assert.equal(refused.message, "RSI_HANGAR_LOG_RESPONSE_REJECTED_ERRSOMETHING");
  assert.equal(refused.signal.kind, "ambiguous");
  const buybacks = await failure(harness([{ success: false, code: "not a code!" }]).api.collectStep({ id: "buybacks" }, ACCOUNT));
  assert.equal(buybacks.message, "RSI_BUYBACKS_RESPONSE_REJECTED_UNSUCCESSFUL");
  assert.equal(buybacks.signal.rsiCode, null);
  // An accepted answer of another shape is a contract change.
  const changed = await failure(harness([{ success: 1, data: { page: 3, pagecount: 4, rendered: "" } }]).api.collectStep({ id: "hangarLog" }, ACCOUNT));
  assert.equal(changed.message, "RSI_HANGAR_LOG_PAGE_MISMATCH_REQUESTED_1_OBSERVED_3");
  assert.equal(changed.signal.kind, "contract");
});

test("GraphQL, identify and roster refusals keep RSI's words instead of reading as changed contracts (F4)", async () => {
  const descriptor = { id: "referrals.legacy.recruits", parserOptions: { ladder: "legacy", kind: "recruits" } };
  const graphql = await failure(harness([[{ errors: [{ message: "Rate limit exceeded", extensions: { code: "THROTTLED", detail: { secret: true } } }] }]]).api.collectStep(descriptor, ACCOUNT));
  assert.equal(graphql.message, "RSI_GRAPHQL_REJECTED");
  assert.deepEqual([graphql.signal.kind, graphql.signal.rsiCode, graphql.signal.rsiMessage], ["limit", "THROTTLED", "Rate limit exceeded"]);
  const unclear = await failure(harness([[{ errors: [{ message: "Unknown field" }] }]]).api.collectStep(descriptor, ACCOUNT));
  assert.deepEqual([unclear.message, unclear.signal.kind], ["RSI_GRAPHQL_REJECTED", "ambiguous"]);

  const identify = await failure(harness([{ success: 0, code: "ErrThrottled", msg: "Slow down" }]).api.identifyAccount());
  assert.deepEqual([identify.message, identify.signal.kind, identify.signal.rsiCode], ["RSI_IDENTIFY_RESPONSE_REJECTED_ERRTHROTTLED", "limit", "ErrThrottled"]);
  const noHandle = await failure(harness([{ success: 1, data: {} }]).api.identifyAccount());
  assert.equal(noHandle.message, "The signed-in RSI account did not expose its dossier handle.");
  assert.equal(noHandle.signal.kind, "ambiguous");

  const roster = await failure(harness([{ success: 0, code: "ErrBusy", msg: "Server busy" }]).api.collectStep({ id: "organizations.members.SYNTH", parserOptions: { organizationSid: "SYNTH" } }, ACCOUNT));
  assert.deepEqual([roster.message, roster.signal.kind], ["RSI_ORGANIZATION_MEMBERS_RESPONSE_REJECTED_ERRBUSY", "limit"]);
  const rosterShape = await failure(harness([{ success: 1, data: { totalrows: "many" } }]).api.collectStep({ id: "organizations.members.SYNTH", parserOptions: { organizationSid: "SYNTH" } }, ACCOUNT));
  assert.deepEqual([rosterShape.message, rosterShape.signal.kind], ["RSI_ORGANIZATION_MEMBERS_CONTRACT_CHANGED", "contract"]);
});
