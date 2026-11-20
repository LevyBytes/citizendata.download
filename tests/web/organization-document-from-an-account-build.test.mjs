import assert from "node:assert/strict";
import test from "node:test";
import { Organizations, account, member } from "./organization-document-loaded-with-fixture-account.mjs";

test("the rosters an account build carries become one organization document without an earlier one", async () => {
  const document = account();
  const endedAt = "2026-11-18T03:00:00.000Z";
  document.organizations.members = [member("TEST", "a"), member("TEST", "b")];
  document.sync.organizationMemberOutcomes = { TEST: { status: "complete", parserVersion: "1.0.0", startedAt: endedAt, endedAt, records: 2, pagesOrBatches: 1, warnings: [] } };
  document.sync.runs = [
    { runId: "account-run", selectedSections: ["profile", "pledges"] },
    { runId: "roster-run", selectedSections: ["organizations.members.TEST"] },
    { runId: "roster-run", selectedSections: ["organizations.members.TEST"] }
  ];
  const built = await Organizations.fromAccountDocument({ accountDocument: document, generatorVersion: "0.42.1" });
  await Organizations.accept(built);
  assert.deepEqual(JSON.parse(JSON.stringify(built.rosterIndex)), [
    { organizationSid: "TEST", memberStart: 0, memberCount: 2, status: "complete", updatedAt: endedAt },
    { organizationSid: "MMHC", memberStart: 2, memberCount: 0, status: "notDownloaded", updatedAt: null }
  ]);
  assert.deepEqual([built.documentType, built.generator.version, built.exportedAt, built.account.handle], ["CitizenDataOrganizations", "0.42.1", document.exportedAt, "Pilot"]);
  assert.equal(built.members.map((entry) => entry.recordKey).join(), "a,b");
  // Only the runs that collected rosters, each once.
  assert.equal(built.sync.runs.map((run) => run.runId).join(), "roster-run");
  // The same rosters as the document the dashboard merges from the same build.
  const withoutRuns = { ...document, sync: { ...document.sync, runs: [] } };
  const merged = await Organizations.merge({ accountDocument: withoutRuns, resultDocument: withoutRuns, selectedSids: ["TEST"], exportedAt: endedAt, generatorVersion: "0.42.1" });
  assert.deepEqual(JSON.parse(JSON.stringify(built.members)), JSON.parse(JSON.stringify(merged.members)));
  assert.deepEqual(JSON.parse(JSON.stringify(built.rosterIndex)), JSON.parse(JSON.stringify(merged.rosterIndex)));
});

test("a build that carries no roster gives no organization document, and an unfinished roster says so", async () => {
  const none = account();
  assert.equal(await Organizations.fromAccountDocument({ accountDocument: none }), null);
  const partial = account();
  partial.organizations.members = [member("MMHC", "c")];
  partial.sync.organizationMemberOutcomes = { MMHC: { status: "partial", parserVersion: "1.0.0", startedAt: null, endedAt: null, records: 1, pagesOrBatches: 1, warnings: [] } };
  const built = await Organizations.fromAccountDocument({ accountDocument: partial });
  assert.deepEqual(JSON.parse(JSON.stringify(built.rosterIndex)), [
    { organizationSid: "TEST", memberStart: 0, memberCount: 0, status: "notDownloaded", updatedAt: null },
    { organizationSid: "MMHC", memberStart: 0, memberCount: 1, status: "partial", updatedAt: null }
  ]);
  await assert.rejects(() => Organizations.fromAccountDocument({ accountDocument: { ...none, account: { localAccountId: "x" } } }), /account identity/u);
});
