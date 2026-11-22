// The canonical Account Data section order (PARSER_HARDENING.md §4.8), and the extension and dashboard scripts
// that plan and check it, shared by the order and continuation tests.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadClassicScripts } from "./load-classic-script.mjs";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export const extension = await loadClassicScripts([
  path.join(root, "extension", "shared", "request-pacing-settings.js"),
  path.join(root, "extension", "jobs", "plan-validation.js"),
  path.join(root, "extension", "jobs", "continuation-refresh.js")
]);

export const Plans = extension.CitizenDataPlanValidation;

export const ORDER = [...extension.CITIZENDATA_REQUEST_PACING.accountBuild.sectionOrder];

export const HANGAR_LOG_PATH = "/api/account/pledgeLog";

export function planFor(sections, floorMs = Plans.MINIMUM_DELAY_MS) {
  return { selectedSections: sections, maximumRecordsBySection: Object.fromEntries(sections.map((section) => [section, 10])), minimumInterRequestDelayMs: floorMs };
}
