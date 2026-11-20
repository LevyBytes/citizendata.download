import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
export const repositoryRoot = path.resolve(testDirectory, "..", "..");
export const docsRoot = path.join(repositoryRoot, "docs");

await import(pathToFileURL(path.join(docsRoot, "scripts", "safe-json.js")));
await import(pathToFileURL(path.join(docsRoot, "scripts", "account-document.js")));
await import(pathToFileURL(path.join(docsRoot, "scripts", "dashboard-model.js")));
await import(pathToFileURL(path.join(docsRoot, "scripts", "demo-profile-avatars.js")));
await import(pathToFileURL(path.join(docsRoot, "scripts", "demo-data.js")));
await import(pathToFileURL(path.join(repositoryRoot, "extension", "jobs", "plan-validation.js")));

export const SafeJson = globalThis.CitizenDataSafeJson;
export const Model = globalThis.CitizenDataDashboardModel;
export const PlanValidation = globalThis.CitizenDataPlanValidation;
