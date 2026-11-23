import assert from "node:assert/strict";
import test from "node:test";

await import("../../extension/shared/request-pacing-settings.js");
await import("../../extension/jobs/plan-validation.js");
await import("../../extension/adapters/catalog.js");
await import("../../extension/adapters/live-runtime.js");
await import("../../extension/adapters/registry.js");
await import("../../extension/jobs/organization-roster-proposal.js");

const Proposal = globalThis.CitizenDataOrganizationRosterProposal;
const Registry = globalThis.CitizenDataAdapterRegistry;

test("organization roster proposal derives all request authority from a bounded SID checklist", () => {
  const result = Proposal.build({ organizationSids: ["TEST", "MMHC"] }, Registry);
  assert.equal(result.ok, true);
  assert.deepEqual(result.value.organizationSids, ["TEST", "MMHC"]);
  assert.deepEqual(result.value.plan.selectedSections, ["organizations.members.TEST", "organizations.members.MMHC"]);
  assert.deepEqual(result.value.plan.maximumRecordsBySection, { "organizations.members.TEST": 50000, "organizations.members.MMHC": 50000 });
  assert.equal(result.value.plan.minimumInterRequestDelayMs, 10000);
  assert.equal(result.value.route, "/api/orgs/getOrgMembers");
  assert.deepEqual(result.value.parserVersions, { "organizations.members.TEST": "0.42.2", "organizations.members.MMHC": "0.42.2" });
});

test("organization roster proposal rejects caller route, cap, selector, and malformed SID authority", () => {
  for (const payload of [
    { organizationSids: ["TEST"], url: "https://example.com" },
    { organizationSids: ["TEST"], maximumRecords: 1 },
    { organizationSids: ["TEST"], selector: "*" },
    { organizationSids: ["test"] },
    { organizationSids: ["../TEST"] },
    { organizationSids: ["TEST", "TEST"] },
    { organizationSids: [] },
    null
  ]) assert.equal(Proposal.build(payload, Registry).ok, false);
});
