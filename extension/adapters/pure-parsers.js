(function initializeCitizenDataPureParsers(root, factory) {
  "use strict";

  const api = factory(root.CitizenDataNormalization);
  root.CitizenDataPureParsers = api;
  if (typeof module === "object" && module?.exports) module.exports = api;
})(globalThis, function createCitizenDataPureParsers(N) {
  "use strict";

  if (!N) throw new Error("CitizenDataNormalization must load before pure-parsers.js.");

  const PARSER_VERSION = "0.42.1";
  const INVENTORY_CATEGORIES = Object.freeze(["gamePackage", "standaloneShip", "shipUpgrade", "reward", "hangarItem", "armor", "weapon", "other", "unknown"]);
  const BALANCE_UNITS = Object.freeze({ storeCredit: "USD", uec: "UEC", rec: "REC" });

  function relatedUrls(input, label) {
    const urls = input === null || input === undefined ? [] : N.list(input, label).map((value, index) => N.normalizeHttpsUrl(value, `${label}[${index}]`));
    return Object.freeze(Array.from(new Set(urls)).sort((left, right) => left < right ? -1 : left > right ? 1 : 0));
  }

  function observation(context, input = []) {
    const urls = relatedUrls(input, "observation.relatedUrls");
    return Object.freeze({ ...context, ...(urls.length ? { relatedUrls: urls } : {}) });
  }

  function outcome(context, records, metadata = {}) {
    const status = metadata.status ?? (metadata.complete === false ? "partial" : "complete");
    if (!["complete", "partial", "failed", "skipped", "notRun"].includes(status)) throw new TypeError("Outcome status is not recognized.");
    const sourceUrls = relatedUrls(metadata.sourceUrls, "outcome.sourceUrls");
    return Object.freeze({
      status,
      parserVersion: status === "skipped" || status === "notRun" ? null : context.parserVersion,
      startedAt: metadata.startedAt ? N.dateTime(metadata.startedAt, "outcome.startedAt") : context.firstObservedAt,
      endedAt: metadata.endedAt ? N.dateTime(metadata.endedAt, "outcome.endedAt") : context.lastObservedAt,
      records,
      pagesOrBatches: N.integer(metadata.pagesOrBatches ?? 1, "outcome.pagesOrBatches"),
      warnings: Object.freeze((metadata.warnings ?? []).map((warning, index) => N.text(warning, `outcome.warnings[${index}]`))),
      ...(sourceUrls.length ? { sourceUrls } : {})
    });
  }

  function result(section, value, records, context, metadata) {
    return Object.freeze({ section, value, outcome: outcome(context, records, metadata) });
  }

  function inventoryCategory(value) {
    return N.oneOf(value ?? "unknown", INVENTORY_CATEGORIES, "Inventory category");
  }

  function catalogIdentifiers(input, label) {
    const source = input === null || input === undefined ? [] : N.list(input, label);
    const normalized = source.map((entry, index) => {
      const identifier = N.plain(entry, `${label}[${index}]`);
      return Object.freeze({
        namespace: N.text(identifier.namespace, `${label}[${index}].namespace`),
        value: N.text(identifier.value ?? identifier.id, `${label}[${index}].value`),
        source: N.oneOf(identifier.source ?? "rsi", ["rsi", "communityMapping"], `${label}[${index}].source`)
      });
    });
    const keys = normalized.map(identifier => `${identifier.namespace}\u0000${identifier.value}\u0000${identifier.source}`);
    if (new Set(keys).size !== keys.length) throw new TypeError(`${label} contains duplicate identifiers.`);
    return Object.freeze(normalized);
  }

  function sourceLink(urlValue, kind, observedAt) {
    const url = new URL(N.normalizeHttpsUrl(urlValue, "Source URL"));
    if (url.hostname !== "robertsspaceindustries.com") throw new TypeError("Source links must use robertsspaceindustries.com.");
    const allowed = kind === "detail"
      ? /^\/pledge\/buyback\/[0-9]+$/u.test(url.pathname) && !url.search
      : /^\/(?:en\/)?account\/(?:pledges|buy-back-pledges)$/u.test(url.pathname);
    if (!allowed) throw new TypeError(`The ${kind} source link is outside the accepted RSI account routes.`);
    return Object.freeze({ kind, url: url.href, observedAt });
  }

  function sourceLinks(input, observedAt, { buyback = false, buybackId = null } = {}) {
    const links = [];
    const source = input ?? {};
    if (source.listingUrl) links.push(sourceLink(source.listingUrl, "listing", observedAt));
    if (source.detailUrl) links.push(sourceLink(source.detailUrl, "detail", observedAt));
    if (!links.length) {
      const fallback = buyback && buybackId !== null
        ? `https://robertsspaceindustries.com/pledge/buyback/${buybackId}`
        : buyback
          ? "https://robertsspaceindustries.com/en/account/buy-back-pledges"
          : "https://robertsspaceindustries.com/en/account/pledges";
      links.push(sourceLink(fallback, buyback && buybackId !== null ? "detail" : "listing", observedAt));
    }
    return Object.freeze(links);
  }

  async function containedItem(input, parentKey, index, context) {
    const source = N.plain(input, `contained item ${index}`);
    const name = N.text(source.name, `contained item ${index}.name`);
    const recordKey = source.recordKey
      ? N.text(source.recordKey, `contained item ${index}.recordKey`)
      : await N.stableKey("contained-item", [parentKey, source.catalogIdentifiers?.[0]?.namespace ?? null, source.catalogIdentifiers?.[0]?.value ?? null, name, index]);
    const images = await N.imageReferences(source.images, "thumbnail", name);
    const record = {
      recordKey,
      name,
      kind: N.nullableText(source.kind, `contained item ${index}.kind`),
      manufacturer: N.nullableText(source.manufacturer, `contained item ${index}.manufacturer`),
      customName: N.nullableText(source.customName, `contained item ${index}.customName`),
      section: N.oneOf(source.section ?? "items", ["items", "alsoContains"], `contained item ${index}.section`),
      category: inventoryCategory(source.category),
      quantity: N.integer(source.quantity ?? 1, `contained item ${index}.quantity`, { minimum: 1 }),
      images,
      relatedUrls: relatedUrls(source.relatedUrls, `contained item ${index}.relatedUrls`),
      catalogIdentifiers: catalogIdentifiers(source.catalogIdentifiers, `contained item ${index}.catalogIdentifiers`)
    };
    return Object.freeze(record);
  }

  async function parseProfile(input, contextInput, metadata = {}) {
    const context = N.context(contextInput, PARSER_VERSION);
    const source = N.plain(input, "Profile payload");
    const handle = N.safeHandle(source.handle, "profile.handle", { nullable: true });
    const ueeCitizenRecord = N.integer(source.ueeCitizenRecord, "profile.ueeCitizenRecord", { nullable: true });
    const exactNullableText = (candidate, label) => {
      if (candidate === null || candidate === undefined) return null;
      if (typeof candidate !== "string" || candidate.length === 0) throw new TypeError(`${label} must be nonempty text or null.`);
      return candidate;
    };
    const badgeSources = source.unlockedBadges === null || source.unlockedBadges === undefined ? [] : N.list(source.unlockedBadges, "profile.unlockedBadges");
    const unlockedBadges = [];
    for (const [index, candidate] of badgeSources.entries()) {
      const badge = N.plain(candidate, `profile.unlockedBadges[${index}]`);
      const sourceIndex = N.integer(badge.sourceIndex, `profile.unlockedBadges[${index}].sourceIndex`);
      const id = N.integer(badge.id, `profile.unlockedBadges[${index}].id`, { nullable: true });
      const title = exactNullableText(badge.title, `profile.unlockedBadges[${index}].title`);
      if ((id === null) !== (title === null)) throw new TypeError(`profile.unlockedBadges[${index}] must contain both an ID and title or two null values.`);
      unlockedBadges.push(Object.freeze({
        sourceIndex,
        id,
        title,
        images: await N.imageReferences(badge.images, "badge", title ?? "Unavailable RSI badge")
      }));
    }
    const nonNullBadges = unlockedBadges.filter((badge) => badge.id !== null);
    const uniquePairs = new Set(nonNullBadges.map((badge) => JSON.stringify([badge.id, badge.title])));
    const badgeCollection = Object.freeze({
      rawRows: unlockedBadges.length,
      nonNullRows: nonNullBadges.length,
      nullRows: unlockedBadges.length - nonNullBadges.length,
      uniqueIdTitlePairs: uniquePairs.size,
      exactDuplicateRows: nonNullBadges.length - uniquePairs.size
    });
    const selectedSource = source.selectedBadge === null || source.selectedBadge === undefined ? null : N.plain(source.selectedBadge, "profile.selectedBadge");
    const selectedTitle = selectedSource ? exactNullableText(selectedSource.title, "profile.selectedBadge.title") : null;
    const selectedBadge = selectedSource === null ? null : Object.freeze({
      title: selectedTitle,
      images: await N.imageReferences(selectedSource.images, "badge-favorite", selectedTitle ?? "Selected RSI badge")
    });
    const featuredSources = source.featuredBadges === null || source.featuredBadges === undefined ? [] : N.list(source.featuredBadges, "profile.featuredBadges");
    const featuredBadges = [];
    for (const [index, candidate] of featuredSources.entries()) {
      const badge = N.plain(candidate, `profile.featuredBadges[${index}]`);
      const title = exactNullableText(badge.title, `profile.featuredBadges[${index}].title`);
      featuredBadges.push(Object.freeze({
        title,
        images: await N.imageReferences(badge.images, "badge-featured", title ?? "Featured RSI badge"),
        relatedUrls: relatedUrls(badge.relatedUrls, `profile.featuredBadges[${index}].relatedUrls`)
      }));
    }
    const value = Object.freeze({
      displayName: N.nullableText(source.displayName, "profile.displayName"),
      handle,
      displayTitle: N.nullableText(source.displayTitle, "profile.displayTitle"),
      enlistedOnRaw: N.nullableText(source.enlistedOnRaw, "profile.enlistedOnRaw"),
      location: N.nullableText(source.location, "profile.location"),
      languages: Object.freeze(Array.from(new Set((source.languages ?? []).map((language, index) => N.text(language, `profile.languages[${index}]`))))),
      website: N.nullableText(source.website, "profile.website"),
      biography: N.nullableText(source.biography, "profile.biography"),
      mainOrganizationSid: N.nullableText(source.mainOrganizationSid, "profile.mainOrganizationSid"),
      organizationRank: N.nullableText(source.organizationRank, "profile.organizationRank"),
      dossierBadgeTitle: N.nullableText(source.dossierBadgeTitle, "profile.dossierBadgeTitle"),
      images: await N.imageReferences(source.images, "avatar", handle ?? source.displayName ?? "RSI profile"),
      unlockedBadges: Object.freeze(unlockedBadges),
      badgeCollection,
      selectedBadge,
      featuredBadges: Object.freeze(featuredBadges),
      observation: observation(context, source.relatedUrls)
    });
    return Object.freeze({ ...result("profile", value, 1, context, metadata), accountMetadata: Object.freeze({ ueeCitizenRecord }) });
  }

  async function parsePledges(input, contextInput, metadata = {}) {
    const context = N.context(contextInput, PARSER_VERSION);
    const sourceRecords = N.list(input, "Pledge payload");
    const value = [];
    for (const [index, entry] of sourceRecords.entries()) {
      const source = N.plain(entry, `pledges[${index}]`);
      const pledgeId = N.integer(source.pledgeId, `pledges[${index}].pledgeId`, { nullable: true });
      const title = N.text(source.title, `pledges[${index}].title`);
      const recordKey = source.recordKey
        ? N.text(source.recordKey, `pledges[${index}].recordKey`)
        : pledgeId === null
          ? await N.stableKey("pledge", [title, source.createdDateRaw ?? null, source.containsSummary ?? null])
          : `pledge:${pledgeId}`;
      const items = [];
      for (const [itemIndex, item] of N.list(source.items ?? [], `pledges[${index}].items`).entries()) items.push(await containedItem(item, recordKey, itemIndex, context));
      const record = {
        pledgeId,
        recordKey,
        title,
        category: inventoryCategory(source.category),
        availability: N.nullableText(source.availability, `pledges[${index}].availability`),
        createdDateRaw: N.nullableText(source.createdDateRaw, `pledges[${index}].createdDateRaw`),
        containsSummary: N.nullableText(source.containsSummary, `pledges[${index}].containsSummary`),
        items: Object.freeze(items),
        images: await N.imageReferences(source.images, "thumbnail", title),
        sourceLinks: sourceLinks(source, context.lastObservedAt),
        sourcePage: N.integer(source.sourcePage, `pledges[${index}].sourcePage`, { nullable: true, minimum: 1 }),
        state: N.oneOf(source.state ?? "current", ["current", "missing-unresolved", "historical"], `pledges[${index}].state`),
        observation: observation(context, source.relatedUrls),
        meltValue: N.money(source.meltValue, `pledges[${index}].meltValue`),
        meltEligible: N.booleanOrNull(source.meltEligible, `pledges[${index}].meltEligible`),
        giftEligible: N.booleanOrNull(source.giftEligible, `pledges[${index}].giftEligible`),
        baseValue: N.money(source.baseValue, `pledges[${index}].baseValue`),
        ccuHistory: Object.freeze([]),
        catalogIdentifiers: catalogIdentifiers(source.catalogIdentifiers, `pledges[${index}].catalogIdentifiers`)
      };
      if (Array.isArray(source.ccuHistory)) {
        const history = [];
        for (const [stepIndex, step] of source.ccuHistory.entries()) history.push(await normalizeCcuStep(step, stepIndex, recordKey));
        record.ccuHistory = Object.freeze(history);
      }
      value.push(Object.freeze(record));
    }
    assertUnique(value, "recordKey", "Pledge");
    return result("pledges", Object.freeze(value), value.length, context, metadata);
  }

  async function normalizeCcuStep(input, index, pledgeKey) {
    const source = N.plain(input, `CCU step ${index}`);
    const sourceEventKeys = Object.freeze(Array.from(new Set((source.sourceEventKeys ?? []).map((key, keyIndex) => N.text(key, `CCU step ${index}.sourceEventKeys[${keyIndex}]`)))));
    const record = {
      stepKey: source.stepKey ? N.text(source.stepKey, `CCU step ${index}.stepKey`) : await N.stableKey("ccu-step", [pledgeKey, index, source.fromShip, source.toShip, source.appliedDateRaw ?? null, ...sourceEventKeys]),
      fromShip: N.text(source.fromShip, `CCU step ${index}.fromShip`),
      toShip: N.text(source.toShip, `CCU step ${index}.toShip`),
      appliedDateRaw: N.nullableText(source.appliedDateRaw, `CCU step ${index}.appliedDateRaw`),
      cost: N.money(source.cost, `CCU step ${index}.cost`),
      cumulativeValue: N.money(source.cumulativeValue, `CCU step ${index}.cumulativeValue`),
      sourceEventKeys
    };
    return Object.freeze(record);
  }

  async function parseBuybacks(input, contextInput, metadata = {}) {
    const context = N.context(contextInput, PARSER_VERSION);
    const sourceRecords = N.list(input, "Buyback payload");
    const value = [];
    for (const [index, entry] of sourceRecords.entries()) {
      const source = N.plain(entry, `buybacks[${index}]`);
      const buybackId = N.integer(source.buybackId, `buybacks[${index}].buybackId`, { nullable: true });
      const title = N.text(source.title, `buybacks[${index}].title`);
      const recordKey = source.recordKey
        ? N.text(source.recordKey, `buybacks[${index}].recordKey`)
        : buybackId === null
          ? await N.stableKey("buyback", [title, source.reclaimDateRaw ?? null, source.containsSummary ?? null])
          : `buyback:${buybackId}`;
      const items = [];
      for (const [itemIndex, item] of N.list(source.items ?? [], `buybacks[${index}].items`).entries()) items.push(await containedItem(item, recordKey, itemIndex, context));
      const record = {
        buybackId,
        recordKey,
        kind: N.oneOf(source.kind ?? "unknown", ["ordinary", "upgrade", "unknown"], `buybacks[${index}].kind`),
        category: inventoryCategory(source.category),
        title,
        reclaimDateRaw: N.nullableText(source.reclaimDateRaw, `buybacks[${index}].reclaimDateRaw`),
        containsSummary: N.nullableText(source.containsSummary, `buybacks[${index}].containsSummary`),
        availability: N.nullableText(source.availability, `buybacks[${index}].availability`),
        items: Object.freeze(items),
        images: await N.imageReferences(source.images, "thumbnail", title),
        sourceLinks: sourceLinks(source, context.lastObservedAt, { buyback: true, buybackId }),
        sourcePage: N.integer(source.sourcePage, `buybacks[${index}].sourcePage`, { nullable: true, minimum: 1 }),
        state: N.oneOf(source.state ?? "available", ["available", "unavailable", "missing-unresolved", "historical"], `buybacks[${index}].state`),
        observation: observation(context, source.relatedUrls),
        buybackPrice: N.money(source.buybackPrice, `buybacks[${index}].buybackPrice`),
        catalogIdentifiers: catalogIdentifiers(source.catalogIdentifiers, `buybacks[${index}].catalogIdentifiers`),
        upgrade: null
      };
      if (record.kind === "upgrade") {
        const upgrade = N.plain(source.upgrade, `buybacks[${index}].upgrade`);
        record.upgrade = Object.freeze({
          fromShipIdentifiers: catalogIdentifiers(upgrade.fromShipIdentifiers, `buybacks[${index}].upgrade.fromShipIdentifiers`),
          toShipIdentifiers: catalogIdentifiers(upgrade.toShipIdentifiers, `buybacks[${index}].upgrade.toShipIdentifiers`),
          skuIdentifiers: catalogIdentifiers(upgrade.skuIdentifiers, `buybacks[${index}].upgrade.skuIdentifiers`)
        });
      }
      value.push(Object.freeze(record));
    }
    assertUnique(value, "recordKey", "Buyback");
    return result("buybacks", Object.freeze(value), value.length, context, metadata);
  }

  // The address a buy-back's own page answered at, which RSI serves with or without a language prefix.
  function buybackPageUrl(value, buybackId, label) {
    const url = new URL(N.normalizeHttpsUrl(value, label));
    if (url.hostname !== "robertsspaceindustries.com" || url.search || !new RegExp(`^/(?:[a-z]{2}/)?pledge/buyback/${buybackId}$`, "u").test(url.pathname)) {
      throw new TypeError(`${label} is not the page of buy-back ${buybackId}.`);
    }
    return url.href;
  }

  // The price RSI asked for each different CCU buy-back when it was read. RSI gives the amount in cents of a US
  // dollar. An upgrade whose price the collector could not read is listed by the collector and is skipped here.
  async function parseBuybackUpgradePrices(input, contextInput, metadata = {}) {
    const context = N.context(contextInput, PARSER_VERSION);
    const value = [];
    const everyRow = N.list(input, "Buyback upgrade price payload");
    // One row holds the ships the hangar's CCU pledges start from; it is no price.
    const hangarRow = everyRow.find((entry) => entry?.key === "hangar-upgrade-ships") ?? null;
    const rows = everyRow.filter((entry) => entry !== hangarRow);
    const hangarShips = new Map((Array.isArray(hangarRow?.ships) ? hangarRow.ships : []).filter((ship) => Number.isSafeInteger(ship?.id)).map((ship) => [ship.id, ship]));
    const hangarUpgradeShips = [];
    for (const [index, entry] of (Array.isArray(hangarRow?.pledges) ? hangarRow.pledges : []).entries()) {
      const ship = hangarShips.get(entry?.shipId);
      if (!ship?.image) continue;
      const fromShipName = N.nullableText(ship.name ?? null, `hangarUpgradeShips[${index}].fromShipName`);
      hangarUpgradeShips.push(Object.freeze({
        pledgeId: N.integer(entry.pledgeId, `hangarUpgradeShips[${index}].pledgeId`, { minimum: 1 }),
        fromShipName,
        images: await N.imageReferences([{ url: ship.image }], "upgrade-source", fromShipName ?? "Upgrade source")
      }));
    }
    // A ship is read with the first upgrade that starts from it or leads to it, and kept with that row.
    const ships = new Map();
    for (const entry of rows) {
      for (const ship of Array.isArray(entry?.ships) ? entry.ships : []) {
        if (Number.isSafeInteger(ship?.id)) ships.set(ship.id, ship);
      }
    }
    for (const [index, entry] of rows.entries()) {
      const label = `buybackUpgradePrices[${index}]`;
      const source = N.plain(entry, label);
      const [fromShipId, toShipId, toSkuId, buybackId] = ["fromShipId", "toShipId", "toSkuId", "buybackId"].map((name) => N.integer(source[name], `${label}.${name}`, { minimum: 1 }));
      // The ship the upgrade starts from and the ship it leads to, each with its image, when RSI listed them.
      const fromShip = ships.get(fromShipId) ?? null;
      const ship = ships.get(toShipId) ?? null;
      const fromShipName = N.nullableText(fromShip?.name ?? null, `${label}.fromShipName`);
      const toShipName = N.nullableText(ship?.name ?? null, `${label}.toShipName`);
      const images = [
        ...await N.imageReferences(fromShip?.image ? [{ url: fromShip.image }] : [], "upgrade-source", fromShipName ?? "Upgrade source"),
        ...await N.imageReferences(ship?.image ? [{ url: ship.image }] : [], "upgrade-destination", toShipName ?? "Upgrade destination")
      ];
      const unread = source.unavailable === true;
      // An upgrade RSI gave no price for is listed only for its ships.
      if (unread && fromShipName === null && toShipName === null && images.length === 0) continue;
      const nativeAmount = unread ? null : N.integer(source.nativeAmount, `${label}.nativeAmount`, { minimum: 0 });
      value.push(Object.freeze({
        recordKey: `buyback-upgrade-price:${fromShipId}:${toShipId}:${toSkuId}`,
        fromShipId,
        toShipId,
        toSkuId,
        readFromBuybackId: buybackId,
        fromShipName,
        toShipName,
        images,
        price: unread ? null : Object.freeze({ amount: (nativeAmount / 100).toFixed(2), currency: "USD" }),
        nativeAmount,
        capturedAt: N.dateTime(source.capturedAt, `${label}.capturedAt`)
      }));
    }
    assertUnique(value, "recordKey", "Buyback upgrade price");
    // The hangar's ships travel beside the prices to the assembler, which puts each image on its pledge.
    return Object.freeze({ ...result("buybackUpgradePrices", Object.freeze(value), value.length, context, metadata), hangarUpgradeShips: Object.freeze(hangarUpgradeShips) });
  }

  // What each buy-back's own page showed: its price on the day it was read, any discount as shown, and what the
  // pledge contains. A page the collector could not read is listed by the collector as unavailable and is skipped here.
  async function parseBuybackDetails(input, contextInput, metadata = {}) {
    const context = N.context(contextInput, PARSER_VERSION);
    const value = [];
    for (const [index, entry] of N.list(input, "Buyback detail payload").entries()) {
      const label = `buybackDetails[${index}]`;
      const source = N.plain(entry, label);
      const buybackId = N.integer(source.buybackId, `${label}.buybackId`, { minimum: 1 });
      if (source.unavailable === true) continue;
      const title = N.text(source.title, `${label}.title`);
      const name = N.text(source.name ?? title, `${label}.name`);
      const ships = [];
      for (const [shipIndex, shipEntry] of N.list(source.ships ?? [], `${label}.ships`).entries()) {
        const ship = N.plain(shipEntry, `${label}.ships[${shipIndex}]`);
        const shipName = N.text(ship.name, `${label}.ships[${shipIndex}].name`);
        ships.push(Object.freeze({
          name: shipName,
          manufacturer: N.nullableText(ship.manufacturer, `${label}.ships[${shipIndex}].manufacturer`),
          focus: N.nullableText(ship.focus, `${label}.ships[${shipIndex}].focus`),
          shipPageUrl: ship.shipPageUrl ? N.normalizeHttpsUrl(ship.shipPageUrl, `${label}.ships[${shipIndex}].shipPageUrl`) : null,
          images: await N.imageReferences(ship.images, "ship", shipName)
        }));
      }
      const discountPercent = source.discountPercent === null || source.discountPercent === undefined ? null : source.discountPercent;
      if (discountPercent !== null && (typeof discountPercent !== "number" || !Number.isFinite(discountPercent) || discountPercent < 0 || discountPercent > 100)) {
        throw new TypeError(`${label}.discountPercent must be a number from 0 through 100 or null.`);
      }
      value.push(Object.freeze({
        buybackId,
        recordKey: `buyback-detail:${buybackId}`,
        title,
        categoryLabel: N.nullableText(source.categoryLabel, `${label}.categoryLabel`),
        name,
        pageType: N.nullableText(source.pageType, `${label}.pageType`),
        price: N.money(source.price, `${label}.price`),
        priceText: N.nullableText(source.priceText, `${label}.priceText`),
        originalPrice: N.money(source.originalPrice, `${label}.originalPrice`),
        discountPercent,
        discountText: N.nullableText(source.discountText, `${label}.discountText`),
        priceDataValue: N.nullableText(source.priceDataValue, `${label}.priceDataValue`),
        priceDataCurrency: N.nullableText(source.priceDataCurrency, `${label}.priceDataCurrency`),
        skuId: N.nullableText(source.skuId, `${label}.skuId`),
        descriptionTitle: N.nullableText(source.descriptionTitle, `${label}.descriptionTitle`),
        description: N.rawText(source.description ?? null, `${label}.description`, { nullable: true }) || null,
        ships: Object.freeze(ships),
        alsoContains: Object.freeze(N.list(source.alsoContains ?? [], `${label}.alsoContains`).map((item, itemIndex) => N.text(item, `${label}.alsoContains[${itemIndex}]`))),
        images: await N.imageReferences(source.images, "detail", name),
        buybackTokensAvailable: N.integer(source.buybackTokensAvailable, `${label}.buybackTokensAvailable`, { nullable: true }),
        sourceUrl: buybackPageUrl(source.sourceUrl, buybackId, `${label}.sourceUrl`),
        capturedAt: N.dateTime(source.capturedAt, `${label}.capturedAt`)
      }));
    }
    assertUnique(value, "recordKey", "Buyback detail");
    return result("buybackDetails", Object.freeze(value), value.length, context, metadata);
  }

  async function parseHangarLog(input, contextInput, metadata = {}) {
    const context = N.context(contextInput, PARSER_VERSION);
    const sourceRecords = N.list(input, "Hangar Log payload");
    const prepared = [];
    for (const [index, entry] of sourceRecords.entries()) {
      const source = N.plain(entry, `hangarLog[${index}]`);
      const rawTimestamp = N.text(source.rawTimestamp, `hangarLog[${index}].rawTimestamp`);
      const subjectId = N.integer(source.subjectId, `hangarLog[${index}].subjectId`);
      const subjectName = N.text(source.subjectName, `hangarLog[${index}].subjectName`);
      const kind = N.text(source.kind ?? "unknown", `hangarLog[${index}].kind`);
      const rawDetail = N.rawText(source.rawDetail ?? "", `hangarLog[${index}].rawDetail`);
      const fingerprint = await N.sha256Hex([rawTimestamp, subjectId, subjectName, kind, rawDetail].join("\u001f"));
      prepared.push({
        fingerprint,
        rawTimestamp,
        subjectId,
        subjectName,
        kind,
        rawDetail,
        parsed: Object.freeze(N.cloneJson(source.parsed ?? {}, `hangarLog[${index}].parsed`)),
        observation: observation(context, source.relatedUrls)
      });
    }
    // RSI presents Hangar Log rows newest first. Numbering identical rows from
    // the oldest occurrence keeps existing event keys stable when another
    // identical row later appears at the front of the list.
    const remainingByFingerprint = new Map();
    for (const entry of prepared) remainingByFingerprint.set(entry.fingerprint, (remainingByFingerprint.get(entry.fingerprint) ?? 0) + 1);
    const value = prepared.map((entry) => {
      const occurrenceOrdinal = remainingByFingerprint.get(entry.fingerprint);
      remainingByFingerprint.set(entry.fingerprint, occurrenceOrdinal - 1);
      return Object.freeze({ ...entry, occurrenceOrdinal });
    });
    return result("hangarLog", Object.freeze(value), value.length, context, metadata);
  }

  async function parseBalances(input, contextInput, metadata = {}) {
    const context = N.context(contextInput, PARSER_VERSION);
    const source = N.plain(input, "Balance payload");
    const value = {};
    let records = 0;
    for (const [key, unit] of Object.entries(BALANCE_UNITS)) {
      const raw = source[key];
      if (raw === null || raw === undefined) value[key] = null;
      else {
        const entry = N.plain(raw, `balances.${key}`);
        value[key] = Object.freeze({
          amount: N.decimal(entry.amount, `balances.${key}.amount`),
          unit: N.oneOf(entry.unit ?? unit, [unit], `balances.${key}.unit`),
          observedAt: context.lastObservedAt
        });
        records += 1;
      }
    }
    return result("financial.balances", Object.freeze(value), records, context, metadata);
  }

  async function parseCreditLedger(input, contextInput, { ledger, ...metadata } = {}) {
    const context = N.context(contextInput, PARSER_VERSION);
    const key = N.oneOf(ledger, Object.keys(BALANCE_UNITS), "Ledger");
    const unit = BALANCE_UNITS[key];
    const sourceRecords = N.list(input, `${key} ledger payload`);
    const counts = new Map();
    const value = [];
    for (const [index, entry] of sourceRecords.entries()) {
      const source = N.plain(entry, `${key} ledger[${index}]`);
      const rawTimestamp = N.text(source.rawTimestamp, `${key} ledger[${index}].rawTimestamp`);
      const amount = N.decimal(source.amount, `${key} ledger[${index}].amount`);
      const rawDetail = N.rawText(source.rawDetail ?? "", `${key} ledger[${index}].rawDetail`);
      const fingerprint = await N.sha256Hex([key, rawTimestamp, amount, rawDetail].join("\u001f"));
      const ordinal = (counts.get(fingerprint) ?? 0) + 1;
      counts.set(fingerprint, ordinal);
      value.push(Object.freeze({
        fingerprint,
        occurrenceOrdinal: ordinal,
        rawTimestamp,
        amount,
        unit,
        rawDetail,
        parsed: Object.freeze(N.cloneJson(source.parsed ?? {}, `${key} ledger[${index}].parsed`)),
        observation: observation(context, source.relatedUrls)
      }));
    }
    return result(`financial.creditLedgers.${key}`, Object.freeze(value), value.length, context, metadata);
  }

  function payment(input, label) {
    const source = N.plain(input, label);
    return Object.freeze({
      rawTimestamp: N.text(source.rawTimestamp, `${label}.rawTimestamp`),
      processor: N.nullableText(source.processor, `${label}.processor`),
      status: N.text(source.status, `${label}.status`),
      amount: N.money(source.amount, `${label}.amount`, { nullable: false })
    });
  }

  async function parseSubscriptions(input, contextInput, metadata = {}) {
    const context = N.context(contextInput, PARSER_VERSION);
    const sourceRecords = N.list(input, "Subscription payload");
    const value = [];
    for (const [index, entry] of sourceRecords.entries()) {
      const source = N.plain(entry, `subscriptions[${index}]`);
      value.push(Object.freeze({
        subscriptionId: N.text(source.subscriptionId, `subscriptions[${index}].subscriptionId`),
        plan: N.text(source.plan, `subscriptions[${index}].plan`),
        state: N.oneOf(source.state, ["active", "ended"], `subscriptions[${index}].state`),
        startDateRaw: N.text(source.startDateRaw, `subscriptions[${index}].startDateRaw`),
        endDateRaw: N.nullableText(source.endDateRaw, `subscriptions[${index}].endDateRaw`),
        recurringState: N.nullableText(source.recurringState, `subscriptions[${index}].recurringState`),
        amount: N.money(source.amount, `subscriptions[${index}].amount`),
        totalPaid: N.money(source.totalPaid, `subscriptions[${index}].totalPaid`),
        totalTimeRaw: N.nullableText(source.totalTimeRaw, `subscriptions[${index}].totalTimeRaw`),
        payments: Object.freeze((source.payments ?? []).map((entryPayment, paymentIndex) => payment(entryPayment, `subscriptions[${index}].payments[${paymentIndex}]`))),
        images: await N.imageReferences(source.images, "subscription", source.plan),
        observation: observation(context, source.relatedUrls)
      }));
    }
    assertUnique(value, "subscriptionId", "Subscription");
    return result("financial.subscriptions", Object.freeze(value), value.length, context, metadata);
  }

  function address(input, label) {
    if (input === null || input === undefined) return null;
    const source = N.plain(input, label);
    return Object.freeze({
      name: N.nullableText(source.name, `${label}.name`),
      lines: Object.freeze((source.lines ?? []).map((line, index) => N.rawText(line, `${label}.lines[${index}]`))),
      city: N.nullableText(source.city, `${label}.city`),
      region: N.nullableText(source.region, `${label}.region`),
      postalCode: N.nullableText(source.postalCode, `${label}.postalCode`),
      country: N.nullableText(source.country, `${label}.country`)
    });
  }

  async function orderItem(input, label) {
    const source = N.plain(input, label);
    return Object.freeze({
      name: N.text(source.name, `${label}.name`),
      quantity: N.integer(source.quantity ?? 1, `${label}.quantity`, { minimum: 1 }),
      unitPrice: N.money(source.unitPrice, `${label}.unitPrice`, { nullable: false }),
      discount: N.money(source.discount, `${label}.discount`, { nullable: false }),
      total: N.money(source.total, `${label}.total`, { nullable: false }),
      physical: N.boolean(source.physical, `${label}.physical`),
      trackingAvailable: N.boolean(source.trackingAvailable, `${label}.trackingAvailable`),
      images: await N.imageReferences(source.images, "order-item", source.name),
      relatedUrls: relatedUrls(source.relatedUrls, `${label}.relatedUrls`)
    });
  }

  async function parseOrders(input, contextInput, metadata = {}) {
    const context = N.context(contextInput, PARSER_VERSION);
    const sourceRecords = N.list(input, "Order payload");
    const value = [];
    for (const [index, entry] of sourceRecords.entries()) {
      const source = N.plain(entry, `orders[${index}]`);
      const items = [];
      for (const [itemIndex, item] of N.list(source.items ?? [], `orders[${index}].items`).entries()) items.push(await orderItem(item, `orders[${index}].items[${itemIndex}]`));
      value.push(Object.freeze({
        orderId: N.text(source.orderId, `orders[${index}].orderId`),
        placedAtRaw: N.text(source.placedAtRaw, `orders[${index}].placedAtRaw`),
        storefront: N.nullableText(source.storefront, `orders[${index}].storefront`),
        status: N.text(source.status, `orders[${index}].status`),
        paymentState: N.nullableText(source.paymentState, `orders[${index}].paymentState`),
        fulfillmentState: N.nullableText(source.fulfillmentState, `orders[${index}].fulfillmentState`),
        physical: source.physical === undefined ? items.some(item => item.physical) : N.boolean(source.physical, `orders[${index}].physical`),
        items: Object.freeze(items),
        billingAddress: address(source.billingAddress, `orders[${index}].billingAddress`),
        shippingAddress: address(source.shippingAddress, `orders[${index}].shippingAddress`),
        itemsTotal: N.money(source.itemsTotal, `orders[${index}].itemsTotal`, { nullable: false }),
        additionalDiscount: N.money(source.additionalDiscount, `orders[${index}].additionalDiscount`, { nullable: false }),
        creditsUsed: N.money(source.creditsUsed, `orders[${index}].creditsUsed`, { nullable: false }),
        shippingAndHandling: N.money(source.shippingAndHandling, `orders[${index}].shippingAndHandling`),
        tax: N.money(source.tax, `orders[${index}].tax`),
        total: N.money(source.total, `orders[${index}].total`, { nullable: false }),
        payments: Object.freeze((source.payments ?? []).map((entryPayment, paymentIndex) => payment(entryPayment, `orders[${index}].payments[${paymentIndex}]`))),
        invoiceAvailable: N.boolean(source.invoiceAvailable, `orders[${index}].invoiceAvailable`),
        observation: observation(context, source.relatedUrls)
      }));
    }
    assertUnique(value, "orderId", "Order");
    return result("financial.orders", Object.freeze(value), value.length, context, metadata);
  }

  async function parseBillingTotal(input, contextInput, metadata = {}) {
    const context = N.context(contextInput, PARSER_VERSION);
    const value = input === null || input === undefined ? null : Object.freeze({
      ...N.money(input, "Billing total", { nullable: false }),
      observedAt: context.lastObservedAt,
      source: "billingPageTotal"
    });
    return result("financial.billingTotal", value, value ? 1 : 0, context, metadata);
  }

  async function referralPerson(input, ladder, kind, index, context) {
    const source = N.plain(input, `${ladder} ${kind}[${index}]`);
    const displayName = N.nullableText(source.displayName, `${ladder} ${kind}[${index}].displayName`);
    const handle = N.safeHandle(source.handle, `${ladder} ${kind}[${index}].handle`, { nullable: true });
    const dateRaw = N.text(source.dateRaw, `${ladder} ${kind}[${index}].dateRaw`);
    const exactRawIdentity = (value, label) => {
      if (value === null || value === undefined) return null;
      if (typeof value !== "string") throw new TypeError(`${label} must be source text or null.`);
      return value;
    };
    return Object.freeze({
      recordKey: source.recordKey ? N.text(source.recordKey, `${ladder} ${kind}[${index}].recordKey`) : await N.stableKey("referral", [ladder, kind, handle, dateRaw]),
      displayName,
      handle,
      displayNameRaw: exactRawIdentity(source.displayNameRaw ?? source.displayName, `${ladder} ${kind}[${index}].displayNameRaw`),
      nicknameRaw: exactRawIdentity(source.nicknameRaw ?? source.handle, `${ladder} ${kind}[${index}].nicknameRaw`),
      dateLabel: N.oneOf(source.dateLabel, ["enlistedOn", "purchasedOn"], `${ladder} ${kind}[${index}].dateLabel`),
      dateRaw,
      dateSortKey: N.dateOrNull(source.dateSortKey, `${ladder} ${kind}[${index}].dateSortKey`),
      images: await N.imageReferences(source.images, "avatar", displayName ?? handle ?? "RSI referral"),
      observation: observation(context, source.relatedUrls)
    });
  }

  async function parseReferrals(input, contextInput, { ladder, kind, ...metadata } = {}) {
    const context = N.context(contextInput, PARSER_VERSION);
    const sourceName = N.oneOf(ladder, ["current", "legacy"], "Referral ladder");
    const recordKind = N.oneOf(kind, ["prospects", "recruits"], "Referral kind");
    const sourceRecords = N.list(input, `${sourceName} ${recordKind} payload`);
    const value = [];
    for (const [index, entry] of sourceRecords.entries()) value.push(await referralPerson(entry, sourceName, recordKind, index, context));
    assertUnique(value, "recordKey", "Referral");
    return result(`referrals.${sourceName}.${recordKind}`, Object.freeze(value), value.length, context, metadata);
  }

  async function parseOrganizationMemberships(input, contextInput, metadata = {}) {
    const context = N.context(contextInput, PARSER_VERSION);
    const sourceRecords = N.list(input, "Organization membership payload");
    const value = [];
    for (const [index, entry] of sourceRecords.entries()) {
      const source = N.plain(entry, `organizations.memberships[${index}]`);
      const name = N.text(source.name, `organizations.memberships[${index}].name`);
      value.push(Object.freeze({
        sid: N.text(source.sid, `organizations.memberships[${index}].sid`),
        name,
        membershipType: N.oneOf(source.membershipType, ["main", "affiliate"], `organizations.memberships[${index}].membershipType`),
        memberCount: N.integer(source.memberCount, `organizations.memberships[${index}].memberCount`),
        rank: N.nullableText(source.rank, `organizations.memberships[${index}].rank`),
        archetype: N.nullableText(source.archetype, `organizations.memberships[${index}].archetype`),
        language: N.nullableText(source.language, `organizations.memberships[${index}].language`),
        primaryActivity: N.nullableText(source.primaryActivity, `organizations.memberships[${index}].primaryActivity`),
        secondaryActivity: N.nullableText(source.secondaryActivity, `organizations.memberships[${index}].secondaryActivity`),
        recruiting: N.booleanOrNull(source.recruiting, `organizations.memberships[${index}].recruiting`),
        rolePlay: N.booleanOrNull(source.rolePlay, `organizations.memberships[${index}].rolePlay`),
        commitment: N.nullableText(source.commitment, `organizations.memberships[${index}].commitment`),
        exclusive: N.booleanOrNull(source.exclusive, `organizations.memberships[${index}].exclusive`),
        images: await N.imageReferences(source.images, "organization-emblem", name),
        observation: observation(context, source.relatedUrls)
      }));
    }
    assertUnique(value, "sid", "Organization membership");
    return result("organizations.memberships", Object.freeze(value), value.length, context, metadata);
  }

  async function parseOrganizationMembers(input, contextInput, { organizationSid, ...metadata } = {}) {
    const context = N.context(contextInput, PARSER_VERSION);
    const sid = N.text(organizationSid, "Organization SID");
    if (!/^[A-Z0-9][A-Z0-9_-]{0,63}$/u.test(sid)) throw new TypeError("Organization SID must be a validated RSI SID.");
    const sourceRecords = N.list(input, "Organization member payload");
    const value = [];
    for (const [index, entry] of sourceRecords.entries()) {
      const source = N.plain(entry, `organizations.members[${index}]`);
      const visibility = N.oneOf(source.visibility ?? "public", ["public", "restricted"], `organizations.members[${index}].visibility`);
      const handle = visibility === "restricted" ? null : N.safeHandle(source.handle, `organizations.members[${index}].handle`, { nullable: true });
      const displayName = visibility === "restricted" ? null : N.nullableText(source.displayName, `organizations.members[${index}].displayName`);
      const recordKey = source.recordKey
        ? N.text(source.recordKey, `organizations.members[${index}].recordKey`)
        : await N.stableKey("organization-member", [sid, visibility, handle, displayName, visibility === "restricted" ? index : null]);
      value.push(Object.freeze({
        recordKey,
        organizationSid: sid,
        visibility,
        displayName,
        handle,
        membershipType: visibility === "restricted" ? null : N.nullableText(source.membershipType, `organizations.members[${index}].membershipType`),
        rank: visibility === "restricted" ? null : N.nullableText(source.rank, `organizations.members[${index}].rank`),
        rankStars: visibility === "restricted" || source.rankStars === null || source.rankStars === undefined ? null : N.integer(source.rankStars, `organizations.members[${index}].rankStars`),
        roles: visibility === "restricted" ? Object.freeze([]) : Object.freeze(Array.from(new Set((source.roles ?? []).map((role, roleIndex) => N.text(role, `organizations.members[${index}].roles[${roleIndex}]`))))),
        images: visibility === "restricted" ? Object.freeze([]) : await N.imageReferences(source.images, "avatar", displayName ?? handle ?? "Organization member"),
        observation: observation(context, source.relatedUrls)
      }));
    }
    assertUnique(value, "recordKey", "Organization member");
    return result(`organizations.members.${sid}`, Object.freeze(value), value.length, context, metadata);
  }

  function assertUnique(records, key, label) {
    const seen = new Set();
    for (const record of records) {
      if (seen.has(record[key])) throw new TypeError(`${label} ${key} values must be unique.`);
      seen.add(record[key]);
    }
  }

  return Object.freeze({
    PARSER_VERSION,
    parseBalances,
    parseBillingTotal,
    parseBuybackDetails,
    parseBuybackUpgradePrices,
    parseBuybacks,
    parseCreditLedger,
    parseHangarLog,
    parseOrders,
    parseOrganizationMembers,
    parseOrganizationMemberships,
    parsePledges,
    parseProfile,
    parseReferrals,
    parseSubscriptions
  });
});
