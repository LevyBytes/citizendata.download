import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const verifierUrl = new URL("../../scripts/verify/public-source-files-check.mjs", import.meta.url);

test("public source verification excludes generated work-temp directories", async () => {
  const source = await readFile(verifierUrl, "utf8");

  assert.match(source, /const skippedFolder = \/\^\(\?:node_modules\|work-temp-\.\*\)\$\/u;/u);
  assert.match(source, /skippedFolder\.test\(entry\.name\)/u);
});
