import assert from "node:assert/strict";
import { createExtensionHarness } from "../support/extension-harness.mjs";

// A build that stops in Buybacks: RSI signs the session out (a 410 would set Buybacks aside, §10.1). The public-status
// and partial-result tests start from its stored, failed job.
export async function failedBuild() {
  const harness = await createExtensionHarness();
  const tab = harness.openTab();
  harness.rsi.failNext((request) => request.path === "/api/account/buybackPledges", { status: 401 });
  await tab.build();
  assert.equal((await harness.finishJob()).status, "failed");
  const job = await harness.repository.getJob(harness.state().lastTerminalJobId);
  return { harness, tab, job };
}
