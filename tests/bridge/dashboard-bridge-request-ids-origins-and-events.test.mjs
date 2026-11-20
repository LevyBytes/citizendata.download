import assert from "node:assert/strict";
import test from "node:test";
import { harness } from "./dashboard-bridge-in-a-stand-in-page.mjs";
import { settle } from "./dashboard-bridge-local-copy-in-a-stand-in-page.mjs";

test("a request ID is accepted once in a bridge session", async () => {
  const fixture = harness();
  const request = fixture.dashboardRequest();
  const event = { source: fixture.windowObject, origin: fixture.context.location.origin, data: request };
  fixture.dispatch("message", event);
  fixture.dispatch("message", event);
  await settle();
  assert.equal(fixture.sent.filter((message) => message.kind === "DASHBOARD_REQUEST").length, 1, "the replay never reaches the extension");
  const responses = fixture.posts.filter((entry) => entry.message.type === "RESPONSE").map((entry) => entry.message.payload);
  assert.equal(responses.length, 2);
  assert.equal(responses.filter((payload) => payload.code === "REPLAYED_REQUEST").length, 1);
});

test("messages from another window, another origin, another session, or carrying request authority are dropped", async () => {
  const fixture = harness();
  const request = fixture.dashboardRequest();
  const origin = fixture.context.location.origin;
  const postsBefore = fixture.posts.length;
  fixture.dispatch("message", { source: {}, origin, data: request });
  fixture.dispatch("message", { source: fixture.windowObject, origin: "https://example.invalid", data: request });
  fixture.dispatch("message", { source: fixture.windowObject, origin, data: { ...request, nonce: `${request.nonce}x` } });
  fixture.dispatch("message", { source: fixture.windowObject, origin, data: { ...request, bridgeSessionId: "00000000-0000-4000-8000-00000000ffff" } });
  fixture.dispatch("message", { source: fixture.windowObject, origin, data: { ...request, payload: { url: "https://example.invalid/collect" } } });
  fixture.dispatch("message", { source: fixture.windowObject, origin, data: { ...request, type: "APPROVE_LOCAL_DASHBOARD" } });
  await settle();
  assert.equal(fixture.sent.length, 0, "nothing was forwarded to the extension");
  assert.equal(fixture.posts.length, postsBefore, "nothing was answered");
});

test("extension events reach the page as status or result, and anything carrying a credential field is withheld", () => {
  const fixture = harness();
  fixture.runtime.extensionListener({ kind: "DASHBOARD_EVENT", payload: { status: { status: "running" } } }, {}, () => {});
  assert.equal(fixture.posts.at(-1).message.type, "STATUS");
  fixture.runtime.extensionListener({ kind: "DASHBOARD_EVENT", payload: { status: { status: "complete" }, result: { schemaVersion: "1" } } }, {}, () => {});
  assert.equal(fixture.posts.at(-1).message.type, "RESULT");
  const before = fixture.posts.length;
  fixture.runtime.extensionListener({ kind: "DASHBOARD_EVENT", payload: { status: {}, accessToken: "secret" } }, {}, () => {});
  fixture.runtime.extensionListener({ kind: "SOMETHING_ELSE", payload: { status: {} } }, {}, () => {});
  assert.equal(fixture.posts.length, before);
});
