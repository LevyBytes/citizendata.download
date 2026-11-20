(function initializeCitizenDataDomExtractors(root, factory) {
  "use strict";

  const api = factory();
  root.CitizenDataDomExtractors = api;
  if (typeof module === "object" && module?.exports) module.exports = api;
})(globalThis, function createCitizenDataDomExtractors() {
  "use strict";

  const EXTRACTOR_VERSION = "0.42.1";

  function requireDocument(value) {
    if (!value || typeof value.querySelectorAll !== "function" || typeof value.querySelector !== "function") throw new TypeError("A parsed HTML Document is required.");
    return value;
  }

  function clean(value) {
    return typeof value === "string" ? value.replace(/\s+/gu, " ").trim() : "";
  }

  function content(node, selectors) {
    for (const selector of selectors) {
      const match = node?.querySelector?.(selector);
      const result = clean(match?.textContent);
      if (result) return result;
    }
    return null;
  }

  function value(node, selectors) {
    for (const selector of selectors) {
      const match = node?.querySelector?.(selector);
      const result = clean(match?.value ?? match?.getAttribute?.("value"));
      if (result) return result;
    }
    return null;
  }

  function attribute(node, names) {
    for (const name of names) {
      const result = clean(node?.getAttribute?.(name));
      if (result) return result;
    }
    return null;
  }

  function numericAttribute(node, names) {
    const direct = attribute(node, names);
    if (direct && /^\d+$/u.test(direct)) return Number(direct);
    for (const link of node?.querySelectorAll?.("a[href]") ?? []) {
      const match = /(?:pledge|buyback)[^0-9]*([0-9]{2,})/iu.exec(link.getAttribute("href") ?? "");
      if (match) return Number(match[1]);
    }
    const textMatch = /#([0-9]{2,})\b/u.exec(clean(node?.textContent));
    return textMatch ? Number(textMatch[1]) : null;
  }

  function absoluteUrl(candidate, baseUrl) {
    if (!candidate) return null;
    try {
      const url = new URL(candidate, baseUrl);
      url.hash = "";
      return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
    } catch {
      return null;
    }
  }

  function relatedUrls(node, baseUrl, extra = []) {
    const urls = [];
    for (const candidate of extra) {
      const url = absoluteUrl(candidate, baseUrl);
      if (url) urls.push(url);
    }
    for (const link of node?.querySelectorAll?.("a[href]") ?? []) {
      const url = absoluteUrl(link.getAttribute?.("href"), baseUrl);
      if (url) urls.push(url);
    }
    return Array.from(new Set(urls));
  }

  function citizenHandleFromUrl(candidate, baseUrl) {
    const absolute = absoluteUrl(candidate, baseUrl);
    if (!absolute) return null;
    try {
      const url = new URL(absolute);
      if (url.origin !== "https://robertsspaceindustries.com") return null;
      const segments = url.pathname.split("/").filter(Boolean);
      const citizensIndex = segments.findIndex((segment) => segment.toLowerCase() === "citizens");
      if (citizensIndex < 0) return null;
      const handle = decodeURIComponent(segments[citizensIndex + 1] ?? "");
      return /^[A-Za-z0-9_-]+$/u.test(handle) ? handle : null;
    } catch {
      return null;
    }
  }

  function extractSessionIdentity(document, { baseUrl = "https://robertsspaceindustries.com/en/account/pledges" } = {}) {
    const parsed = requireDocument(document);
    const pageText = clean(parsed.body?.innerText ?? parsed.body?.textContent);
    const restricted = /restricted area/iu.test(pageText)
      && /authorized personnel only/iu.test(pageText)
      && /you must be authenticated to reach this area/iu.test(pageText);
    if (restricted) return { state: "signed-out", handle: null };

    const title = clean(parsed.title);
    const accountSurface = /my hangar/iu.test(title)
      || Boolean(parsed.querySelector("#pledge-log, .accountPanelUser, .accountUserSummary"));
    if (!accountSurface) return { state: "unknown", handle: null };

    for (const link of parsed.querySelectorAll("a[href*='/citizens/']")) {
      const handle = citizenHandleFromUrl(link.getAttribute?.("href"), baseUrl);
      if (handle) return { state: "authenticated", handle };
    }
    const avatar = parsed.querySelector(".accountPanelUser__avatar [aria-label], .accountUserSummary__avatar [aria-label]");
    const avatarHandle = clean(avatar?.getAttribute?.("aria-label"));
    return {
      state: "authenticated",
      handle: /^[A-Za-z0-9_-]+$/u.test(avatarHandle) ? avatarHandle : null
    };
  }

  function images(node, baseUrl, role = "thumbnail") {
    const seen = new Set();
    const records = [];
    const add = (candidate, altText = null, width = null, height = null) => {
      const url = absoluteUrl(candidate, baseUrl);
      if (!url || seen.has(url)) return;
      seen.add(url);
      records.push({ url, role, altText, width, height });
    };
    for (const image of node?.querySelectorAll?.("img[src], img[data-src]") ?? []) {
      add(
        image.getAttribute("src") || image.getAttribute("data-src"),
        clean(image.getAttribute("alt")) || null,
        image.naturalWidth || null,
        image.naturalHeight || null
      );
    }
    for (const image of node?.querySelectorAll?.("[style*='background'], [data-background], .image") ?? []) {
      const styleValue = image.style?.backgroundImage
        || image.getAttribute?.("data-background")
        || image.getAttribute?.("style")
        || (typeof globalThis.getComputedStyle === "function" ? globalThis.getComputedStyle(image).backgroundImage : "");
      for (const match of String(styleValue).matchAll(/url\(["']?([^"')]+)["']?\)/gu)) add(match[1]);
    }
    return records;
  }

  function fieldMap(node) {
    const fields = new Map();
    for (const entry of node?.querySelectorAll?.(".entry, .col, dl") ?? []) {
      const label = clean(entry.querySelector?.(".label, span, dt")?.textContent).toLowerCase().replace(/:$/u, "");
      if (!label) continue;
      const explicit = clean(entry.querySelector?.(".value, dd")?.textContent);
      if (explicit) {
        fields.set(label, explicit);
        continue;
      }
      const clone = entry.cloneNode?.(true);
      clone?.querySelector?.(".label, span, dt")?.remove?.();
      const fallback = clean(clone?.textContent);
      if (fallback) fields.set(label, fallback);
    }
    return fields;
  }

  function findField(fields, ...fragments) {
    for (const [label, entryValue] of fields) {
      if (fragments.some((fragment) => label.includes(fragment))) return entryValue || null;
    }
    return null;
  }

  function moneyValue(raw, fallbackCurrency = "USD") {
    const source = clean(raw).replace(/,/gu, "");
    const match = /(-?[0-9]+(?:\.[0-9]{1,4})?)/u.exec(source);
    if (!match) return null;
    const currency = /\b([A-Z]{3})\b/u.exec(source)?.[1] ?? fallbackCurrency;
    return { amount: Number(match[1]).toFixed(2), currency };
  }

  // `itemName` is true for an item inside a pledge, whose name is all there is to go by.
  function categoryFor(title, kind = "", itemName = false) {
    const source = `${title ?? ""} ${kind ?? ""}`.toLowerCase();
    if (/\b(?:package|packs?)\b/u.test(source)) return "gamePackage";
    if (/\bstandalone ships?\b/u.test(source) || /^ship\b/u.test(source)) return "standaloneShip";
    // A pledge or buy-back is an upgrade by the kind RSI gives it, or by the kind RSI names before the first dash
    // of its title. A word further inside its title says nothing: an Add-Ons pledge is never an upgrade.
    if (/\bupgrade\b|\bccu\b/u.test(String(kind ?? "").toLowerCase()) || /^(?:ship upgrades?|upgrades?|ccus?)\s+-/u.test(source) || (itemName && /\bupgrade\b|\bccu\b/u.test(source))) return "shipUpgrade";
    if (/\breward\b/u.test(source)) return "reward";
    if (/\b(?:armor|undersuit)\b/u.test(source)) return "armor";
    if (/\b(?:weapon|rifle|pistol|smg|lmg|shotgun)\b/u.test(source)) return "weapon";
    if (/\b(?:decoration|hangar|flair|poster|fishtank|fish tank|model|plant)\b/u.test(source)) return "hangarItem";
    return source ? "other" : "unknown";
  }

  function stripLabel(raw, label) {
    return clean(raw).replace(new RegExp(`^${label}\\s*:?\\s*`, "iu"), "");
  }

  // RSI lists what a pledge holds in two groups: cards with a picture, and a plain "Also Contains" list.
  function containedItem(entry, baseUrl, section) {
    const name = content(entry, [".title", "h3", "h4"]);
    if (!name) return null;
    const kind = content(entry, [".kind", ".type"]);
    return {
      name,
      kind,
      // The maker line of a card, for example "Roberts Space Industries (RSI)".
      manufacturer: content(entry, [".liner"]),
      // The name the owner gave a ship.
      customName: content(entry, [".custom-name-text"]),
      section,
      category: categoryFor(name, kind, true),
      quantity: 1,
      images: images(entry, baseUrl, "contained-item"),
      relatedUrls: relatedUrls(entry, baseUrl),
      catalogIdentifiers: []
    };
  }

  function extractProfile(document, { baseUrl = "https://robertsspaceindustries.com/en/account/settings/profile" } = {}) {
    const parsed = requireDocument(document);
    const settingsItems = Array.from(parsed.querySelectorAll(".settingsItem"));
    if (settingsItems.length) {
      const settings = new Map();
      for (const item of settingsItems) {
        const label = content(item, [".settingsItemTitle__icon"]);
        const itemValue = content(item, [".settingsItemData__content"]);
        if (label && itemValue) settings.set(label.toLowerCase(), itemValue);
      }
      const avatarItem = settingsItems.find((item) => /avatar/iu.test(content(item, [".settingsItemTitle__icon"]) ?? ""));
      return {
        ueeCitizenRecord: null,
        displayName: settings.get("display name") ?? null,
        handle: (settings.get("handle") ?? "").replace(/^@/u, "") || null,
        displayTitle: settings.get("display title") ?? null,
        enlistedOnRaw: null,
        location: settings.get("location") ?? null,
        languages: (settings.get("spoken languages") ?? "").split(/[,/]/u).map(clean).filter(Boolean),
        website: settings.get("website") ?? null,
        biography: settings.get("biography") ?? null,
        mainOrganizationSid: null,
        organizationRank: null,
        dossierBadgeTitle: settings.get("display title") ?? null,
        images: images(avatarItem, baseUrl, "avatar"),
        relatedUrls: relatedUrls(parsed, baseUrl, [baseUrl])
      };
    }
    const root = parsed.querySelector(".public-profile, #public-profile, .account-profile") ?? parsed;
    const profile = root.querySelector(".profile.left-col") ?? root;
    const profileEntries = Array.from(profile.querySelectorAll?.(".info .entry") ?? []);
    const handleEntry = profileEntries.find((entry) => /handle name/iu.test(clean(entry.querySelector?.(".label")?.textContent)));
    const displayNameEntry = profileEntries.find((entry) => !entry.querySelector?.(".label") && clean(entry.querySelector?.(".value")?.textContent));
    const titleEntry = profileEntries.find((entry) => entry !== handleEntry && entry !== displayNameEntry && clean(entry.querySelector?.(".value")?.textContent));
    const allFields = fieldMap(root);
    const organization = root.querySelector(".main-org");
    const organizationFields = fieldMap(organization);
    const organizationLink = organization?.querySelector?.("a[href*='/orgs/']");
    const organizationPath = absoluteUrl(organizationLink?.getAttribute?.("href"), baseUrl);
    const organizationSidFromUrl = organizationPath ? new URL(organizationPath).pathname.split("/").filter(Boolean).at(-1) : null;
    const displayTitle = clean(titleEntry?.querySelector?.(".value")?.textContent) || null;
    const citizenRecordRaw = clean(root.querySelector?.(".citizen-record .value")?.textContent).replace(/^#/u, "");
    const citizenRecordNumber = /^\d+$/u.test(citizenRecordRaw) ? Number(citizenRecordRaw) : null;
    const ueeCitizenRecord = Number.isSafeInteger(citizenRecordNumber) ? citizenRecordNumber : null;
    return {
      ueeCitizenRecord,
      displayName: clean(displayNameEntry?.querySelector?.(".value")?.textContent) || null,
      handle: clean(handleEntry?.querySelector?.(".value")?.textContent).replace(/^@/u, "") || null,
      displayTitle,
      enlistedOnRaw: findField(allFields, "enlisted"),
      location: findField(allFields, "location"),
      languages: (findField(allFields, "fluency", "language") ?? "").split(/[,/]/u).map(clean).filter(Boolean),
      website: findField(allFields, "website"),
      biography: findField(allFields, "bio"),
      mainOrganizationSid: findField(organizationFields, "spectrum identification", "sid") ?? organizationSidFromUrl,
      organizationRank: findField(organizationFields, "organization rank", "rank"),
      dossierBadgeTitle: displayTitle,
      images: images(profile, baseUrl, "avatar"),
      relatedUrls: relatedUrls(root, baseUrl, [baseUrl, organizationPath])
    };
  }

  function pageNumber(candidate, baseUrl) {
    if (Number.isSafeInteger(candidate) && candidate >= 1) return candidate;
    try {
      const fromUrl = new URL(baseUrl).searchParams.get("page");
      return fromUrl !== null && /^[1-9][0-9]{0,8}$/u.test(fromUrl) ? Number(fromUrl) : null;
    } catch {
      return null;
    }
  }

  function extractPledges(document, { baseUrl = "https://robertsspaceindustries.com/en/account/pledges", page = null } = {}) {
    requireDocument(document);
    const sourcePage = pageNumber(page, baseUrl);
    const container = document.querySelector(".list-items");
    const entries = container ? Array.from(container.children) : Array.from(document.querySelectorAll(".list-items > li"));
    return entries.map((entry) => {
      const title = value(entry, [".js-pledge-name"]) ?? content(entry, [".pledge-title-row h1", ".pledge-title-row h3", ".pledge-title-row", ".title", ".basic-infos h3"]);
      const pledgeIdValue = value(entry, [".js-pledge-id"]);
      const pledgeId = pledgeIdValue && /^\d+$/u.test(pledgeIdValue) ? Number(pledgeIdValue) : numericAttribute(entry, ["data-pledge-id", "data-id"]);
      const alsoContains = new Set(entry.querySelectorAll(".without-images .item"));
      const items = Array.from(entry.querySelectorAll(".with-images .item, .without-images .item"), (item) => containedItem(item, baseUrl, alsoContains.has(item) ? "alsoContains" : "items")).filter(Boolean);
      return {
        pledgeId,
        title,
        category: categoryFor(title),
        availability: content(entry, [".availability", ".status", ".attrib"]),
        createdDateRaw: stripLabel(content(entry, [".date-col", ".date"]) ?? "", "Created") || null,
        containsSummary: stripLabel(content(entry, [".items-col", ".contains"]) ?? "", "Contains") || null,
        items,
        images: images(entry, baseUrl),
        relatedUrls: relatedUrls(entry, baseUrl),
        listingUrl: baseUrl,
        sourcePage,
        state: "current",
        meltValue: moneyValue(value(entry, [".js-pledge-value"])),
        meltEligible: Boolean(entry.querySelector(".js-reclaim")),
        giftEligible: Boolean(entry.querySelector(".js-gift")),
        baseValue: moneyValue(value(entry, [".js-pledge-configuration-value"])),
        ccuHistory: [],
        catalogIdentifiers: []
      };
    }).filter((record) => record.title);
  }

  function identifier(namespace, candidate) {
    const normalized = clean(candidate);
    return normalized ? { namespace, value: normalized, source: "rsi" } : null;
  }

  function extractBuybacks(document, { baseUrl = "https://robertsspaceindustries.com/en/account/buy-back-pledges" } = {}) {
    requireDocument(document);
    const listingPage = Number(new URL(baseUrl).searchParams.get("page") ?? "1");
    const sourcePage = pageNumber(null, baseUrl);
    return Array.from(document.querySelectorAll(".available-pledges article.pledge, ul.pledges article.pledge, article.pledge"), (entry, entryIndex) => {
      const title = content(entry, [".pledge-title-row h1", ".information h1", "h1"]);
      // The button comes before the block around it: the block has no link of its own, so choosing it loses the
      // buy-back's page link.
      const candidates = [
        ...entry.querySelectorAll("[data-pledge-id], [data-pledgeId], [data-buyback-id], [href*='/pledge/buyback/'], .holosmallbtn"),
        ...entry.querySelectorAll(".buyback-action")
      ];
      const action = candidates.find((candidate) => numericAttribute(candidate, ["data-pledge-id", "data-pledgeId", "data-buyback-id", "data-id"]) !== null
        || /\/pledge\/buyback\/[0-9]+$/u.test(absoluteUrl(candidate.getAttribute?.("href"), baseUrl) ?? "")) ?? candidates[0] ?? entry;
      const detailUrl = absoluteUrl(action.getAttribute?.("href"), baseUrl);
      const detailMatch = detailUrl ? /\/pledge\/buyback\/([0-9]+)$/u.exec(new URL(detailUrl).pathname) : null;
      const buybackId = numericAttribute(action, ["data-pledge-id", "data-pledgeId", "data-buyback-id", "data-id"]) ?? (detailMatch ? Number(detailMatch[1]) : null);
      const dds = Array.from(entry.querySelectorAll("dd"), (node) => clean(node.textContent));
      const fromShip = attribute(action, ["data-from-ship-id", "data-fromShipId"]);
      const toShip = attribute(action, ["data-to-ship-id", "data-toShipId"]);
      const toSku = attribute(action, ["data-to-sku-id", "data-toSkuId"]);
      // A CCU buy-back has no page of its own: its button opens RSI's store upgrade page with the ships and the SKU
      // of the upgrade. Anything with its own buy-back page is an ordinary buy-back, whatever its title says.
      const upgrade = !detailMatch && Boolean(fromShip || toShip || toSku);
      const priceNode = entry.querySelector(".final-price");
      const priceCents = clean(priceNode?.getAttribute?.("data-value"));
      const buybackPrice = /^\d+$/u.test(priceCents)
        ? { amount: (Number(priceCents) / 100).toFixed(2), currency: clean(priceNode.getAttribute("data-currency")) || "USD" }
        : moneyValue(content(entry, [".final-price"]));
      return {
        buybackId,
        ...(buybackId === null ? { recordKey: `buyback-listing:${Number.isSafeInteger(listingPage) ? listingPage : 1}:${entryIndex}` } : {}),
        kind: upgrade ? "upgrade" : "ordinary",
        category: categoryFor(title, upgrade ? "upgrade" : ""),
        title,
        reclaimDateRaw: dds[0] ?? null,
        containsSummary: dds.length >= 4 ? dds[2] : dds[1] ?? null,
        availability: entry.querySelector(".unavailable") ? "Unavailable" : "Available",
        items: [],
        images: images(entry, baseUrl),
        relatedUrls: relatedUrls(entry, baseUrl),
        ...(detailUrl ? { detailUrl } : { listingUrl: baseUrl }),
        sourcePage,
        state: entry.querySelector(".unavailable") ? "unavailable" : "available",
        buybackPrice,
        catalogIdentifiers: [],
        upgrade: upgrade ? {
          fromShipIdentifiers: [identifier("ship", fromShip)].filter(Boolean),
          toShipIdentifiers: [identifier("ship", toShip)].filter(Boolean),
          skuIdentifiers: [identifier("sku", toSku)].filter(Boolean)
        } : null
      };
    }).filter((record) => record.title);
  }

  // An amount as the page shows it. The currency is read from the text, or from the element's own currency attribute;
  // it is never assumed.
  function shownMoney(raw, attributeCurrency = "") {
    const source = clean(raw).replace(/,/gu, "");
    const amount = /(-?[0-9]+(?:\.[0-9]{1,4})?)/u.exec(source)?.[1];
    const currency = /\b([A-Z]{3})\b/u.exec(source)?.[1] ?? (/^[A-Z]{3}$/u.test(attributeCurrency) ? attributeCurrency : null);
    return amount && currency ? { amount: Number(amount).toFixed(2), currency } : null;
  }

  // The text of a node with a space between its parts, so `Save<strong>25%</strong>` reads "Save 25%".
  function spacedText(node) {
    const parts = Array.from(node?.childNodes ?? [], (child) => clean(child.textContent)).filter(Boolean);
    return parts.length ? parts.join(" ") : null;
  }

  // One buy-back's own page, /pledge/buyback/<id>. `recognized` is false when the markup is not such a page, so the
  // caller can tell an answer about some other page from a buy-back page whose layout changed. The add-to-cart button
  // is read for its SKU number only; nothing here follows or activates a link.
  function extractBuybackDetail(document, { baseUrl = "https://robertsspaceindustries.com/pledge/buyback/0" } = {}) {
    requireDocument(document);
    const bodyClass = clean(document.body?.getAttribute?.("class"));
    const buyButton = document.querySelector("a.js-buy-back");
    const recognized = /(?:^|\s)buy-back(?:\s|$)/u.test(bodyClass)
      || Boolean(buyButton)
      || Boolean(document.querySelector(".buy-back-title, .buy-back-warning, .buy-back-description"));
    if (!recognized) return { recognized: false };

    const title = content(document, ["#store-header h1", ".content-block4 h1", "h1"]);
    const separator = title ? title.indexOf(" - ") : -1;
    const categoryUrl = absoluteUrl(document.querySelector("a.viewall[href]")?.getAttribute?.("href"), baseUrl);
    const typeFromClass = /(?:^|\s)([a-z0-9-]+)-type(?:\s|$)/u.exec(bodyClass)?.[1] ?? null;
    const typeFromLink = categoryUrl ? new URL(categoryUrl).pathname.split("/").filter(Boolean).at(-1) ?? null : null;
    const priceNode = document.querySelector(".price .final-price") ?? document.querySelector(".final-price");
    const priceDataValue = clean(priceNode?.getAttribute?.("data-value")) || null;
    const priceDataCurrency = clean(priceNode?.getAttribute?.("data-currency")) || null;
    const priceText = clean(priceNode?.textContent) || null;
    const discountNode = document.querySelector(".price .discount") ?? document.querySelector(".discount");
    const percent = /^([0-9]+(?:\.[0-9]+)?)\s*%$/u.exec(clean(discountNode?.querySelector?.("strong")?.textContent));
    const tokens = clean(document.querySelector(".buy-back-warning strong")?.textContent);
    const paragraphs = Array.from(document.querySelectorAll(".buy-back-description p"), (node) => clean(node.textContent)).filter(Boolean);
    const ships = Array.from(document.querySelectorAll(".package-listing.ship li"), (entry) => {
      const fields = {};
      for (const info of entry.querySelectorAll(".info")) {
        const label = clean(info.textContent).split(":")[0].toLowerCase();
        const fieldValue = clean(info.querySelector("span")?.textContent);
        if (label && fieldValue && !Object.hasOwn(fields, label)) fields[label] = fieldValue;
      }
      const shipPageUrl = Array.from(entry.querySelectorAll("a[href]"), (link) => absoluteUrl(link.getAttribute("href"), baseUrl))
        .find((url) => url && /\/pledge\/ships\//u.test(new URL(url).pathname)) ?? null;
      return { name: fields.ship ?? null, manufacturer: fields.manufacturer ?? null, focus: fields.focus ?? null, shipPageUrl, images: images(entry, baseUrl, "ship") };
    }).filter((ship) => ship.name);
    return {
      recognized: true,
      title,
      categoryLabel: separator > 0 ? title.slice(0, separator) : null,
      name: separator > 0 ? title.slice(separator + 3) : title,
      pageType: typeFromClass ?? typeFromLink,
      price: shownMoney(priceText, priceDataCurrency ?? ""),
      priceText,
      originalPrice: shownMoney(content(document, [".price .original-price", ".original-price"]), priceDataCurrency ?? ""),
      discountPercent: percent ? Number(percent[1]) : null,
      discountText: spacedText(discountNode),
      priceDataValue,
      priceDataCurrency,
      skuId: clean(buyButton?.getAttribute?.("data-sku")) || null,
      descriptionTitle: content(document, [".buy-back-title"]),
      description: paragraphs.length ? paragraphs.join("\n\n") : content(document, [".buy-back-description"]),
      ships,
      alsoContains: Array.from(document.querySelectorAll(".package-listing.item li"), (node) => clean(node.textContent)).filter(Boolean),
      images: images(document.querySelector(".lcol figure") ?? document.querySelector("figure"), baseUrl, "detail"),
      buybackTokensAvailable: /^\d+$/u.test(tokens) ? Number(tokens) : null
    };
  }

  function logKind(detail) {
    const source = detail.toLowerCase();
    if (source.includes("upgrade applied")) return "upgradeApplied";
    if (source.includes("reclaimed")) return "reclaimed";
    if (source.includes("gift")) return "gifted";
    if (source.includes("created")) return "created";
    if (source.includes("buy-back") || source.includes("buyback")) return "buyback";
    if (source.includes("reward")) return "reward";
    return "unknown";
  }

  function extractHangarLog(document, { baseUrl = "https://robertsspaceindustries.com/api/account/pledgeLog" } = {}) {
    requireDocument(document);
    return Array.from(document.querySelectorAll("#pledge-log .pledge-log-entry"), (entry) => {
      const paragraph = entry.querySelector("p") ?? entry;
      const fullText = clean(paragraph.textContent);
      const subjectName = content(paragraph, [".important"]) ?? "Unknown subject";
      const subjectId = numericAttribute(paragraph, ["data-pledge-id", "data-id"]);
      const timestampMatch = /^(.+?)\s+-\s+/u.exec(fullText);
      const detailMatch = subjectId === null ? null : new RegExp(`#${subjectId}\\s*-\\s*(.+)$`, "u").exec(fullText);
      const rawDetail = detailMatch?.[1] ?? fullText;
      return {
        rawTimestamp: timestampMatch?.[1] ?? "",
        subjectId,
        subjectName,
        kind: logKind(rawDetail),
        rawDetail,
        parsed: { recognized: false },
        relatedUrls: relatedUrls(entry, baseUrl)
      };
    }).filter((record) => record.rawTimestamp && record.subjectId !== null);
  }

  function isoDateFromText(raw) {
    const parsed = Date.parse(raw);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : null;
  }

  function extractReferralRows(document) {
    requireDocument(document);
    return Array.from(document.querySelectorAll("[class*='accountReferralRecruitsDrawer__user']"), (entry) => {
      const dateContainer = entry.querySelector("[class*='accountReferralRecruitsDrawer__user-date'], .date");
      const dateRaw = content(dateContainer ?? entry, ["p:last-child"]) ?? clean(dateContainer?.textContent);
      const dateContext = clean(dateContainer?.textContent);
      return {
        displayName: content(entry, ["[class*='a-displayName']", ".display-name", ".moniker"]),
        handle: (content(entry, ["[class*='a-handleName']", ".handle"]) ?? "").replace(/^@/u, ""),
        dateRaw,
        dateLabel: /purchased/iu.test(dateContext) ? "purchasedOn" : "enlistedOn",
        dateSortKey: isoDateFromText(dateRaw),
        images: images(entry, "https://robertsspaceindustries.com/en/referral", "avatar"),
        relatedUrls: relatedUrls(entry, "https://robertsspaceindustries.com/en/referral", [
          `https://robertsspaceindustries.com/en/citizens/${encodeURIComponent((content(entry, ["[class*='a-handleName']", ".handle"]) ?? "").replace(/^@/u, ""))}`,
          `https://robertsspaceindustries.com/spectrum/messages/member/${encodeURIComponent((content(entry, ["[class*='a-handleName']", ".handle"]) ?? "").replace(/^@/u, ""))}`
        ])
      };
    }).filter((record) => record.displayName && record.handle && record.dateRaw);
  }

  function booleanField(entryValue) {
    if (!entryValue) return null;
    if (/\b(?:yes|true|recruiting|exclusive)\b/iu.test(entryValue)) return true;
    if (/\b(?:no|false|not recruiting|open)\b/iu.test(entryValue)) return false;
    return null;
  }

  function extractOrganizationMemberships(document, { baseUrl = "https://robertsspaceindustries.com/en/account/settings/organizations" } = {}) {
    requireDocument(document);
    return Array.from(document.querySelectorAll(".profile-content.orgs-content .box-content.org, .box-content.org"), (entry) => {
      const fields = fieldMap(entry);
      const organizationLink = entry.querySelector("a[href*='/orgs/']");
      const organizationUrl = absoluteUrl(organizationLink?.getAttribute?.("href"), baseUrl);
      const sidFromUrl = organizationUrl ? new URL(organizationUrl).pathname.split("/").filter(Boolean).at(-1) : null;
      return {
        sid: findField(fields, "spectrum identification", "sid") ?? sidFromUrl,
        name: content(entry, [".entry.orgtitle .value", ".info .entry:first-child .value", ".name", "h3", "h2"]),
        membershipType: entry.classList?.contains("main") ? "main" : "affiliate",
        memberCount: Number((content(entry, [".members"]) ?? "0").replace(/[^0-9]/gu, "")) || 0,
        rank: findField(fields, "organization rank", "rank"),
        archetype: findField(fields, "archetype"),
        language: findField(fields, "language"),
        primaryActivity: findField(fields, "primary activity"),
        secondaryActivity: findField(fields, "secondary activity"),
        recruiting: booleanField(findField(fields, "recruiting")),
        rolePlay: booleanField(findField(fields, "role play")),
        commitment: findField(fields, "commitment"),
        exclusive: booleanField(findField(fields, "exclusive")),
        images: images(entry, baseUrl, "organization-emblem"),
        relatedUrls: relatedUrls(entry, baseUrl, [baseUrl, organizationUrl])
      };
    }).filter((record) => record.sid && record.name);
  }

  function memberHandle(entry, baseUrl) {
    const visible = (content(entry, [".name-wrap .nick", ".nick", "[data-handle]"]) ?? "").replace(/^@/u, "");
    if (visible) return visible;
    for (const link of entry.querySelectorAll("a[href*='/citizens/']")) {
      try {
        const path = new URL(link.getAttribute("href"), baseUrl).pathname.split("/").filter(Boolean);
        const citizens = path.findIndex((segment) => segment.toLowerCase() === "citizens");
        const handle = citizens >= 0 ? decodeURIComponent(path[citizens + 1] ?? "") : "";
        if (/^[A-Za-z0-9_-]+$/u.test(handle)) return handle;
      } catch {
        // A malformed dossier link is not identity evidence.
      }
    }
    return null;
  }

  function memberRoles(entry) {
    return Array.from(entry.querySelectorAll(".rolelist .role, .roles .role, .rolelist li"), (node) => clean(node.textContent)).filter((entryValue, index, values) => entryValue && values.indexOf(entryValue) === index);
  }

  function memberRankStars(entry) {
    const active = entry.querySelectorAll(".ranking-stars .active, .stars .active").length;
    if (active) return active;
    const stars = content(entry, [".ranking-stars", ".stars"]);
    const match = /(?:^|\s)([0-5])(?:\s|$)/u.exec(stars ?? "");
    return match ? Number(match[1]) : null;
  }

  function extractOrganizationMembers(document, { organizationSid, baseUrl } = {}) {
    requireDocument(document);
    if (typeof organizationSid !== "string" || !/^[A-Z0-9][A-Z0-9_-]{0,63}$/u.test(organizationSid)) throw new TypeError("A validated organization SID is required.");
    const expectedPath = `/en/orgs/${organizationSid}/members`;
    const source = new URL(baseUrl ?? `https://robertsspaceindustries.com${expectedPath}`);
    if (source.origin !== "https://robertsspaceindustries.com" || source.pathname !== expectedPath) throw new TypeError("Organization member extraction requires the extension-owned roster route.");
    const sourceUrl = source.href;
    return Array.from(document.querySelectorAll("#members-data .member-item, #members-data .js-member-item"), (entry) => {
      const className = clean(entry.getAttribute?.("class"));
      const displayName = content(entry, [".name-wrap .name", ".frontinfo .name"]);
      const handle = memberHandle(entry, sourceUrl);
      const explicitlyVisible = /(?:^|\s)org-visibility-V(?:\s|$)/u.test(className);
      const explicitlyRestricted = /(?:^|\s)org-visibility-(?:R|H)(?:\s|$)/u.test(className);
      const visibility = explicitlyRestricted || (!explicitlyVisible && !displayName && !handle) ? "restricted" : "public";
      if (visibility === "restricted") return {
        organizationSid,
        visibility,
        displayName: null,
        handle: null,
        membershipType: null,
        rank: null,
        rankStars: null,
        roles: [],
        images: [],
        relatedUrls: [sourceUrl]
      };
      return {
        organizationSid,
        visibility,
        displayName,
        handle,
        membershipType: /(?:^|\s)org-main(?:\s|$)/u.test(className) ? "main" : "affiliate",
        rank: content(entry, [".rank .name", ".rank .title", ".frontinfo .rank"]),
        rankStars: memberRankStars(entry),
        roles: memberRoles(entry),
        images: images(entry, sourceUrl, "avatar"),
        relatedUrls: relatedUrls(entry, sourceUrl, [sourceUrl, handle ? `https://robertsspaceindustries.com/en/citizens/${encodeURIComponent(handle)}` : null, handle ? `https://robertsspaceindustries.com/spectrum/messages/member/${encodeURIComponent(handle)}` : null])
      };
    });
  }

  return Object.freeze({ EXTRACTOR_VERSION, extractBuybackDetail, extractBuybacks, extractHangarLog, extractOrganizationMembers, extractOrganizationMemberships, extractPledges, extractProfile, extractReferralRows, extractSessionIdentity });
});
