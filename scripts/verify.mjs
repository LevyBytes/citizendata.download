import { checkExtensionManifest } from "./verify/extension-manifest-check.mjs";
import { checkDashboardContract, checkLicense } from "./verify/license-and-dashboard-contract-check.mjs";
import { checkPublicSourceFiles } from "./verify/public-source-files-check.mjs";
import { checkRequiredFilesAndSchemaCopies, requiredPaths } from "./verify/required-files-and-schema-copies-check.mjs";

await checkRequiredFilesAndSchemaCopies();
const fileCount = await checkPublicSourceFiles();
await checkExtensionManifest();
await checkLicense();
await checkDashboardContract();

console.log(`PASS required files: ${requiredPaths.length}`);
console.log(`PASS LF-only, BOM-less public source files: ${fileCount}`);
console.log("PASS public source contains no known private demo identifiers");
console.log("PASS Manifest V3 least-privilege permission contract");
console.log("PASS dashboard CSP and local Load/Build control contract");
