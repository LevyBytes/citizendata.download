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
const structuredData = text => JSON.parse(text.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/u)[1]);
const structured = structuredData(head);
const sitemap = await readFile(path.join(docs, "sitemap.xml"), "utf8");
const lastModified = Object.fromEntries([...sitemap.matchAll(/<loc>([^<]+)<\/loc><lastmod>([^<]+)<\/lastmod>/gu)].map(match => [match[1], match[2]]));
// The width and height in a JPEG's start-of-frame segment (markers C0 to CF, except C4, C8 and CC).
function jpegSize(bytes) {
  for (let offset = 2; offset + 9 < bytes.length && bytes[offset] === 0xff; offset += 2 + bytes.readUInt16BE(offset + 2)) {
    const marker = bytes[offset + 1];
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return [bytes.readUInt16BE(offset + 7), bytes.readUInt16BE(offset + 5)];
  }
  return [];
}

test("static search and share metadata agree on the public root and product", () => {
  const title = head.match(/<title>([^<]+)<\/title>/u)[1];
  assert.match(title, /Star Citizen Data Downloader/u);
  assert.equal(meta("og:title"), title);
  assert.equal(meta("twitter:title"), title);
  assert.equal(meta("application-name"), title);
  assert.equal(meta("twitter:description"), meta("description"));
  assert.equal(meta("og:description"), meta("description"));
  assert.equal(meta("og:type"), "website");
  assert.equal(meta("og:site_name"), "Star Citizen Download");
  assert.equal(meta("apple-mobile-web-app-title"), meta("og:site_name"));
  assert.equal(meta("og:url"), base);
  const canonicals = [...head.matchAll(/<link[^>]+rel="canonical"[^>]*>/gu)].map(match => attributes(match[0]));
  assert.deepEqual(canonicals.map(link => link.href), [base]);
  assert.equal(meta("twitter:card"), "summary_large_image");
  assert.match(meta("robots"), /max-image-preview:large/u);
  assert.doesNotMatch(meta("robots"), /noindex|nofollow|noimageindex|nosnippet/u);
  assert.doesNotMatch(head, /DownloadCitizen|DirectorGunner|424242|STAR-GN2F|file:\/|localhost|fb:app_id|twitter:(?:site|creator)/u);
});

test("social image is a real JPEG and search favicon a real PNG, each matching declared dimensions", async () => {
  const imageUrl = new URL(meta("og:image"));
  assert.equal(imageUrl.origin, new URL(base).origin);
  assert.equal(meta("twitter:image"), imageUrl.href);
  assert.equal(meta("og:image:alt"), meta("twitter:image:alt"));
  assert.ok(meta("og:image:alt").length > 20 && meta("og:image:alt").length <= 420);
  assert.equal(meta("og:image:type"), "image/jpeg");
  const image = await readFile(path.join(docs, imageUrl.pathname));
  assert.equal(image.subarray(0, 3).toString("hex"), "ffd8ff");
  const [width, height] = jpegSize(image);
  assert.equal(width, Number(meta("og:image:width")));
  assert.equal(height, Number(meta("og:image:height")));
  assert.equal(width, 1200);
  assert.equal(height, 630);
  assert.ok(image.length < 1_000_000, "Shared JPEG should remain under the chosen one-megabyte budget");
  const favicon = await readFile(path.join(docs, "assets/favicon-96.png"));
  assert.equal(favicon.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.equal(favicon.readUInt32BE(16), 96);
  assert.equal(favicon.readUInt32BE(20), 96);
  assert.match(head, /rel="icon" type="image\/png" sizes="96x96" href="assets\/favicon-96\.png"/u);
});

test("structured data stays factual and crawl files identify only public website pages", async () => {
  assert.equal(structured["@context"], "https://schema.org");
  assert.deepEqual(structured["@graph"].map(item => item["@type"]), ["WebSite", "WebApplication", "Person"]);
  for (const item of structured["@graph"]) {
    // The publisher is a person, whose url is their own profile.
    if (item["@type"] !== "Person") assert.equal(item.url, base);
    assert.ok(item["@id"].startsWith(base));
    for (const unsupported of ["aggregateRating", "review", "downloadUrl", "installUrl"]) assert.equal(item[unsupported], undefined);
  }
  const [website, application, publisher] = structured["@graph"];
  assert.equal(website.name, meta("application-name"));
  assert.ok(website.alternateName.includes(meta("og:site_name")));
  assert.equal(application.description, meta("description"));
  // The only offer is the free one, which the X label states too.
  assert.deepEqual(application.offers, { "@type": "Offer", price: "0", priceCurrency: "USD" });
  assert.equal(application.isAccessibleForFree, true);
  assert.deepEqual([meta("twitter:label1"), meta("twitter:data1")], ["Price", "Free"]);
  // The publisher and author is the person LevyBytes.
  assert.deepEqual([publisher.name, publisher.url], ["LevyBytes", "https://github.com/LevyBytes"]);
  for (const reference of [website.publisher, application.author, application.publisher]) assert.deepEqual(reference, { "@id": publisher["@id"] });
  // Search, AI answers and AI training are allowed, and robots.txt says so; nothing opts out.
  const robots = await readFile(path.join(docs, "robots.txt"), "utf8");
  assert.match(robots, /User-agent: \*\nContent-Signal: search=yes, ai-input=yes, ai-train=yes\nAllow: \/\n/u);
  assert.match(robots, /User-agent: __usage_ai-training\nAllow: \/\n/u);
  assert.ok(robots.includes(`Sitemap: ${base}sitemap.xml`));
  assert.doesNotMatch(robots, /Disallow:|=no\b/u);
  const pages = [base, `${base}terms-of-service.html`, `${base}privacy-policy.html`];
  assert.deepEqual([...sitemap.matchAll(/<loc>([^<]+)<\/loc>/gu)].map(match => match[1]), pages);
  assert.deepEqual(Object.keys(lastModified), pages, "every page has a lastmod date");
  for (const date of Object.values(lastModified)) assert.match(date, /^\d{4}-\d{2}-\d{2}$/u);
  assert.doesNotMatch(sitemap, /<priority>|<changefreq>/u);
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
    // Structured data is a data block, which no browser runs.
    assert.deepEqual(policyTags.filter(tag => tag.tag === "script" && tag.type !== "application/ld+json"), [], `${filename} must run no script`);
    assert.deepEqual(policyTags.filter(tag => tag.tag === "meta" && tag.name === "robots" && /noindex/iu.test(tag.content ?? "")), [], `${filename} must stay indexable`);
    // The page's own date is the one the sitemap gives it, and its breadcrumb runs from the home page to it.
    const [page, breadcrumb] = structuredData(policy)["@graph"];
    assert.deepEqual([page.url, page.dateModified], [`${base}${filename}`, lastModified[`${base}${filename}`]], `${filename}: its date in the sitemap`);
    assert.deepEqual(breadcrumb.itemListElement.map(item => item.position), [1, 2]);
  }
  // Where the two links sit in the page is checked in the browser by tests/web/validate-dashboard.mjs.
});
