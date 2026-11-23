import assert from "node:assert/strict";
import { cp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { repositoryRoot, scratch } from "./options-and-run-folders.mjs";

// The dashboard under test is a copy of docs/ that differs in one thing: it does not space its image downloads.
// That spacing is kept toward RSI's image host, and here every image comes from this machine. The policy the
// dashboard states, and writes into the Images ZIP, is left as it is; only the wait is taken out.
export const docsRoot = path.join(scratch, "docs");
await cp(path.join(repositoryRoot, "docs"), docsRoot, { recursive: true });
{
  const policyPath = path.join(docsRoot, "scripts", "media-materializer.js");
  let source = await readFile(policyPath, "utf8");
  // The gap between image starts is drawn from this baseline times the pace's factor (§14); at 0 there is none.
  for (const [shipped, unspaced] of [["const gapBaseline = { startGapMinimumMs: policy.minimumInterRequestDelayMs, startGapMaximumMs: policy.maximumInterRequestDelayMs };", "const gapBaseline = { startGapMinimumMs: 0, startGapMaximumMs: 0 };"]]) {
    assert.equal(source.split(shipped).length, 2, `The dashboard no longer writes its image spacing as this check expects: ${shipped}`);
    source = source.replace(shipped, unspaced);
  }
  await writeFile(policyPath, source);
}
export const dashboardUrl = pathToFileURL(path.join(docsRoot, "index.html")).href;
// Chrome writes a Windows drive letter of a file address in capitals, whatever the letter case of the folder this run
// was started from.
export const dashboardPath = new URL(dashboardUrl).pathname.replace(/^\/([a-z]):\//u, (_, drive) => `/${drive.toUpperCase()}:/`);
// The popup shows a Windows drive path the way a file manager does, and any other path as it is.
const decodedDashboardPath = decodeURIComponent(dashboardPath);
export const displayedPath = /^\/[A-Za-z]:\//u.test(decodedDashboardPath) ? decodedDashboardPath.slice(1).replaceAll("/", "\\") : decodedDashboardPath;
