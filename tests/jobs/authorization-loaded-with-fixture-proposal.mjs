import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadClassicScript } from "../extension/load-classic-script.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const { api: authorization } = await loadClassicScript(path.join(root, "extension", "shared", "authorization.js"), "CitizenDataAuthorization");
const plan = {
  selectedSections: ["profile"],
  maximumRecordsBySection: { profile: 1 },
  minimumInterRequestDelayMs: 2500
};
const identifiers = {
  authorizationId: "11111111-1111-4111-8111-111111111111",
  runId: "22222222-2222-4222-8222-222222222222",
  localAccountId: "33333333-3333-4333-8333-333333333333"
};

export function proposal(nowMs = 1000) {
  return authorization.createProposal({
    proposalId: "44444444-4444-4444-8444-444444444444",
    plan,
    dashboardOrigin: "https://citizendata.download",
    dashboardPath: "/",
    dashboardTabId: 3,
    bridgeSessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    parserVersions: { profile: "1" },
    nowMs,
    ttlMs: 10_000
  });
}

export function acceptedInput(overrides = {}) {
  return {
    ...identifiers,
    nowMs: 2000,
    permissionGranted: true,
    accountId: "account-1",
    planHash: "a".repeat(64),
    extensionVersion: "0.1.0",
    ...overrides
  };
}
