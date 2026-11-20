await import("../../docs/scripts/file-timestamp.js");
await import("../../docs/scripts/account-exports.js");
await import("../../docs/scripts/safe-json.js");
await import("../../docs/scripts/demo-profile-avatars.js");
await import("../../docs/scripts/demo-data.js");

export const Exports = globalThis.CitizenDataExports;
export const SafeJson = globalThis.CitizenDataSafeJson;
export const native = (document, selection) => JSON.parse(Exports.createExport(document, selection).text);
const money = (amount) => ({ amount, currency: "USD" });

export function fixture() {
  const person = (recordKey) => ({ recordKey, displayName: recordKey, handle: recordKey, dateRaw: null, dateSortKey: null, images: [] });
  return {
    schemaVersion: 1,
    account: { handle: "PrivateHandle", ueeCitizenRecord: 123 },
    profile: { displayName: "Private Name" },
    pledges: [{
      recordKey: "pledge-1", title: "Package", category: "gamePackage",
      items: [{ name: "Ship", images: [{ imageKey: "image-1", sourceUrl: "https://example.org/ship.png" }] }], images: [],
      sourceLinks: [{ url: "https://robertsspaceindustries.com/en/account/pledges?page=1" }]
    }],
    buybacks: [{ recordKey: "buyback-1", title: "Buyback", reclaimDateRaw: "November 23, 2017", images: [], sourceLinks: [] }],
    hangarLog: [{
      rawTimestamp: "Nov 17 2026, 5:00 am", subjectId: 4, subjectName: "Unknown reward", rawDetail: "Reward!\nAdditional detail: \"Étoile\"", fingerprint: "not-exported",
      occurrenceOrdinal: 1, kind: "future-event", parsed: { delta: 1 }, observation: { parserVersion: "private" }
    }],
    referrals: {
      current: { prospects: [person("current-prospect")], recruits: [person("shared-recruit")] },
      legacy: { prospects: [person("legacy-prospect")], recruits: [person("shared-recruit")] }
    },
    financial: {
      balances: { storeCredit: { amount: "0.0000", unit: "USD" }, uec: null, rec: { amount: "7.5000", unit: "REC" } },
      billingTotal: { amount: "9007199254740993.1250", currency: "USD", source: "billingPageTotal" },
      creditLedgers: { storeCredit: [{ rawTimestamp: "Yesterday", amount: "-10.2500", unit: "USD", rawDetail: "Order credit", parsed: {} }, { amount: null, rawDetail: "Amount unavailable" }], uec: [], rec: [] },
      subscriptions: [{ subscriptionId: "sub-1", amount: null, totalPaid: money("12.5000"), payments: [{ amount: money("12.5000"), rawTimestamp: null }], images: [] }],
      orders: [{
        orderId: "order-1", total: money("19.9900"), tax: null,
        items: [{ name: "Physical item", quantity: 2, unitPrice: money("9.9950"), total: money("19.9900"), images: [] }], payments: [], shippingAddress: null,
        billingAddress: { country: "US" }
      }]
    },
    sync: { sectionOutcomes: {}, runs: [{ authorization: "unrelated" }] },
    integrity: { algorithm: "SHA-256", contentHash: "original-file-only" },
    unrelated: { neverCopy: true }
  };
}

export function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
