import { INSURANCE, SHIPS } from "./page-sizes-and-ship-names.mjs";
import { buildBuyback } from "./generated-pledges-and-buybacks.mjs";

export const FOCUS = ["Starter / Pathfinder", "Light Fighter", "Medium Freight", "Exploration"];

// What the synthetic store asks for an upgrade, in cents.
export function upgradePriceCents(fromShipId, toSkuId) {
  return 500 * (1 + (fromShipId + toSkuId) % 7);
}

// The generated list repeats an item, the same title and contents line, every 20 buy-backs.
export const ITEM_PERIOD = 20;

// RSI shows one page for one item: every buy-back with the same title and contents line shows the same price,
// discount, SKU, description, and images, whatever its own number or reclaim date. This numbers the item.
export function itemSequence(buyback) {
  for (let sequence = 0; sequence < ITEM_PERIOD; sequence += 1) {
    const generated = buildBuyback(sequence);
    if (!generated.upgrade && generated.title === buyback.title && generated.contains === buyback.contains) return sequence;
  }
  let hash = 0;
  for (const character of `${buyback.title}|${buyback.contains}`) hash = (Math.imul(hash, 31) + character.codePointAt(0)) >>> 0;
  return ITEM_PERIOD + hash % 100000;
}

// What an ordinary buy-back's own page shows. Every fifth item is discounted, every third has no ship, and the
// packages are game packages, so each layout the extension reads appears in an account of any size.
export function buildBuybackDetail(buyback) {
  const sequence = itemSequence(buyback);
  const name = buyback.title.slice(buyback.title.indexOf(" - ") + 3);
  const gamePackage = buyback.title.startsWith("Package");
  const [ship, makerName] = SHIPS[sequence % SHIPS.length];
  const listCents = 2000 + (sequence % 30) * 500;
  const discountPercent = sequence % 5 === 0 ? (sequence % 2 ? 25 : 15) : null;
  return {
    id: buyback.id,
    title: buyback.title,
    name,
    type: gamePackage ? "game-packages" : "extras",
    typeLabel: gamePackage ? "Game Packages" : "Extras",
    cents: discountPercent ? listCents * (100 - discountPercent) / 100 : listCents,
    originalCents: discountPercent ? listCents : null,
    discountPercent,
    sku: 7000 + sequence,
    description: [`Synthetic description of ${name}.`, "It was reclaimed and can be bought back."],
    ships: sequence % 3 === 2 ? [] : [{ name: ship, manufacturer: makerName, focus: FOCUS[sequence % FOCUS.length], page: `/pledge/ships/synthetic-${sequence % SHIPS.length}/${ship.replace(/[^A-Za-z0-9]+/gu, "-")}` }],
    alsoContains: gamePackage ? ["Star Citizen Digital Download", INSURANCE[sequence % INSURANCE.length], "Self-Land Hangar"] : [INSURANCE[sequence % INSURANCE.length]]
  };
}
