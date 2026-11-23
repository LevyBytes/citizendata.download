// A parent exit of 0x80000003 is a refused GPU start only with the startup log's evidence (chromegpustartevidence.mjs):
// with it, the start is tried again exactly once with the software profile; without it, or after the handshake was
// left unanswered by a browser still running, nothing is retried, and the failure keeps its log and what the browser
// could still tell.
import assert from "node:assert/strict";
import test from "node:test";
import { STARTUP_LOG_CHARACTERS, isGpuStartRefused, launchWithFallback, startThroughHandshake } from "./chrome-test-launch.mjs";

const GPU_EXIT = "[9520:1204:1122/101500.120:ERROR:gpu_process_host.cc(991)] GPU process exited unexpectedly: exit_code=-1073741790";
const NOT_USABLE = "[9520:1204:1122/101500.130:FATAL:gpu_data_manager_impl_private.cc(415)] GPU process isn't usable. Goodbye.";
const BOTH = `${GPU_EXIT}\n${NOT_USABLE}\n`;

// A simulated browser whose standard error is `log`: `exit(code)` ends it, `answer(value)` completes its handshake,
// and `diagnosis`, when given, is what it can still tell. `stops` counts the stops asked for.
function browser(log, diagnosis = null) {
  const simulated = { stops: 0 };
  simulated.exited = new Promise((resolve) => { simulated.exit = resolve; });
  const handshake = new Promise((resolve, reject) => { simulated.answer = resolve; simulated.failHandshake = reject; });
  simulated.launched = {
    exited: simulated.exited, handshake: () => handshake, stop: async () => { simulated.stops += 1; }, log: () => log,
    ...(diagnosis ? { diagnose: async () => diagnosis } : {})
  };
  return simulated;
}

// Launches through the fallback: the standard browser is `standard`, started with `onStandard` applied to it; a
// software launch answers at once. Returns the outcome, the profiles launched and the reports.
async function run(standard, onStandard, profile = "standard") {
  const software = browser("");
  const profiles = [];
  const reports = [];
  const outcome = launchWithFallback((flags, name) => startThroughHandshake(async () => {
    profiles.push(name);
    const launched = name === "software" && profile === "standard" ? software : standard;
    if (launched === software) software.answer("software handshake");
    else onStandard(standard);
    return launched.launched;
  }, flags, name, { exitWaitMs: 1 }), { profile, report: (name, _flags, why = null) => reports.push([name, why]) });
  const settled = await outcome.then((value) => ({ value }), (error) => ({ error }));
  return { ...settled, profiles, reports, software };
}

test("0x80000003 is a refused GPU start only beside both the GPU process exit and its fatal line", () => {
  for (const code of [2147483651, -2147483645]) {
    assert.equal(isGpuStartRefused(code, BOTH), true);
    assert.equal(isGpuStartRefused(code, `${GPU_EXIT}\n`), false, "the GPU exit alone");
    assert.equal(isGpuStartRefused(code, `${NOT_USABLE}\n`), false, "the fatal line alone");
    assert.equal(isGpuStartRefused(code, ""), false, "no log");
  }
  assert.equal(isGpuStartRefused(1, BOTH), false, "another exit beside the same log");
  assert.equal(isGpuStartRefused(null, BOTH), false, "no exit at all");
});

test("the browser ending itself after the GPU process was refused is tried again exactly once with the software profile", async () => {
  const standard = browser(`[startup]\n${BOTH}`);
  const result = await run(standard, (launched) => launched.exit(2147483651));
  assert.equal(result.value, "software handshake");
  assert.deepEqual(result.profiles, ["standard", "software"]);
  assert.deepEqual([standard.stops, result.software.stops], [1, 0]);
  assert.match(result.reports[1][1], /exited with 2147483651/u);
});

test("the same exit without that evidence, or under the software profile, is not retried, and keeps its log", async () => {
  const withoutFatal = await run(browser(`${GPU_EXIT}\n`), (launched) => launched.exit(2147483651));
  assert.deepEqual([withoutFatal.error?.exitCode, withoutFatal.profiles, withoutFatal.error?.startupLog], [2147483651, ["standard"], `${GPU_EXIT}\n`]);
  const software = await run(browser(BOTH), (launched) => launched.exit(2147483651), "software");
  assert.deepEqual([software.error?.exitCode, software.profiles], [2147483651, ["software"]]);
});

test("a handshake left unanswered by a browser still running is not retried and is reported with what it could tell", async () => {
  const told = { browser: "HeadlessChrome/150", targets: ["page about:blank attached:true"], processes: ["browser"] };
  const hung = browser(BOTH, told);
  const result = await run(hung, (launched) => launched.failHandshake(new Error("Chrome did not answer Page.enable within 30000 ms.")));
  assert.deepEqual([result.profiles, result.error?.exitCode, result.error?.diagnosis, hung.stops], [["standard"], undefined, told, 1]);
  assert.match(result.error.message, /Still running, the browser told: .*"processes":\["browser"\]/u);
});

test("the log a failed start keeps is the end of the browser's standard error, bounded", async () => {
  const long = `${"x".repeat(STARTUP_LOG_CHARACTERS)}\n${BOTH}`;
  const result = await run(browser(long), (launched) => launched.exit(7));
  assert.equal(result.error.startupLog.length, STARTUP_LOG_CHARACTERS);
  assert.ok(result.error.startupLog.endsWith(BOTH));
});
