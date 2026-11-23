// Composes an installable extension from three layers, in this order: the browser-neutral source in `extension/`, the
// target's platform overlay in `platform/<platform>/`, then the target manifest from `manifests/`, written as the
// package's `manifest.json`, and the repository's legal notices. Every layer keeps its package-root-relative paths, so
// no source path is rewritten. A path that two layers both supply is refused: no layer replaces another's file.
//
// Used by scripts/package-extension.mjs, which writes the result, and by the tests, which load the same composition.
import { lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

export const FIREFOX_PLATFORM_NOT_IMPLEMENTED = "FIREFOX_PLATFORM_NOT_IMPLEMENTED";
export const LEGAL_FILE_NAMES = Object.freeze(["LICENSE", "THIRD_PARTY_NOTICES.md"]);

// Firefox has a manifest scaffold only. It has no background runtime and no parser adapter yet
// (platform/firefox/README.md), so it cannot be composed.
export const TARGETS = Object.freeze({
  chromium: Object.freeze({
    implemented: true,
    layers: Object.freeze(["extension", "platform/chromium"]),
    manifest: "manifests/chrome.json",
    required: Object.freeze(["manifest.json", "service-worker.js", "offscreen/parser.html", "offscreen/parser.js", ...LEGAL_FILE_NAMES])
  }),
  firefox: Object.freeze({ implemented: false, manifest: "manifests/firefox.json" })
});

export class CompositionError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = "CompositionError";
    this.code = code;
  }
}

export function targetDefinition(target) {
  if (!Object.hasOwn(TARGETS, target)) throw new CompositionError("UNKNOWN_TARGET", `There is no extension target named ${JSON.stringify(target)}. Targets: ${Object.keys(TARGETS).join(", ")}.`);
  const definition = TARGETS[target];
  if (!definition.implemented) {
    throw new CompositionError(FIREFOX_PLATFORM_NOT_IMPLEMENTED, "The Firefox platform overlay is not implemented, so no Firefox extension is composed or packaged. See platform/firefox/README.md.");
  }
  return definition;
}

// Every file below one layer's folder, as package paths. A symbolic link or junction is refused, not followed.
export function listLayerFiles(repositoryRoot, layer) {
  const layerRoot = path.join(repositoryRoot, ...layer.split("/"));
  const files = [];
  const walk = (directory, relative) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      const stat = lstatSync(absolute);
      if (stat.isSymbolicLink()) throw new CompositionError("PACKAGE_SYMBOLIC_LINK", `Extension packages may not contain symbolic links: ${layer}/${name}`);
      if (stat.isDirectory()) walk(absolute, name);
      else if (stat.isFile()) files.push({ name, source: absolute, layer });
      else throw new CompositionError("PACKAGE_SPECIAL_FILE", `Extension packages may hold only files and folders: ${layer}/${name}`);
    }
  };
  walk(layerRoot, "");
  return files.sort(byName);
}

function byName(left, right) {
  return left.name < right.name ? -1 : left.name > right.name ? 1 : 0;
}

const forbiddenPackagePath = /(?:^|\/)(?:\.|private-data(?:\/|$)|captures(?:\/|$)|(?:account-data[^/]*|rsi-account[^/]*|citizendata-[^/]*|hangarlink[^/]*)\.(?:json|zip)$)|\.(?:crx|log|map|pem|tmp)$/iu;

// Refuses unsafe, duplicate, private and development-only paths, and a package without its required files.
export function assertPackageFilePolicy(files, required = ["manifest.json", "service-worker.js", ...LEGAL_FILE_NAMES]) {
  const names = new Set();
  for (const file of files) {
    if (typeof file?.name !== "string" || file.name.length === 0 || file.name.includes("\\") || file.name.startsWith("/") || file.name.split("/").includes("..")) {
      throw new Error(`Unsafe extension package path: ${String(file?.name)}`);
    }
    const normalized = file.name.toLowerCase();
    if (names.has(normalized)) throw new Error(`Duplicate extension package path: ${file.name}`);
    if (forbiddenPackagePath.test(file.name)) throw new Error(`Private or development-only file is not allowed in the extension package: ${file.name}`);
    names.add(normalized);
  }
  for (const name of required) {
    if (!names.has(name.toLowerCase())) throw new Error(`Required extension package file is missing: ${name}`);
  }
  return files;
}

// The composed package of one target: its files in byte order of their paths, each with its bytes and the source file
// it came from, plus the parsed manifest and its version.
export function composeTarget(repositoryRoot, target) {
  const definition = targetDefinition(target);
  const owners = new Map();
  const files = [];
  const add = (file) => {
    const key = file.name.toLowerCase();
    const earlier = owners.get(key);
    if (earlier) {
      throw new CompositionError("PACKAGE_PATH_COLLISION", `${file.layer}/${file.name} and ${earlier.layer}/${earlier.name} would both become package path ${file.name}; no layer may replace another's file.`);
    }
    owners.set(key, file);
    files.push(file);
  };
  for (const layer of definition.layers) for (const file of listLayerFiles(repositoryRoot, layer)) add(file);
  const manifestSource = path.join(repositoryRoot, ...definition.manifest.split("/"));
  add({ name: "manifest.json", source: manifestSource, layer: definition.manifest });
  for (const name of LEGAL_FILE_NAMES) add({ name, source: path.join(repositoryRoot, name), layer: "repository root" });
  const composed = files.sort(byName).map((file) => ({ ...file, bytes: readFileSync(file.source) }));
  assertPackageFilePolicy(composed, definition.required);
  const manifest = JSON.parse(composed.find((file) => file.name === "manifest.json").bytes.toString("utf8"));
  return { target, files: composed, manifest, version: String(manifest.version ?? "") };
}

// The source file behind one package path of a target, for the tests that load extension files one by one.
export function packageSourcePath(repositoryRoot, target, packagePath) {
  const file = composeTarget(repositoryRoot, target).files.find((candidate) => candidate.name === packagePath);
  if (!file) throw new CompositionError("PACKAGE_PATH_MISSING", `The ${target} package has no file ${packagePath}.`);
  return file.source;
}

// Writes composed files below `directory`, which must not hold any of them yet.
export function writeComposedDirectory(files, directory) {
  for (const file of files) {
    const destination = path.join(directory, ...file.name.split("/"));
    mkdirSync(path.dirname(destination), { recursive: true });
    writeFileSync(destination, file.bytes, { flag: "wx" });
  }
}
