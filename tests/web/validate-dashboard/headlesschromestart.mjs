// Starts the headless Chrome the dashboard checks drive: its profile's rendering flags first, then the safe software
// rendering profile when Chrome exits before its DevTools handshake completes (tests/support/chrome-test-launch.mjs).
// The handshake is the start: the port file, the page target, its socket, and a first answer. Each launch has a new
// profile folder of its own inside the run's profile folder, which the run removes at its end; a crashed launch's
// files are left alone. The browser binary and flags that ran are printed.
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { launchReport, launchWithFallback, startThroughHandshake } from "../../support/chrome-test-launch.mjs";
import { POLL_MS, quiet } from "./polling-intervals.mjs";
import { chromePath, profileDirectory } from "./run-options-and-work-folders.mjs";

export let chrome = null;
export let chromeErrors = "";
// The page Chrome opened: its socket, open and answering, once the handshake has completed.
export let devtools = null;
const STARTUP_MS = 12000;
let launches = 0;
let launchProfile = null;

async function until(read, what) {
  const deadline = Date.now() + STARTUP_MS;
  for (;;) {
    try {
      const value = await read();
      if (value) return value;
    } catch { /* Not ready yet. */ }
    if (Date.now() > deadline) throw new Error(`Chrome gave no ${what} within ${STARTUP_MS / 1000} seconds.\n${chromeErrors}`);
    await quiet(POLL_MS);
  }
}

// Port file, page target, socket, then one command answered: Chrome is started only when all four hold.
async function handshake() {
  const activePortFile = path.join(launchProfile, "DevToolsActivePort");
  const port = await until(() => existsSync(activePortFile) && readFileSync(activePortFile, "utf8").trim().split(/\r?\n/u)[0], "DevTools port file");
  const page = await until(async () => (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((target) => target.type === "page"), "page target");
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", () => reject(new Error(`Chrome's DevTools socket failed to open.\n${chromeErrors}`)), { once: true });
  });
  await new Promise((resolve, reject) => {
    const answered = (event) => {
      if (JSON.parse(event.data).id !== 0) return;
      socket.removeEventListener("message", answered);
      resolve();
    };
    socket.addEventListener("message", answered);
    socket.addEventListener("close", () => reject(new Error(`Chrome's DevTools socket closed during the handshake.\n${chromeErrors}`)), { once: true });
    socket.send(JSON.stringify({ id: 0, method: "Runtime.evaluate", params: { expression: "1", returnByValue: true } }));
  });
  devtools = { port, socket };
  return devtools;
}

function launch(flags) {
  launchProfile = path.join(profileDirectory, `launch${++launches}`);
  chromeErrors = "";
  const child = spawn(chromePath, ["--headless=new", ...flags, "--remote-debugging-port=0", `--user-data-dir=${launchProfile}`, "about:blank"], { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
  chrome = child;
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { chromeErrors += chunk; });
  // A program that could not start at all has no exit code.
  const exited = new Promise((resolve) => {
    child.once("exit", (exitCode) => resolve(exitCode));
    child.once("error", () => resolve(null));
  });
  const stop = async () => {
    devtools?.socket.close();
    devtools = null;
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await exited;
  };
  return { exited, handshake, stop, log: () => chromeErrors };
}

await launchWithFallback((flags, profile) => startThroughHandshake(launch, flags, profile), {
  report: (profile, flags, why = null) => console.log(`${launchReport(chromePath, profile, ["--headless=new", ...flags])}${why ? ` (${why})` : ""}`)
});
