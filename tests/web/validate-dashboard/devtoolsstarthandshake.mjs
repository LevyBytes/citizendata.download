// The start of the dashboard checks' Chrome, as headlesschromestart.mjs drives it: the DevTools handshake, each step
// within the start budget, and what a browser still running can tell when its page leaves the handshake unanswered.
// A browser whose page has no renderer keeps its socket open and never answers; the handshake then fails within the
// budget, with the diagnosis of devtoolsdiagnosis.mjs, instead of waiting for ever. A failed start removes the run's
// profile folder.
import { existsSync, readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { launchWithFallback, startThroughHandshake } from "../../support/chrome-test-launch.mjs";

export const STARTUP_MS = 12000;
const POLL_MS = 50;

const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

// `step` resolves within `milliseconds` or the handshake fails, naming what Chrome did not give.
export async function within(milliseconds, what, step, errors) {
  let timer;
  const late = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Chrome gave no ${what} within ${milliseconds / 1000} seconds.\n${errors()}`)), milliseconds); });
  try {
    return await Promise.race([step(), late]);
  } finally {
    clearTimeout(timer);
  }
}

// `read()` asked again until it gives a value, for at most `milliseconds`; then the handshake fails, and nothing is
// left polling.
async function polled(milliseconds, what, read, errors) {
  const deadline = Date.now() + milliseconds;
  for (;;) {
    try {
      const value = await read();
      if (value) return value;
    } catch { /* Not ready yet. */ }
    if (Date.now() > deadline) throw new Error(`Chrome gave no ${what} within ${milliseconds / 1000} seconds.\n${errors()}`);
    await pause(POLL_MS);
  }
}

// Port file, page target, socket, then one command answered: Chrome is started only when all four hold, each within
// `startupMs`. `onPort(port)` is told the port as soon as it is known, for the diagnosis. Returns { port, socket }.
export async function devtoolsHandshake({ activePortFile, errors = () => "", startupMs = STARTUP_MS, onPort = () => {} }) {
  const port = await polled(startupMs, "DevTools port file", () => existsSync(activePortFile) && readFileSync(activePortFile, "utf8").trim().split(/\r?\n/u)[0], errors);
  onPort(port);
  const page = await polled(startupMs, "page target", async () => (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((target) => target.type === "page"), errors);
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  try {
    await within(startupMs, "open DevTools socket", () => new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", () => reject(new Error(`Chrome's DevTools socket failed to open.\n${errors()}`)), { once: true });
    }), errors);
    await within(startupMs, "answer to the page's first command (Runtime.evaluate)", () => new Promise((resolve, reject) => {
      const answered = (event) => {
        if (JSON.parse(event.data).id !== 0) return;
        socket.removeEventListener("message", answered);
        resolve();
      };
      socket.addEventListener("message", answered);
      socket.addEventListener("close", () => reject(new Error(`Chrome's DevTools socket closed during the handshake.\n${errors()}`)), { once: true });
      socket.send(JSON.stringify({ id: 0, method: "Runtime.evaluate", params: { expression: "1", returnByValue: true } }));
    }), errors);
  } catch (error) {
    socket.close();
    throw error;
  }
  return { port, socket };
}

// Starts the browser through the shared fallback (tests/support/chrome-test-launch.mjs). A start that fails removes
// `profileDirectory`, once its processes were stopped, and fails with its error, startup log and diagnosis.
export async function startDashboardChrome({ launch, profileDirectory, report = () => {} }) {
  try {
    return await launchWithFallback((flags, profile) => startThroughHandshake(launch, flags, profile), { report });
  } catch (error) {
    await rm(profileDirectory, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    throw error;
  }
}
