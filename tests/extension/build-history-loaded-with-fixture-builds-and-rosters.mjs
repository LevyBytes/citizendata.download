import assert from "node:assert/strict";
import { createExtensionHarness } from "../support/extension-harness.mjs";

await import("../../docs/scripts/account-document.js");
await import("../../docs/schema/account-export.schema.js");
await import("../../docs/scripts/file-timestamp.js");
await import("../../docs/scripts/canonical-download.js");
await import("../../extension/storage/build-history.js");
export const AccountDocument = globalThis.CitizenDataAccountDocument;
export const Download = globalThis.CitizenDataCanonicalDownload;
const History = globalThis.CitizenDataBuildHistory;

export const SMALL = { counts: { pledges: 12, buybacks: 24, orders: 5, storeCredit: 5, uec: 3, rec: 2, olderHangarLogRows: 5, prospects: 5, recruits: 2, legacyRecruits: 1, organizationMembers: 5 } };
export const SETTINGS_KEY = "citizendata.buildHistory.v1";
export const plain = (value) => JSON.parse(JSON.stringify(value));
const resultOf = (tab) => plain(tab.events.filter((event) => event.result).at(-1)?.result ?? null);

export async function build(harness, tab) {
  tab.reload();
  const started = await tab.build();
  assert.equal(started.code, "RUN_STARTED", started.message);
  const finished = await harness.finishJob();
  assert.equal(finished.status, "complete", JSON.stringify((await tab.status()).activeJob?.failure));
  // Builds are at least a minute apart, as the builds of a real account are.
  await harness.advanceBy(60000);
  return resultOf(tab);
}

export async function account() {
  const harness = await createExtensionHarness({ account: SMALL });
  const tab = harness.openTab();
  const first = await build(harness, tab);
  return { harness, tab, first };
}

export const history = async (harness) => plain(await harness.popup.request("GET_BUILD_HISTORY"));

// The file a kept build gives back, as text.
export async function savedFile(harness, historyId) {
  const response = plain(await harness.popup.request("GET_BUILD_HISTORY_COPY", { historyId }));
  assert.equal(response.ok, true, JSON.stringify(response));
  assert.equal(response.copy.encoding, "gzip");
  return { ...response.copy, text: Buffer.from(await History.unpack(response.copy.gzipBase64)).toString("utf8") };
}

await import("../../docs/scripts/organization-document.js");
export const Organizations = globalThis.CitizenDataOrganizationDocument;

// Collects the roster of the synthetic organization, as the dashboard asks for it after a build.
export async function collectRoster(harness, tab) {
  await tab.request("ACKNOWLEDGE_RESULT", { runId: harness.state().lastCompletedRunId });
  tab.reload();
  const started = await tab.request("PROPOSE_ORGANIZATION_ROSTER", { organizationSids: ["SYNTH"] });
  assert.equal(started.code, "RUN_STARTED", started.message);
  const finished = await harness.finishJob();
  assert.equal(finished.status, "complete", JSON.stringify((await tab.status()).activeJob?.failure));
  await harness.advanceBy(60000);
  return resultOf(tab);
}

export const keptOrganizations = (status) => status.copies.filter((copy) => copy.kind === "organizations");
export const keptBuilds = (status) => status.copies.filter((copy) => copy.kind === "build");
