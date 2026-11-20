import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const docs = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../docs");
const html = await readFile(path.join(docs, "index.html"), "utf8");
const head = html.match(/<head>([\s\S]*?)<\/head>/u)[1];
const attributes = tag => Object.fromEntries([...tag.matchAll(/([\w:-]+)="([^"]*)"/gu)].map(match => [match[1], match[2]]));
const tags = [...head.matchAll(/<meta\s[^>]+>/gu)].map(match => attributes(match[0]));
const meta = key => {
  const matches = tags.filter(tag => tag.name === key || tag.property === key);
  assert.equal(matches.length, 1, `Expected one ${key} tag`);
  return matches[0].content;
};
const base = "https://citizendata.download/";
const structured = JSON.parse(head.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/u)[1]);

test("static search and share metadata agree on the public root and product", () => {
  const title = head.match(/<title>([^<]+)<\/title>/u)[1];
  assert.match(title, /Star Citizen Data Downloader/u);
  assert.equal(meta("og:title"), title);
  assert.equal(meta("twitter:title"), title);
  assert.equal(meta("twitter:description"), meta("description"));
  assert.equal(meta("og:description"), meta("description"));
  assert.equal(meta("og:type"), "website");
  assert.equal(meta("og:site_name"), "CitizenData");
  assert.equal(meta("og:url"), base);
  const canonicals = [...head.matchAll(/<link[^>]+rel="canonical"[^>]*>/gu)].map(match => attributes(match[0]));
  assert.deepEqual(canonicals.map(link => link.href), [base]);
  assert.equal(meta("twitter:card"), "summary_large_image");
  assert.match(meta("robots"), /max-image-preview:large/u);
  assert.doesNotMatch(meta("robots"), /noindex|nofollow|noimageindex|nosnippet/u);
  assert.doesNotMatch(head, /DownloadCitizen|DirectorGunner|424242|STAR-GN2F|file:\/|localhost|fb:app_id|twitter:(?:site|creator)/u);
});

test("social image and search favicon are real PNGs matching declared dimensions", async () => {
  const imageUrl = new URL(meta("og:image"));
  assert.equal(imageUrl.origin, new URL(base).origin);
  assert.equal(meta("twitter:image"), imageUrl.href);
  assert.equal(meta("og:image:alt"), meta("twitter:image:alt"));
  assert.ok(meta("og:image:alt").length > 20 && meta("og:image:alt").length <= 420);
  assert.equal(meta("og:image:type"), "image/png");
  const image = await readFile(path.join(docs, imageUrl.pathname));
  assert.equal(image.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.equal(image.readUInt32BE(16), Number(meta("og:image:width")));
  assert.equal(image.readUInt32BE(20), Number(meta("og:image:height")));
  assert.equal(image.readUInt32BE(16), 1200);
  assert.equal(image.readUInt32BE(20), 630);
  assert.ok(image.length < 1_000_000, "Shared PNG should remain under the chosen one-megabyte budget");
  const favicon = await readFile(path.join(docs, "assets/favicon-96.png"));
  assert.equal(favicon.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.equal(favicon.readUInt32BE(16), 96);
  assert.equal(favicon.readUInt32BE(20), 96);
  assert.match(head, /rel="icon" type="image\/png" sizes="96x96" href="assets\/favicon-96\.png"/u);
});

test("structured data stays factual and crawl files identify only public website pages", async () => {
  assert.equal(structured["@context"], "https://schema.org");
  assert.deepEqual(structured["@graph"].map(item => item["@type"]), ["WebSite", "WebApplication"]);
  for (const item of structured["@graph"]) {
    assert.equal(item.url, base);
    assert.ok(item["@id"].startsWith(base));
    for (const unsupported of ["aggregateRating", "review", "offers", "downloadUrl", "installUrl"]) assert.equal(item[unsupported], undefined);
  }
  assert.equal(structured["@graph"][0].name, meta("og:site_name"));
  assert.equal(structured["@graph"][1].description, meta("description"));
  const robots = await readFile(path.join(docs, "robots.txt"), "utf8");
  assert.match(robots, /User-agent: \*\nAllow: \/\n/u);
  assert.ok(robots.includes(`Sitemap: ${base}sitemap.xml`));
  assert.doesNotMatch(robots, /Disallow:/u);
  const sitemap = await readFile(path.join(docs, "sitemap.xml"), "utf8");
  assert.deepEqual([...sitemap.matchAll(/<loc>([^<]+)<\/loc>/gu)].map(match => match[1]), [base, `${base}terms-of-service.html`, `${base}privacy-policy.html`]);
  assert.doesNotMatch(sitemap, /<lastmod>|<priority>|<changefreq>/u);
  assert.match(html, /id="overview" data-nosnippet/u);
  assert.match(html, /id="inventory" data-nosnippet/u);
  assert.match(html, /class="secondary-grid"[^>]*data-nosnippet/u);
});

test("each policy page is static, indexable, and named by the dashboard under its own link relation", async () => {
  const policyLinks = [...head.matchAll(/<link[^>]+>/gu)].map(match => attributes(match[0]));
  for (const [relation, filename] of [["privacy-policy", "privacy-policy.html"], ["terms-of-service", "terms-of-service.html"]]) {
    assert.deepEqual(policyLinks.filter(link => link.rel === relation).map(link => link.href), [filename]);
    const policy = await readFile(path.join(docs, filename), "utf8");
    const policyTags = [...policy.matchAll(/<(link|meta|script)\b[^>]*>/giu)].map(match => ({ tag: match[1].toLowerCase(), ...attributes(match[0]) }));
    assert.deepEqual(policyTags.filter(tag => tag.tag === "link" && tag.rel === "canonical").map(tag => tag.href), [`${base}${filename}`]);
    assert.deepEqual(policyTags.filter(tag => tag.tag === "script"), [], `${filename} must run no script`);
    assert.deepEqual(policyTags.filter(tag => tag.tag === "meta" && tag.name === "robots" && /noindex/iu.test(tag.content ?? "")), [], `${filename} must stay indexable`);
  }
  // Where the two links sit in the page is checked in the browser by tests/web/validate-dashboard.mjs.
});
