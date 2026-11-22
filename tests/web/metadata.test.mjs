// The public site's search and share metadata: static tags that agree on the public root and product, and a
// social image and search favicon that are real images of their declared sizes.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { docs, head, attributes, meta, base } from "./sitemetadatasources.mjs";

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
