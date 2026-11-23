// What the dashboard checks' Chrome, still running, can tell when its page leaves the DevTools handshake unanswered
// (devtoolsstarthandshake.mjs): its version, its targets, and its process types, which show whether a renderer started.
import { within } from "./devtoolsstarthandshake.mjs";

const DIAGNOSIS_MS = 5000;

// Each question to Chrome on `port` is given five seconds; an unanswered one is reported as such.
export async function diagnoseDevTools(port, milliseconds = DIAGNOSIS_MS) {
  const ask = (what, question) => within(milliseconds, what, question, () => "").catch((error) => ({ unanswered: error.message.split("\n")[0] }));
  const version = await ask("version", async () => (await fetch(`http://127.0.0.1:${port}/json/version`)).json());
  const targets = await ask("target list", async () => (await fetch(`http://127.0.0.1:${port}/json/list`)).json());
  const processes = typeof version?.webSocketDebuggerUrl !== "string" ? { unanswered: "no browser socket" } : await ask("process list", () => new Promise((resolve, reject) => {
    const browser = new WebSocket(version.webSocketDebuggerUrl);
    browser.addEventListener("open", () => browser.send(JSON.stringify({ id: 1, method: "SystemInfo.getProcessInfo" })), { once: true });
    browser.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== 1) return;
      browser.close();
      resolve(message.result ?? message.error);
    });
    browser.addEventListener("error", () => reject(new Error("the browser socket failed")), { once: true });
  }));
  return {
    browser: version?.Browser ?? version,
    targets: Array.isArray(targets) ? targets.map((target) => `${target.type} ${target.url}`) : targets,
    processes: Array.isArray(processes?.processInfo) ? processes.processInfo.map((entry) => entry.type).sort() : processes
  };
}
