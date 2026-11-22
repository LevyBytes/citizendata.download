// The public site's head, structured data, sitemap and images, read from docs/, for the metadata tests.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const docs = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../docs");

export const html = await readFile(path.join(docs, "index.html"), "utf8");

export const head = html.match(/<head>([\s\S]*?)<\/head>/u)[1];

export const attributes = tag => Object.fromEntries([...tag.matchAll(/([\w:-]+)="([^"]*)"/gu)].map(match => [match[1], match[2]]));

export const tags = [...head.matchAll(/<meta\s[^>]+>/gu)].map(match => attributes(match[0]));

export const meta = key => {
  const matches = tags.filter(tag => tag.name === key || tag.property === key);
  assert.equal(matches.length, 1, `Expected one ${key} tag`);
  return matches[0].content;
};

export const base = "https://citizendata.download/";
