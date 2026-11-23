import { spawnSync } from "node:child_process";
import { lstat } from "node:fs/promises";
import path from "node:path";
import { fail, repositoryRoot } from "./repository-root-and-failure.mjs";

export const requiredPaths = [
  "LICENSE",
  "README.md",
  "PRIVACY.md",
  "SECURITY.md",
  "RELEASING.md",
  "THIRD_PARTY_NOTICES.md",
  "docs/.nojekyll",
  "docs/CNAME",
  "docs/index.html",
  "manifests/chrome.json",
  "manifests/firefox.json",
  "platform/chromium/service-worker.js",
  "platform/chromium/offscreen/parser.html",
  "platform/chromium/offscreen/parser.js",
  "platform/firefox/README.md",
  "schema/account-export.schema.json",
  "schema/offline-package.schema.json"
];

export async function checkRequiredFilesAndSchemaCopies() {
  for (const relativePath of requiredPaths) {
    const absolute = path.join(repositoryRoot, relativePath);
    try {
      if (!(await lstat(absolute)).isFile()) fail(`Required path is not a file: ${relativePath}`);
    } catch (error) {
      if (error?.code === "ENOENT") fail(`Required file is missing: ${relativePath}`);
      throw error;
    }
  }

  const schemaCheck = spawnSync(process.execPath, ["scripts/sync-schemas.mjs", "--check"], {
    cwd: repositoryRoot,
    encoding: "utf8"
  });
  if (schemaCheck.status !== 0) fail(schemaCheck.stderr || schemaCheck.stdout || "Schema copy check failed.");
  process.stdout.write(schemaCheck.stdout);
}
