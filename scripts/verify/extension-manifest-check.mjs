import { readFile } from "node:fs/promises";
import path from "node:path";
import { fail, repositoryRoot } from "./repository-root-and-failure.mjs";

const forbiddenExtensionPermissions = new Set([
  "debugger",
  "declarativeNetRequest",
  "declarativeNetRequestWithHostAccess",
  "management",
  "nativeMessaging",
  "proxy",
  "webRequest",
  "webRequestBlocking"
]);

export async function checkExtensionManifest() {
  const manifest = JSON.parse(await readFile(path.join(repositoryRoot, "extension", "manifest.json"), "utf8"));
  if (manifest.manifest_version !== 3) fail("The extension must use Manifest V3.");
  const requiredExtensionPermissions = ["alarms", "cookies", "offscreen", "storage", "unlimitedStorage"];
  if (JSON.stringify(manifest.permissions ?? []) !== JSON.stringify(requiredExtensionPermissions)) {
    fail(`Extension permissions must exactly match: ${requiredExtensionPermissions.join(", ")}`);
  }
  for (const permission of [...(manifest.permissions ?? []), ...(manifest.optional_permissions ?? [])]) {
    if (forbiddenExtensionPermissions.has(permission)) fail(`Forbidden extension permission: ${permission}`);
  }
  if (Object.hasOwn(manifest, "externally_connectable")) fail("externally_connectable is outside the approved bridge design.");
  const requiredHosts = manifest.host_permissions ?? [];
  if (requiredHosts.length !== 1 || requiredHosts[0] !== "https://robertsspaceindustries.com/*") fail("The only required host permission must be the exact RSI HTTPS host.");
  if ((manifest.optional_host_permissions ?? []).length !== 0) fail("CitizenData must not carry additional optional host permissions.");
}
