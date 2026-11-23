import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const protocolSource = await readFile(new URL("../../extension/shared/protocol.js", import.meta.url), "utf8");
const bridgeSource = await readFile(new URL("../../extension/content/dashboard-bridge.js", import.meta.url), "utf8");

export function harness(options = {}) {
  const listeners = new Map();
  const posts = [];
  const sent = [];
  let uuidCounter = 0;
  const addWindowListener = (type, listener) => {
    const values = listeners.get(type) ?? new Set();
    values.add(listener);
    listeners.set(type, values);
  };
  const removeWindowListener = (type, listener) => listeners.get(type)?.delete(listener);
  const windowObject = {
    top: null,
    addEventListener: addWindowListener,
    removeEventListener: removeWindowListener,
    postMessage(message, targetOrigin) { posts.push({ message, targetOrigin }); }
  };
  windowObject.top = windowObject;
  const runtime = {
    invalidated: false,
    getManifest() {
      if (this.invalidated) throw new Error("Extension context invalidated.");
      return { version: "0.42.2" };
    },
    sendMessage(message) {
      if (options.sendThrows) throw new TypeError("Cannot read properties of undefined (reading 'sendMessage')");
      sent.push(message);
      // A local copy first asks whether its path is approved; `hello` is the extension's answer.
      if (message.kind === "LOCAL_DASHBOARD_HELLO") return Promise.resolve(options.hello ?? { ok: true, approved: false });
      return Promise.resolve({ ok: true, message });
    },
    onMessage: {
      addListener(listener) {
        if (options.listenerThrows) throw new Error("Extension context invalidated.");
        runtime.extensionListener = listener;
      },
      removeListener(listener) {
        if (runtime.invalidated) throw new Error("Extension context invalidated.");
        if (runtime.extensionListener === listener) runtime.extensionListener = null;
      }
    }
  };
  const context = {
    URL,
    chrome: { runtime },
    console,
    crypto: {
      randomUUID() {
        uuidCounter += 1;
        return `00000000-0000-4000-8000-${String(uuidCounter).padStart(12, "0")}`;
      }
    },
    location: options.location ?? { origin: "https://citizendata.download", pathname: "/" },
    window: windowObject
  };
  context.globalThis = context;
  vm.runInNewContext(protocolSource, context, { filename: "protocol.js" });
  assert.doesNotThrow(() => vm.runInNewContext(bridgeSource, context, { filename: "dashboard-bridge.js" }));

  function dispatch(type, event) {
    for (const listener of [...(listeners.get(type) ?? [])]) listener(event);
  }

  function dashboardRequest() {
    const ready = posts.find((entry) => entry.message.type === context.CitizenDataProtocol.EVENT_TYPES.BRIDGE_READY)?.message;
    assert.ok(ready);
    return context.CitizenDataProtocol.makeEnvelope({
      type: context.CitizenDataProtocol.REQUEST_TYPES.GET_STATUS,
      requestId: "10000000-0000-4000-8000-000000000001",
      bridgeSessionId: ready.bridgeSessionId,
      nonce: ready.nonce,
      payload: null
    });
  }

  return { context, dispatch, listeners, posts, runtime, sent, windowObject, dashboardRequest };
}
