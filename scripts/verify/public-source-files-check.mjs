import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fail, repositoryRoot } from "./repository-root-and-failure.mjs";

const textExtensions = new Set([".css", ".html", ".js", ".json", ".md", ".mjs", ".svg", ".txt", ".yaml", ".yml"]);
const forbiddenPrivateMarkers = [
  ["109", "5494"].join(""),
  ["$49,", "022.91"].join(""),
  ["TEST", " Squadron"].join("")
];
// The owner's thanks line on the dashboard names the organization on purpose. That one link is allowed; the name is
// still refused anywhere else, the example account included.
const organizationMarker = forbiddenPrivateMarkers[2];
const allowedMarkerUses = {
  "docs/index.html": [`aria-label="${organizationMarker} (opens in a new tab)">${organizationMarker}</a>`]
};

async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if ([".git", "dist", "node_modules"].includes(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    const stat = await lstat(absolute);
    if (stat.isSymbolicLink()) fail(`Symbolic links are not accepted in release source: ${absolute}`);
    if (entry.isDirectory()) files.push(...await walk(absolute));
    else if (entry.isFile()) files.push(absolute);
  }
  return files;
}

// Checks every text file of the source tree and gives back how many files the tree holds.
export async function checkPublicSourceFiles() {
  const files = await walk(repositoryRoot);
  for (const filePath of files) {
    const relative = path.relative(repositoryRoot, filePath).replaceAll(path.sep, "/");
    const extension = path.extname(filePath).toLowerCase();
    const base = path.basename(filePath);
    if (!textExtensions.has(extension) && ![".editorconfig", ".gitattributes", ".gitignore", ".nojekyll", "CNAME"].includes(base)) continue;
    const bytes = await readFile(filePath);
    if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) fail(`UTF-8 BOM is not allowed: ${relative}`);
    if (bytes.includes(0x0d)) fail(`CR/CRLF is not allowed: ${relative}`);
    const text = bytes.toString("utf8");
    let scanned = text;
    // Each allowed use is taken out once, so a second use in the same file is still refused.
    for (const allowed of allowedMarkerUses[relative] ?? []) scanned = scanned.replace(allowed, "");
    for (const marker of forbiddenPrivateMarkers) {
      if (scanned.includes(marker)) fail(`Private demo marker '${marker}' is not allowed in public source: ${relative}`);
    }
    if ([".json"].includes(extension)) JSON.parse(text);
    if ([".js", ".mjs", ".html"].includes(extension)) {
      if (/\beval\s*\(/u.test(text) || /\bnew\s+Function\b/u.test(text) || /document\.write\s*\(/u.test(text)) fail(`String-to-code or document.write is not allowed: ${relative}`);
      if (/\.(?:innerHTML|outerHTML)\s*=/u.test(text) || /insertAdjacentHTML\s*\(/u.test(text)) fail(`HTML string injection is not allowed: ${relative}`);
    }
  }
  return files.length;
}
