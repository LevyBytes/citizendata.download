import assert from "node:assert/strict";
import test from "node:test";
import { harness } from "./dashboard-bridge-in-a-stand-in-page.mjs";

test("dashboard bridge catches synchronous sendMessage context invalidation", () => {
  const fixture = harness({ sendThrows: true });
  assert.doesNotThrow(() => fixture.dispatch("message", {
    source: fixture.windowObject,
    origin: fixture.context.location.origin,
    data: fixture.dashboardRequest()
  }));
  const response = fixture.posts.at(-1).message;
  assert.equal(response.type, fixture.context.CitizenDataProtocol.EVENT_TYPES.RESPONSE);
  assert.equal(response.payload.code, "EXTENSION_UNAVAILABLE");
});

test("dashboard bridge catches a missing runtime after extension reload", () => {
  const fixture = harness();
  fixture.context.chrome.runtime = undefined;
  assert.doesNotThrow(() => fixture.dispatch("message", {
    source: fixture.windowObject,
    origin: fixture.context.location.origin,
    data: fixture.dashboardRequest()
  }));
  assert.equal(fixture.posts.at(-1).message.payload.code, "EXTENSION_UNAVAILABLE");
  assert.equal(fixture.listeners.get("message")?.size ?? 0, 0);
});

test("dashboard bridge stops without throwing when readiness loses its extension context", () => {
  const fixture = harness();
  fixture.runtime.invalidated = true;
  assert.doesNotThrow(() => fixture.dispatch("citizendata-dashboard-ready", {}));
  assert.equal(fixture.listeners.get("message")?.size ?? 0, 0);
  assert.equal(fixture.listeners.get("citizendata-dashboard-ready")?.size ?? 0, 0);
});

test("a bridge that cannot listen to the extension does not announce itself", () => {
  const fixture = harness({ listenerThrows: true });
  assert.deepEqual(fixture.posts, []);
  assert.equal(fixture.listeners.get("message")?.size ?? 0, 0);
  assert.equal(fixture.listeners.get("citizendata-dashboard-ready")?.size ?? 0, 0);
});
