import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadClassicScript } from "../extension/load-classic-script.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const { api: Refresh } = await loadClassicScript(path.join(root, "extension", "jobs", "continuation-refresh.js"), "CitizenDataContinuationRefresh");

export function profileValue(overrides = {}) {
  return {
    unlockedBadges: [
      { sourceIndex: 0, id: 10, title: "Primary", images: [{ url: "https://media.robertsspaceindustries.com/primary.png" }] },
      { sourceIndex: 1, id: 20, title: "Second", images: [] },
      { sourceIndex: 2, id: null, title: null, images: [] }
    ],
    badgeCollection: { rawRows: 3, nonNullRows: 2, nullRows: 1, uniqueIdTitlePairs: 2, exactDuplicateRows: 0 },
    selectedBadge: { title: "Primary", images: [{ url: "https://media.robertsspaceindustries.com/primary.png" }] },
    featuredBadges: [{ title: "Primary", images: [{ url: "https://media.robertsspaceindustries.com/primary.png" }] }],
    ...overrides
  };
}

export function failedJob() {
  return {
    sectionIndex: 2,
    plan: { selectedSections: ["profile", "buybacks", "referrals.legacy.prospects"] },
    cursorBySection: { "referrals.legacy.prospects": { page: 29 } }
  };
}

export const resultSectionsForSection = {
  profile: ["profile"],
  buybacks: ["buybacks"],
  "referrals.legacy.prospects": ["referrals.legacy.prospects"]
};
