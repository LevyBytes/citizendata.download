// Checks that the dashboard and the extension popup render as they did at a reference (the last commit by default):
// every element's box and computed style, at each width, in headless Chrome. --help prints the usage.
import { rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { outFolder, pageNames, PAGES, scratch } from "./check-rendering/options-and-evidence-folders.mjs";
import { openBrowser } from "./check-rendering/chrome-process-and-devtools-session.mjs";
import { comparePage, propertiesFor } from "./check-rendering/page-comparison-steps.mjs";
import { prepareTrees } from "./check-rendering/reference-and-current-trees.mjs";

const report = { reference: null, pages: {} };
let failed = false;
let session = null;
try {
  const trees = await prepareTrees();
  report.reference = trees.referenceName;
  session = await openBrowser();
  for (const name of pageNames) {
    const spec = PAGES[name];
    const properties = await propertiesFor(spec, trees);
    const result = await comparePage(session, spec, trees, properties);
    report.pages[name] = { page: `${spec.folder}/${spec.page}`, widths: spec.widths, properties: properties.length, ...result };
    const readings = `${result.readings} element readings (box, and ${properties.length} properties with ::before and ::after) at ${spec.widths.length} width(s)`;
    if (result.selfCheck.length > 0) {
      failed = true;
      console.log(`FAIL ${name}: the reference does not render the same twice, so it cannot be compared: ${result.selfCheck.join(" | ")}`);
    } else if (result.differences.length > 0) {
      failed = true;
      console.log(`FAIL ${name} renders differently from ${report.reference}: ${result.differences.join(" | ")}`);
    } else {
      console.log(`PASS ${name} renders as at ${report.reference}: ${readings}${result.retagged ? `; ${result.retagged} element(s) with a new tag` : ""}`);
    }
  }
} catch (error) {
  failed = true;
  report.error = String(error?.stack ?? error);
  console.error(`Rendering: ${error?.message ?? error}`);
} finally {
  const ended = session ? await session.close() : true;
  await writeFile(path.join(outFolder, "rendering.json"), `${JSON.stringify(report, null, 2)}\n`);
  if (!ended) {
    failed = true;
    console.error(`Rendering: Chrome did not end within 5 s; its profile is kept in ${scratch}`);
  } else if (path.dirname(path.resolve(scratch)) === outFolder) {
    await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}
process.exitCode = failed ? 1 : 0;
