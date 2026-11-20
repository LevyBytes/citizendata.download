import assert from "node:assert/strict";
import test from "node:test";
import { createExtensionHarness } from "../support/extension-harness.mjs";
import { resultOf } from "./service-worker-fixture-running-build-requests-and-kept-records.mjs";

test("organization rosters are a separate run for chosen organizations at their own slower pacing", async () => {
  const harness = await createExtensionHarness();
  const tab = harness.openTab();
  await tab.build();
  await harness.finishJob();
  await tab.request("ACKNOWLEDGE_RESULT", { runId: harness.state().lastCompletedRunId });
  tab.reload();

  for (const payload of [{ organizationSids: [] }, { organizationSids: ["synth"] }, { organizationSids: ["SYNTH", "SYNTH"] }, { organizationSids: ["SYNTH"], route: "/api/orgs/other" }, { organizationSid: "SYNTH" }]) {
    assert.equal((await tab.request("PROPOSE_ORGANIZATION_ROSTER", payload)).ok, false, JSON.stringify(payload));
  }
  const before = harness.rsi.requests.length;
  const startedAt = harness.clock.now;
  const started = await tab.request("PROPOSE_ORGANIZATION_ROSTER", { organizationSids: ["SYNTH"] });
  assert.equal(started.code, "RUN_STARTED", started.message);
  assert.deepEqual(started.organizationSids, ["SYNTH"]);
  assert.equal(started.status.activeJob.jobKind, "organizationData");
  const finished = await harness.finishJob();
  assert.equal(finished.status, "complete");
  assert.equal(finished.pendingResult.jobKind, "organizationData");
  const requests = harness.rsi.requests.slice(before);
  assert.deepEqual(requests.map((request) => request.path), ["/api/spectrum/auth/identify", "/api/orgs/getOrgMembers", "/api/orgs/getOrgMembers", "/api/orgs/getOrgMembers"]);
  // Three pages at no less than ten seconds apart.
  assert.ok(requests[2].at - requests[1].at >= 10000 && requests[3].at - requests[2].at >= 10000);
  assert.ok(harness.clock.now - startedAt >= 20000);
  const document = resultOf(tab);
  const roster = document.organizations.members.filter((member) => member.organizationSid === "SYNTH");
  assert.equal(roster.length, harness.rsi.state.members.length);
  // Members who hide their membership are counted without any identity.
  const restricted = roster.filter((member) => member.visibility === "restricted");
  assert.equal(restricted.length, harness.rsi.state.members.filter((member) => member.restricted).length);
  assert.ok(restricted.every((member) => member.handle === null && member.displayName === null));
  assert.equal(document.pledges.length, harness.rsi.state.pledges.length, "the saved account data is kept alongside the roster");
});
