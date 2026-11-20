(function exposeDashboardModel(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.CitizenDataDashboardModel = api;
})(typeof globalThis === "object" ? globalThis : this, () => {
  "use strict";

  const COLLECTION_SECTIONS = Object.freeze({
    profile: Object.freeze({ operation: "Reading your RSI dossier", label: "Account identity", summary: "Verifying the signed in RSI dossier and account identity." }),
    "financial.balances": Object.freeze({ operation: "Reading account balances", label: "Account balances", summary: "Reading Store Credit, UEC, and REC balances from Billing." }),
    "financial.billingTotal": Object.freeze({ operation: "Reading billing totals", label: "Billing total", summary: "Reading the account's total billed amount." }),
    "financial.ledgers": Object.freeze({ operation: "Reading financial ledgers", label: "Financial ledgers", summary: "Reading Store Credit, UEC, and REC ledger histories." }),
    "financial.orders": Object.freeze({ operation: "Reading billing orders", label: "Billing orders", summary: "Reading billing order history, including physical merchandise records." }),
    "financial.subscriptions": Object.freeze({ operation: "Reading subscription history", label: "Subscriptions", summary: "Reading subscription status and subscription billing history." }),
    hangarLog: Object.freeze({ operation: "Reading Hangar Log history", label: "Hangar Log", summary: "Reading pledge creation, upgrade, gift, reclaim, and reward history." }),
    pledges: Object.freeze({ operation: "Reading your current Hangar", label: "Current Hangar", summary: "Reading current Hangar pledges and their contained items." }),
    buybacks: Object.freeze({ operation: "Reading Buy Back Pledges", label: "Buybacks", summary: "Reading Buy Back Pledges and their contained items." }),
    buybackDetails: Object.freeze({ operation: "Reading buy-back prices", label: "Buy-back prices", summary: "Reading one buy-back page for each item, for its price and contents." }),
    buybackUpgradePrices: Object.freeze({ operation: "Reading CCU buy-back prices", label: "CCU buy-back prices", summary: "Reading the price RSI asks now for each different CCU buy-back." }),
    "referrals.legacy.recruits": Object.freeze({ operation: "Reading legacy referral recruits", label: "Legacy recruits", summary: "Reading recruits from the legacy referral ladder." }),
    "referrals.current.prospects": Object.freeze({ operation: "Reading current referral prospects", label: "Current prospects", summary: "Reading prospects from the current referral ladder." }),
    "referrals.current.recruits": Object.freeze({ operation: "Reading current referral recruits", label: "Current recruits", summary: "Reading recruits from the current referral ladder." }),
    "organizations.memberships": Object.freeze({ operation: "Reading organization memberships", label: "Organizations", summary: "Reading public organization memberships from the RSI dossier." })
  });

  function collectionSectionPresentation(section) {
    if (typeof section === "string" && section.startsWith("organizations.members.")) {
      const sid = section.slice("organizations.members.".length);
      return Object.freeze({ operation: `Reading the ${sid || "selected"} member roster`, label: `${sid || "Selected"} member roster`, summary: "Reading the separately authorized member roster for the selected organization." });
    }
    return COLLECTION_SECTIONS[section] ?? Object.freeze({ operation: "Building your account backup", label: "Account backup", summary: "Collecting the next authorized account data section." });
  }

  function continuableFailurePresentation(activeJob, section) {
    const code = typeof activeJob?.failure?.code === "string" ? activeJob.failure.code.slice(0, 80) : "RUN_FAILED";
    const message = typeof activeJob?.failure?.message === "string" ? activeJob.failure.message.slice(0, 500) : "The account backup stopped.";
    const technicalMessage = code === message ? code : `${code}: ${message}`;
    const diagnostic = `${code} ${message}`;
    const pageMismatch = /RSI_BUYBACKS_PAGE_MISMATCH_REQUESTED_([0-9]+)_OBSERVED_([0-9]+)/u.exec(diagnostic);
    if (pageMismatch) {
      return Object.freeze({
        summary: `Completed data and the Buybacks page ${pageMismatch[1]} cursor are preserved. Continue when ready.`,
        historyMessage: `The previous attempt requested Buybacks page ${pageMismatch[1]}, but RSI returned page ${pageMismatch[2]}.`,
        technicalMessage
      });
    }
    return Object.freeze({
      summary: `Completed data and the saved ${section.label} cursor are preserved. Continue when ready.`,
      historyMessage: `The previous attempt stopped in ${section.label}. No completed data was discarded.`,
      technicalMessage
    });
  }

  function collectionStatusPresentation(publicStatus, options = {}) {
    const bridgeConnected = options.bridgeConnected === true;
    const connecting = options.connecting === true;
    const activeJob = publicStatus?.activeJob && typeof publicStatus.activeJob === "object" ? publicStatus.activeJob : null;
    const jobStatus = activeJob?.status ?? publicStatus?.status ?? null;
    const section = collectionSectionPresentation(activeJob?.currentSection);
    const roster = options.jobKind === "organizationData" || activeJob?.jobKind === "organizationData" || activeJob?.currentSection?.startsWith?.("organizations.members.");
    if (connecting) return Object.freeze({ badge: "CONNECTING", operation: roster ? "Preparing Organization Data" : "Verifying your signed in RSI account", summary: roster ? "CitizenData is preparing the selected organization roster job." : "CitizenData is establishing the read only backup run.", tone: "warning", active: true, terminal: false });
    if (!bridgeConnected) return Object.freeze({ badge: "DISCONNECTED", operation: "Extension connection unavailable", summary: "The dashboard cannot currently communicate with CitizenData.", tone: "quiet", active: false, terminal: false });
    if (publicStatus?.requiresRebind === true) return Object.freeze({ badge: "RECONNECT REQUIRED", operation: section.operation, summary: "The durable run is paused until this dashboard session is explicitly reconnected.", tone: "warning", active: true, terminal: false });
    if (jobStatus === "running") return Object.freeze({ badge: "COLLECTING", operation: section.operation, summary: section.summary, tone: "active", active: true, terminal: false });
    if (jobStatus === "paused") return Object.freeze({ badge: "PAUSED", operation: section.operation, summary: "The durable run is preserved and is not issuing RSI requests.", tone: "warning", active: false, terminal: false });
    if (jobStatus === "complete") return Object.freeze({ badge: "COMPLETED", operation: roster ? "Organization Data complete" : "Account backup complete", summary: roster ? "The selected rosters are ready in one Organization JSON." : "The canonical account document passed validation and is open in this dashboard.", tone: "success", active: false, terminal: true });
    if (jobStatus === "failed" && publicStatus?.continuable === true) {
      const failure = continuableFailurePresentation(activeJob, section);
      return Object.freeze({ badge: "READY TO CONTINUE", operation: roster ? `Continue Organization Data from ${section.label}` : `Continue backup from ${section.label}`, summary: failure.summary, historyMessage: failure.historyMessage, technicalMessage: failure.technicalMessage, tone: "warning", active: false, terminal: true });
    }
    if (jobStatus === "failed") return Object.freeze({ badge: "FAILED", operation: roster ? "Organization Data stopped" : `Backup stopped in ${section.label}`, summary: activeJob?.failure?.message ?? "The run stopped with an explicit recoverable failure.", tone: "failure", active: false, terminal: true });
    if (jobStatus === "cancelled") return Object.freeze({ badge: "CANCELLED", operation: roster ? "Organization Data cancelled" : "Account backup cancelled", summary: roster ? "The Organization Data job was cancelled." : "The account collection was cancelled.", tone: "quiet", active: false, terminal: true });
    return Object.freeze({ badge: "CONNECTED", operation: "Ready to build your backup", summary: "CitizenData is connected and no account collection is active.", tone: "active", active: false, terminal: false });
  }

  function collectionProgress(activeJob) {
    const sectionCount = Number.isSafeInteger(activeJob?.sectionCount) && activeJob.sectionCount > 0 ? activeJob.sectionCount : 0;
    const completedSections = Math.min(sectionCount, Math.max(0, Number.isSafeInteger(activeJob?.completedSections) ? activeJob.completedSections : 0));
    const currentPosition = sectionCount ? Math.min(sectionCount, completedSections + (completedSections < sectionCount ? 1 : 0)) : 0;
    const overallPercent = sectionCount ? completedSections / sectionCount * 100 : 0;
    const currentSection = activeJob?.currentSection;
    const section = collectionSectionPresentation(currentSection);
    const rawRequestProgress = activeJob?.requestProgressBySection?.[currentSection];
    const totalKnown = rawRequestProgress?.totalKnown === true && Number.isSafeInteger(rawRequestProgress.total) && rawRequestProgress.total > 0;
    const requestTotal = totalKnown ? rawRequestProgress.total : null;
    const requestCompleted = totalKnown ? Math.min(requestTotal, Math.max(0, Number.isSafeInteger(rawRequestProgress.completed) ? rawRequestProgress.completed : 0)) : 0;
    const subphaseLabels = { storeCredit: "Store Credit", uec: "UEC", rec: "REC" };
    const requestLabel = subphaseLabels[rawRequestProgress?.subphase] ?? (typeof currentSection === "string" && currentSection.startsWith("organizations.members.") ? "Roster pages" : section.label);
    const httpRequestCount = Number.isSafeInteger(activeJob?.httpRequestCount) && activeJob.httpRequestCount >= 0 ? activeJob.httpRequestCount : 0;
    const resolvedRequestTotalsForSections = Math.min(sectionCount, Math.max(0, Number.isSafeInteger(activeJob?.resolvedRequestTotalsForSections) ? activeJob.resolvedRequestTotalsForSections : 0));
    const httpRequestsTotal = Number.isSafeInteger(activeJob?.httpRequestsTotal) && activeJob.httpRequestsTotal >= httpRequestCount ? activeJob.httpRequestsTotal : null;
    const discovering = activeJob?.status === "running" && typeof currentSection === "string" && !totalKnown;
    return Object.freeze({
      sectionCount,
      completedSections,
      currentPosition,
      overallPercent,
      overallText: sectionCount ? `${completedSections} of ${sectionCount} sections completed` : "Preparing section progress",
      httpRequestCount,
      httpRequestsTotal,
      resolvedRequestTotalsForSections,
      httpText: httpRequestsTotal === null
        ? `${httpRequestCount} RSI request${httpRequestCount === 1 ? "" : "s"} completed`
        : `${httpRequestCount} of ${httpRequestsTotal} RSI request${httpRequestsTotal === 1 ? "" : "s"} completed`,
      requestProgress: totalKnown
        ? Object.freeze({ label: requestLabel, completed: requestCompleted, total: requestTotal, percent: requestCompleted / requestTotal * 100, text: `${requestCompleted} of ${requestTotal} RSI request${requestTotal === 1 ? "" : "s"}`, indeterminate: false })
        : discovering ? Object.freeze({ label: requestLabel, completed: 0, total: null, percent: null, text: "Discovering request total...", indeterminate: true }) : null
    });
  }

  function safeActivityPresentation(activity) {
    if (!activity || typeof activity !== "object" || Array.isArray(activity)) return null;
    const section = collectionSectionPresentation(activity.section);
    const at = typeof activity.at === "string" && !Number.isNaN(Date.parse(activity.at)) ? activity.at : null;
    if (activity.kind === "section-started") return Object.freeze({ at, tone: "normal", message: `Starting ${section.label}.` });
    if (activity.kind === "section-completed") {
      const records = Number.isSafeInteger(activity.recordsTotal) && activity.recordsTotal >= 0 ? activity.recordsTotal : 0;
      const requests = Number.isSafeInteger(activity.requestsTotal) && activity.requestsTotal >= 0 ? activity.requestsTotal : 0;
      return Object.freeze({ at, tone: "normal", message: `Completed ${section.label} · ${records} records in ${requests} RSI request${requests === 1 ? "" : "s"}.` });
    }
    const method = typeof activity.method === "string" && /^(?:GET|POST)$/u.test(activity.method) ? activity.method : "REQUEST";
    const route = typeof activity.route === "string" && /^\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]{1,200}$/u.test(activity.route) ? activity.route : "allowed RSI route";
    const parts = [`${method} ${route}`];
    if (Number.isSafeInteger(activity.page) && activity.page > 0) parts.push(`page ${activity.page}${Number.isSafeInteger(activity.pageCount) && activity.pageCount > 0 ? ` of ${activity.pageCount}` : ""}`);
    if (activity.kind === "request-started") return Object.freeze({ at, tone: "normal", message: `Requesting ${parts.join(" · ")}.` });
    if (activity.kind !== "request-completed") return null;
    if (Number.isSafeInteger(activity.responseStatus)) parts.push(`HTTP ${activity.responseStatus}`);
    if (Number.isSafeInteger(activity.recordsReceived) && activity.recordsReceived >= 0) parts.push(`${activity.recordsReceived} record${activity.recordsReceived === 1 ? "" : "s"}`);
    if (Number.isSafeInteger(activity.elapsedMs) && activity.elapsedMs >= 0) parts.push(`${activity.elapsedMs} ms`);
    return Object.freeze({ at, tone: "normal", message: `Received ${parts.join(" · ")}.` });
  }

  function asArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function requireObject(value, label) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
    return value;
  }

  function validateTextFields(record, fields, label) {
    for (const field of fields) if (record[field] !== null && record[field] !== undefined && typeof record[field] !== "string") throw new Error(`${label}.${field} must be text or null.`);
  }

  function validateIntegerField(record, field, label) {
    const value = record[field];
    if (value !== null && value !== undefined && (!Number.isSafeInteger(value) || value < 0)) throw new Error(`${label}.${field} must be a nonnegative safe integer or null.`);
  }

  function validateRecords(records, label, validateRecord) {
    if (!Array.isArray(records)) throw new Error(`${label} must be an array.`);
    records.forEach((record, index) => {
      const recordLabel = `${label}[${index}]`;
      requireObject(record, recordLabel);
      validateRecord(record, recordLabel);
    });
  }

  function validateIdentity(record, field, label) {
    if (typeof record[field] !== "string" || !record[field].trim()) throw new Error(`${label}.${field} must be nonempty text.`);
  }

  function validateMedia(record, label) {
    if (record.images !== undefined) validateRecords(record.images, `${label}.images`, (image, imageLabel) => {
      validateTextFields(image, ["imageKey", "role", "altText"], imageLabel);
    });
  }

  function validateInventoryRecord(record, label) {
    validateIdentity(record, "recordKey", label);
    validateTextFields(record, ["title", "category", "state", "createdDateRaw", "reclaimDateRaw", "containsSummary"], label);
    validateMedia(record, label);
    if (record.items !== undefined) validateRecords(record.items, `${label}.items`, (item, itemLabel) => {
      validateTextFields(item, ["name", "kind", "category", "manufacturer", "customName", "section"], itemLabel);
      validateMedia(item, itemLabel);
    });
    if (record.sourceLinks !== undefined) validateRecords(record.sourceLinks, `${label}.sourceLinks`, (link, linkLabel) => validateTextFields(link, ["url"], linkLabel));
    if (record.observation !== undefined) validateTextFields(requireObject(record.observation, `${label}.observation`), ["lastObservedAt"], `${label}.observation`);
  }

  function validateAccountDocument(document) {
    requireObject(document, "Account JSON");
    if (document.schemaVersion !== 1) throw new Error("Only account schema version 1 is supported by this source checkpoint.");
    requireObject(document.account, "account");
    requireObject(document.profile, "profile");
    // Validate the shapes consumed by the renderer before replacing a loaded file.
    // Complete schema and integrity verification remain a separate adapter concern.
    validateTextFields(document.account, ["handle"], "account");
    validateIntegerField(document.account, "ueeCitizenRecord", "account");
    validateTextFields(document.profile, ["displayName", "handle", "displayTitle", "dossierBadgeTitle", "enlistedOnRaw", "mainOrganizationSid", "organizationRank"], "profile");
    validateMedia(document.profile, "profile");
    requireObject(document.financial, "financial");
    requireObject(document.financial.balances, "financial.balances");
    for (const key of ["storeCredit", "uec", "rec"]) {
      const balance = document.financial.balances[key];
      if (balance === null || balance === undefined) continue;
      requireObject(balance, `financial.balances.${key}`);
      if (typeof balance.amount !== "string" || !decimalParts(balance.amount) || typeof balance.unit !== "string") throw new Error(`financial.balances.${key} must contain an exact decimal amount and a unit.`);
    }
    if (document.financial.billingTotal !== null) {
      const total = requireObject(document.financial.billingTotal, "financial.billingTotal");
      if (total.source !== "billingPageTotal" || typeof total.amount !== "string" || !decimalParts(total.amount) || typeof total.currency !== "string") throw new Error("financial.billingTotal must be direct Billing-page evidence or null.");
    }
    if (document.financial.subscriptions !== undefined && document.financial.subscriptions !== null) {
      const validateMoney = (money, label) => {
        requireObject(money, label);
        if (typeof money.amount !== "string" || !decimalParts(money.amount) || typeof money.currency !== "string" || !money.currency.trim()) throw new Error(`${label} must contain an exact decimal amount and currency.`);
      };
      validateRecords(document.financial.subscriptions, "financial.subscriptions", (subscription, label) => {
        validateIdentity(subscription, "subscriptionId", label);
        validateTextFields(subscription, ["plan", "state", "startDateRaw", "endDateRaw", "recurringState", "totalTimeRaw"], label);
        for (const key of ["amount", "totalPaid"]) if (subscription[key] !== null && subscription[key] !== undefined) validateMoney(subscription[key], `${label}.${key}`);
        if (subscription.payments !== undefined) validateRecords(subscription.payments, `${label}.payments`, (payment, paymentLabel) => {
          validateTextFields(payment, ["rawTimestamp", "processor", "status"], paymentLabel);
          if (payment.amount !== null && payment.amount !== undefined) validateMoney(payment.amount, `${paymentLabel}.amount`);
        });
      });
    }
    requireObject(document.referrals, "referrals");
    requireObject(document.referrals.current, "referrals.current");
    requireObject(document.referrals.legacy, "referrals.legacy");
    requireObject(document.organizations, "organizations");
    for (const key of ["pledges", "buybacks"]) {
      validateRecords(document[key], key, validateInventoryRecord);
    }
    for (const source of ["current", "legacy"]) {
      for (const kind of ["prospects", "recruits"]) {
        validateRecords(document.referrals[source][kind], `referrals.${source}.${kind}`, (record, label) => {
          validateIdentity(record, "recordKey", label);
          validateTextFields(record, ["displayName", "handle", "dateRaw", "dateSortKey"], label);
          validateMedia(record, label);
        });
      }
    }
    validateRecords(document.organizations.memberships, "organizations.memberships", (membership, label) => {
      validateIdentity(membership, "sid", label);
      validateTextFields(membership, ["name", "membershipType", "rank"], label);
      validateIntegerField(membership, "memberCount", label);
      if (membership.isMain !== undefined && typeof membership.isMain !== "boolean") throw new Error(`${label}.isMain must be a boolean.`);
      validateMedia(membership, label);
    });
    validateRecords(document.organizations.members ?? [], "organizations.members", (member, label) => {
      validateIdentity(member, "recordKey", label);
      validateIdentity(member, "organizationSid", label);
      validateTextFields(member, ["displayName", "handle", "membershipType", "rank"], label);
      if (!["public", "restricted"].includes(member.visibility)) throw new Error(`${label}.visibility must be public or restricted.`);
      validateIntegerField(member, "rankStars", label);
      validateMedia(member, label);
      if (member.roles !== undefined && (!Array.isArray(member.roles) || member.roles.some((role) => typeof role !== "string"))) throw new Error(`${label}.roles must be an array of text.`);
    });
    if (document.sync !== undefined) {
      requireObject(document.sync, "sync");
      for (const key of ["sectionOutcomes", "organizationMemberOutcomes"]) {
        if (document.sync[key] === undefined) continue;
        for (const [section, outcome] of Object.entries(requireObject(document.sync[key], `sync.${key}`))) validateTextFields(requireObject(outcome, `sync.${key}.${section}`), ["status"], `sync.${key}.${section}`);
      }
    }
    return document;
  }

  function referralTimestamp(value) {
    const dateSortKey = typeof value === "string" ? value : value?.dateSortKey;
    const dateRaw = typeof value === "object" && value ? value.dateRaw : null;
    const candidate = typeof dateSortKey === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(dateSortKey) ? dateSortKey : dateRaw;
    const match = typeof candidate === "string" ? /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}):(\d{2})(?:Z)?)?$/u.exec(candidate) : null;
    if (!match) return null;
    const [, yearText, monthText, dayText, hourText = "0", minuteText = "0", secondText = "0"] = match;
    const [year, month, day, hour, minute, second] = [yearText, monthText, dayText, hourText, minuteText, secondText].map(Number);
    const time = Date.UTC(year, month - 1, day, hour, minute, second);
    const date = new Date(time);
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day || date.getUTCHours() !== hour || date.getUTCMinutes() !== minute || date.getUTCSeconds() !== second) return null;
    return time;
  }

  function sortReferralRecords(records, order = "newest") {
    const multiplier = order === "oldest" ? 1 : -1;
    return asArray(records).map((record, index) => ({ record, index, time: referralTimestamp(record) })).sort((left, right) => {
      if (left.time === null && right.time !== null) return 1;
      if (right.time === null && left.time !== null) return -1;
      if (left.time !== right.time) return (left.time - right.time) * multiplier;
      const keyOrder = String(left.record.recordKey ?? "").localeCompare(String(right.record.recordKey ?? ""));
      return keyOrder || left.index - right.index;
    }).map(({ record }) => record);
  }

  function paginate(records, page, pageSize = 25) {
    const items = asArray(records);
    const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
    const safePage = Math.min(Math.max(Number.isInteger(page) ? page : 1, 1), totalPages);
    return { items: items.slice((safePage - 1) * pageSize, safePage * pageSize), page: safePage, pageSize, total: items.length, totalPages };
  }

  // Queued, loading, and ready load states also carry a message; only a failed load is an error.
  function mediaLoadError(loadState) {
    if (loadState?.status !== "error") return null;
    return typeof loadState.message === "string" && loadState.message ? loadState.message : "This image could not be loaded.";
  }

  function getBalance(document, key) {
    return document?.financial?.balances?.[key] ?? null;
  }

  function getMainMembership(document) {
    const memberships = asArray(document?.organizations?.memberships).filter((membership) => membership && typeof membership === "object" && !Array.isArray(membership));
    const sid = document?.profile?.mainOrganizationSid;
    if (typeof sid === "string" && sid.trim()) return memberships.find((membership) => membership.sid === sid && membership.membershipType !== "affiliate") ?? null;
    return memberships.find((membership) => membership.membershipType === "main") ?? memberships.find((membership) => membership.isMain === true && membership.membershipType !== "affiliate") ?? null;
  }

  function getBillingTotal(document) {
    const total = document?.financial?.billingTotal;
    if (!total || total.source !== "billingPageTotal" || typeof total.amount !== "string" || typeof total.currency !== "string") return null;
    return total;
  }

  function decimalParts(value) {
    const match = /^(-?)([0-9]+)(?:\.([0-9]{1,4}))?$/u.exec(String(value ?? ""));
    if (!match) return null;
    return { sign: match[1], integer: match[2], fraction: match[3] ?? "" };
  }

  function formatExactNumber(value, minimumFractionDigits = 0) {
    const parts = decimalParts(value);
    if (!parts) return "—";
    const integer = parts.integer.replace(/\B(?=(?:[0-9]{3})+(?![0-9]))/gu, ",");
    const fraction = parts.fraction.padEnd(minimumFractionDigits, "0");
    return `${parts.sign}${integer}${fraction ? `.${fraction}` : ""}`;
  }

  function formatExactMoney(value, currencyOrUnit) {
    const parts = decimalParts(value);
    if (!parts) return "—";
    const formatted = formatExactNumber(value, currencyOrUnit === "USD" ? 2 : 0);
    if (currencyOrUnit !== "USD") return formatted;
    return parts.sign === "-" ? `-$${formatted.slice(1)}` : `$${formatted}`;
  }

  function buildDefaultPlan() {
    const selectedSections = ["profile", "financial.balances", "financial.billingTotal", "financial.ledgers", "financial.orders", "financial.subscriptions", "hangarLog", "pledges", "buybacks", "referrals.legacy.recruits", "referrals.current.prospects", "referrals.current.recruits", "organizations.memberships", "buybackDetails", "buybackUpgradePrices"];
    return {
      selectedSections,
      maximumRecordsBySection: {
        profile: 1,
        pledges: 10000,
        hangarLog: 50000,
        buybacks: 10000,
        "financial.balances": 3,
        "financial.billingTotal": 1,
        "financial.ledgers": 25000,
        "financial.orders": 10000,
        "financial.subscriptions": 1000,
        "referrals.current.prospects": 10000,
        "referrals.current.recruits": 10000,
        "referrals.legacy.recruits": 10000,
        "organizations.memberships": 1000,
        buybackDetails: 10000,
        buybackUpgradePrices: 10000
      },
      minimumInterRequestDelayMs: 900
    };
  }

  function membersForOrganization(document, sid) {
    return asArray(document?.organizations?.members).filter((member) => member.organizationSid === sid);
  }

  function initials(value) {
    const words = String(value ?? "").trim().split(/\s+/u).filter(Boolean);
    if (!words.length) return "?";
    return words.slice(0, 2).map((word) => word[0]).join("").toUpperCase();
  }

  function personLinks(handle, { redacted = false, exampleProspect = false } = {}) {
    // Conservative link eligibility; unsupported handles remain readable text.
    if (redacted || typeof handle !== "string" || !/^[A-Za-z0-9_-]+$/u.test(handle)) return null;
    if (exampleProspect) {
      const url = "https://robertsspaceindustries.com/enlist?referral=STAR-GN2F-6JLW";
      return { monikerUrl: url, usernameUrl: url };
    }
    const segment = encodeURIComponent(handle);
    return {
      monikerUrl: `https://robertsspaceindustries.com/spectrum/messages/member/${segment}`,
      usernameUrl: `https://robertsspaceindustries.com/en/citizens/${segment}`
    };
  }

  function inventorySearchText(record) {
    const values = [];
    const seen = new WeakSet();
    const visit = (value, depth) => {
      if (value === null || value === undefined || depth > 8) return;
      if (["string", "number", "boolean"].includes(typeof value)) {
        values.push(String(value));
        return;
      }
      if (typeof value !== "object" || seen.has(value)) return;
      seen.add(value);
      if (Array.isArray(value)) {
        for (const child of value) visit(child, depth + 1);
        return;
      }
      for (const [key, child] of Object.entries(value)) {
        values.push(key);
        visit(child, depth + 1);
      }
    };
    visit(record, 0);
    return values.join(" ").toLocaleLowerCase();
  }

  // RSI's placeholder picture, which a saved file from an earlier build may still hold, is never shown.
  function isPlaceholderImage(image) {
    return globalThis.CitizenDataAccountDocument.isPlaceholderImage(image);
  }

  function inventoryMediaEntries(record) {
    const entries = [];
    const seenImages = new Set();
    const visitedEntities = new WeakSet();
    const visit = (entity, depth, ownerLabel) => {
      if (!entity || typeof entity !== "object" || Array.isArray(entity) || depth > 6 || visitedEntities.has(entity)) return;
      visitedEntities.add(entity);
      const label = typeof entity.title === "string" && entity.title.trim()
        ? entity.title.trim()
        : typeof entity.name === "string" && entity.name.trim() ? entity.name.trim() : ownerLabel;
      for (const [index, image] of asArray(entity.images).entries()) {
        if (!image || typeof image !== "object" || Array.isArray(image) || isPlaceholderImage(image)) continue;
        const identity = [image.imageKey, image.normalizedUrl, image.sourceUrl]
          .find((value) => typeof value === "string" && value.trim());
        const key = identity ? `image:${identity}` : `path:${ownerLabel}:${depth}:${index}`;
        if (seenImages.has(key)) continue;
        seenImages.add(key);
        entries.push(Object.freeze({ reference: image, label: image.altText?.trim?.() || label || "Account record image" }));
      }
      for (const item of asArray(entity.items)) visit(item, depth + 1, label || ownerLabel);
    };
    visit(record, 0, typeof record?.title === "string" ? record.title : "Account record image");
    return entries;
  }

  // The image a record is shown by, as a position among its media entries. A CCU is shown by the ship it leads
  // to: the image read with its price, or else its last image, which is that of the item the CCU holds.
  function inventoryLeadMediaIndex(record, entries = inventoryMediaEntries(record)) {
    const destination = entries.findIndex((entry) => entry.reference?.role === "upgrade-destination");
    if (destination >= 0) return destination;
    return (record?.kind === "upgrade" || record?.category === "shipUpgrade") && entries.length > 0 ? entries.length - 1 : 0;
  }

  function referralSearchText(record) {
    return [record?.displayName, record?.handle]
      .filter((value) => typeof value === "string" && value.trim())
      .join("\n")
      .toLocaleLowerCase();
  }

  return Object.freeze({ asArray, buildDefaultPlan, collectionProgress, collectionSectionPresentation, collectionStatusPresentation, formatExactMoney, formatExactNumber, getBalance, getBillingTotal, getMainMembership, initials, inventoryLeadMediaIndex, inventoryMediaEntries, inventorySearchText, isPlaceholderImage, mediaLoadError, membersForOrganization, paginate, personLinks, referralSearchText, referralTimestamp, safeActivityPresentation, sortReferralRecords, validateAccountDocument });
});
