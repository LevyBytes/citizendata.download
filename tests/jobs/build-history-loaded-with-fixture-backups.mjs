await import("../../docs/scripts/account-document.js");
await import("../../extension/storage/build-history.js");
await import("../../docs/scripts/file-timestamp.js");
await import("../../docs/scripts/canonical-download.js");

export const History = globalThis.CitizenDataBuildHistory;
export const ON = { enabled: true, keep: 5 };

// A small backup shaped like a real one: account data, plus the fields that record the run and each reading.
export function backup(exportedAt, change = {}) {
  return {
    schemaVersion: "1.0.0",
    generator: { name: "CitizenData", version: "test" },
    exportedAt,
    account: { localAccountId: "local-1", ueeCitizenRecord: 4242, handle: "Synthetic Citizen" },
    pledges: [
      {
        pledgeId: 1, recordKey: "pledge:1", title: "Package - Example", state: "current",
        sourceLinks: [{ kind: "listing", url: "https://robertsspaceindustries.com/account/pledges?page=1", observedAt: exportedAt }],
        observation: { firstObservedAt: exportedAt, lastObservedAt: exportedAt, parserVersion: "1.1.0" }
      },
      ...(change.pledges ?? [])
    ],
    buybacks: [],
    buybackDetails: [{ buybackId: 7, price: { amount: "17.00", currency: "USD" }, capturedAt: exportedAt }],
    financial: { balances: { storeCredit: { amount: change.storeCredit ?? "25.00", unit: "USD", observedAt: exportedAt } } },
    dataQuality: { anomalies: [] },
    sync: { runs: [{ runId: `run-${exportedAt}` }], removalTracking: { comparedAt: exportedAt } },
    integrity: { algorithm: "SHA-256", contentHash: exportedAt.replace(/\D/gu, "").padEnd(64, "0") }
  };
}

export const FIRST = "2026-11-01T12:00:00.000Z";
export const SECOND = "2026-11-02T12:00:00.000Z";
export const THIRD = "2026-11-03T12:00:00.000Z";
export const extraPledge = { pledgeId: 2, recordKey: "pledge:2", title: "Add-Ons - Example", state: "current" };

// An Organization JSON as the dashboard saves it, reduced to what the history reads.
export function organizations(exportedAt, members = ["a", "b"], updatedAt = exportedAt) {
  return {
    schemaVersion: 1, documentType: "CitizenDataOrganizations", generator: { name: "CitizenData", version: "0.42.2" }, exportedAt,
    account: { localAccountId: "11111111-1111-4111-8111-111111111111", handle: "Example Citizen" },
    memberships: [{ sid: "TEST" }, { sid: "MMHC" }],
    rosterIndex: [{ organizationSid: "TEST", memberStart: 0, memberCount: members.length, status: "complete", updatedAt }, { organizationSid: "MMHC", memberStart: members.length, memberCount: 0, status: "notDownloaded", updatedAt: null }],
    members: members.map((key) => ({ recordKey: key, organizationSid: "TEST", observation: { lastObservedAt: exportedAt } })),
    sync: { runs: [] }, integrity: { algorithm: "SHA-256", contentHash: "0".repeat(64) }
  };
}
