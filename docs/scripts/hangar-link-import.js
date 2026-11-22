(function exposeHangarLinkImport(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.CitizenDataHangarLinkImport = api;
})(typeof globalThis === "object" ? globalThis : this, () => {
  "use strict";

  // Opens the file Hangar Link and Fleetview use, { type: "hangarlink", version: 1, pledges: [...] }, as an account
  // document the dashboard can show.
  //
  // Such a file holds the hangar and the buy-backs and nothing else: no Hangar Log, billing, referrals, organizations,
  // or images. The document made here says so. Its generator is named "Hangar Link import", the two lists are marked
  // partial, and every other section is marked not run, so the dashboard shows an incomplete build and the user can
  // complete it with Build. Because the Hangar Log is not run and the lists are not complete, the document can never
  // be the earlier backup a removal comparison rests on.
  //
  // Only what the file states is carried over. A value the file cannot state is null or an empty list, never a guess:
  // a cost in game credits (Hangar Link writes 0 for those), a buy-back cost of 0 (the file does not tell a free
  // buy-back from one with no recorded price), and every image.
  const GENERATOR_NAME = "Hangar Link import";
  const PARSER_VERSION = "hangar-link-import-1";
  const LIST_WARNING = "Imported from a Hangar Link file. Star Citizen Data Downloader did not read this list from RSI.";
  const HANGAR_PAGE_SIZE = 10;
  const BUYBACK_PAGE_SIZE = 100;
  const MONTH_NAMES = Object.freeze(["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]);
  const SECTIONS = Object.freeze([
    "profile", "pledges", "hangarLog", "buybacks", "financial.balances", "referrals.current.prospects", "referrals.current.recruits",
    "referrals.legacy.prospects", "referrals.legacy.recruits", "organizations.memberships", "financial.billingTotal",
    "financial.creditLedgers.storeCredit", "financial.creditLedgers.uec", "financial.creditLedgers.rec", "financial.orders", "financial.subscriptions"
  ]);

  function isObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function isHangarLinkFile(value) {
    return isObject(value) && value.type === "hangarlink" && Array.isArray(value.pledges);
  }

  function isHangarLinkImport(document) {
    return document?.generator?.name === GENERATOR_NAME;
  }

  function textOrNull(value) {
    return typeof value === "string" && value.trim() ? value.trim() : null;
  }

  // "2016-08-25" as RSI shows a date, "August 25, 2016", which is the form the rest of the dashboard reads.
  function shownDate(value) {
    const match = typeof value === "string" ? /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value) : null;
    if (!match) return null;
    const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
    const check = new Date(Date.UTC(year, month - 1, day));
    if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
    return `${MONTH_NAMES[month - 1]} ${day}, ${year}`;
  }

  // "185.0" to an exact "185.00". Null for anything that is not a plain non-negative decimal.
  function decimal(value) {
    const match = typeof value === "string" ? /^([0-9]{1,12})(?:\.([0-9]{1,4}))?$/u.exec(value) : null;
    if (!match) return null;
    return `${String(BigInt(match[1]))}.${(match[2] ?? "").padEnd(2, "0")}`;
  }

  function dollars(record, key) {
    const amount = record.currency === "USD" ? decimal(record[key]) : null;
    return amount === null ? null : { amount, currency: "USD" };
  }

  // The same reading of a name the extension applies to a title on RSI's own page.
  function categoryFor(title, kind = "") {
    const source = `${title ?? ""} ${kind ?? ""}`.toLowerCase();
    if (/\b(?:package|packs?)\b/u.test(source)) return "gamePackage";
    if (/\bstandalone ships?\b/u.test(source) || /^ship\b/u.test(source)) return "standaloneShip";
    if (/\bupgrade\b|\bccu\b/u.test(source)) return "shipUpgrade";
    if (/\breward\b/u.test(source)) return "reward";
    if (/\b(?:armor|undersuit)\b/u.test(source)) return "armor";
    if (/\b(?:weapon|rifle|pistol|smg|lmg|shotgun)\b/u.test(source)) return "weapon";
    if (/\b(?:decoration|hangar|flair|poster|fishtank|fish tank|model|plant)\b/u.test(source)) return "hangarItem";
    return source.trim() ? "other" : "unknown";
  }

  function pageOf(record, pageSize) {
    return record.pageOf === pageSize && Number.isSafeInteger(record.page) && record.page >= 1 ? record.page : null;
  }

  function containedItems(record, parentKey) {
    const items = [];
    const add = (entry, section) => {
      const name = textOrNull(entry?.title);
      if (!isObject(entry) || name === null) return;
      const kind = section === "items" ? textOrNull(entry.kind) : null;
      items.push({
        recordKey: `${parentKey}:item:${items.length}`,
        name,
        kind,
        manufacturer: section === "items" ? textOrNull(entry.liner) : null,
        customName: section === "items" ? textOrNull(entry.itemCustomName) : null,
        section,
        category: categoryFor(name, kind ?? ""),
        quantity: 1,
        images: [],
        catalogIdentifiers: []
      });
    };
    for (const entry of Array.isArray(record.items) ? record.items : []) add(entry, "items");
    for (const entry of Array.isArray(record.alsoContains) ? record.alsoContains : []) add(entry, "alsoContains");
    return items;
  }

  function hangarPledge(record, id, title, date, observation, importedAt) {
    const recordKey = `pledge:${id}`;
    const page = pageOf(record, HANGAR_PAGE_SIZE);
    return {
      pledgeId: id,
      recordKey,
      title,
      category: categoryFor(title),
      availability: null,
      createdDateRaw: date,
      containsSummary: textOrNull(record.contains),
      items: containedItems(record, recordKey),
      images: [],
      sourceLinks: [{ kind: "listing", url: `https://robertsspaceindustries.com/account/pledges${page === null ? "" : `?page=${page}&pagesize=${HANGAR_PAGE_SIZE}`}`, observedAt: importedAt }],
      sourcePage: page,
      state: "current",
      observation,
      meltValue: dollars(record, "cost"),
      meltEligible: typeof record.meltable === "boolean" ? record.meltable : null,
      giftEligible: typeof record.giftable === "boolean" ? record.giftable : null,
      baseValue: dollars(record, "configurationCost"),
      ccuHistory: [],
      catalogIdentifiers: []
    };
  }

  function identifiers(namespace, value) {
    const text = textOrNull(value);
    return text === null ? [] : [{ namespace, value: text, source: "rsi" }];
  }

  function buyback(record, id, title, date, observation, importedAt) {
    const page = pageOf(record, BUYBACK_PAGE_SIZE);
    const upgrade = {
      fromShipIdentifiers: identifiers("ship", record.fromShipId),
      toShipIdentifiers: identifiers("ship", record.toShipId),
      skuIdentifiers: identifiers("sku", record.toSkuId)
    };
    const isUpgrade = record.pledgeType === "upgrade" || Object.values(upgrade).some((list) => list.length > 0);
    const ownPage = typeof record.buybackHref === "string" && record.buybackHref === `/pledge/buyback/${id}`;
    const price = isUpgrade ? null : dollars(record, "cost");
    return {
      buybackId: id,
      recordKey: `buyback:${id}`,
      kind: isUpgrade ? "upgrade" : "ordinary",
      category: categoryFor(title, isUpgrade ? "upgrade" : ""),
      title,
      reclaimDateRaw: date,
      containsSummary: textOrNull(record.contains),
      availability: null,
      images: [],
      sourceLinks: [ownPage
        ? { kind: "detail", url: `https://robertsspaceindustries.com/pledge/buyback/${id}`, observedAt: importedAt }
        : { kind: "listing", url: `https://robertsspaceindustries.com/account/buy-back-pledges${page === null ? "" : `?page=${page}&pagesize=${BUYBACK_PAGE_SIZE}`}`, observedAt: importedAt }],
      sourcePage: page,
      state: "available",
      observation,
      // A cost of 0 does not say whether the buy-back is free or its price was never recorded.
      buybackPrice: price !== null && Number(price.amount) > 0 ? price : null,
      items: [],
      catalogIdentifiers: [],
      upgrade: isUpgrade ? upgrade : null
    };
  }

  function outcome(status, importedAt, records) {
    const listed = status === "partial";
    return { status, parserVersion: listed ? PARSER_VERSION : null, startedAt: listed ? importedAt : null, endedAt: listed ? importedAt : null, records, pagesOrBatches: 0, warnings: listed ? [LIST_WARNING] : [] };
  }

  // Builds the account document. It still needs its integrity stamp, which the caller adds.
  function toAccountDocument(file, { importedAt, localAccountId, generatorVersion } = {}) {
    if (!isHangarLinkFile(file)) throw new Error("This is not a Hangar Link file.");
    if (file.version !== 1) throw new Error(`This Hangar Link file is version ${typeof file.version === "number" ? file.version : "unknown"}. Star Citizen Data Downloader reads version 1.`);
    if (typeof importedAt !== "string" || Number.isNaN(Date.parse(importedAt))) throw new TypeError("An import time is required.");
    if (typeof localAccountId !== "string" || typeof generatorVersion !== "string" || !generatorVersion) throw new TypeError("A local account identifier and a generator version are required.");

    const observation = { firstObservedAt: importedAt, lastObservedAt: importedAt, parserVersion: PARSER_VERSION };
    const handles = new Set();
    const pledges = [];
    const buybacks = [];
    const seen = { pledges: new Set(), buybacks: new Set() };
    const counts = { hangar: 0, buybacks: 0, repeated: 0, leftOut: 0 };
    for (const record of file.pledges) {
      const id = isObject(record) && typeof record.pledgeId === "string" && /^[0-9]{1,15}$/u.test(record.pledgeId) ? Number(record.pledgeId) : null;
      const title = isObject(record) ? textOrNull(record.name) : null;
      const date = isObject(record) ? shownDate(record.date) : null;
      const handle = isObject(record) ? textOrNull(record.hangar) : null;
      if (id === null || title === null || date === null || handle === null || typeof record.buyback !== "boolean") {
        counts.leftOut += 1;
        continue;
      }
      handles.add(handle);
      const list = record.buyback ? "buybacks" : "pledges";
      // Hangar Link's own files can hold the same record more than once.
      if (seen[list].has(id)) {
        counts.repeated += 1;
        continue;
      }
      seen[list].add(id);
      if (record.buyback) buybacks.push(buyback(record, id, title, date, observation, importedAt));
      else pledges.push(hangarPledge(record, id, title, date, observation, importedAt));
    }
    counts.hangar = pledges.length;
    counts.buybacks = buybacks.length;
    if (handles.size > 1) throw new Error("This Hangar Link file holds records of more than one RSI account. Star Citizen Data Downloader opens one account at a time.");
    if (!pledges.length && !buybacks.length) {
      throw new Error(counts.leftOut ? "No record in this Hangar Link file could be read: each needs a pledge number, a name, a date, and its RSI account." : "This Hangar Link file holds no records.");
    }
    const handle = [...handles][0];

    const sectionOutcomes = {};
    for (const section of SECTIONS) sectionOutcomes[section] = outcome("notRun", importedAt, 0);
    sectionOutcomes.pledges = outcome("partial", importedAt, pledges.length);
    sectionOutcomes.buybacks = outcome("partial", importedAt, buybacks.length);

    const document = {
      schemaVersion: 1,
      generator: { name: GENERATOR_NAME, version: generatorVersion },
      exportedAt: importedAt,
      account: { localAccountId, ueeCitizenRecord: null, handle },
      profile: {
        displayName: null, handle, displayTitle: null, enlistedOnRaw: null, location: null, languages: [], website: null, biography: null,
        mainOrganizationSid: null, organizationRank: null, images: [], observation
      },
      pledges,
      hangarLog: [],
      buybacks,
      financial: {
        balances: { storeCredit: null, uec: null, rec: null },
        billingTotal: null,
        creditLedgers: { storeCredit: [], uec: [], rec: [] },
        subscriptions: [],
        orders: []
      },
      referrals: { current: { prospects: [], recruits: [] }, legacy: { prospects: [], recruits: [] } },
      organizations: { memberships: [] },
      sync: { sectionOutcomes, organizationMemberOutcomes: {}, checkpoints: {}, runs: [] }
    };
    return { document, counts };
  }

  return Object.freeze({ GENERATOR_NAME, PARSER_VERSION, isHangarLinkFile, isHangarLinkImport, toAccountDocument });
});
