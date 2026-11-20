import { INSURANCE, SHIPS, UPGRADE_SHIPS } from "./page-sizes-and-ship-names.mjs";
import { dayBefore } from "./text-date-and-money-formats.mjs";

export function buildPledge(sequence) {
  // Stepping the ship once more every five pledges gives every ship every kind of pledge.
  const [ship, makerName, makerCode] = SHIPS[(sequence + Math.floor(sequence / 5)) % SHIPS.length];
  const maker = { name: makerName, code: makerCode };
  const from = UPGRADE_SHIPS[sequence % UPGRADE_SHIPS.length];
  const target = UPGRADE_SHIPS[(sequence + 3) % UPGRADE_SHIPS.length];
  const shape = sequence % 5;
  const day = dayBefore(sequence);
  const id = 30000000 + sequence;
  const insurance = INSURANCE[sequence % INSURANCE.length];
  const cents = 2500 + (sequence % 40) * 500;
  const base = { id, created: day.long, valueCents: cents, configurationCents: shape === 1 ? cents : 0, giftable: sequence % 3 === 0, meltable: sequence % 4 !== 0, availability: sequence % 3 === 0 ? "Gift" : "Attributed" };
  if (shape === 0) return {
    ...base, title: `Package - ${ship} Starter Pack${sequence % 2 ? " - Warbond" : ""}`, contains: `${ship} and 4 items`,
    items: [{ title: ship, kind: "Ship", liner: maker, customName: sequence % 10 === 0 ? `Synthetic ${sequence}` : null }, { title: "Self-Land Hangar", kind: "Hangar", liner: null, customName: null }],
    alsoContains: ["Star Citizen Digital Download", insurance, `Starting Money: ${(1 + sequence % 5) * 1000} UEC`]
  };
  if (shape === 1) return { ...base, title: `Standalone Ships - ${ship}`, contains: `${ship} and 1 item`, items: [{ title: ship, kind: "Ship", liner: maker, customName: null }], alsoContains: [insurance] };
  if (shape === 2) return { ...base, title: `Upgrade - ${from} to ${target} Standard Edition`, contains: `${from} to ${target} Upgrade`, items: [{ title: `${from} to ${target} Upgrade`, kind: null, liner: null, customName: null }], alsoContains: [] };
  if (shape === 3) return {
    ...base, title: `Gear - Synthetic Armor Set ${sequence}`, contains: `Synthetic Armor Set ${sequence}`,
    items: [{ title: `Synthetic Armor Set ${sequence}`, kind: "FPS Equipment", liner: null, customName: null }], alsoContains: []
  };
  return {
    ...base, title: `Add-Ons - Synthetic Hangar Flair ${sequence}`, contains: `Synthetic Hangar Flair ${sequence}`,
    items: [{ title: `Synthetic Hangar Flair ${sequence}`, kind: "Hangar decoration", liner: null, customName: null }], alsoContains: []
  };
}

// Every fourth buy-back is an upgrade. `upgradesFrom` makes every later one an upgrade as well, for an account
// with a long buy-back list and few buy-back pages to read.
export function buildBuyback(sequence, upgradesFrom = Infinity) {
  const [ship] = SHIPS[sequence % SHIPS.length];
  const from = UPGRADE_SHIPS[sequence % UPGRADE_SHIPS.length];
  const target = UPGRADE_SHIPS[(sequence + 2) % UPGRADE_SHIPS.length];
  const id = 20000000 + sequence;
  const day = dayBefore(sequence);
  if (sequence % 4 === 3 || sequence >= upgradesFrom) return {
    id, title: `Upgrade - ${from} to ${target} Standard Edition`, date: day.long, contains: `${from} to ${target} Upgrade`, upgraded: false,
    upgrade: { fromShipId: String(10 + sequence % 8), toShipId: String(100 + sequence % 8), toSkuId: String(5000 + sequence % 8) }
  };
  // RSI marks a pledge that had an upgrade applied before it was melted.
  return { id, title: sequence % 2 ? `Standalone Ships - ${ship}` : `Package - ${ship} Starter Pack`, date: day.long, contains: `${ship} and ${1 + sequence % 4} items`, upgraded: sequence % 6 === 1, upgrade: null };
}
