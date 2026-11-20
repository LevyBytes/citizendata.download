(function exposeAccountExports(root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.CitizenDataExports = api;
})(typeof globalThis === "object" ? globalThis : this, (root) => {
  "use strict";

  // Selected-data downloads deliberately do not claim to be complete account exports.
  const SECTIONS = ["hangar", "buybacks", "referrals", "hangar-log", "billing", "organization-members"];
  const LIMITS = { bytes: 25 * 1024 * 1024, depth: 64, nodes: 250000, string: 1024 * 1024, array: 200000, properties: 50000 };
  const DECIMAL = /^-?[0-9]+(?:\.[0-9]{1,4})?$/u;
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

  function object(value, label) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
    return value;
  }

  function records(value, label, validate = () => {}) {
    if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
    if (value.length > LIMITS.array) throw new Error(`${label} contains too many records.`);
    value.forEach((record, index) => validate(object(record, `${label}[${index}]`), `${label}[${index}]`));
    return value;
  }

  function textFields(value, keys, label) {
    for (const key of keys) if (value[key] !== undefined && value[key] !== null && typeof value[key] !== "string") throw new Error(`${label}.${key} must be text or null.`);
  }

  function recordKey(record, label) {
    if (typeof record.recordKey !== "string" || !record.recordKey.trim()) throw new Error(`${label}.recordKey must be nonempty text.`);
  }

  function images(record, label) {
    if (record.images !== undefined) records(record.images, `${label}.images`, (image, at) => textFields(image, ["imageKey", "role", "altText", "sourceUrl", "normalizedUrl"], at));
  }

  function catalogIdentifiers(record, label) {
    if (record.catalogIdentifiers === undefined) return;
    records(record.catalogIdentifiers, `${label}.catalogIdentifiers`, (identifier, at) => {
      textFields(identifier, ["namespace", "value", "source"], at);
      if (!["rsi", "communityMapping"].includes(identifier.source)) throw new Error(`${at}.source is not recognized.`);
    });
  }

  function inventory(record, label) {
    recordKey(record, label);
    textFields(record, ["title", "category", "state", "createdDateRaw", "reclaimDateRaw", "containsSummary"], label);
    images(record, label);
    catalogIdentifiers(record, label);
    if (record.items !== undefined) records(record.items, `${label}.items`, (item, at) => {
      textFields(item, ["name", "kind", "category", "manufacturer", "customName", "section"], at);
      images(item, at);
    });
    if (record.sourceLinks !== undefined) records(record.sourceLinks, `${label}.sourceLinks`, (link, at) => textFields(link, ["url"], at));
    moneyFields(record, ["meltValue", "baseValue", "buybackPrice"], label);
    if (record.meltEligible !== undefined && record.meltEligible !== null && typeof record.meltEligible !== "boolean") throw new Error(`${label}.meltEligible must be true, false, or null.`);
    if (record.ccuHistory !== undefined) records(record.ccuHistory, `${label}.ccuHistory`, (step, at) => {
      textFields(step, ["stepKey", "fromShip", "toShip", "appliedDateRaw"], at);
      moneyFields(step, ["cost", "cumulativeValue"], at);
      if (!Array.isArray(step.sourceEventKeys) || step.sourceEventKeys.some(key => typeof key !== "string" || !key)) throw new Error(`${at}.sourceEventKeys must be an array of nonempty text.`);
    });
    if (record.upgrade !== undefined && record.upgrade !== null) {
      object(record.upgrade, `${label}.upgrade`);
      for (const key of ["fromShipIdentifiers", "toShipIdentifiers", "skuIdentifiers"]) catalogIdentifiers({ catalogIdentifiers: record.upgrade[key] }, `${label}.upgrade.${key}`);
    }
  }

  function referral(record, label) {
    recordKey(record, label);
    textFields(record, ["displayName", "handle", "displayNameRaw", "nicknameRaw", "dateLabel", "dateRaw", "dateSortKey"], label);
    images(record, label);
  }

  function selectedAnomalies(document, coverage) {
    const anomalies = document?.dataQuality?.anomalies;
    if (!Array.isArray(anomalies)) return [];
    return anomalies.filter((entry) => coverage.some((section) =>
      entry?.section === section
      || section === "organizations.members" && typeof entry?.section === "string" && entry.section.startsWith("organizations.members.")
      || section === "financial" && typeof entry?.section === "string" && entry.section.startsWith("financial.")
    ));
  }

  function validOrganizationSid(value) {
    // The native schema requires nonempty text, not an uppercase or trimmed ID.
    return typeof value === "string" && value.length > 0;
  }

  function organizationOutcome(document, sid) {
    const outcomes = document.sync?.organizationMemberOutcomes;
    return outcomes && own(outcomes, sid) ? outcomes[sid]?.status : undefined;
  }

  function listOrganizationRosters(document) {
    const members = document?.organizations?.members;
    if (!Array.isArray(members)) return [];
    const counts = new Map();
    for (const member of members) {
      const sid = member?.organizationSid;
      if (validOrganizationSid(sid)) counts.set(sid, (counts.get(sid) ?? 0) + 1);
    }
    const outcomes = document?.sync?.organizationMemberOutcomes;
    if (outcomes && typeof outcomes === "object" && !Array.isArray(outcomes)) {
      for (const sid of Object.keys(outcomes)) {
        if (validOrganizationSid(sid) && ["complete", "partial"].includes(outcomes[sid]?.status) && !counts.has(sid)) counts.set(sid, 0);
      }
    }
    const memberships = Array.isArray(document?.organizations?.memberships) ? document.organizations.memberships : [];
    return Array.from(counts, ([sid, recordCount]) => {
      const membership = memberships.find(item => item?.sid === sid);
      const name = typeof membership?.name === "string" && membership.name ? membership.name : sid;
      return { sid, name, recordCount };
    });
  }

  function organizationMember(record, label) {
    recordKey(record, label);
    textFields(record, ["organizationSid", "visibility", "displayName", "handle", "membershipType", "rank"], label);
    if (record.roles !== undefined && (!Array.isArray(record.roles) || record.roles.some(role => typeof role !== "string"))) throw new Error(`${label}.roles must be an array of text.`);
    if (record.rankStars !== undefined && record.rankStars !== null && (!Number.isSafeInteger(record.rankStars) || record.rankStars < 0)) throw new Error(`${label}.rankStars must be a nonnegative safe integer or null.`);
    images(record, label);
  }

  function organizationRoster(document, sid) {
    if (!validOrganizationSid(sid) || !listOrganizationRosters(document).some(roster => roster.sid === sid)) throw new Error("Choose an organization with parsed member data.");
    const source = object(document.organizations, "organizations");
    // Selection identity remains available even for a parsed-empty roster.
    const result = { organizationSid: sid };
    if (own(source, "memberships")) {
      if (!Array.isArray(source.memberships)) throw new Error("organizations.memberships must be an array.");
      result.memberships = records(source.memberships.filter(membership => membership?.sid === sid), "organizations.memberships", (membership, at) => {
        textFields(membership, ["sid", "name", "membershipType", "rank"], at);
        images(membership, at);
      });
    }
    result.members = records(source.members.filter(member => member?.organizationSid === sid), "organizations.members", organizationMember);
    return result;
  }

  function rawLog(record, label) {
    for (const key of ["rawTimestamp", "subjectId", "subjectName", "rawDetail"]) if (!own(record, key)) throw new Error(`${label}.${key} is missing.`);
    for (const key of ["rawTimestamp", "rawDetail"]) if (typeof record[key] !== "string") throw new Error(`${label}.${key} must be text.`);
    if (record.subjectName !== null && typeof record.subjectName !== "string") throw new Error(`${label}.subjectName must be text or null.`);
    if (record.subjectId !== null && (!Number.isSafeInteger(record.subjectId) || record.subjectId < 0)) throw new Error(`${label}.subjectId must be a nonnegative safe integer or null.`);
  }

  function decimal(value, label) {
    if (typeof value !== "string" || !DECIMAL.test(value)) throw new Error(`${label} must be an exact decimal string.`);
  }

  function money(value, label, unit = "currency") {
    if (value === null) return;
    object(value, label);
    decimal(value.amount, `${label}.amount`);
    if (typeof value[unit] !== "string" || !value[unit]) throw new Error(`${label}.${unit} must be nonempty text.`);
  }

  function moneyFields(record, keys, label) {
    for (const key of keys) if (own(record, key)) money(record[key], `${label}.${key}`);
  }

  function payments(record, label) {
    if (record.payments !== undefined) records(record.payments, `${label}.payments`, (payment, at) => {
      textFields(payment, ["rawTimestamp", "processor", "status"], at);
      if (own(payment, "amount")) money(payment.amount, `${at}.amount`);
    });
  }

  function financial(value, coverage) {
    object(value, "financial");
    let count = 0;
    if (own(value, "balances")) {
      object(value.balances, "financial.balances");
      for (const [key, balance] of Object.entries(value.balances)) {
        money(balance, `financial.balances.${key}`, "unit");
        if (balance !== null) count += 1;
      }
      coverage.push("financial.balances");
    }
    if (own(value, "billingTotal")) {
      money(value.billingTotal, "financial.billingTotal");
      if (value.billingTotal !== null) {
        if (value.billingTotal.source !== undefined && value.billingTotal.source !== "billingPageTotal") throw new Error("financial.billingTotal must come from the Billing page.");
        count += 1;
      }
      coverage.push("financial.billingTotal");
    }
    if (own(value, "creditLedgers")) {
      object(value.creditLedgers, "financial.creditLedgers");
      for (const [key, ledger] of Object.entries(value.creditLedgers)) {
        const label = `financial.creditLedgers.${key}`;
        count += records(ledger, label, (event, at) => {
          textFields(event, ["rawTimestamp", "rawDetail", "unit"], at);
          if (own(event, "amount") && event.amount !== null) decimal(event.amount, `${at}.amount`);
          if (own(event, "parsed")) object(event.parsed, `${at}.parsed`);
        }).length;
        coverage.push(label);
      }
    }
    if (own(value, "subscriptions")) {
      count += records(value.subscriptions, "financial.subscriptions", (subscription, at) => {
        textFields(subscription, ["subscriptionId", "plan", "state", "startDateRaw", "endDateRaw", "recurringState", "totalTimeRaw"], at);
        moneyFields(subscription, ["amount", "totalPaid"], at);
        payments(subscription, at);
        images(subscription, at);
      }).length;
      coverage.push("financial.subscriptions");
    }
    if (own(value, "orders")) {
      count += records(value.orders, "financial.orders", (order, at) => {
        textFields(order, ["orderId", "placedAtRaw", "storefront", "status", "paymentState", "fulfillmentState"], at);
        moneyFields(order, ["itemsTotal", "additionalDiscount", "creditsUsed", "shippingAndHandling", "tax", "total"], at);
        payments(order, at);
        for (const key of ["billingAddress", "shippingAddress"]) if (own(order, key) && order[key] !== null) object(order[key], `${at}.${key}`);
        if (order.items !== undefined) records(order.items, `${at}.items`, (item, itemAt) => {
          textFields(item, ["name"], itemAt);
          if (item.quantity !== undefined && (!Number.isSafeInteger(item.quantity) || item.quantity < 1)) throw new Error(`${itemAt}.quantity must be a positive safe integer.`);
          moneyFields(item, ["unitPrice", "discount", "total"], itemAt);
          images(item, itemAt);
        });
      }).length;
      coverage.push("financial.orders");
    }
    if (!coverage.some(key => key.startsWith("financial."))) coverage.push("financial");
    return count;
  }

  function options(selection) {
    object(selection, "Export selection");
    const result = { format: "native", inventoryScope: "both", referralLadder: "both", referralKind: "both", example: false, ...selection };
    const choices = {
      preset: ["inventory", "referrals", "hangar-log", "billing", "organization-members", "custom"],
      format: ["native", "hangar-link"], inventoryScope: ["hangar", "buybacks", "both"],
      referralLadder: ["both", "current", "legacy"], referralKind: ["both", "prospects", "recruits"]
    };
    for (const [key, allowed] of Object.entries(choices)) if (!allowed.includes(result[key])) throw new Error(`Choose a valid ${key}.`);
    if (typeof result.example !== "boolean") throw new Error("example must be a boolean.");
    if (result.format === "hangar-link" && result.preset !== "inventory") throw new Error("Hangar Link format is available only for inventory.");
    if (result.sections !== undefined && (!Array.isArray(result.sections) || result.sections.some(section => !SECTIONS.includes(section)))) throw new Error("Choose valid custom sections.");
    if (result.preset === "custom" && !result.sections?.length) throw new Error("Choose at least one section.");
    return result;
  }

  function serialize(payload) {
    let nodes = 0;
    const ancestors = new WeakSet();
    function visit(value, depth) {
      if (depth > LIMITS.depth) throw new Error("Export JSON nesting is too deep.");
      if (++nodes > LIMITS.nodes) throw new Error("Export JSON contains too many values.");
      if (value === null || typeof value === "boolean") return;
      if (typeof value === "string") {
        if (value.length > LIMITS.string) throw new Error("An export string is too long.");
        return;
      }
      if (typeof value === "number" && Number.isFinite(value)) return;
      if (typeof value !== "object") throw new Error("Selected data contains a value that JSON cannot preserve.");
      if (ancestors.has(value)) throw new Error("Selected data contains a circular reference.");
      ancestors.add(value);
      if (Array.isArray(value)) {
        if (value.length > LIMITS.array) throw new Error("An export array is too long.");
        for (let index = 0; index < value.length; index += 1) {
          if (!own(value, index)) throw new Error("Selected data contains an incomplete array.");
          visit(value[index], depth + 1);
        }
        if (Object.keys(value).length !== value.length) throw new Error("Selected data contains array properties JSON cannot preserve.");
      } else {
        const prototype = Object.getPrototypeOf(value);
        if (prototype !== Object.prototype && prototype !== null) throw new Error("Selected data must contain plain JSON objects.");
        const keys = Object.keys(value);
        if (keys.length > LIMITS.properties) throw new Error("An export object has too many properties.");
        for (const key of keys) {
          if (key.length > LIMITS.string) throw new Error("An export property name is too long.");
          const descriptor = Object.getOwnPropertyDescriptor(value, key);
          if (!own(descriptor, "value")) throw new Error("Selected data must contain plain JSON values.");
          visit(descriptor.value, depth + 1);
        }
      }
      if (Object.getOwnPropertySymbols(value).length) throw new Error("Selected data contains properties JSON cannot preserve.");
      ancestors.delete(value);
    }
    visit(payload, 0);
    // Serialization takes a detached snapshot without changing the loaded model.
    const text = `${JSON.stringify(payload, null, 2)}\n`;
    if (new TextEncoder().encode(text).byteLength > LIMITS.bytes) throw new Error("Export JSON exceeds the 25 MiB limit.");
    return text;
  }

  function prepare(document, selection) {
    object(document, "Account data");
    const chosen = options(selection);
    let sections;
    if (chosen.preset === "inventory") sections = chosen.inventoryScope === "both" ? ["hangar", "buybacks"] : [chosen.inventoryScope];
    else if (chosen.preset === "custom") sections = SECTIONS.filter(section => chosen.sections.includes(section));
    else sections = [chosen.preset];
    let payload = {};
    let recordCount = 0;
    const coverage = [];
    const warnings = [];
    for (const section of sections) {
      if (section === "hangar" || section === "buybacks") {
        const key = section === "hangar" ? "pledges" : "buybacks";
        payload[key] = records(document[key], key, inventory);
        recordCount += payload[key].length;
        coverage.push(key);
      } else if (section === "referrals") {
        const source = object(document.referrals, "referrals");
        payload.referrals = {};
        for (const ladder of chosen.referralLadder === "both" ? ["current", "legacy"] : [chosen.referralLadder]) {
          object(source[ladder], `referrals.${ladder}`);
          payload.referrals[ladder] = {};
          for (const kind of chosen.referralKind === "both" ? ["prospects", "recruits"] : [chosen.referralKind]) {
            const key = `referrals.${ladder}.${kind}`;
            payload.referrals[ladder][kind] = records(source[ladder][kind], key, referral);
            recordCount += source[ladder][kind].length;
            coverage.push(key);
          }
        }
      } else if (section === "hangar-log") {
        payload.hangarLog = records(document.hangarLog, "hangarLog", rawLog).map(({ rawTimestamp, subjectId, subjectName, rawDetail }) => ({ rawTimestamp, subjectId, subjectName, rawDetail }));
        recordCount += payload.hangarLog.length;
        coverage.push("hangarLog");
      } else if (section === "billing") {
        recordCount += financial(document.financial, coverage);
        payload.financial = document.financial;
      } else if (section === "organization-members") {
        payload.organizations = organizationRoster(document, chosen.organizationSid);
        recordCount += payload.organizations.members.length;
        coverage.push("organizations.members");
      }
    }
    if (chosen.example) warnings.push("Example data");
    else for (const key of coverage) {
      const outcomes = document.sync?.sectionOutcomes;
      const status = key === "organizations.members" ? organizationOutcome(document, chosen.organizationSid) : outcomes && own(outcomes, key) ? outcomes[key]?.status : undefined;
      if (status === "complete") continue;
      const warning = ["failed", "skipped", "notRun", "partial"].includes(status) ? "Partial source" : "Completeness unknown";
      if (!warnings.includes(warning)) warnings.push(warning);
    }
    const anomalies = selectedAnomalies(document, coverage);
    if (anomalies.length > 0 && chosen.format === "native" && chosen.preset !== "hangar-log") {
      payload.dataQuality = { anomalies };
      warnings.push(`${anomalies.length} raw data warning${anomalies.length === 1 ? "" : "s"}`);
    }
    let suffix = chosen.preset;
    if (chosen.preset === "inventory") suffix = chosen.inventoryScope === "both" ? "hangar-and-buybacks" : chosen.inventoryScope;
    if (chosen.preset === "referrals") suffix += `${chosen.referralLadder === "both" ? "" : `-${chosen.referralLadder}`}${chosen.referralKind === "both" ? "" : `-${chosen.referralKind}`}`;
    if (chosen.preset === "organization-members") suffix += `-${chosen.organizationSid.replace(/[^a-zA-Z0-9_-]+/gu, "-").replace(/^-+|-+$/gu, "").slice(0, 80) || "organization"}`;
    if (chosen.preset === "custom") suffix = "selection";
    if (chosen.preset === "hangar-log") payload = payload.hangarLog;
    if (chosen.format === "hangar-link") {
      const adapter = root.CitizenDataHangarLinkExport;
      if (typeof adapter?.prepareExport !== "function") throw new Error("The Hangar Link export did not load. Reload this page.");
      const converted = adapter.prepareExport(document, { inventoryScope: chosen.inventoryScope });
      if (!converted || !Number.isSafeInteger(converted.recordCount) || converted.recordCount < 0 || !Array.isArray(converted.warnings) || converted.warnings.some(warning => typeof warning !== "string")) throw new Error("Hangar Link export returned an invalid result.");
      payload = converted.payload;
      recordCount = converted.recordCount;
      for (const warning of converted.warnings) if (!warnings.includes(warning)) warnings.push(warning);
      suffix += "-hangar-link";
    }
    const timestamp = root.CitizenDataFileTimestamp?.format?.(new Date().toISOString()) ?? "undated-000000-000Z";
    const fileName = `citizendata${chosen.example ? "-example" : ""}-${suffix}-${timestamp}.json`;
    return { text: serialize(payload), recordCount, fileName, warnings };
  }

  function inspectExport(document, selection) {
    try {
      const { recordCount, fileName, warnings } = prepare(document, selection);
      return { canExport: true, recordCount, fileName, warnings, errors: [] };
    } catch (error) {
      return { canExport: false, recordCount: 0, fileName: "", warnings: [], errors: [error instanceof Error ? error.message : "Cannot export the selected data."] };
    }
  }

  function createExport(document, selection) {
    const { text, fileName } = prepare(document, selection);
    return { text, fileName, mimeType: "application/json" };
  }

  return Object.freeze({ inspectExport, createExport, listOrganizationRosters });
});
