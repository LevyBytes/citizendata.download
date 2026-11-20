// Checks that every file and folder of the test suite and of the tooling beside it is named for what it is. A name fails when
// it holds
//   a part's position in place of a name: dashboard-checks-2.mjs, part3/, data12.js;
//   a hash in place of a name: fixture-97dc70bf.json;
//   a line of its code: document-add-event-listener-click.mjs;
//   fewer than three characters.
// A README under tests/ fails as well: a check says what it is for at the top of its own file.
// A number that is the thing's own name passes: a version (0.42.1), a standard's or a platform's (sha256, x86_64), an
// amount with its unit (380px, 30-seconds), a limit a test is about (over-100), a date. Whether a name says exactly
// what its file holds is for the reader to judge; this check refuses the names that cannot.
//
// Usage: node scripts/check-file-names.mjs
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FOLDERS = ["tests", "scripts"];
const SKIPPED_FOLDER = /^(?:node_modules|work-temp-.*)$/u;
// The numbers that name something, taken out before a name is judged.
const OWN_NUMBERS = [
  /\d+(?:\.\d+)+/gu,
  /\b(?:uuid|sha|crc|utf|base|ipv|x86_|arm|aarch|rfc|iso|mv|v)\d+\b/giu,
  /\b\d+(?:px|em|rem|ms|kb|mb|x)\b/giu,
  /\b\d+-(?:seconds?|minutes?|hours?|days?|weeks?|months?|years?|characters?|lines?|bytes?|widths?)\b/giu,
  /\b(?:over|under|above|below|within|max|min)-\d+\b/giu,
  /\b\d{4}-\d{2}-\d{2}\b/gu
];
const POSITION = /(?:^|[-_ .])\d+(?=$|[-_ .])|[a-z]\d+$/iu;
const HASH = /(?:^|[-_.])(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{8,}(?=$|[-_.])/iu;
// Words a name holds only when it was cut from a line of script.
const CODE_WORDS = ["add-event-listener", "remove-event-listener", "query-selector", "get-element-by-id", "inner-html", "text-content", "set-attribute", "for-each", "const", "let", "var", "await"];

// What is wrong with one name, as a sentence, or null. `isFile` says whether an extension is to be taken off first.
export function nameFailure(name, isFile) {
  const stem = isFile ? name.replace(/(?:\.test)?\.[^.]+$/u, "") : name;
  const withoutOwnNumbers = OWN_NUMBERS.reduce((text, own) => text.replace(own, "#"), stem);
  if (POSITION.test(withoutOwnNumbers)) return "a number where its name should say what it is";
  if (HASH.test(stem)) return "a hash where its name should say what it is";
  if (stem.length < 3) return "a name too short to say what it is";
  const codeWord = CODE_WORDS.find((word) => `-${stem.toLowerCase()}-`.includes(`-${word}-`));
  return codeWord ? `named after its code ("${codeWord}") instead of what it is` : null;
}

function namedEntries(folder, repositoryRoot) {
  const found = [];
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    if (SKIPPED_FOLDER.test(entry.name)) continue;
    const full = path.join(folder, entry.name);
    found.push({ relative: path.relative(repositoryRoot, full).split(path.sep).join("/"), name: entry.name, isFile: entry.isFile() });
    if (entry.isDirectory()) found.push(...namedEntries(full, repositoryRoot));
  }
  return found;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const entries = FOLDERS.flatMap((folder) => namedEntries(path.join(repositoryRoot, folder), repositoryRoot));
  const readme = (entry) => (entry.relative.startsWith("tests/") && /^readme\b/iu.test(entry.name) ? "a README among the tests; a check explains itself in its own file" : null);
  const failures = entries.map((entry) => ({ entry, failure: readme(entry) ?? nameFailure(entry.name, entry.isFile) })).filter(({ failure }) => failure !== null);
  if (failures.length > 0) {
    for (const { entry, failure } of failures) console.error(`${entry.relative}: ${failure}`);
    console.error(`FAIL file names: ${failures.length} of ${entries.length} files and folders are not named for what they are`);
    process.exit(1);
  }
  console.log(`PASS file names: ${entries.length} files and folders, each named for what it is`);
}
