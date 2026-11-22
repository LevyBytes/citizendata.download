// Starts the headless Chrome the dashboard checks drive: its profile's rendering flags first, then the safe software
// rendering profile when Chrome exits before it answers (tests/support/chrome-test-launch.mjs). The browser binary and
// flags that ran are printed.
import { spawn } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { clearInterval, setInterval } from "node:timers";
import { launchReport, launchWithFallback } from "../../support/chrome-test-launch.mjs";
import { POLL_MS } from "./polling-intervals.mjs";
import { chromePath, profileDirectory } from "./run-options-and-work-folders.mjs";

export let chrome = null;
export let chromeErrors = "";
const activePortFile = path.join(profileDirectory, "DevToolsActivePort");

// Starts headless Chrome with the profile's rendering flags; resolves once its DevTools port file exists, and rejects
// with the exit code when Chrome exits first (tests/support/chrome-test-launch.mjs).
function startChrome(flags) {
  rmSync(activePortFile, { force: true });
  chromeErrors = "";
  const child = spawn(chromePath, ["--headless=new", ...flags, "--remote-debugging-port=0", `--user-data-dir=${profileDirectory}`, "about:blank"], { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
  chrome = child;
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { chromeErrors += chunk; });
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const exited = (exitCode) => { clearInterval(timer); reject(Object.assign(new Error(`Chrome exited with ${exitCode} before answering.\n${chromeErrors}`), { exitCode })); };
    const timer = setInterval(() => {
      if (!existsSync(activePortFile) && Date.now() - started < 12000) return;
      clearInterval(timer);
      child.off("exit", exited);
      if (existsSync(activePortFile)) resolve(child);
      else reject(new Error(`Chrome wrote no DevTools port file within 12 seconds.\n${chromeErrors}`));
    }, POLL_MS);
    child.once("exit", exited);
  });
}

await launchWithFallback(startChrome, {
  report: (profile, flags, why = null) => console.log(`${launchReport(chromePath, profile, ["--headless=new", ...flags])}${why ? ` (${why})` : ""}`)
});
