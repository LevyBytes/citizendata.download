import assert from "node:assert/strict";
import test from "node:test";
import { harness } from "./dashboard-bridge-in-a-stand-in-page.mjs";
import { LOCAL_PATH, localHarness, readyPosts, settle } from "./dashboard-bridge-local-copy-in-a-stand-in-page.mjs";

test("an unapproved local copy is told only that approval is needed and cannot send requests", async () => {
  const fixture = localHarness({ ok: true, approved: false });
  await settle();
  assert.deepEqual(fixture.sent.map((message) => ({ ...message })), [{ kind: "LOCAL_DASHBOARD_HELLO", dashboardPath: LOCAL_PATH }]);
  // The notice carries no session and no nonce, so the page has nothing it could use to address the extension.
  assert.deepEqual(fixture.posts.map((entry) => ({ ...entry.message })), [{ channel: "citizendata.dashboard.v1", protocolVersion: 2, type: "LOCAL_APPROVAL_REQUIRED" }]);
  fixture.dispatch("citizendata-dashboard-ready", {});
  assert.equal(fixture.posts.length, 2, "the notice is repeated when the dashboard finishes loading");
  assert.equal(fixture.posts[1].message.type, "LOCAL_APPROVAL_REQUIRED");
  assert.equal(fixture.listeners.get("message")?.size ?? 0, 0, "page requests are not listened for before approval");
  fixture.runtime.extensionListener({ kind: "DASHBOARD_EVENT", payload: { status: { status: "running" } } }, {}, () => {});
  assert.equal(fixture.posts.length, 2, "extension events are not forwarded before approval");
  assert.equal(readyPosts(fixture).length, 0);
});

test("approval starts the bridge in the open tab, once", async () => {
  const fixture = localHarness({ ok: true, approved: false });
  await settle();
  fixture.runtime.extensionListener({ kind: "LOCAL_DASHBOARD_APPROVED" }, {}, () => {});
  assert.equal(readyPosts(fixture).length, 1);
  assert.equal(fixture.posts.at(-1).targetOrigin, "*", "a file page has no origin that postMessage could target");
  fixture.dispatch("message", { source: fixture.windowObject, origin: "null", data: fixture.dashboardRequest() });
  await settle();
  const forwarded = fixture.sent.at(-1);
  assert.equal(forwarded.kind, "DASHBOARD_REQUEST");
  assert.equal(forwarded.dashboardOrigin, "file://");
  assert.equal(forwarded.dashboardPath, LOCAL_PATH);
  assert.equal(fixture.posts.at(-1).message.type, "RESPONSE");

  fixture.runtime.extensionListener({ kind: "LOCAL_DASHBOARD_APPROVED" }, {}, () => {});
  assert.equal(readyPosts(fixture).length, 1, "a repeated approval must not open a second session");
  fixture.dispatch("citizendata-dashboard-ready", {});
  assert.equal(readyPosts(fixture).length, 2, "after approval a reloaded dashboard script is given the same session again");
  assert.equal(readyPosts(fixture)[1].message.bridgeSessionId, readyPosts(fixture)[0].message.bridgeSessionId);
  assert.equal(fixture.posts.filter((entry) => entry.message.type === "LOCAL_APPROVAL_REQUIRED").length, 1);
});

test("an already approved local copy connects as soon as it loads", async () => {
  const fixture = localHarness({ ok: true, approved: true });
  await settle();
  assert.deepEqual(fixture.posts.map((entry) => entry.message.type), ["BRIDGE_READY"]);
  assert.equal(fixture.listeners.get("message")?.size, 1);
});

test("a local copy stays disconnected when the extension refuses it or cannot be reached", async () => {
  const refused = localHarness({ ok: false, code: "UNTRUSTED_DASHBOARD" });
  await settle();
  assert.deepEqual(refused.posts, []);
  assert.equal(refused.listeners.get("message")?.size ?? 0, 0);

  const unreachable = localHarness(null, { sendThrows: true });
  await settle();
  assert.deepEqual(unreachable.posts, []);
  assert.equal(unreachable.listeners.get("message")?.size ?? 0, 0);
});

test("only a local copy answers the extension's check of which dashboard a tab shows", async () => {
  const local = localHarness({ ok: true, approved: false });
  await settle();
  const replies = [];
  local.runtime.extensionListener({ kind: "LOCAL_DASHBOARD_PING" }, {}, (reply) => replies.push({ ...reply }));
  assert.deepEqual(replies, [{ dashboardPath: LOCAL_PATH }]);

  const hosted = harness();
  hosted.runtime.extensionListener({ kind: "LOCAL_DASHBOARD_PING" }, {}, (reply) => replies.push(reply));
  assert.equal(replies.length, 1, "the hosted dashboard is never a local copy");
  hosted.runtime.extensionListener({ kind: "LOCAL_DASHBOARD_APPROVED" }, {}, () => {});
  assert.equal(readyPosts(hosted).length, 1, "the hosted bridge started at load and is not restarted");
});
