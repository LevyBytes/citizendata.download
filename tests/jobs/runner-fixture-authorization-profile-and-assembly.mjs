import { assemblerApi, authorizationApi, localAccountId, sectionOutcome } from "./runner-under-test.mjs";

export function authorizationRecord(clock, overrides = {}) {
  const idleTtlMs = 30_000;
  return {
    policyVersion: 1,
    authorizationId: "22222222-2222-4222-8222-222222222222",
    runId: "33333333-3333-4333-8333-333333333333",
    accountId: "account-1",
    localAccountId,
    dashboardOrigin: "https://citizendata.download",
    dashboardPath: "/",
    dashboardTabId: 1,
    bridgeSessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    selectedSections: ["profile"],
    maximumRecordsBySection: { profile: 1 },
    minimumInterRequestDelayMs: 2500,
    parserVersions: { profile: "1" },
    planHash: "a".repeat(64),
    extensionVersion: "0.1.0",
    oneRunOnly: true,
    issuedAt: new Date(clock).toISOString(),
    expiresAt: new Date(clock + 60_000).toISOString(),
    idleTtlMs,
    lastActivityAt: new Date(clock).toISOString(),
    idleExpiresAt: new Date(clock + idleTtlMs).toISOString(),
    consumedAt: null,
    revokedAt: null,
    ...overrides
  };
}

export function profile(displayName = "Citizen", status = "complete") {
  const timestamp = "2026-11-17T12:00:00.000Z";
  return {
    section: "profile",
    value: {
      displayName,
      handle: "Citizen",
      displayTitle: null,
      enlistedOnRaw: null,
      location: null,
      languages: [],
      website: null,
      biography: null,
      mainOrganizationSid: null,
      organizationRank: null,
      dossierBadgeTitle: null,
      images: [],
      observation: { firstObservedAt: timestamp, lastObservedAt: timestamp, parserVersion: "1.0.0" }
    },
    outcome: sectionOutcome(status)
  };
}

export async function assembleCanonical({ job, authorization, staged, previous, completedAt }) {
  const priorRuns = (previous?.sync?.runs ?? []).filter((run) => run.runId !== job.runId);
  return assemblerApi.assemble({
    account: {
      localAccountId: previous?.account?.localAccountId ?? job.localAccountId,
      ueeCitizenRecord: previous?.account?.ueeCitizenRecord ?? null,
      handle: staged.results.find((result) => result.section === "profile")?.value?.handle ?? previous?.account?.handle ?? null
    },
    exportedAt: completedAt,
    previous,
    results: staged.results,
    checkpoints: previous?.sync?.checkpoints ?? {},
    runs: [...priorRuns, {
      runId: job.runId,
      status: "complete",
      startedAt: job.createdAt,
      endedAt: completedAt,
      selectedSections: [...job.plan.selectedSections],
      authorization: authorizationApi.runAuthorizationReceipt(authorization),
      organizationMemberAuthorization: null
    }]
  });
}
