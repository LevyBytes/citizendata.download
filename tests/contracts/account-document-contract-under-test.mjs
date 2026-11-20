import { readFile } from "node:fs/promises";

await import("../../shared/account-document.js");

export const api = globalThis.CitizenDataAccountDocument;
export const accountSchema = JSON.parse(await readFile(new URL("../../schema/account-export.schema.json", import.meta.url), "utf8"));
export const offlineSchema = JSON.parse(await readFile(new URL("../../schema/offline-package.schema.json", import.meta.url), "utf8"));
