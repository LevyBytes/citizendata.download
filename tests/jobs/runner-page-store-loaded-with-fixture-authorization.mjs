import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadClassicScripts } from "../extension/load-classic-script.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const context = await loadClassicScripts([
  path.join(root, "extension", "shared", "request-pacing-settings.js"),
  path.join(root, "extension", "shared", "pace-controller.js"),
  path.join(root, "extension", "shared", "pace-history.js"),
  path.join(root, "extension", "shared", "authorization.js"),
  path.join(root, "extension", "storage", "database.js"),
  path.join(root, "extension", "jobs", "runner.js")
], { crypto: globalThis.crypto, TextEncoder, Uint8Array });
export const databaseApi = context.CitizenDataDatabase;
export const runnerApi = context.CitizenDataRunner;
// Today's schedule, for the tests that assert it: a job that starts at the fastest baseline (§15.3).
export const atBaseline = (job) => ({ ...job, pace: context.CitizenDataPaceController.atBaseline(context.CITIZENDATA_REQUEST_PACING) });
export const plain = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
export const sha256 = (text) => createHash("sha256").update(text).digest("hex");
export const RUN_ID = "33333333-3333-4333-8333-333333333333";
export const AUTHORIZATION_ID = "22222222-2222-4222-8222-222222222222";

export function authorizationRecord(clock) {
  return {
    policyVersion: 1,
    authorizationId: AUTHORIZATION_ID,
    runId: RUN_ID,
    accountId: "account-1",
    localAccountId: "11111111-1111-4111-8111-111111111111",
    dashboardOrigin: "https://citizendata.download",
    dashboardPath: "/",
    dashboardTabId: 1,
    bridgeSessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    selectedSections: ["pledges"],
    maximumRecordsBySection: { pledges: 500 },
    minimumInterRequestDelayMs: 900,
    parserVersions: { pledges: "1" },
    planHash: "a".repeat(64),
    extensionVersion: "0.1.0",
    oneRunOnly: true,
    issuedAt: new Date(clock).toISOString(),
    expiresAt: new Date(clock + 3_600_000).toISOString(),
    idleTtlMs: 600_000,
    lastActivityAt: new Date(clock).toISOString(),
    idleExpiresAt: new Date(clock + 600_000).toISOString(),
    consumedAt: null,
    revokedAt: null
  };
}

export function outcome(status, records, pages) {
  const timestamp = "2026-11-17T12:00:00.000Z";
  return { status, parserVersion: "1", startedAt: timestamp, endedAt: timestamp, records, pagesOrBatches: pages, warnings: [] };
}
