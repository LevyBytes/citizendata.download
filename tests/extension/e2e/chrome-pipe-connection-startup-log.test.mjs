// The extension check's pipe to Chrome (chrome-pipe-connection.mjs) keeps exactly the end of the browser's standard
// error that a failed start keeps (STARTUP_LOG_CHARACTERS), however it arrives, so GPU evidence written last before the
// browser exits reaches startThroughHandshake and the retry judgement. The browser is a simulated child process.
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";
import { STARTUP_LOG_CHARACTERS, isGpuStartRefused, startThroughHandshake } from "../../support/chrome-test-launch.mjs";
import { ChromePipeConnection } from "./chrome-pipe-connection.mjs";

const EVIDENCE = "[9520:1204:1122/101500.120:ERROR:gpu_process_host.cc(991)] GPU process exited unexpectedly: exit_code=-1073741790\n"
  + "[9520:1204:1122/101500.130:FATAL:gpu_data_manager_impl_private.cc(415)] GPU process isn't usable. Goodbye.\n";

// A child process as spawn gives it with stdio ["ignore", "ignore", "pipe", "pipe", "pipe"]: its standard error, the
// pipe Chrome reads commands from (3) and the one it answers on (4). `exit(code)` ends it.
function simulatedChrome() {
  const child = new EventEmitter();
  child.stderr = new PassThrough();
  child.stdio = [null, null, child.stderr, new PassThrough(), new PassThrough()];
  child.killed = 0;
  child.kill = () => { child.killed += 1; };
  child.exit = (code) => child.emit("exit", code);
  return child;
}

// Lets the stream deliver what was written.
const delivered = () => new Promise((resolve) => setImmediate(resolve));

test("the pipe keeps exactly the last STARTUP_LOG_CHARACTERS characters of standard error, written in many parts", async () => {
  const child = simulatedChrome();
  const pipe = new ChromePipeConnection(child);
  const filler = Array.from({ length: 40 }, (_, index) => `[startup ${index}] ${"x".repeat(900)}\n`).join("");
  assert.ok(filler.length > 2 * STARTUP_LOG_CHARACTERS);
  for (let start = 0; start < filler.length; start += 1777) child.stderr.write(filler.slice(start, start + 1777));
  child.stderr.write(EVIDENCE);
  await delivered();
  const written = filler + EVIDENCE;
  assert.equal(pipe.stderr.length, STARTUP_LOG_CHARACTERS);
  assert.equal(pipe.stderr, written.slice(-STARTUP_LOG_CHARACTERS));
  assert.ok(pipe.stderr.endsWith(EVIDENCE));
});

test("GPU evidence written last before the exit reaches startThroughHandshake through the pipe, and is judged a refused start", async () => {
  const child = simulatedChrome();
  const pipe = new ChromePipeConnection(child);
  const launched = {
    exited: pipe.exited,
    handshake: () => pipe.send("Target.setDiscoverTargets", { discover: true }),
    stop: () => pipe.kill(),
    log: () => pipe.stderr
  };
  const start = startThroughHandshake(async () => launched, [], "standard", { exitWaitMs: 1 });
  child.stderr.write("y".repeat(STARTUP_LOG_CHARACTERS + 5000));
  child.stderr.write(EVIDENCE);
  await delivered();
  child.exit(2147483651);
  const error = await start.then(() => null, (failure) => failure);
  assert.equal(error?.exitCode, 2147483651);
  assert.equal(error.startupLog.length, STARTUP_LOG_CHARACTERS);
  assert.ok(error.startupLog.endsWith(EVIDENCE));
  assert.equal(isGpuStartRefused(error.exitCode, error.startupLog), true);
});
