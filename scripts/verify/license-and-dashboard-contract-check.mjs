import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fail, repositoryRoot } from "./repository-root-and-failure.mjs";

export async function checkLicense() {
  const packageDocument = JSON.parse(await readFile(path.join(repositoryRoot, "package.json"), "utf8"));
  if (packageDocument.license !== "MIT") fail("package.json must declare the selected MIT license.");
  const licenseBytes = await readFile(path.join(repositoryRoot, "LICENSE"));
  const licenseHash = createHash("sha256").update(licenseBytes).digest("hex");
  if (licenseHash !== "8554a10deefef574e410676fd6c94a9e6ab7c55fb9fd050482a5ae5e3c90f679") fail("LICENSE must exactly match the approved standard MIT text and LevyBytes repository notice.");
}

export async function checkDashboardContract() {
  const dashboard = await readFile(path.join(repositoryRoot, "docs", "index.html"), "utf8");
  if (/<script[^>]+src=["']https?:/iu.test(dashboard)) fail("The dashboard must not load remote scripts.");
  if (!dashboard.includes("connect-src 'self'")) fail("The dashboard CSP must restrict offline-source reads to the same origin.");
  if (dashboard.includes("CONCEPT MOCKUP")) fail("The public dashboard still contains the rejected concept badge.");
  const loadPosition = dashboard.indexOf('id="loadButton"');
  const buildPosition = dashboard.indexOf('id="buildButton"');
  if (loadPosition < 0 || buildPosition <= loadPosition) fail("Build must follow Load JSON in the public dashboard controls.");
  const buildStatusParts = ['id="parserOverlay"', 'id="buildChoices"', 'id="buildAccountAction"', 'id="buildImagesAction"'];
  if (!buildStatusParts.every((part) => dashboard.includes(part))) fail("Build Status must expose explicit account and image choices.");
  const dashboardScript = await readFile(path.join(repositoryRoot, "docs", "scripts", "dashboard.js"), "utf8");
  if (!/buildButton\.addEventListener\("click",\s*openBuildChooser\)/u.test(dashboardScript)) fail("Build must open Build Status choices.");
  if (/buildButton\.addEventListener\("click",\s*proposeBuild\)/u.test(dashboardScript)) fail("Build must not start account collection directly.");
}
