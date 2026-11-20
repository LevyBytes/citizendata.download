import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadClassicScript } from "../extension/load-classic-script.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const { api: database } = await loadClassicScript(path.join(root, "extension", "storage", "database.js"), "CitizenDataDatabase");
// Records come back as objects of the script's own context; comparisons use plain copies.
export const plain = (value) => JSON.parse(JSON.stringify(value));
