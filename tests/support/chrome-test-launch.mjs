// How the browser checks start Chrome: test-only settings shared by the dashboard check and the extension check. The
// extension and the dashboard never read this file; it changes nothing in how the product runs in a user's browser.
//
// A launch profile is a set of rendering flags. "standard" turns off the GPU as the checks always have. "software"
// also keeps the GPU's work inside the browser process and renders with SwiftShader, so no separate GPU process has to
// start. On some Windows machines Chrome's GPU process is refused at start and the browser exits with 0xC0000022
// (STATUS_ACCESS_DENIED, -1073741790) before it answers anything. Or the GPU process exits with that code and the
// browser then ends itself with 0x80000003 (2147483651), an exit that is not the GPU's by itself: it counts only when
// the browser's own startup log shows both the GPU process exit and the fatal "GPU process isn't usable". Those
// failures, before the DevTools handshake completed and so before any assertion, are retried once with the software
// profile; every other failure is reported as it is.
//
// The profile is "standard" unless CITIZENDATA_TEST_BROWSER_PROFILE names another. Each launcher prints the browser
// binary and the flags that actually ran.
import { existsSync } from "node:fs";
import { boundedStartupLog, isGpuStartRefused } from "./chromegpustartevidence.mjs";

export { GPU_FATAL_PARENT_EXIT_CODES, GPU_START_REFUSED_EXIT_CODES, STARTUP_LOG_CHARACTERS, boundedStartupLog, isGpuStartRefused } from "./chromegpustartevidence.mjs";

export const PROFILE_VARIABLE = "CITIZENDATA_TEST_BROWSER_PROFILE";
export const LAUNCH_PROFILES = Object.freeze({
  standard: Object.freeze(["--disable-gpu"]),
  software: Object.freeze(["--disable-gpu", "--disable-gpu-compositing", "--in-process-gpu", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
});

// Chrome: the given path, then CHROME_PATH, then the usual install locations.
export function chromeExecutable(given = null, environment = process.env) {
  if (given) return given;
  const candidates = [
    environment.CHROME_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium"
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

export function chosenProfile(environment = process.env) {
  const name = environment[PROFILE_VARIABLE] ?? "standard";
  if (!Object.hasOwn(LAUNCH_PROFILES, name)) throw new Error(`${PROFILE_VARIABLE} must be one of ${Object.keys(LAUNCH_PROFILES).join(", ")}, not ${name}.`);
  return name;
}

// The line each launcher prints: which binary ran, under which profile, with which flags.
export function launchReport(executable, profile, flags) {
  return `Browser: ${executable} (${profile} profile) ${flags.join(" ")}`;
}

// One retryable start, up to the end of the DevTools handshake. `launch(flags, profile)` starts the browser and
// returns { exited, handshake, stop, log, diagnose }: `exited`, a promise of the exit code; `handshake()`, which
// finds the page and waits for its first answers; `stop()`, which ends the process; `log()`, the browser's standard
// error so far; and, when it has one, `diagnose()`, what a browser still running can tell about a handshake it left
// unanswered. A start that fails is stopped. Its error carries `exitCode` when the browser exited before the
// handshake completed, even when a closed socket was seen first; `startupLog`, the bounded log; and `diagnosis` when
// the browser was still running. launchWithFallback tells a refused GPU start from any other failure by them.
export async function startThroughHandshake(launch, flags, profile, { exitWaitMs = 3000 } = {}) {
  const browser = await launch(flags, profile);
  const exitedFirst = browser.exited.then((exitCode) => Promise.reject(Object.assign(new Error(`Chrome exited with ${exitCode} before the DevTools handshake completed.`), { exitCode })));
  exitedFirst.catch(() => {});
  try {
    return await Promise.race([browser.handshake(), exitedFirst]);
  } catch (error) {
    if (!Number.isInteger(error?.exitCode)) {
      let timer;
      const exitCode = await Promise.race([browser.exited, new Promise((resolve) => { timer = setTimeout(resolve, exitWaitMs, null); })]);
      clearTimeout(timer);
      if (Number.isInteger(exitCode)) Object.assign(error, { exitCode });
      else if (typeof browser.diagnose === "function") error.diagnosis = await browser.diagnose().catch((failure) => ({ unavailable: failure?.message ?? String(failure) }));
    }
    await browser.stop();
    error.startupLog = boundedStartupLog(typeof browser.log === "function" ? browser.log() : "");
    if (error.diagnosis) error.message += `\nStill running, the browser told: ${JSON.stringify(error.diagnosis)}`;
    throw error;
  }
}

// Starts the browser with the chosen profile. `start(flags, profile)` resolves once the browser has answered, and
// rejects with an error whose `exitCode` is set when the browser exited before answering. Only a refused GPU start
// under a profile other than "software" is tried again, once, with the software profile. `report` is told each launch.
export async function launchWithFallback(start, { profile = chosenProfile(), report = () => {} } = {}) {
  report(profile, LAUNCH_PROFILES[profile]);
  try {
    return await start(LAUNCH_PROFILES[profile], profile);
  } catch (error) {
    if (profile === "software" || !isGpuStartRefused(error?.exitCode, error?.startupLog)) throw error;
    report("software", LAUNCH_PROFILES.software, `retried after Chrome exited with ${error.exitCode} before answering`);
    return start(LAUNCH_PROFILES.software, "software");
  }
}
