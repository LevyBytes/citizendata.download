// The public site's structured data, crawl files and policy pages: structured data stays factual, crawl files
// identify only public website pages, and each policy page is static, indexable, and named by the dashboard under
// its own link relation.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { docs, html, head, attributes, meta, base } from "./sitemetadatasources.mjs";

const structuredData = text => JSON.parse(text.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/u)[1]);

const structured = structuredData(head);

const sitemap = await readFile(path.join(docs, "sitemap.xml"), "utf8");

const lastModified = Object.fromEntries([...sitemap.matchAll(/<loc>([^<]+)<\/loc><lastmod>([^<]+)<\/lastmod>/gu)].map(match => [match[1], match[2]]));

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
