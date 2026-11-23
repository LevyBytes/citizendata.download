// The extension package's manifest and files, for the manifest and source policy tests: the Chromium package as the
// packager composes it from extension/, platform/chromium/ and manifests/chrome.json (scripts/extension-composition.mjs).
import path from "node:path";
import { fileURLToPath } from "node:url";
import { composeTarget } from "../../scripts/extension-composition.mjs";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export const chromiumPackage = composeTarget(root, "chromium");

// Package path to its composed file: { name, bytes, source, layer }.
export const packageFiles = new Map(chromiumPackage.files.map((file) => [file.name, file]));
