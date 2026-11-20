import assert from "node:assert/strict";
import { cp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { repositoryRoot, scratch } from "./options-and-run-folders.mjs";

// The extension under test is a copy of extension/ that differs in one thing: it does not wait between its steps.
// That wait is the pace the extension keeps toward RSI, and here every answer comes from this machine. The copy keeps
// the shipped pace only while PACE_KEY is set in its storage, for the one scenario that is about real time.
export const PACE_KEY = "citizendata.test.shippedPace";
export const extensionUnderTest = path.join(scratch, "extension");
await cp(path.join(repositoryRoot, "extension"), extensionUnderTest, { recursive: true });
{
  const runnerPath = path.join(extensionUnderTest, "jobs", "runner.js");
  let source = await readFile(runnerPath, "utf8");
  for (const [shipped, unpaced] of [
    ["const delay = job.plan.minimumInterRequestDelayMs;", `const delay = (await chrome.storage.local.get(${JSON.stringify(PACE_KEY)}))[${JSON.stringify(PACE_KEY)}] === true ? job.plan.minimumInterRequestDelayMs : 0;`],
    ["Math.max(nowMs() + 250, stepStartedAtMs + laneIntervalMs)", "Math.max(nowMs() + (delay > 0 ? 250 : 0), stepStartedAtMs + laneIntervalMs)"]
  ]) {
    assert.equal(source.split(shipped).length, 2, `The extension no longer writes its pace as this check expects: ${shipped}`);
    source = source.replace(shipped, unpaced);
  }
  await writeFile(runnerPath, source);
}
