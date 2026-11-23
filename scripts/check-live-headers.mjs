// After publication: reads the Content-Security-Policy response header of each page of the hosted site and checks it
// against the page's own meta policy in docs/. The header must hold every directive of the meta policy with the same
// sources, and frame-ancestors 'none', which a meta policy cannot set. The meta policy stays in each page as the
// fallback. This is the only script here that contacts the hosted site; no test runs it.
//
// Usage: node scripts/check-live-headers.mjs [origin]     (default https://citizendata.download)
import { readFile } from "node:fs/promises";
import { request } from "node:https";
import path from "node:path";
import { URL, fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const origin = new URL(process.argv[2] ?? "https://citizendata.download").origin;
// Each address and the page that answers it; an unknown address is answered by 404.html with status 404.
const PAGES = [
  ["/", "index.html", 200],
  ["/index.html", "index.html", 200],
  ["/privacy-policy.html", "privacy-policy.html", 200],
  ["/terms-of-service.html", "terms-of-service.html", 200],
  ["/no-such-page-header-check", "404.html", 404]
];

// The status and Content-Security-Policy header of one GET, with no cookie, following no redirect.
const headOf = (address) => new Promise((resolve, reject) => {
  const asked = request(address, { method: "GET", headers: { "Cache-Control": "no-cache" } }, (response) => {
    response.resume();
    resolve({ status: response.statusCode, header: response.headers["content-security-policy"] ?? null });
  });
  asked.on("error", reject);
  asked.end();
});

// A policy as a map of directive to its sources, in order.
function directives(policy) {
  const map = new Map();
  for (const part of policy.split(";").map((text) => text.trim()).filter(Boolean)) {
    const [name, ...sources] = part.split(/\s+/u);
    if (!map.has(name.toLowerCase())) map.set(name.toLowerCase(), sources.join(" "));
  }
  return map;
}

async function metaPolicy(file) {
  const html = await readFile(path.join(repositoryRoot, "docs", file), "utf8");
  const found = /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"/iu.exec(html);
  if (!found) throw new Error(`docs/${file} has no meta Content-Security-Policy.`);
  return found[1];
}

const failures = [];
for (const [address, file, status] of PAGES) {
  const expected = directives(await metaPolicy(file));
  expected.set("frame-ancestors", "'none'");
  const response = await headOf(new URL(address, origin));
  const header = response.header;
  const problems = [];
  if (response.status !== status) problems.push(`status ${response.status}, expected ${status}`);
  if (!header) problems.push("no Content-Security-Policy header");
  else {
    const actual = directives(header);
    for (const [name, sources] of expected) if (actual.get(name) !== sources) problems.push(`${name} is "${actual.get(name) ?? "absent"}", expected "${sources}"`);
  }
  console.log(`${problems.length ? "FAIL" : "PASS"} ${address} (${file})${problems.length ? `: ${problems.join("; ")}` : ""}`);
  if (problems.length) failures.push(address);
}
if (failures.length) {
  console.error(`\nFAIL live headers: ${failures.join(", ")}`);
  process.exit(1);
}
console.log("\nPASS live headers: every page has its policy as a response header, with frame-ancestors 'none'");
