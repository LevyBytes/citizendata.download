// Headless Chrome on the check's own profile, driven over the DevTools protocol. Remote requests are blocked, reduced
// motion is asked for (the hero artwork then holds still), and every page starts with empty storage (the hero
// rotation is kept in sessionStorage), so what a page shows depends on its files alone.
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { browserExecutable, profile, scratch } from "./options-and-evidence-folders.mjs";

const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const FLAGS = ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--disable-background-networking", "--disable-component-update", "--disable-sync", "--no-first-run"];
// Run in each page before its own scripts. The dashboard says once that it is ready; the flag keeps that for later.
const PAGE_START = "try { sessionStorage.clear(); localStorage.clear(); } catch { /* A page without storage has none to clear. */ }\n"
  + "addEventListener('citizendata-dashboard-ready', () => { globalThis.renderingCheckReady = true; }, { once: true });";

// Chrome writes its port, then its browser path, to this file; it is read once both lines are there.
async function devtoolsPort(chrome, failure) {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    if (failure()) throw failure();
    if (chrome.exitCode !== null || chrome.signalCode !== null) throw new Error(`Chrome exited during startup: ${chrome.signalCode ?? chrome.exitCode}`);
    const lines = await readFile(path.join(profile, "DevToolsActivePort"), "utf8").then((text) => text.split(/\r?\n/u), () => []);
    if (lines.length >= 2 && /^\d+$/u.test(lines[0])) return lines[0];
    await pause(50);
  }
  throw new Error("Chrome did not open its DevTools port within 15 s");
}

// Returns { command(method, params), loads(), close() }; close() says whether Chrome ended.
export async function openBrowser() {
  const environment = { ...process.env, TEMP: scratch, TMP: scratch, TMPDIR: scratch };
  const chrome = spawn(browserExecutable, [...FLAGS, "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: ["ignore", "ignore", "pipe"], windowsHide: true, env: environment });
  let spawnError = null;
  let stderr = "";
  chrome.on("error", (error) => { spawnError = error; });
  chrome.stderr.on("data", (chunk) => { stderr += chunk; });
  let socket = null;
  const close = async () => {
    socket?.close();
    if (chrome.exitCode === null && chrome.signalCode === null) chrome.kill();
    for (let attempt = 0; attempt < 100 && !spawnError && chrome.exitCode === null && chrome.signalCode === null; attempt += 1) await pause(50);
    return spawnError !== null || chrome.exitCode !== null || chrome.signalCode !== null;
  };
  try {
    const port = await devtoolsPort(chrome, () => spawnError);
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(10000) })).json();
    const target = targets.find((each) => each.type === "page");
    if (!target) throw new Error(`Chrome opened no page: ${stderr.trim().slice(0, 300)}`);
    socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("The DevTools connection did not open within 10 s")), 10000);
      socket.addEventListener("open", () => { clearTimeout(timer); resolve(); }, { once: true });
      socket.addEventListener("error", () => { clearTimeout(timer); reject(new Error("The DevTools connection failed")); }, { once: true });
    });
    const session = connect(socket);
    for (const method of ["Page.enable", "Runtime.enable", "Network.enable"]) await session.command(method);
    await session.command("Network.setBlockedURLs", { urls: ["http://*", "https://*"] });
    await session.command("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    await session.command("Page.addScriptToEvaluateOnNewDocument", { source: PAGE_START });
    return { ...session, close };
  } catch (error) {
    await close();
    throw error;
  }
}

function connect(socket) {
  const pending = new Map();
  let sequence = 0;
  let loads = 0;
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data);
    if (message.method === "Page.loadEventFired") loads += 1;
    const request = message.id ? pending.get(message.id) : null;
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.error) request.reject(new Error(`${request.method}: ${message.error.message}`));
    else request.resolve(message.result);
  });
  socket.addEventListener("close", () => {
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error(`The DevTools connection closed during ${request.method}`)); }
    pending.clear();
  });
  const command = (method, params = {}) => new Promise((resolve, reject) => {
    sequence += 1;
    const timer = setTimeout(() => { pending.delete(sequence); reject(new Error(`${method} took more than 60 s`)); }, 60000);
    pending.set(sequence, { method, resolve, reject, timer });
    socket.send(JSON.stringify({ id: sequence, method, params }));
  });
  return { command, loads: () => loads };
}
