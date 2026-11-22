// The extension package's manifest and files, read from the repository, for the manifest and source policy tests.
import path from "node:path";
import { fileURLToPath } from "node:url";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export const extensionRoot = path.join(root, "extension");
