import { writeFile } from "node:fs/promises";
import path from "node:path";
import { dashboard, extensionPage } from "./browser-pages-and-account-in-use.mjs";
import { only, out } from "./options-and-run-folders.mjs";

export const results = [];
export function assertStep(condition, message) {
  if (!condition) throw new Error(message);
}

export async function scenario(name, run) {
  // The approval scenario also prepares the pages every later scenario uses, so it always runs.
  if (only && !only.has(name) && name !== "local-copy-approval") {
    results.push({ name, status: "not run" });
    return;
  }
  const started = Date.now();
  try {
    const detail = await run();
    results.push({ name, status: "passed", seconds: Number(((Date.now() - started) / 1000).toFixed(1)), ...(detail ? { detail } : {}) });
    console.log(`PASS ${name} (${((Date.now() - started) / 1000).toFixed(1)} s)${detail ? ` ${JSON.stringify(detail)}` : ""}`);
  } catch (error) {
    results.push({ name, status: "failed", seconds: Number(((Date.now() - started) / 1000).toFixed(1)), error: error.message });
    console.log(`FAIL ${name}: ${error.message}`);
    // What the user would have been looking at when it failed.
    for (const [label, page] of [["dashboard", dashboard], ["popup", extensionPage]]) {
      if (page) await page.screenshot().then((image) => writeFile(path.join(out, `failed-${name}-${label}.png`), image)).catch(() => {});
    }
    throw error;
  }
}
