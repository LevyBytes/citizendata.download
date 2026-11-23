// The dashboard checks' Chrome start (devtoolsstarthandshake.mjs): a parent exit counts as a refused GPU start, and is
// retried once with the software profile, only beside the log's evidence; without it the start fails with no retry and
// removes the run's profile folder.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { startDashboardChrome } from "./devtoolsstarthandshake.mjs";

const work = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", `work-temp-start-gpu-retry-${process.pid}`);
const EVIDENCE = "GPU process exited unexpectedly: exit_code=-1073741790\nGPU process isn't usable. Goodbye.\n";

test.after(() => rmSync(work, { recursive: true, force: true }));

test("a parent exit is retried with the software profile only beside the GPU evidence", { timeout: 5000 }, async () => {
  for (const [log, retried] of [[EVIDENCE, true], ["", false]]) {
    const folder = path.join(work, `gpu-${retried}`);
    mkdirSync(folder, { recursive: true });
    const profiles = [];
    const launch = async (_flags, profile) => {
      profiles.push(profile);
      if (profile === "software") return { exited: new Promise(() => {}), handshake: async () => "software page", stop: async () => {}, log: () => "" };
      return { exited: Promise.resolve(2147483651), handshake: () => new Promise(() => {}), stop: async () => {}, log: () => log };
    };
    const outcome = await startDashboardChrome({ launch, profileDirectory: folder }).then((value) => value, (error) => error.exitCode);
    assert.deepEqual([outcome, profiles, existsSync(folder)], retried ? ["software page", ["standard", "software"], true] : [2147483651, ["standard"], false]);
  }
});
