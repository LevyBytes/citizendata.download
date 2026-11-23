import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const repositoryRoot = new URL("../../", import.meta.url);
const installUrl = "https://chromewebstore.google.com/detail/citizen-data-downloader/ehklbfcpnadaeodflibpihhgimmmhjpd";
const staticDetail = "Available from the Chrome Web Store.";
const installDetail = "Install from the Chrome Web Store.";
const updateDetail = "Update from the Chrome Web Store.";

test("the approved store card links to the canonical Chrome Web Store listing", async () => {
  const [html, dashboard, readme] = await Promise.all([
    readFile(new URL("docs/index.html", repositoryRoot), "utf8"),
    readFile(new URL("docs/scripts/dashboard.js", repositoryRoot), "utf8"),
    readFile(new URL("README.md", repositoryRoot), "utf8")
  ]);

  assert.match(html, new RegExp(`href="${installUrl}"`, "u"));
  assert.ok(html.includes("Get the Star Citizen Data Downloader extension."));
  assert.ok(html.includes(staticDetail));
  assert.ok(html.includes(`"installUrl": "${installUrl}"`));
  assert.ok(html.includes(`"${installUrl}"`));
  assert.ok(dashboard.includes(`const EXTENSION_INSTALL_URL = "${installUrl}";`));
  assert.ok(dashboard.includes("Get the Star Citizen Data Downloader extension."));
  assert.ok(dashboard.includes("Update the Star Citizen Data Downloader extension."));
  assert.equal(dashboard.split(installDetail).length - 1, 1);
  assert.equal(dashboard.split(updateDetail).length - 1, 1);
  assert.ok(readme.includes(`](${installUrl})`));
  assert.ok(!html.includes("approval pending"));
  assert.ok(!dashboard.includes("approval pending"));
});
