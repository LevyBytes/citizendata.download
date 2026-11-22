import assert from "node:assert/strict";
import { cp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { repositoryRoot, scratch } from "./options-and-run-folders.mjs";

// The extension under test is a copy of extension/ that differs in two things. It does not wait between its steps:
// that wait is the pace the extension keeps toward RSI, and here every answer comes from this machine. The copy keeps
// the shipped pace only while PACE_KEY is set in its storage, for the one scenario that is about real time. And it
// holds RSI's status host as granted (below).
export const PACE_KEY = "citizendata.test.shippedPace";
export const extensionUnderTest = path.join(scratch, "extension");
await cp(path.join(repositoryRoot, "extension"), extensionUnderTest, { recursive: true });
{
  const runnerPath = path.join(extensionUnderTest, "jobs", "runner.js");
  let source = await readFile(runnerPath, "utf8");
  for (const [shipped, unpaced] of [
    ["const laneIntervalMs = PaceController.stepIntervalMs({ baseline, planFloorMs: job.plan.minimumInterRequestDelayMs, pace: job.pace, settings: PACING, random });",
      `const laneIntervalMs = (await ` +
      `chrome.storage.local.get(${JSON.stringify(PACE_KEY)}))[${JSON.stringify(PACE_KEY)}] === true ? PaceController.stepIntervalMs({ baseline, planFloorMs: job.plan.minimumInterRequestDelayMs, pace: job.pace, settings: PACING, random }) : 0;`],
    ["Math.max(nowMs() + 250, logicalStartedAtMs + logicalIntervalMs)", "Math.max(nowMs() + (laneIntervalMs > 0 ? 250 : 0), logicalStartedAtMs + logicalIntervalMs)"]
  ]) {
    assert.equal(source.split(shipped).length, 2, `The extension no longer writes its pace as this check expects: ${shipped}`);
    source = source.replace(shipped, unpaced);
  }
  await writeFile(runnerPath, source);
}
// The copy also holds RSI's status host as granted. The shipped extension asks for it as an optional permission when
// the user allows the status check (§9.3); a test cannot click Chrome's prompt.
{
  const manifestPath = path.join(extensionUnderTest, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const statusHost = "https://status.robertsspaceindustries.com/*";
  assert.deepEqual(manifest.optional_host_permissions, [statusHost], "The extension no longer asks for the status host as this check expects.");
  manifest.host_permissions = [...manifest.host_permissions, statusHost];
  delete manifest.optional_host_permissions;
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}
`);
}
