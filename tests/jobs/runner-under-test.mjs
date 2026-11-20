import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadClassicScripts } from "../extension/load-classic-script.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
await import("../../docs/scripts/account-document.js");
await import("../../docs/schema/account-export.schema.js");
await import("../../extension/adapters/update-delta.js");
await import("../../extension/adapters/removal-tracking.js");
await import("../../extension/adapters/document-assembler.js");
const context = await loadClassicScripts([
  path.join(root, "extension", "shared", "authorization.js"),
  path.join(root, "extension", "storage", "database.js"),
  path.join(root, "extension", "jobs", "runner.js")
]);
export const authorizationApi = context.CitizenDataAuthorization;
export const databaseApi = context.CitizenDataDatabase;
export const runnerApi = context.CitizenDataRunner;
export const assemblerApi = globalThis.CitizenDataDocumentAssembler;
export const accountDocumentApi = globalThis.CitizenDataAccountDocument;
export const localAccountId = "11111111-1111-4111-8111-111111111111";

export function sectionOutcome(status = "complete", records = 1) {
  const timestamp = "2026-11-17T12:00:00.000Z";
  return { status, parserVersion: "1.0.0", startedAt: timestamp, endedAt: timestamp, records, pagesOrBatches: 1, warnings: status === "partial" ? ["Page failed"] : [] };
}
