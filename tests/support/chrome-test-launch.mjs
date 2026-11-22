// How the browser checks start Chrome: test-only settings shared by the dashboard check and the extension check. The
// extension and the dashboard never read this file; it changes nothing in how the product runs in a user's browser.
//
// A launch profile is a set of rendering flags. "standard" turns off the GPU as the checks always have. "software"
// also keeps the GPU's work inside the browser process and renders with SwiftShader, so no separate GPU process has to
// start. On some Windows machines Chrome's GPU process is refused at start and the browser exits with 0xC0000022
// (STATUS_ACCESS_DENIED, -1073741790) before it answers anything. That one failure, before any assertion, is retried
// once with the software profile; every other failure is reported as it is.
//
// The profile is "standard" unless CITIZENDATA_TEST_BROWSER_PROFILE names another. Each launcher prints the browser
// binary and the flags that actually ran.
import { existsSync } from "node:fs";

export const PROFILE_VARIABLE = "CITIZENDATA_TEST_BROWSER_PROFILE";
export const LAUNCH_PROFILES = Object.freeze({
  standard: Object.freeze(["--disable-gpu"]),
  software: Object.freeze(["--disable-gpu", "--disable-gpu-compositing", "--in-process-gpu", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
});
// 0xC0000022 as Node reports it on Windows, unsigned, and as PowerShell shows it, signed.
export const GPU_START_REFUSED_EXIT_CODES = Object.freeze([3221225506, -1073741790]);

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

export function isGpuStartRefused(exitCode) {
  return GPU_START_REFUSED_EXIT_CODES.includes(exitCode);
}

// The line each launcher prints: which binary ran, under which profile, with which flags.
export function launchReport(executable, profile, flags) {
  return `Browser: ${executable} (${profile} profile) ${flags.join(" ")}`;
}

// Starts the browser with the chosen profile. `start(flags, profile)` resolves once the browser has answered, and
// rejects with an error whose `exitCode` is set when the browser exited before answering. Only a refused GPU start
// under a profile other than "software" is tried again, once, with the software profile. `report` is told each launch.
export async function launchWithFallback(start, { profile = chosenProfile(), report = () => {} } = {}) {
  report(profile, LAUNCH_PROFILES[profile]);
  try {
    return await start(LAUNCH_PROFILES[profile], profile);
  } catch (error) {
    if (profile === "software" || !isGpuStartRefused(error?.exitCode)) throw error;
    report("software", LAUNCH_PROFILES.software, `retried after Chrome exited with ${error.exitCode} before answering`);
    return start(LAUNCH_PROFILES.software, "software");
  }
}
