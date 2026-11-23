// Starts the headless Chrome the dashboard checks drive: its profile's rendering flags first, then the safe software
// rendering profile when Chrome exits before its DevTools handshake completes (tests/support/chrome-test-launch.mjs).
// The handshake is the start: the port file, the page target, its socket, and a first answer, each within the start
// budget (devtoolsstarthandshake.mjs); a browser still running that leaves it unanswered fails the start with what it
// can tell (devtoolsdiagnosis.mjs), its process types among them. Each launch has a new profile folder of its own
// inside the run's profile folder; a failed start removes the run's folder, and the run removes it at its end. The
// browser binary and flags that ran are printed.
import { spawn } from "node:child_process";
import path from "node:path";
import { launchReport } from "../../support/chrome-test-launch.mjs";
import { diagnoseDevTools } from "./devtoolsdiagnosis.mjs";
import { devtoolsHandshake, startDashboardChrome } from "./devtoolsstarthandshake.mjs";
import { chromePath, profileDirectory } from "./run-options-and-work-folders.mjs";

export let chrome = null;
export let chromeErrors = "";
// The page Chrome opened: its socket, open and answering, once the handshake has completed.
export let devtools = null;
let launches = 0;

function launch(flags) {
  const launchProfile = path.join(profileDirectory, `launch${++launches}`);
  let port = null;
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
  const handshake = async () => {
    devtools = await devtoolsHandshake({ activePortFile: path.join(launchProfile, "DevToolsActivePort"), errors: () => chromeErrors, onPort: (known) => { port = known; } });
    return devtools;
  };
  const stop = async () => {
    devtools?.socket.close();
    devtools = null;
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await exited;
  };
  const diagnose = async () => (port ? diagnoseDevTools(port) : { unanswered: "no DevTools port was written" });
  return { exited, handshake, stop, log: () => chromeErrors, diagnose };
}

await startDashboardChrome({
  launch,
  profileDirectory,
  report: (profile, flags, why = null) => console.log(`${launchReport(chromePath, profile, ["--headless=new", ...flags])}${why ? ` (${why})` : ""}`)
});
