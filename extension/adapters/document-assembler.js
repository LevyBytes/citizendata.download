(function initializeCitizenDataDocumentAssembler(root, factory) {
  "use strict";

  const api = factory(root.CitizenDataAccountDocument, root.CITIZENDATA_ACCOUNT_SCHEMA, root.CitizenDataRemovalTracking, root.CitizenDataUpdateDelta, root.CitizenDataJobOutcomes);
  root.CitizenDataDocumentAssembler = api;
  if (typeof module === "object" && module?.exports) module.exports = api;
})(globalThis, function createCitizenDataDocumentAssembler(AccountDocument, AccountSchema, RemovalTracking, Delta, JobOutcomes) {
  "use strict";

  const REQUIRED_OUTCOMES = Object.freeze([
    "profile",
    "pledges",
    "hangarLog",
    "buybacks",
    "financial.balances",
    "referrals.current.prospects",
    "referrals.current.recruits",
    "referrals.legacy.prospects",
    "referrals.legacy.recruits",
    "organizations.memberships"
  ]);

  function clone(value) {
    return structuredClone(value);
  }

  function notRun() {
    return { status: "notRun", parserVersion: null, startedAt: null, endedAt: null, records: 0, pagesOrBatches: 0, warnings: [] };
  }

  function emptyProfile() {
    return {
      displayName: null,
      handle: null,
      displayTitle: null,
      enlistedOnRaw: null,
      location: null,
      languages: [],
      website: null,
      biography: null,
      mainOrganizationSid: null,
      organizationRank: null,
      dossierBadgeTitle: null,
      images: [],
      observation: { firstObservedAt: "1970-01-01T00:00:00.000Z", lastObservedAt: "1970-01-01T00:00:00.000Z", parserVersion: "unobserved" }
    };
  }

  function skeleton({ account, exportedAt, generator }) {
    const sectionOutcomes = Object.fromEntries(REQUIRED_OUTCOMES.map(section => [section, notRun()]));
    return {
      schemaVersion: 1,
      generator: { name: generator?.name ?? "CitizenData", version: generator?.version ?? "0.42.1" },
      exportedAt,
      account: {
        localAccountId: account.localAccountId,
        ueeCitizenRecord: account.ueeCitizenRecord ?? null,
        handle: account.handle ?? null
      },
      profile: emptyProfile(),
      pledges: [],
      hangarLog: [],
      buybacks: [],
      financial: {
        balances: { storeCredit: null, uec: null, rec: null },
        billingTotal: null,
        creditLedgers: { storeCredit: [], uec: [], rec: [] },
        subscriptions: [],
        orders: []
      },
      referrals: { current: { prospects: [], recruits: [] }, legacy: { prospects: [], recruits: [] } },
      organizations: { memberships: [], members: [] },
      dataQuality: { anomalies: [] },
      sync: { sectionOutcomes, organizationMemberOutcomes: {}, checkpoints: {}, runs: [] },
      integrity: { algorithm: "SHA-256", contentHash: "0".repeat(64) }
    };
  }

  function valueAt(document, section) {
    const path = section.split(".");
    let current = document;
    for (const segment of path) current = current?.[segment];
    return current;
  }

  function setAt(document, section, value) {
    const path = section.split(".");
    let current = document;
    for (const segment of path.slice(0, -1)) current = current[segment];
    current[path.at(-1)] = clone(value);
  }

  function isRoster(section) {
    return section.startsWith("organizations.members.");
  }

  function applyRoster(document, result) {
    const sid = result.section.slice("organizations.members.".length);
    document.organizations.members = document.organizations.members.filter(member => member.organizationSid !== sid).concat(clone(result.value));
    document.sync.organizationMemberOutcomes[sid] = clone(result.outcome);
  }

  // A run reads the page of each buy-back that has no captured detail yet, so its result holds those and the saved
  // backup holds the rest. The details the saved backup holds are kept beside the new ones, whatever version number
  // the build that captured them carried.
  function applyBuybackDetails(document, result, previous) {
    const carried = Array.isArray(previous?.buybackDetails) ? previous.buybackDetails : [];
    const merged = new Map(carried.map((detail) => [detail.buybackId, detail]));
    for (const detail of result.value ?? []) merged.set(detail.buybackId, detail);
    document.buybackDetails = clone([...merged.values()]);
    document.sync.sectionOutcomes.buybackDetails = clone(result.outcome);
  }

  // Keeps the details of the buy-backs the backup holds, in the order of the buy-back list, and shows each captured
  // price on its buy-back. The list itself carries no price. One page is read for an item, so a buy-back whose own
  // page was not read takes the detail read for another buy-back of the same item: the same price and contents under
  // its own number and its own page address, with `readFromBuybackId` naming the buy-back whose page was read.
  function finishBuybackDetails(document) {
    if (!Array.isArray(document.buybackDetails)) return;
    const buybacks = new Map(document.buybacks.filter((buyback) => Number.isSafeInteger(buyback.buybackId)).map((buyback) => [buyback.buybackId, buyback]));
    const details = new Map(document.buybackDetails.filter((detail) => buybacks.has(detail.buybackId)).map((detail) => [detail.buybackId, detail]));
    const byItem = new Map();
    for (const [buybackId, detail] of details) {
      const key = Delta.buybackItemKey(buybacks.get(buybackId));
      // A detail read from the buy-back's own page is preferred as the one others are given.
      if (!byItem.has(key) || byItem.get(key).readFromBuybackId !== undefined && detail.readFromBuybackId === undefined) byItem.set(key, detail);
    }
    for (const [buybackId, buyback] of buybacks) {
      if (details.has(buybackId) || !Delta.buybackHasPage(buyback)) continue;
      const read = byItem.get(Delta.buybackItemKey(buyback));
      if (!read) continue;
      details.set(buybackId, {
        ...clone(read),
        buybackId,
        recordKey: `buyback-detail:${buybackId}`,
        sourceUrl: read.sourceUrl.replace(/[0-9]+$/u, String(buybackId)),
        readFromBuybackId: read.readFromBuybackId ?? read.buybackId
      });
    }
    document.buybackDetails = [...buybacks.keys()].filter((buybackId) => details.has(buybackId)).map((buybackId) => details.get(buybackId));
    for (const detail of document.buybackDetails) {
      if (detail.price) buybacks.get(detail.buybackId).buybackPrice = clone(detail.price);
    }
    const outcome = document.sync.sectionOutcomes.buybackDetails;
    if (outcome && outcome.status !== "notRun") outcome.records = document.buybackDetails.length;
  }

  // The price RSI asked for a CCU buy-back is shown on every buy-back of that upgrade. A CCU buy-back whose price
  // was not read by this build has none: the price changes, so an earlier one is never shown in its place.
  function finishBuybackUpgradePrices(document) {
    const prices = new Map((Array.isArray(document.buybackUpgradePrices) ? document.buybackUpgradePrices : []).map((entry) => [`${entry.fromShipId}:${entry.toShipId}:${entry.toSkuId}`, entry]));
    const held = new Set();
    for (const buyback of document.buybacks ?? []) {
      if (buyback?.kind !== "upgrade") continue;
      const group = Delta.buybackUpgradeGroup(buyback);
      const read = group ? prices.get(group.key) : null;
      if (read) held.add(group.key);
      buyback.buybackPrice = read?.price ? clone(read.price) : null;
      // The images of the upgrade's two ships come first among the buy-back's images: the ship it starts from, then
      // the ship it leads to. They are this build's reading and replace an earlier build's. A buy-back this build
      // read nothing for, as when the prices were skipped, keeps the ship images it has.
      if (!read) continue;
      const own = (Array.isArray(buyback.images) ? buyback.images : []).filter((image) => !["upgrade-source", "upgrade-destination"].includes(image?.role));
      const shipImages = (Array.isArray(read.images) ? read.images : []).filter((image) => !own.some((other) => other?.imageKey === image?.imageKey));
      if (shipImages.length || own.length !== (buyback.images?.length ?? 0)) buyback.images = [...clone(shipImages), ...own];
    }
    if (Array.isArray(document.buybackUpgradePrices)) {
      document.buybackUpgradePrices = [...prices].filter(([key]) => held.has(key)).map(([, entry]) => entry);
      const outcome = document.sync.sectionOutcomes.buybackUpgradePrices;
      if (outcome && outcome.status !== "notRun") outcome.records = document.buybackUpgradePrices.length;
    }
  }

  // The image of the ship a hangar CCU starts from, read in the CCU price stage, comes first among the pledge's
  // images. The image of the ship it leads to stays last, where the pledge's item put it.
  function finishHangarUpgradeShips(document, results) {
    const read = (Array.isArray(results) ? results : []).find((result) => result?.section === "buybackUpgradePrices")?.hangarUpgradeShips;
    if (!Array.isArray(read) || read.length === 0) return;
    const byPledge = new Map(read.map((entry) => [entry.pledgeId, entry]));
    for (const pledge of document.pledges ?? []) {
      const entry = byPledge.get(pledge?.pledgeId);
      if (!entry || pledge.category !== "shipUpgrade") continue;
      const own = (Array.isArray(pledge.images) ? pledge.images : []).filter((image) => image?.role !== "upgrade-source");
      const source = (Array.isArray(entry.images) ? entry.images : []).filter((image) => !own.some((other) => other?.imageKey === image?.imageKey));
      if (source.length > 0) pledge.images = [...clone(source), ...own];
    }
  }

  // W-14, the warning of a section set aside (§10.3). The technical code stays in the contract findings.
  const SET_ASIDE_WARNING = "Not read because Star Citizen Data Downloader could not recognize RSI's page.";

  // The sections the run set aside (§10.3): each result section's outcome is "failed" with W-14. Its values stay as
  // they are: the saved backup's in an update, the empty skeleton in a first build.
  function applySetAside(document, entries) {
    for (const entry of Array.isArray(entries) ? entries : []) {
      if (typeof entry?.section !== "string" || typeof entry.at !== "string") continue;
      const resultSections = typeof JobOutcomes?.outcomesForJob === "function" ? JobOutcomes.outcomesForJob(entry.section) : [entry.section];
      for (const resultSection of resultSections) {
        const roster = isRoster(resultSection);
        const outcomes = roster ? document.sync.organizationMemberOutcomes : document.sync.sectionOutcomes;
        const key = roster ? resultSection.slice("organizations.members.".length) : resultSection;
        const records = Number.isSafeInteger(outcomes[key]?.records) ? outcomes[key].records : 0;
        outcomes[key] = { status: "failed", parserVersion: typeof entry.parserVersion === "string" ? entry.parserVersion : null, startedAt: entry.at, endedAt: entry.at, records, pagesOrBatches: 0, warnings: [SET_ASIDE_WARNING] };
      }
    }
  }

  function applyResult(document, result, previous, retainedSections) {
    if (!result || typeof result.section !== "string" || !result.outcome) throw new TypeError("Parser results require a section and outcome.");
    if (!document.dataQuality) document.dataQuality = { anomalies: [] };
    const anomalies = [...(document.dataQuality.anomalies ?? [])];
    const knownAnomalies = new Map(anomalies.map((entry, index) => [entry.anomalyKey, index]));
    for (const anomaly of result.anomalies ?? []) {
      const existing = knownAnomalies.get(anomaly.anomalyKey);
      if (existing === undefined) {
        knownAnomalies.set(anomaly.anomalyKey, anomalies.length);
        anomalies.push(clone(anomaly));
      } else anomalies[existing] = clone(anomaly);
    }
    document.dataQuality.anomalies = anomalies;
    // CCU buy-back prices are never kept from an earlier build, also when this build's reading did not finish.
    if (result.section === "buybackUpgradePrices") {
      document.buybackUpgradePrices = result.outcome.status === "complete" ? clone(result.value ?? []) : [];
      document.sync.sectionOutcomes.buybackUpgradePrices = clone(result.outcome);
      return;
    }
    const priorOutcome = isRoster(result.section)
      ? previous?.sync?.organizationMemberOutcomes?.[result.section.slice("organizations.members.".length)]
      : previous?.sync?.sectionOutcomes?.[result.section];
    if (result.outcome.status !== "complete" && priorOutcome?.status === "complete") {
      retainedSections.push(result.section);
      return;
    }
    if (isRoster(result.section)) applyRoster(document, result);
    else if (result.section === "buybackDetails") applyBuybackDetails(document, result, previous);
    else {
      setAt(document, result.section, result.value);
      document.sync.sectionOutcomes[result.section] = clone(result.outcome);
    }
  }

  async function assemble(options) {
    if (!options?.account?.localAccountId || !options.exportedAt) throw new TypeError("Account identity and exportedAt are required.");
    const previous = options.previous ? clone(options.previous) : null;
    if (!previous && !(options.results ?? []).some(result => result?.section === "profile" && ["complete", "partial"].includes(result?.outcome?.status))) {
      throw new TypeError("A first account document requires an observed profile result; the assembler will not fabricate profile evidence.");
    }
    const document = previous ?? skeleton(options);
    if (!document.dataQuality) document.dataQuality = { anomalies: [] };
    document.exportedAt = options.exportedAt;
    document.generator = { name: options.generator?.name ?? document.generator.name, version: options.generator?.version ?? document.generator.version };
    document.account = {
      localAccountId: options.account.localAccountId,
      ueeCitizenRecord: options.account.ueeCitizenRecord ?? document.account.ueeCitizenRecord ?? null,
      handle: options.account.handle ?? document.account.handle ?? null
    };
    const retainedSections = [];
    if (typeof RemovalTracking?.reconcile !== "function") throw new Error("The removal tracking implementation is required.");
    // A removal is claimed only against an earlier backup whose own hash still verifies.
    let previousVerified;
    try {
      previousVerified = options.previous ? await AccountDocument.verifyIntegrity(options.previous) === true : false;
    } catch {
      previousVerified = false;
    }
    for (const result of options.results ?? []) applyResult(document, result, previous, retainedSections);
    // `document` began as a copy of the earlier backup and now holds the new lists; the earlier lists are read from
    // the earlier backup itself.
    RemovalTracking.reconcile({
      document,
      previous: options.previous ?? null,
      previousVerified,
      results: options.results ?? [],
      reusedSections: options.reusedSections ?? [],
      comparedAt: options.exportedAt
    });
    finishBuybackDetails(document);
    // A build of the account that did not read the CCU buy-back prices holds none. A run that reads only
    // organization rosters leaves the account's data, these prices included, as the last build read it.
    const ranSections = [...(options.results ?? []).map((result) => result?.section), ...(options.reusedSections ?? [])].filter((section) => typeof section === "string");
    if (ranSections.some((section) => !isRoster(section)) && !ranSections.includes("buybackUpgradePrices") && Array.isArray(document.buybackUpgradePrices)) {
      document.buybackUpgradePrices = [];
      document.sync.sectionOutcomes.buybackUpgradePrices = notRun();
    }
    finishBuybackUpgradePrices(document);
    finishHangarUpgradeShips(document, options.results);
    applySetAside(document, options.setAsideSections);
    // Records kept from an earlier build may still hold RSI's placeholder picture.
    AccountDocument?.removePlaceholderImages(document);
    // The run's contract findings join those of earlier builds, each once by its key, the newest 100 kept (§5.7).
    const findings = [...(document.dataQuality.contractFindings ?? []), ...(options.contractFindings ?? [])];
    if (findings.length > 0) {
      const byKey = new Map();
      for (const finding of findings) if (typeof finding?.findingKey === "string") byKey.set(finding.findingKey, clone(finding));
      document.dataQuality.contractFindings = [...byKey.values()].sort((left, right) => left.observedAt.localeCompare(right.observedAt)).slice(-100);
    }
    if (options.checkpoints) document.sync.checkpoints = clone(options.checkpoints);
    if (options.runs) document.sync.runs = clone(options.runs);
    document.integrity = { algorithm: "SHA-256", contentHash: "0".repeat(64) };
    const stamped = AccountDocument?.stampIntegrity ? await AccountDocument.stampIntegrity(document) : document;
    if (!AccountSchema || typeof AccountDocument?.assertValid !== "function" || typeof AccountDocument?.verifyIntegrity !== "function") {
      throw new Error("The canonical account schema and integrity implementation are required.");
    }
    AccountDocument.assertValid(stamped, AccountSchema, "Assembled account document");
    if (!await AccountDocument.verifyIntegrity(stamped)) throw new Error("The assembled account document failed integrity verification.");
    return Object.freeze({ document: stamped, retainedSections: Object.freeze(retainedSections) });
  }

  return Object.freeze({ REQUIRED_OUTCOMES, SET_ASIDE_WARNING, assemble, skeleton, valueAt });
});
