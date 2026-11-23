// The dashboard checks' Chrome start (devtoolsstarthandshake.mjs) against a stand-in DevTools endpoint: it reaches a
// page that answers; a page that never answers, as one without a renderer, fails the start within the budget with the
// browser's process types; a failed start stops its process and removes the run's profile folder; a failure after the
// start is never retried as one. The GPU retry case is in devtoolsstartgpuretry.test.mjs.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { diagnoseDevTools } from "./devtoolsdiagnosis.mjs";
import { devtoolsHandshake, startDashboardChrome } from "./devtoolsstarthandshake.mjs";
import { devtoolsStandIn } from "./devtoolsstandin.mjs";

const work = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", `work-temp-start-handshake-${process.pid}`);
const BUDGET_MS = 400;
// Idle processes standing for Chrome; each is ended after the tests, whatever their outcome.
const children = [];
const silent = (seconds) => {
  const child = spawn(process.execPath, ["-e", `setTimeout(() => {}, ${seconds * 1000})`], { stdio: "ignore", windowsHide: true });
  children.push(child);
  return child;
};

// A profile folder with its port file pointing at `standIn`, as Chrome leaves it once its DevTools server listens.
function profileFor(name, standIn) {
  const folder = path.join(work, name);
  mkdirSync(path.join(folder, "launch1"), { recursive: true });
  standIn.writePortFile(path.join(folder, "launch1", "DevToolsActivePort"));
  return folder;
}

// A launch of a real, idle process standing for Chrome, whose DevTools are `standIn`.
function launchWith(standIn, folder, child, launched) {
  return async () => {
    launched.push(child.pid);
    const exited = new Promise((resolve) => child.once("exit", (code, signal) => resolve(code ?? signal)));
    const activePortFile = path.join(folder, "launch1", "DevToolsActivePort");
    return { exited, handshake: () => devtoolsHandshake({ activePortFile, startupMs: BUDGET_MS }), stop: async () => { child.kill(); await exited; }, log: () => "", diagnose: () => diagnoseDevTools(standIn.port, BUDGET_MS) };
  };
}

test.after(() => {
  for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill();
  rmSync(work, { recursive: true, force: true });
});

test("the start reaches a page that answers, and its socket answers the next command", { timeout: 5000 }, async () => {
  const standIn = await devtoolsStandIn();
  const { socket } = await devtoolsHandshake({ activePortFile: path.join(profileFor("answers", standIn), "launch1", "DevToolsActivePort"), startupMs: BUDGET_MS });
  const answer = await new Promise((resolve) => {
    socket.addEventListener("message", (event) => resolve(JSON.parse(event.data)));
    socket.send(JSON.stringify({ id: 1, method: "Page.enable" }));
  });
  socket.close();
  await standIn.close();
  assert.deepEqual([answer.id, standIn.received], [1, [["page", "Runtime.evaluate"], ["page", "Page.enable"]]]);
});

test("a page that never answers fails the start within the budget, and the browser tells it has no renderer", { timeout: 5000 }, async () => {
  const standIn = await devtoolsStandIn({ pageAnswers: false, processTypes: ["browser", "network.mojom.NetworkService"] });
  const startedAt = Date.now();
  const activePortFile = path.join(profileFor("silent", standIn), "launch1", "DevToolsActivePort");
  await assert.rejects(devtoolsHandshake({ activePortFile, startupMs: BUDGET_MS }), /Chrome gave no answer to the page's first command \(Runtime\.evaluate\) within 0\.4 seconds/u);
  assert.ok(Date.now() - startedAt < BUDGET_MS * 3, `${Date.now() - startedAt} ms`);
  const told = await diagnoseDevTools(standIn.port, BUDGET_MS);
  await standIn.close();
  assert.deepEqual(told, { browser: "StandIn/1.0", targets: ["page about:blank"], processes: ["browser", "network.mojom.NetworkService"] });
});

test("a failed start stops its process, removes the run's profile folder, is not retried, and says why", { timeout: 8000 }, async () => {
  const standIn = await devtoolsStandIn({ pageAnswers: false, processTypes: ["browser"] });
  const folder = profileFor("failed", standIn);
  const child = silent(60);
  const launched = [];
  const error = await startDashboardChrome({ launch: launchWith(standIn, folder, child, launched), profileDirectory: folder }).then(() => null, (failure) => failure);
  await standIn.close();
  assert.match(error?.message ?? "", /Runtime\.evaluate[\s\S]*Still running, the browser told: .*"processes":\["browser"\]/u);
  assert.deepEqual([launched.length, child.exitCode !== null || child.signalCode !== null, existsSync(folder)], [1, true, false]);
});

test("a failure after the start is the caller's and is never retried as a start", { timeout: 5000 }, async () => {
  const standIn = await devtoolsStandIn();
  const folder = profileFor("assertion", standIn);
  const child = silent(60);
  const launched = [];
  const run = async () => {
    const { socket } = await startDashboardChrome({ launch: launchWith(standIn, folder, child, launched), profileDirectory: folder });
    socket.close();
    assert.equal("shown", "expected", "an assertion of the checks");
  };
  await assert.rejects(run, assert.AssertionError);
  child.kill();
  await standIn.close();
  assert.deepEqual([launched.length, existsSync(folder)], [1, true], "one launch; the run removes its folder at its end");
});
