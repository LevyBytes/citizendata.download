import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const repositoryRoot = new URL("../../", import.meta.url);
const installUrl = "https://github.com/LevyBytes/citizendata.download/tree/main/extension";
const approvalDetail = "Google Chrome Extension Marketplace approval pending, submitted 11/22/2026. Use the GitHub-hosted extension in developer mode for now.";

test("the pending store approval card links to the developer-mode extension source", async () => {
  const [html, dashboard] = await Promise.all([
    readFile(new URL("docs/index.html", repositoryRoot), "utf8"),
    readFile(new URL("docs/scripts/dashboard.js", repositoryRoot), "utf8")
  ]);

  assert.match(html, new RegExp(`href="${installUrl}"`, "u"));
  assert.ok(html.includes("Get the Star Citizen Data Downloader extension."));
  assert.ok(html.includes(approvalDetail));
  assert.ok(dashboard.includes(`const EXTENSION_INSTALL_URL = "${installUrl}";`));
  assert.ok(dashboard.includes("Get the Star Citizen Data Downloader extension."));
  assert.ok(dashboard.includes("Update the Star Citizen Data Downloader extension."));
  assert.equal(dashboard.split(approvalDetail).length - 1, 2);
  assert.ok(!html.includes("https://chromewebstore.google.com/"));
  assert.ok(!dashboard.includes("https://chromewebstore.google.com/"));
});
