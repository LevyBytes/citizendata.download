import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const checkOnly = process.argv.slice(2).includes("--check");

const accountSource = path.join(repositoryRoot, "schema", "account-export.schema.json");
const offlineSource = path.join(repositoryRoot, "schema", "offline-package.schema.json");
const accountDocumentSource = path.join(repositoryRoot, "shared", "account-document.js");
const organizationDocumentSource = path.join(repositoryRoot, "shared", "organization-document.js");
// The shared pacing files that exist; pace-controller.js and pace-history.js join request-pacing-settings.js.
const SHARED_PACING_FILES = ["request-pacing-settings.js", "pace-controller.js", "pace-history.js"].filter((name) => existsSync(path.join(repositoryRoot, "shared", name)));

function schemaScript(schema, globalName) {
  const json = JSON.stringify(schema, null, 2)
    .replaceAll("<", "\\u003c")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
  return `globalThis.${globalName} = ${json};\n`;
}

async function readRequiredJson(filePath) {
  const bytes = await readFile(filePath);
  const text = bytes.toString("utf8");
  return { bytes, value: JSON.parse(text) };
}

async function matches(filePath, expected) {
  try {
    return Buffer.compare(await readFile(filePath), expected) === 0;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function synchronize(filePath, expected, mismatches) {
  if (await matches(filePath, expected)) return;
  if (checkOnly) {
    mismatches.push(path.relative(repositoryRoot, filePath).replaceAll(path.sep, "/"));
    return;
  }
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, expected);
  console.log(`SYNC ${path.relative(repositoryRoot, filePath)}`);
}

const account = await readRequiredJson(accountSource);
const offline = await readRequiredJson(offlineSource);
const accountDocumentBytes = await readFile(accountDocumentSource);
const organizationDocumentBytes = await readFile(organizationDocumentSource);
const mismatches = [];

for (const relativePath of [
  "extension/schema/account-export.schema.json",
  "docs/schema/account-export.schema.json"
]) {
  await synchronize(path.join(repositoryRoot, relativePath), account.bytes, mismatches);
}

for (const relativePath of [
  "extension/schema/offline-package.schema.json",
  "docs/schema/offline-package.schema.json"
]) {
  await synchronize(path.join(repositoryRoot, relativePath), offline.bytes, mismatches);
}

await synchronize(
  path.join(repositoryRoot, "docs", "schema", "account-export.schema.js"),
  Buffer.from(schemaScript(account.value, "CITIZENDATA_ACCOUNT_SCHEMA"), "utf8"),
  mismatches
);

await synchronize(
  path.join(repositoryRoot, "extension", "schema", "account-export.schema.js"),
  Buffer.from(schemaScript(account.value, "CITIZENDATA_ACCOUNT_SCHEMA"), "utf8"),
  mismatches
);

await synchronize(
  path.join(repositoryRoot, "docs", "schema", "offline-package.schema.js"),
  Buffer.from(schemaScript(offline.value, "CITIZENDATA_OFFLINE_SCHEMA"), "utf8"),
  mismatches
);

await synchronize(
  path.join(repositoryRoot, "extension", "schema", "offline-package.schema.js"),
  Buffer.from(schemaScript(offline.value, "CITIZENDATA_OFFLINE_SCHEMA"), "utf8"),
  mismatches
);

for (const relativePath of [
  "extension/shared/account-document.js",
  "docs/scripts/account-document.js"
]) {
  await synchronize(path.join(repositoryRoot, relativePath), accountDocumentBytes, mismatches);
}

for (const relativePath of [
  "extension/shared/organization-document.js",
  "docs/scripts/organization-document.js"
]) {
  await synchronize(path.join(repositoryRoot, relativePath), organizationDocumentBytes, mismatches);
}

// The request pacing settings and the pace controller and history that read them: one source each in shared/,
// copied byte for byte to the extension and the dashboard.
for (const name of SHARED_PACING_FILES) {
  const bytes = await readFile(path.join(repositoryRoot, "shared", name));
  for (const relativePath of [`extension/shared/${name}`, `docs/scripts/${name}`]) {
    await synchronize(path.join(repositoryRoot, relativePath), bytes, mismatches);
  }
}

if (mismatches.length > 0) {
  throw new Error(`Generated schema copies are stale or missing:\n${mismatches.map((item) => `- ${item}`).join("\n")}`);
}

console.log(checkOnly ? "PASS schema copies are current" : "PASS schema copies synchronized");
