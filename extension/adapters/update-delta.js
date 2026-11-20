(function initializeCitizenDataUpdateDelta(root, factory) {
  "use strict";

  const api = factory();
  root.CitizenDataUpdateDelta = api;
  if (typeof module === "object" && module?.exports) module.exports = api;
})(globalThis, function createCitizenDataUpdateDelta() {
  "use strict";

  function image(value) {
    return value && typeof value === "object" ? {
      url: value.url ?? null,
      role: value.role ?? null,
      altText: value.altText ?? null,
      width: value.width ?? null,
      height: value.height ?? null
    } : null;
  }

  function money(value) {
    return value && typeof value === "object" ? { amount: value.amount ?? null, currency: value.currency ?? null } : null;
  }

  function hangarRecord(value) {
    return value && typeof value === "object" ? [value.rawTimestamp, value.subjectId, value.subjectName, value.kind, value.rawDetail] : null;
  }

  function referralRecord(value) {
    return value && typeof value === "object" ? {
      recordKey: value.recordKey ?? null,
      displayName: value.displayName ?? null,
      handle: value.handle ?? null,
      displayNameRaw: value.displayNameRaw ?? value.displayName ?? null,
      nicknameRaw: value.nicknameRaw ?? value.handle ?? null,
      dateLabel: value.dateLabel ?? null,
      dateRaw: value.dateRaw ?? null,
      dateSortKey: value.dateSortKey ?? null,
      images: Array.isArray(value.images) ? value.images.map(image) : []
    } : null;
  }

  function orderItem(value) {
    return value && typeof value === "object" ? {
      name: value.name ?? null,
      unitPrice: money(value.unitPrice),
      quantity: value.quantity ?? null,
      discount: money(value.discount),
      total: money(value.total),
      physical: value.physical ?? null,
      trackingAvailable: value.trackingAvailable ?? null,
      images: Array.isArray(value.images) ? value.images.map(image) : [],
      relatedUrls: Array.isArray(value.relatedUrls) ? [...value.relatedUrls] : []
    } : null;
  }

  function orderRecord(value) {
    return value && typeof value === "object" ? {
      orderId: value.orderId ?? null,
      placedAtRaw: value.placedAtRaw ?? null,
      storefront: value.storefront ?? null,
      status: value.status ?? null,
      paymentState: value.paymentState ?? null,
      fulfillmentState: value.fulfillmentState ?? null,
      physical: value.physical ?? null,
      items: Array.isArray(value.items) ? value.items.map(orderItem) : [],
      billingAddress: value.billingAddress ?? null,
      shippingAddress: value.shippingAddress ?? null,
      itemsTotal: money(value.itemsTotal),
      additionalDiscount: money(value.additionalDiscount),
      creditsUsed: money(value.creditsUsed),
      shippingAndHandling: money(value.shippingAndHandling),
      tax: money(value.tax),
      total: money(value.total),
      payments: Array.isArray(value.payments) ? value.payments.map((payment) => ({
        rawTimestamp: payment.rawTimestamp ?? null,
        processor: payment.processor ?? null,
        status: payment.status ?? null,
        amount: money(payment.amount)
      })) : [],
      invoiceAvailable: value.invoiceAvailable ?? null
    } : null;
  }

  function ledgerRecord(value) {
    return value && typeof value === "object" ? [value.rawTimestamp, value.amount, value.rawDetail] : null;
  }

  function equal(left, right, project = (value) => value) {
    return JSON.stringify(project(left)) === JSON.stringify(project(right));
  }

  function prefixMatches(current, previous, project = (value) => value) {
    if (!Array.isArray(current) || !Array.isArray(previous) || current.length > previous.length) return false;
    return current.every((value, index) => equal(value, previous[index], project));
  }

  function findAnchor(current, previous, project = (value) => value, maximumWindow = 20) {
    if (!Array.isArray(current) || !Array.isArray(previous) || previous.length === 0) return -1;
    const windowSize = Math.min(maximumWindow, previous.length);
    const needle = previous.slice(0, windowSize).map(project).map(JSON.stringify);
    const haystack = current.map(project).map(JSON.stringify);
    outer: for (let start = 0; start <= haystack.length - needle.length; start += 1) {
      for (let offset = 0; offset < needle.length; offset += 1) if (haystack[start + offset] !== needle[offset]) continue outer;
      return start;
    }
    return -1;
  }

  function hangarAsRaw(value) {
    return {
      rawTimestamp: value.rawTimestamp,
      subjectId: value.subjectId,
      subjectName: value.subjectName,
      kind: value.kind,
      rawDetail: value.rawDetail,
      parsed: value.parsed ?? {},
      relatedUrls: Array.isArray(value.observation?.relatedUrls) ? [...value.observation.relatedUrls] : []
    };
  }

  function referralAsRaw(value) {
    return {
      recordKey: value.recordKey,
      displayName: value.displayName ?? null,
      handle: value.handle ?? null,
      displayNameRaw: value.displayNameRaw ?? value.displayName ?? null,
      nicknameRaw: value.nicknameRaw ?? value.handle ?? null,
      dateLabel: value.dateLabel,
      dateRaw: value.dateRaw,
      dateSortKey: value.dateSortKey ?? null,
      images: Array.isArray(value.images) ? value.images.map(image).filter(Boolean) : [],
      relatedUrls: Array.isArray(value.observation?.relatedUrls) ? [...value.observation.relatedUrls] : []
    };
  }

  function ledgerAsRaw(value) {
    return {
      rawTimestamp: value.rawTimestamp,
      amount: value.amount,
      rawDetail: value.rawDetail,
      parsed: value.parsed ?? {},
      relatedUrls: Array.isArray(value.observation?.relatedUrls) ? [...value.observation.relatedUrls] : []
    };
  }

  // Whether a listed buy-back has a page of its own, /pledge/buyback/<id>. An upgrade has none.
  function buybackHasPage(buyback) {
    const id = buyback?.buybackId;
    if (buyback?.kind !== "ordinary" || !Number.isSafeInteger(id) || id < 1 || !["available", "unavailable"].includes(buyback.state)) return false;
    return (buyback.sourceLinks ?? []).some((link) => link?.kind === "detail");
  }

  // One key for every buy-back of the same item. RSI shows the same page, with the same price, discount, and
  // contents, for buy-backs that have the same title and the same contents line, so one page read serves them all.
  function buybackItemKey(buyback) {
    return JSON.stringify([buyback?.title ?? null, buyback?.containsSummary ?? null]);
  }

  // A CCU buy-back is identified by the ship it upgrades from, the ship it upgrades to, and RSI's SKU of the
  // upgrade. Two buy-backs with the same three are the same CCU and cost the same at one moment, so its price is
  // read once.
  function buybackUpgradeGroup(buyback) {
    if (buyback?.kind !== "upgrade") return null;
    const one = (list) => {
      const value = Number(Array.isArray(list) ? list[0]?.value : NaN);
      return Number.isSafeInteger(value) && value >= 1 ? value : null;
    };
    const fromShipId = one(buyback.upgrade?.fromShipIdentifiers);
    const toShipId = one(buyback.upgrade?.toShipIdentifiers);
    const toSkuId = one(buyback.upgrade?.skuIdentifiers);
    return fromShipId && toShipId && toSkuId ? { key: `${fromShipId}:${toShipId}:${toSkuId}`, fromShipId, toShipId, toSkuId } : null;
  }

  return Object.freeze({ buybackHasPage, buybackItemKey, buybackUpgradeGroup, equal, findAnchor, hangarAsRaw, hangarRecord, ledgerAsRaw, ledgerRecord, orderRecord, prefixMatches, referralAsRaw, referralRecord });
});
