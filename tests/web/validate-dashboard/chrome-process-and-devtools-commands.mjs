import { existsSync } from "node:fs";
import { POLL_MS, quiet } from "./polling-intervals.mjs";
import { chromeErrors } from "./headlesschromestart.mjs";

// Chrome is started by headlesschromestart.mjs when this module loads; its process and its error output are read here.
export { chrome, chromeErrors } from "./headlesschromestart.mjs";

export async function waitForFile(filePath, timeoutMs = 12000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(filePath)) return;
    await quiet(POLL_MS);
  }
  throw new Error(`Timed out waiting for ${filePath}\n${chromeErrors}`);
}

export async function waitForJson(url, timeoutMs = 12000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.json();
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await quiet(POLL_MS);
  }
  throw new Error(`Timed out reading ${url}: ${lastError?.message ?? "unknown error"}\n${chromeErrors}`);
}

export let socket;
// The steps that connect are a module of their own; a module reads another's variable and assigns it through this.
export const setSocket = (value) => { socket = value; };
let sequence = 0;
export const pending = new Map();
export const exceptions = [];
export const remoteRequests = [];

export function command(method, params = {}) {
  return new Promise((resolve, reject) => {
    if (socket?.readyState !== WebSocket.OPEN) {
      reject(new Error(`Chrome DevTools connection is not open for ${method}.\n${chromeErrors}`));
      return;
    }
    const id = ++sequence;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Chrome DevTools timed out during ${method}.\n${chromeErrors}`));
    }, 15000);
    pending.set(id, { resolve, reject, timer });
    try {
      socket.send(JSON.stringify({ id, method, params }));
    } catch (error) {
      clearTimeout(timer);
      pending.delete(id);
      reject(error);
    }
  });
}

export async function evaluate(expression) {
  const response = await command("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (response.exceptionDetails) throw new Error(`Browser evaluation failed: ${response.exceptionDetails.exception?.description ?? response.exceptionDetails.text}`);
  return response.result.value;
}

export async function waitFor(expression, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await evaluate(expression)) return;
    await quiet(POLL_MS);
  }
  throw new Error(`Timed out waiting for browser condition: ${expression}`);
}
