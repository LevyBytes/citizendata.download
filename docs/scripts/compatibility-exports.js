(function exposeCitizenDataCompatibilityExport(root, factory) {
  "use strict";

  const api = factory(root);
  root.CitizenDataHangarLinkExport = api;
  if (typeof module === "object" && module?.exports) module.exports = api;
})(typeof globalThis === "object" ? globalThis : this, function createCitizenDataCompatibilityExport(root) {
  "use strict";

  // Writes the file Hangar Link and Fleetview import: { type: "hangarlink", version: 1, pledges: [...] }. The hangar and
  // the buy-back list share the one array; each record's "buyback" flag says which it came from.
  //
  // Hangar Link builds this file from the same RSI pages CitizenData reads, and derives several fields from names:
  // insurance, package, starting UEC, pledge type, and the ships of an upgrade. The rules below follow Hangar Link's
  // public reader so a file written here matches one written there. Where the backup holds no value, the field is
  // written the way Hangar Link writes it for a page that showed none, and the caller is told. Nothing in this file
  // changes the backup itself.

  const FIELD_ORDER = Object.freeze(["pledgeId", "name", "contains", "cost", "configurationCost", "currency", "date", "insuranceType", "warbond", "giftable", "meltable", "package", "uec", "pledgeType", "hangar", "page", "pageOf", "alsoContains", "items", "upgradeFrom", "upgradeTo", "buyback", "buybackHref", "fromShipId", "toShipId", "toSkuId"]);
  const HANGAR_PAGE_SIZE = 10;
  const BUYBACK_PAGE_SIZE = 100;
  const MAXIMUM_GIFT_VALUE = 1000;
  const MAXIMUM_ITEM_COPIES = 500;
  const MONTHS = Object.freeze(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]);

  // Longest cover first: a pledge that lists both lifetime and 120 month insurance is lifetime insured.
  const INSURANCE = Object.freeze([
    ["lifetimeinsurance", "insLTI"], ["120monthinsurance", "ins120"], ["72monthinsurance", "ins72"], ["60monthinsurance", "ins60"],
    ["24monthinsurance", "ins24"], ["12monthinsurance", "ins12"], ["6monthinsurance", "ins6"], ["3monthinsurance", "ins3"], ["2monthinsurance", "ins2"]
  ]);

  // Words removed from an upgrade's text, in this order, to leave "<ship> to <ship>".
  const UPGRADE_WORDING = Object.freeze([
    [/Upgrade ?-/giu, ""],
    [/SUBSCRIBERS - INCLUDES HANGAR FLAIR AND 12 MONTHS INSURANCE./giu, " "],
    [/Ship Upgrades ?-/giu, ""],
    [/Standard Upgrade/giu, ""],
    [/Standard Edition/giu, ""],
    [/Subscribers? Warbond Edition/giu, ""],
    [/Warbond Subscribers? Edition/giu, ""],
    [/Subscribers? Edition/giu, ""],
    [/Warbond Edition/giu, ""],
    [/Warbond Upgrade/giu, ""],
    [/Upgrade/giu, ""],
    [/Limited/giu, ""],
    [/Edition/giu, ""]
  ]);

  // Maker names removed from a ship title before it is reduced to slug form. Hangar Link removes them anywhere in the
  // title, which also shortens words such as "Cargo"; the alias list in the ship table allows for that.
  const MAKER_WORDING = Object.freeze([
    [/RSI/giu, ""], [/Kruger/giu, ""], [/ARGO/giu, ""], [/GRIN/giu, ""], [/AEGIS/giu, ""], [/ANVIL/giu, ""], [/AOPOA/giu, ""], [/BANU/giu, ""],
    [/CNOU/giu, ""], [/consolidated/giu, ""], [/outland/giu, ""], [/DRAKE/giu, ""], [/GATAC/giu, ""], [/MISC/giu, ""],
    [/ BISE/giu, " "], [/ BIS/giu, " "], [/BISE /giu, " "], [/BIS /giu, " "],
    [/ESPERIA/giu, ""], [/ORIGIN/giu, ""], [/RSI/giu, ""], [/TUMBRIL/giu, ""], [/VANDUUL/giu, ""], [/Xi'an/giu, ""], [/Crusader/giu, ""],
    [/Greycat Industrial -/giu, ""], [/Greycat /giu, ""], [/- Mini Hauler/giu, ""]
  ]);

  const own = (value, key) => Object.hasOwn(value, key);
  const text = (value) => typeof value === "string" ? value : "";

  function shipTable(candidate) {
    const table = candidate ?? root.CitizenDataHangarLinkShips;
    if (!table || !Array.isArray(table.slugs) || !table.titles || !table.aliases) throw new Error("The Hangar Link ship table did not load. Reload this page.");
    return { slugs: new Set(table.slugs), titles: table.titles, aliases: table.aliases };
  }

  function strip(value, wording) {
    let result = value;
    for (const [pattern, replacement] of wording) result = result.replace(pattern, replacement).trim();
    return result;
  }

  // The Hangar Link slug for a ship title, or null when the table does not know the ship.
  function locateShip(title, table) {
    const exact = text(title).trim();
    if (!exact) return null;
    const listed = own(table.titles, exact.toLowerCase()) ? table.titles[exact.toLowerCase()] : null;
    if (listed && table.slugs.has(listed)) return listed;
    const reduced = strip(exact, MAKER_WORDING).toLowerCase().trim().replace(/[^a-z0-9]/gu, "-").replace(/-+/gu, "-");
    if (table.slugs.has(reduced)) return reduced;
    const alias = own(table.aliases, reduced) ? table.aliases[reduced] : null;
    return alias && table.slugs.has(alias) ? alias : null;
  }

  // "Upgrade - Aurora MR to Avenger Titan Standard Edition" names two ships. Both must be known for either to be written.
  function upgradeShips(source, table) {
    const parts = strip(text(source), UPGRADE_WORDING).replace(/ {2,}/gu, " ").trim().replace(/\t+/gu, " ").trim().toLowerCase().split(" to ");
    if (parts.length < 2) return null;
    const from = locateShip(parts[0], table);
    const to = locateShip(parts.at(-1), table);
    return from && to ? { from, to } : null;
  }

  function nameType(name) {
    const source = text(name).trim();
    if (/Mk II Heartseeker Upgrade/iu.test(source)) return "other";
    const kit = /Upgrade Kit|Livery Upgrade/iu.test(source);
    if (!kit && /Upgrade/iu.test(source)) return "upgrade";
    if (/Package/iu.test(source) || /Standalone Ship/iu.test(source)) return "ship";
    return "other";
  }

  // Hangar Link keeps letters, digits, spaces, and hyphens of a name.
  function plainName(name) {
    return text(name).replace(/&quot;/giu, "").trim().replace(/[^A-Za-z\s0-9-]/gu, "").trim();
  }

  // Numbers are written as Hangar Link writes them: "100.0", "12.5", "17.25".
  function decimalText(value) {
    return Number.isInteger(value) ? `${value}.0` : String(value);
  }

  // The dollar amount of a recorded value, or null when none was recorded. Hangar Link reads a value only when RSI
  // shows it in dollars, and writes 0 for a pledge valued in game credits; so does this.
  function dollars(money) {
    if (!money || typeof money !== "object") return null;
    const value = Number(money.amount);
    if (!Number.isFinite(value)) return null;
    return money.currency === "USD" ? value : 0;
  }

  // "May 19, 2026" or "Sep 02, 2014" to "2026-05-19". RSI shows both month spellings.
  function isoDate(raw) {
    const match = /^([A-Za-z]{3,9})\.? (\d{1,2}), (\d{4})$/u.exec(text(raw).trim());
    if (!match) return null;
    const month = MONTHS.indexOf(match[1].slice(0, 3).toLowerCase());
    const day = Number(match[2]);
    const year = Number(match[3]);
    if (month < 0) return null;
    const check = new Date(Date.UTC(year, month, day));
    if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month || check.getUTCDate() !== day) return null;
    return `${match[3]}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  function insuranceType(titles) {
    const seen = new Set(titles.map((title) => title.toLowerCase().replace(/[^a-z0-9]/gu, "").replace(/months/gu, "month")));
    return INSURANCE.find(([title]) => seen.has(title))?.[1] ?? "insNone";
  }

  function startingUec(alsoTitles, itemTitles) {
    const isStartingMoney = (title) => title.split(":")[0] === "Starting Money";
    const title = alsoTitles.find(isStartingMoney) ?? itemTitles.find(isStartingMoney);
    if (title === undefined) return 0;
    const value = Number.parseFloat(title.replace(/[^0-9.]/gu, ""));
    return Number.isFinite(value) ? value : 0;
  }

  // The page of RSI's list a record was read from: the recorded page, else the page named in its listing link.
  function sourcePage(record) {
    if (Number.isSafeInteger(record.sourcePage) && record.sourcePage >= 1) return record.sourcePage;
    for (const link of Array.isArray(record.sourceLinks) ? record.sourceLinks : []) {
      if (link?.kind !== "listing" || typeof link.url !== "string") continue;
      const match = /[?&]page=(\d{1,6})(?:&|$)/u.exec(link.url);
      if (match && Number(match[1]) >= 1) return Number(match[1]);
    }
    return 1;
  }

  function identifierValue(list) {
    const value = Array.isArray(list) ? list[0]?.value : null;
    return typeof value === "string" ? value : "";
  }

  // RSI lists a buy-back either with a link to its own page, or, for an upgrade, with the three numbers its upgrade
  // tool needs and no link. Hangar Link expects the link as a path, and an empty one for the second kind.
  function buybackListing(buyback) {
    const upgrade = buyback.upgrade && typeof buyback.upgrade === "object" ? buyback.upgrade : {};
    const numbers = { fromShipId: identifierValue(upgrade.fromShipIdentifiers), toShipId: identifierValue(upgrade.toShipIdentifiers), toSkuId: identifierValue(upgrade.skuIdentifiers) };
    for (const link of Array.isArray(buyback.sourceLinks) ? buyback.sourceLinks : []) {
      const match = link?.kind === "detail" && typeof link.url === "string" ? /^https:\/\/robertsspaceindustries\.com(\/pledge\/buyback\/[0-9]+)$/u.exec(link.url) : null;
      if (match) return { buybackHref: match[1], ...numbers };
    }
    const hasNumbers = Object.values(numbers).some(Boolean);
    return { buybackHref: hasNumbers ? "" : `/pledge/buyback/${buyback.buybackId}`, ...numbers };
  }

  // A backup made before CitizenData recorded custom names holds "<title> - <custom name>" as the item name.
  function itemTitle(item, table) {
    const name = text(item.name);
    if (own(item, "customName") || item.kind !== "Ship" || locateShip(name, table)) return { title: name, customName: text(item.customName) };
    const cut = name.lastIndexOf(" - ");
    if (cut > 0 && locateShip(name.slice(0, cut), table)) return { title: name.slice(0, cut), customName: name.slice(cut + 3) };
    return { title: name, customName: "" };
  }

  function hangarRecord(pledge, handle, table, notes) {
    const allItems = Array.isArray(pledge.items) ? pledge.items : [];
    const alsoContains = [];
    const items = [];
    for (const item of allItems) {
      const copies = Math.min(Number.isSafeInteger(item?.quantity) && item.quantity > 1 ? item.quantity : 1, MAXIMUM_ITEM_COPIES);
      if (item?.section === "alsoContains") {
        for (let copy = 0; copy < copies; copy += 1) alsoContains.push({ title: text(item.name) });
        continue;
      }
      const { title, customName } = itemTitle(item, table);
      for (let copy = 0; copy < copies; copy += 1) items.push({ itemCustomName: customName, kind: text(item.kind), liner: text(item.manufacturer), title, slug: "" });
    }
    const alsoTitles = alsoContains.map((entry) => entry.title);
    const itemTitles = items.map((entry) => entry.title);
    const heartseekerMkII = itemTitles.some((title) => /Hornet Mk II.*Heartseeker/iu.test(title));
    for (const item of items) {
      if (item.kind !== "Ship") continue;
      let slug = locateShip(item.title, table);
      if (slug === "f7c-m-super-hornet-mk-ii" && heartseekerMkII && table.slugs.has("f7cm-hornet-heartseeker-mkii")) slug = "f7cm-hornet-heartseeker-mkii";
      if (slug) item.slug = slug;
      else notes.unknownShips.add(item.title);
    }

    // The name RSI shows may end in a coupon code after a colon.
    const shownName = text(pledge.title).split(":")[0];
    const contains = text(pledge.containsSummary);
    let pledgeType = nameType(shownName);
    let upgrade = null;
    if (pledgeType === "upgrade") {
      const only = items.length === 1 && !items[0].kind && !items[0].liner && items[0].title ? items[0].title : null;
      upgrade = upgradeShips(contains, table) ?? upgradeShips(shownName, table) ?? (only ? upgradeShips(only, table) : null);
      if (!upgrade) notes.unknownUpgrades += 1;
    }
    const ships = items.filter((item) => item.kind === "Ship").length;
    if (ships === 1) pledgeType = "ship";
    else if (ships > 1) pledgeType = "pack";

    const value = dollars(pledge.meltValue);
    if (value === null) notes.withoutValue += 1;
    const cost = value ?? 0;
    return {
      pledgeId: String(pledge.pledgeId),
      name: plainName(shownName),
      contains,
      cost: decimalText(cost),
      configurationCost: decimalText(dollars(pledge.baseValue) ?? 0),
      currency: text(pledge.meltValue?.currency) || "USD",
      insuranceType: insuranceType([...alsoTitles, ...itemTitles]),
      // Hangar Link's own files carry false for every pledge: the hangar page has no warbond marker.
      warbond: false,
      // RSI does not allow a pledge worth more than 1000 to be gifted.
      giftable: pledge.giftEligible === true && cost <= MAXIMUM_GIFT_VALUE,
      meltable: pledge.meltEligible === true,
      package: [...alsoTitles, ...itemTitles].includes("Star Citizen Digital Download"),
      uec: decimalText(startingUec(alsoTitles, itemTitles)),
      pledgeType,
      hangar: handle,
      page: sourcePage(pledge),
      pageOf: HANGAR_PAGE_SIZE,
      alsoContains,
      items,
      upgradeFrom: upgrade?.from ?? "",
      upgradeTo: upgrade?.to ?? "",
      buyback: false,
      buybackHref: null,
      fromShipId: null,
      toShipId: null,
      toSkuId: null
    };
  }

  function buybackRecord(buyback, handle, table, notes) {
    const shownName = text(buyback.title).replace(/ - upgraded/giu, " ").trim();
    const contains = text(buyback.containsSummary);
    const pledgeType = nameType(shownName);
    let upgrade = null;
    if (pledgeType === "upgrade") {
      upgrade = upgradeShips(contains, table) ?? upgradeShips(shownName, table);
      if (!upgrade) notes.unknownUpgrades += 1;
    }
    const price = dollars(buyback.buybackPrice);
    // An upgrade's buy-back price is never recorded. Any other buy-back has one once its own page was read.
    const isUpgrade = buyback.kind === "upgrade" || pledgeType === "upgrade";
    if (!isUpgrade) notes.pricedKinds += 1;
    if (price === null) notes[isUpgrade ? "upgradesWithoutPrice" : "withoutPrice"] += 1;
    return {
      pledgeId: String(buyback.buybackId),
      name: plainName(shownName),
      contains,
      cost: decimalText(price ?? 0),
      configurationCost: "0.0",
      currency: text(buyback.buybackPrice?.currency) || "USD",
      insuranceType: "insNone",
      warbond: false,
      giftable: false,
      meltable: false,
      package: false,
      uec: "0.0",
      pledgeType,
      hangar: handle,
      page: sourcePage(buyback),
      pageOf: BUYBACK_PAGE_SIZE,
      alsoContains: [],
      items: [],
      upgradeFrom: upgrade?.from ?? "",
      upgradeTo: upgrade?.to ?? "",
      buyback: true,
      ...buybackListing(buyback)
    };
  }

  function count(number, singular, plural = `${singular}s`) {
    return `${number.toLocaleString("en-US")} ${number === 1 ? singular : plural}`;
  }

  function prepareExport(document, { inventoryScope = "both", ships } = {}) {
    if (!document || typeof document !== "object" || !["hangar", "buybacks", "both"].includes(inventoryScope)) throw new TypeError("Choose a valid compatibility inventory scope.");
    const table = shipTable(ships);
    const handle = text(document.account?.handle);
    if (!handle) throw new Error("This backup does not name its RSI account, which Hangar Link needs.");
    const notes = { unknownShips: new Set(), unknownUpgrades: 0, withoutValue: 0, withoutPrice: 0, upgradesWithoutPrice: 0, pricedKinds: 0, withoutId: 0, withoutDate: 0, notHeld: 0, olderCapture: false, buybacks: 0 };
    const pledges = [];

    const add = (source, idKey, dateKey, heldStates, convert) => {
      for (const record of Array.isArray(source) ? source : []) {
        if (!record || typeof record !== "object") continue;
        // A record RSI no longer lists is history, not something the account holds.
        if (!heldStates.includes(record.state)) { notes.notHeld += 1; continue; }
        if (!Number.isSafeInteger(record[idKey]) || record[idKey] < 0) { notes.withoutId += 1; continue; }
        const date = isoDate(record[dateKey]);
        if (!date) { notes.withoutDate += 1; continue; }
        const converted = { ...convert(record, handle, table, notes), date };
        pledges.push(Object.fromEntries(FIELD_ORDER.map((key) => [key, converted[key]])));
      }
    };
    if (inventoryScope !== "buybacks") {
      add(document.pledges, "pledgeId", "createdDateRaw", ["current"], (record, ...rest) => {
        if (!own(record, "giftEligible")) notes.olderCapture = true;
        return hangarRecord(record, ...rest);
      });
    }
    if (inventoryScope !== "hangar") {
      add(document.buybacks, "buybackId", "reclaimDateRaw", ["available", "unavailable"], (record, ...rest) => {
        notes.buybacks += 1;
        return buybackRecord(record, ...rest);
      });
    }

    const left = [];
    if (notes.withoutId) left.push(`${count(notes.withoutId, "record")} without an RSI pledge number`);
    if (notes.withoutDate) left.push(`${count(notes.withoutDate, "record")} without a readable date`);
    if (notes.notHeld) left.push(`${count(notes.notHeld, "record")} RSI no longer lists`);
    if (!pledges.length) {
      throw new Error(left.length ? `Nothing can be written for Hangar Link. Left out: ${left.join(", ")}.` : "The selected lists are empty, so there is nothing to write for Hangar Link.");
    }

    const warnings = [];
    if (left.length) warnings.push(`Left out: ${left.join(", ")}.`);
    if (notes.unknownShips.size) {
      const names = [...notes.unknownShips].sort();
      warnings.push(`${count(names.length, "ship")} not in the Hangar Link ship table will be listed without a Fleetview model: ${names.slice(0, 5).join(", ")}${names.length > 5 ? `, and ${names.length - 5} more` : ""}.`);
    }
    if (notes.unknownUpgrades) warnings.push(`${count(notes.unknownUpgrades, "upgrade")} could not be matched to two known ships and ${notes.unknownUpgrades === 1 ? "is" : "are"} written without them.`);
    if (notes.withoutValue) warnings.push(`${count(notes.withoutValue, "pledge")} with no recorded value ${notes.withoutValue === 1 ? "is" : "are"} written with a cost of 0.`);
    if (notes.withoutPrice) {
      warnings.push(notes.withoutPrice === notes.pricedKinds
        ? "This backup holds no buy-back prices, so buy-backs are written with a cost of 0. Build it again with the extension to record them."
        : `${count(notes.withoutPrice, "buy-back")} with no recorded price ${notes.withoutPrice === 1 ? "is" : "are"} written with a cost of 0.`);
    }
    if (notes.upgradesWithoutPrice) {
      warnings.push(`${count(notes.upgradesWithoutPrice, "upgrade buy-back")} ${notes.upgradesWithoutPrice === 1 ? "is" : "are"} written with a cost of 0.`);
    }
    if (notes.olderCapture) warnings.push("This backup predates gift, also-contains, maker, and custom-name capture. Update it with the extension to add them.");
    return { payload: { type: "hangarlink", version: 1, pledges }, recordCount: pledges.length, warnings };
  }

  return Object.freeze({ FIELD_ORDER, isoDate, locateShip: (title, ships) => locateShip(title, shipTable(ships)), prepareExport });
});
