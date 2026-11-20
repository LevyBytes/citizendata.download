import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { docsRoot, repositoryRoot } from "./dashboard-scripts-under-test.mjs";

test("a badge title maps to its community wiki page", async () => {
  await import(pathToFileURL(path.join(docsRoot, "scripts", "badge-wiki-pages.js")));
  const pages = globalThis.CITIZENDATA_BADGE_WIKI_PAGES;
  assert.equal(pages.Civilian, "Civilian");
  assert.ok(Object.keys(pages).length >= 10);
  for (const [title, page] of Object.entries(pages)) assert.ok(typeof page === "string" && page.trim() === page && page.length > 0, title);
});

// The owner set these sentences word for word, so here the text is the contract.
test("the README carries the owner's wording and the community mark", async () => {
  const readme = await readFile(path.join(repositoryRoot, "README.md"), "utf8");
  assert.match(readme, /Built for citizens who want local backed up records of their own account history\./u);
  assert.match(readme, /Account data stays local in the device the browser runs on\./u);
  assert.match(readme, /docs\/assets\/made-by-the-community\.svg/u);
});

test("sort icon is the byte-identical supplied asset", async () => {
  const bytes = await readFile(path.join(docsRoot, "assets", "icons", "sort-direction.svg"));
  assert.equal(createHash("sha256").update(bytes).digest("hex").toUpperCase(), "C6FD35A55086E2962781FAD659B8E1CC3A5BA5BB0E74F83F371F7C959808A99C");
});

test("semantic dashboard icons are byte-identical supplied assets", async () => {
  const expected = new Map([
    ["bundle-star-citizen.svg", "A915BE2E5A2179DCA4F5D624822453F992362F20FFFA5CB3999C88187FA33D9D"],
    ["referral-rewards.svg", "842EB0B557988C12AEEB409794B7289AF81099960BE93B3DCDC920C6048A0A23"],
    ["flyable.svg", "293BF4206798E6BA687C1298088FCED828457AB5334620C0BE8C5F7A712C3D0E"],
    ["game-status.svg", "912707A12A2496C11D05DA741EB9D66D846B7D402CEF604B0DD81D0528CA450F"]
  ]);
  for (const [fileName, digest] of expected) {
    const bytes = await readFile(path.join(docsRoot, "assets", "icons", fileName));
    assert.equal(createHash("sha256").update(bytes).digest("hex").toUpperCase(), digest, fileName);
  }
});
