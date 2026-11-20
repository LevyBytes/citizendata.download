import assert from "node:assert/strict";
import { createExtensionHarness } from "../../../support/extension-harness.mjs";
import { POLL_MS, pause } from "./polling-intervals.mjs";
import { assertStep } from "./scenario-runner.mjs";

// The parts of a backup that do not depend on when or under which run it was made.
function timeless(document) {
  const strip = (value) => {
    if (Array.isArray(value)) return value.map(strip);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value).filter(([key]) => !/At$/u.test(key) && !["runs", "integrity", "localAccountId", "checkpoints"].includes(key)).map(([key, entry]) => [key, strip(entry)]));
  };
  return strip(document);
}

// The unit tests run the extension under Node with a small stand-in DOM. This runs the same synthetic account through
// that harness and requires the same backup Chrome produced, so the stand-in cannot drift from the real browser unnoticed.
export async function assertHarnessParity(chromeDocument, accountOptions) {
  const harness = await createExtensionHarness({ account: accountOptions });
  const tab = harness.openTab();
  await tab.build();
  await harness.finishJob();
  const nodeDocument = tab.events.find((event) => event.result)?.result;
  assertStep(nodeDocument, "The Node harness did not produce a backup for the parity comparison.");
  assert.deepEqual(timeless(nodeDocument), timeless(chromeDocument), "The Node test harness and Chrome produced different backups from the same synthetic account.");
}

export function longestGap(requests) {
  let longest = 0;
  for (let index = 1; index < requests.length; index += 1) longest = Math.max(longest, requests[index].at - requests[index - 1].at);
  return longest;
}

export async function waitForRequests(account, count, timeoutMs, description) {
  const deadline = Date.now() + timeoutMs;
  while (account.requests.length < count) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${description}; saw ${account.requests.length} of ${count} RSI requests.`);
    await pause(POLL_MS);
  }
}
