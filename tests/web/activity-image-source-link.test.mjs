import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../../docs/index.html", import.meta.url), "utf8");
const dashboard = await readFile(new URL("../../docs/scripts/dashboard.js", import.meta.url), "utf8");

test("the Dancing Ben activity image links safely to its timestamped source", () => {
  const link = [
    '<a class="collection-activity-link" id="collectionActivityLink" ',
    'href="https://www.youtube.com/watch?v=_d4b32OhcYI&amp;t=2183s" ',
    'target="_blank" rel="noopener noreferrer" ',
    'aria-label="Watch the Ben Dance source on YouTube (opens in a new tab)" hidden>',
    '<img id="collectionActivityImage"'
  ].join("");
  assert.ok(html.includes(link));
  assert.match(dashboard, /refs\.collectionActivityLink\.hidden = false/u);
  assert.match(dashboard, /refs\.collectionActivityLink\.hidden = true/u);
});
