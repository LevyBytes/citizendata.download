import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadClassicScripts } from "../extension/load-classic-script.mjs";
import { baseAccountDocument } from "../fixtures/account-document.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const context = await loadClassicScripts([
  path.join(root, "docs", "schema", "account-export.schema.js"),
  path.join(root, "docs", "scripts", "account-document.js"),
  path.join(root, "docs", "scripts", "organization-document.js")
], { URL, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, DataView, Blob, crypto: globalThis.crypto, structuredClone });
export const Organizations = context.CitizenDataOrganizationDocument;

export function member(sid, key) {
  return {
    recordKey: key, organizationSid: sid, visibility: "public", displayName: key, handle: key, membershipType: "main", rank: null, rankStars: null, roles: [], images: [],
    observation: { firstObservedAt: "2026-11-18T00:00:00.000Z", lastObservedAt: "2026-11-18T00:00:00.000Z", parserVersion: "1.0.0" }
  };
}

export function account() {
  const document = baseAccountDocument();
  document.account.handle = "Pilot";
  document.organizations.memberships = [
    {
      sid: "TEST", name: "Test", membershipType: "main", memberCount: 2, rank: null, archetype: null, language: null, primaryActivity: null, secondaryActivity: null,
      recruiting: null, rolePlay: null, commitment: null, exclusive: null, images: [],
      observation: { firstObservedAt: "2026-11-18T00:00:00.000Z", lastObservedAt: "2026-11-18T00:00:00.000Z", parserVersion: "1.0.0" }
    },
    {
      sid: "MMHC", name: "MMHC", membershipType: "affiliate", memberCount: 1, rank: null, archetype: null, language: null, primaryActivity: null, secondaryActivity: null,
      recruiting: null, rolePlay: null, commitment: null, exclusive: null, images: [],
      observation: { firstObservedAt: "2026-11-18T00:00:00.000Z", lastObservedAt: "2026-11-18T00:00:00.000Z", parserVersion: "1.0.0" }
    }
  ];
  return document;
}
