(function initializeCitizenDataLiveRuntime(root, factory) {
  "use strict";

  const api = factory(root);
  root.CitizenDataLiveRuntime = api;
  if (typeof module === "object" && module?.exports) module.exports = api;
})(globalThis, function createCitizenDataLiveRuntime(root) {
  "use strict";

  const parsers = root.CitizenDataPureParsers;
  const rsiApi = root.CitizenDataRsiApi;

  // Billing page 1, the address collectBillingDocument asks for. A later billing section of the plan reads it from the
  // cache, so it is kept at a section end when the runner says so (PARSER_HARDENING.md §5.6, §13.1).
  const BILLING_PAGE_1_URL = "https://robertsspaceindustries.com/account/billing?page=1&pagesize=100";
  const sectionEndRetain = (input) => ({ retain: input?.retainBillingPage === true ? [BILLING_PAGE_1_URL] : [] });
  const BILLING_SECTIONS = new Set(["financial.balances", "financial.billingTotal", "financial.orders", "financial.subscriptions"]);

  async function closeCollectorTab() {
    rsiApi.clearTransientCaches();
  }

  // The status page's checker (extension/adapters/rsi-status-page.js), or "not read" where it is not loaded.
  function checkStatusPage(options = {}) {
    const statusPage = root.CitizenDataRsiStatusPage;
    return typeof statusPage?.checkStatusPage === "function"
      ? statusPage.checkStatusPage(options)
      : Promise.resolve({ status: "unknown", reason: "unreadable", components: [], httpStatus: null, checkedAt: new Date().toISOString() });
  }

  async function discoverSignedInAccount() {
    const identity = await rsiApi.identifyAccount();
    return identity.accountId;
  }

  // The signed-in account's handle and display name, from RSI's identify route alone, for Add new account. It reads
  // no section of the account.
  async function identifySignedInAccount() {
    const identity = await rsiApi.identifyAccount();
    return Object.freeze({ accountId: identity.accountId, displayName: identity.displayName });
  }

  function recordKey(section, record, index) {
    if (section === "pledges") return record.pledgeId ?? `${record.title}|${record.createdDateRaw}|${index}`;
    if (section === "buybacks") return record.recordKey ?? record.buybackId ?? `${record.title}|${record.reclaimDateRaw}|${index}`;
    if (section === "buybackDetails") return record.buybackId ?? index;
    if (section === "financial.orders") return record.orderId ?? index;
    if (section.startsWith("referrals.")) return record.recordKey ?? `${record.handle}|${record.dateRaw}|${index}`;
    if (section === "organizations.memberships") return record.sid ?? index;
    if (section.startsWith("organizations.members.")) return record.recordKey ?? `${record.visibility}|${record.handle}|${record.displayName}|${index}`;
    return JSON.stringify(record);
  }

  function mergeArrays(section, previous, incoming) {
    const output = [...previous];
    const keys = new Set(output.map((record, index) => recordKey(section, record, index)));
    for (const [index, record] of incoming.entries()) {
      const key = recordKey(section, record, index);
      if (keys.has(key)) continue;
      keys.add(key);
      output.push(record);
    }
    return output;
  }

  function mergeRaw(section, previous, pageResult) {
    const incoming = pageResult.raw;
    if (pageResult.snapshot === true) return incoming;
    if (section === "profile" && previous && incoming) {
      return {
        ...previous,
        ...incoming,
        images: incoming.images?.length ? incoming.images : (previous.images ?? [])
      };
    }
    if (section === "financial.ledgers") {
      const prior = previous ?? { storeCredit: [], uec: [], rec: [] };
      return {
        storeCredit: mergeArrays("financial.creditLedgers.storeCredit", prior.storeCredit ?? [], incoming.storeCredit ?? []),
        uec: mergeArrays("financial.creditLedgers.uec", prior.uec ?? [], incoming.uec ?? []),
        rec: mergeArrays("financial.creditLedgers.rec", prior.rec ?? [], incoming.rec ?? [])
      };
    }
    if (Array.isArray(incoming)) return mergeArrays(section, Array.isArray(previous) ? previous : [], incoming);
    return incoming;
  }

  function rawCount(section, raw) {
    if (section === "profile") return raw ? 1 : 0;
    if (section === "financial.balances") return raw ? Object.values(raw).filter((value) => value !== null).length : 0;
    if (section === "financial.billingTotal") return raw ? 1 : 0;
    if (section === "financial.ledgers") return ["storeCredit", "uec", "rec"].reduce((total, key) => total + (raw?.[key]?.length ?? 0), 0);
    return Array.isArray(raw) ? raw.length : 0;
  }

  function mergeSourceUrls(previous, incoming) {
    return Array.from(new Set([...(Array.isArray(previous) ? previous : []), ...(Array.isArray(incoming) ? incoming : [])])).sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
  }

  // The anomaly limits of §5.7: a page or batch, and a whole section.
  const ANOMALIES_PER_PAGE = 1000;
  const ANOMALIES_PER_SECTION = 10000;
  // The evidence copier's bounds: how deep a value may nest, and how many values it may hold.
  const EVIDENCE_DEPTH = 32;
  const EVIDENCE_NODES = 20000;

  // A JSON-safe copy of a source value, made from its own data properties only: no getter, toJSON or other method of
  // the value is called. A value JSON cannot hold, a cycle, or a value past the bounds gives null.
  function jsonEvidence(value) {
    let nodes = 0;
    const active = new Set();
    function copy(candidate, depth) {
      nodes += 1;
      if (nodes > EVIDENCE_NODES || depth > EVIDENCE_DEPTH) throw new RangeError("evidence bound");
      if (candidate === null || typeof candidate === "string" || typeof candidate === "boolean") return candidate;
      if (typeof candidate === "number") return Number.isFinite(candidate) ? candidate : null;
      if (typeof candidate !== "object") return null;
      if (active.has(candidate)) throw new TypeError("evidence cycle");
      active.add(candidate);
      try {
        if (Array.isArray(candidate)) {
          const output = [];
          for (let index = 0; index < candidate.length; index += 1) {
            const descriptor = Object.getOwnPropertyDescriptor(candidate, index);
            output.push(descriptor && "value" in descriptor ? copy(descriptor.value, depth + 1) : null);
          }
          return output;
        }
        const prototype = Object.getPrototypeOf(candidate);
        if (prototype !== Object.prototype && prototype !== null && Object.prototype.toString.call(candidate) !== "[object Object]") return null;
        const output = {};
        for (const key of Object.keys(candidate)) {
          const descriptor = Object.getOwnPropertyDescriptor(candidate, key);
          if (descriptor && "value" in descriptor) output[key] = copy(descriptor.value, depth + 1);
        }
        return output;
      } finally {
        active.delete(candidate);
      }
    }
    try {
      return value === undefined ? null : copy(value, 0);
    } catch {
      return null;
    }
  }

  function boundedMessage(value, fallback) {
    const message = typeof value === "string" && value.trim() ? value.trim() : fallback;
    return message.slice(0, 1000);
  }

  // A referral row RSI sent out of shape is kept as evidence, whatever the parser made of it. When the normalized data
  // holds a record under the row's own id, the row's proven identity is retained there too, and its evidence says so.
  function markRetainedReferralRows(anomalies, parserResults) {
    const keys = new Set(parserResults.flatMap((result) => (Array.isArray(result?.value) ? result.value : []).map((record) => record?.recordKey)).filter((key) => typeof key === "string"));
    return anomalies.map((entry) => entry?.retainedInNormalizedData !== true && entry?.issueCode?.startsWith("RSI_REFERRAL_RECORD_") && typeof entry.raw?.id === "string" && keys.has(entry.raw.id)
      ? Object.freeze({ ...entry, retainedInNormalizedData: true })
      : entry);
  }

  function anomaly(section, candidate, metadata, observedAt) {
    const recordIndex = Number.isSafeInteger(candidate?.recordIndex) && candidate.recordIndex > 0 ? candidate.recordIndex : 1;
    const pageOrBatch = Number.isSafeInteger(candidate?.pageOrBatch) && candidate.pageOrBatch > 0
      ? candidate.pageOrBatch
      : Number.isSafeInteger(metadata.pagesOrBatches) && metadata.pagesOrBatches > 0 ? metadata.pagesOrBatches : null;
    const issueCode = typeof candidate?.issueCode === "string" && /^[A-Z0-9_]+$/u.test(candidate.issueCode)
      ? candidate.issueCode.slice(0, 200)
      : "PARSER_REJECTED_RECORD";
    // A record can hold more than one anomaly (its nested rows, the errors of one GraphQL answer); each names itself.
    const keySuffix = typeof candidate?.keySuffix === "string" && /^[A-Za-z0-9_.[\]-]{1,120}$/u.test(candidate.keySuffix) ? `:${candidate.keySuffix}` : "";
    return Object.freeze({
      anomalyKey: `${section}:${recordIndex}:${pageOrBatch ?? "unknown"}${keySuffix}`,
      section,
      recordIndex,
      pageOrBatch,
      issueCode,
      message: boundedMessage(candidate?.message, "A source record contained unexpected values and was retained for later review."),
      raw: jsonEvidence(candidate?.raw),
      retainedInNormalizedData: candidate?.retainedInNormalizedData === true,
      observedAt,
      sourceUrls: Object.freeze([...(metadata.sourceUrls ?? [])])
    });
  }

  function mergeAnomalies(...groups) {
    const merged = new Map();
    for (const group of groups) for (const entry of group ?? []) merged.set(entry.anomalyKey, entry);
    return Object.freeze([...merged.values()].sort((left, right) => left.section.localeCompare(right.section) || left.recordIndex - right.recordIndex));
  }

  // The value a record parser returned for one record, which must be an array.
  function arrayValueOf(parsed) {
    if (!Array.isArray(parsed?.value)) throw new TypeError("The record parser did not return an array value.");
    return parsed.value;
  }

  // The anomalies of a parse: nested rows a parser left out, as anomaly records of the section.
  function nestedAnomalyCollector(section, metadata, observedAt) {
    const found = [];
    return {
      found,
      collect: (offset) => (entry) => found.push(anomaly(section, { ...entry, recordIndex: offset === null ? entry.recordIndex : offset }, metadata, observedAt))
    };
  }

  async function parseArrayResilient(parser, raw, context, metadata, parserOptions, section) {
    const whole = nestedAnomalyCollector(section, metadata, context.observedAt);
    try {
      const parserResult = await parser(raw, context, { ...metadata, ...parserOptions, onNestedAnomaly: whole.collect(null) });
      return { parserResult, anomalies: Object.freeze(whole.found) };
    } catch (collectionError) {
      const value = [];
      const acceptedRaw = [];
      const rejected = [];
      const nested = nestedAnomalyCollector(section, metadata, context.observedAt);
      for (const [index, record] of raw.entries()) {
        try {
          // A record rejected as a whole is one anomaly; its nested rows count only when the record is kept.
          const own = [];
          const parsed = await parser([record], context, { ...metadata, warnings: [], ...parserOptions, onNestedAnomaly: (entry) => own.push(entry) });
          value.push(...arrayValueOf(parsed));
          acceptedRaw.push(record);
          for (const entry of own) nested.collect(index + 1)(entry);
        } catch (recordError) {
          rejected.push(anomaly(section, {
            recordIndex: index + 1,
            issueCode: "PARSER_REJECTED_RECORD",
            message: boundedMessage(recordError?.message, "The parser rejected this source record."),
            raw: record,
            retainedInNormalizedData: false
          }, metadata, context.observedAt));
        }
      }
      rejected.push(...nested.found);
      if (acceptedRaw.length > 0 && rejected.length > 0) {
        try {
          // The nested rows were reported by the separate parses above, with their places in the whole list.
          const reparsed = await parser(acceptedRaw, context, { ...metadata, ...parserOptions, onNestedAnomaly: () => {} });
          if (Array.isArray(reparsed?.value)) value.splice(0, value.length, ...reparsed.value);
        } catch {
          // Individually normalized records remain retained in source order.
        }
      }
      if (rejected.length === nested.found.length) {
        rejected.push(anomaly(section, {
          recordIndex: 1,
          issueCode: "PARSER_REJECTED_COLLECTION",
          message: boundedMessage(collectionError?.message, "The parser rejected the record collection while individual records remained readable."),
          raw,
          retainedInNormalizedData: true
        }, metadata, context.observedAt));
      }
      const warnings = [...(metadata.warnings ?? []), `${rejected.length} parser anomaly record${rejected.length === 1 ? "" : "s"} retained in dataQuality.anomalies; collection continued.`];
      return {
        parserResult: Object.freeze({
          section,
          value: Object.freeze(value),
          outcome: Object.freeze({
            status: metadata.complete === false ? "partial" : "complete",
            parserVersion: context.parserVersion,
            startedAt: context.firstObservedAt,
            endedAt: context.observedAt,
            records: value.length,
            pagesOrBatches: metadata.pagesOrBatches ?? 1,
            warnings: Object.freeze(warnings),
            ...((metadata.sourceUrls ?? []).length ? { sourceUrls: Object.freeze([...(metadata.sourceUrls ?? [])]) } : {})
          })
        }),
        anomalies: Object.freeze(rejected)
      };
    }
  }

  // What a section has gathered so far: the merged rows, the pages they came from, and what the collector flagged.
  // The worker keeps this in memory while a section runs. It is never stored as a whole; each step stores only its own
  // page, and after a restart the same merge over the stored pages gives the same state back.
  function applyPage(section, state, page) {
    return {
      raw: mergeRaw(section, state?.raw ?? null, page),
      sourceUrls: mergeSourceUrls(state?.sourceUrls, page.sourceUrls),
      anomalies: mergeAnomalies(state?.anomalies, page.anomalies)
    };
  }

  async function parseResults(descriptor, section, raw, pageResult, observedAt = new Date().toISOString()) {
    const context = { observedAt, firstObservedAt: pageResult.firstObservedAt ?? observedAt, parserVersion: descriptor.version };
    const metadata = {
      complete: pageResult.complete !== false,
      pagesOrBatches: pageResult.pagesOrBatches ?? 1,
      warnings: pageResult.warnings ?? [],
      sourceUrls: pageResult.sourceUrls ?? []
    };
    if (section === "financial.ledgers") {
      const parsed = await Promise.all(["storeCredit", "uec", "rec"].map((ledger) => parseArrayResilient(
        parsers.parseCreditLedger,
        raw?.[ledger] ?? [],
        context,
        metadata,
        { ledger },
        `financial.creditLedgers.${ledger}`
      )));
      return {
        parserResults: parsed.map((entry) => entry.parserResult),
        anomalies: mergeAnomalies(...parsed.map((entry) => entry.anomalies))
      };
    }
    if (section === "referrals.current.prospects" && descriptor.parserOptions?.sharedProspects === true) {
      const warning = "RSI exposes one shared prospects dataset. Star Citizen Data Downloader collected it once and retained it in both ladder views.";
      const sharedMetadata = { ...metadata, warnings: [...(metadata.warnings ?? []), warning] };
      const current = await parseArrayResilient(parsers.parseReferrals, raw, context, sharedMetadata, { ladder: "current", kind: "prospects" }, "referrals.current.prospects");
      const legacy = await parseArrayResilient(parsers.parseReferrals, raw, context, sharedMetadata, { ladder: "legacy", kind: "prospects" }, "referrals.legacy.prospects");
      return {
        parserResults: [current.parserResult, legacy.parserResult],
        anomalies: mergeAnomalies(current.anomalies, legacy.anomalies)
      };
    }
    const parser = parsers?.[descriptor.parser];
    if (typeof parser !== "function") throw new Error(`The ${section} parser is unavailable.`);
    if (Array.isArray(raw)) {
      const parsed = await parseArrayResilient(parser, raw, context, metadata, descriptor.parserOptions ?? {}, section);
      return { parserResults: [parsed.parserResult], anomalies: parsed.anomalies };
    }
    return { parserResults: [await parser(raw, context, { ...metadata, ...(descriptor.parserOptions ?? {}) })], anomalies: Object.freeze([]) };
  }

  function createAdapter(descriptor) {
    // One collection step. `input.cursor` is the small stored position; `input.sectionState` is what the section has
    // gathered so far, kept in memory by the caller. A step that does not end the section returns its own page as
    // text to be stored once, and the state with that page merged in. The step that ends the section normalizes the
    // whole section, once, and returns the parser results.
    async function collectSectionStep(input) {
      const cursor = input.cursor ?? null;
      const state = input.sectionState ?? null;
      let pageResult;
      try {
        // The collectors read the rows gathered so far to find where an update meets the saved backup.
        pageResult = await rsiApi.collectStep(descriptor, {
          ...input,
          cursor: cursor || state ? { ...(cursor ?? {}), raw: state?.raw ?? null, sourceUrls: state?.sourceUrls ?? [] } : null
        });
      } catch (error) {
        await closeCollectorTab();
        // The signal says what RSI answered; the request lines of the failed step are kept (F2).
        return { ok: false, code: "RSI_READ_FAILED", message: error.message, signal: error.signal ?? null, requestActivities: Array.isArray(error.requestActivities) ? error.requestActivities : [], contractFinding: error.contractFinding ?? null };
      }

      // A durable request slot of a step (§6.3): the step goes on in a later invocation, from its kept answers.
      if (pageResult.pendingPhase) return { ok: true, pendingPhase: pageResult.pendingPhase, requestActivities: Array.isArray(pageResult.requestActivities) ? pageResult.requestActivities : [] };
      const previousRecordCount = rawCount(descriptor.id, state?.raw ?? null);
      if (pageResult.reusePrevious === true) {
        const cumulativeRecordCount = pageResult.previousRecordCount;
        if (input.previousSection?.current !== true || !Number.isSafeInteger(cumulativeRecordCount) || cumulativeRecordCount < 0 || cumulativeRecordCount > input.maximumRecords) {
          await closeCollectorTab();
          return { ok: false, code: "INVALID_UPDATE_REUSE", message: `${descriptor.id} could not prove a current bounded previous section.` };
        }
        if (pageResult.done) rsiApi.clearTransientCaches(sectionEndRetain(input));
        return {
          ok: true,
          accountId: input.accountId,
          // The saved section replaces whatever earlier steps of this section had gathered while looking for it.
          recordCount: Math.max(0, cumulativeRecordCount - previousRecordCount),
          cumulativeRecordCount,
          parserResults: [],
          resultMode: "reuse",
          reusedPrevious: true,
          changeState: "unchanged",
          requestActivities: pageResult.requestActivities ?? [],
          requestProgress: pageResult.requestProgress ?? null,
          done: true,
          cursor: null
        };
      }

      const sourceUrls = mergeSourceUrls(state?.sourceUrls, pageResult.sourceUrls);
      const pageResultWithSources = { ...pageResult, sourceUrls };
      const raw = mergeRaw(descriptor.id, state?.raw ?? null, pageResultWithSources);
      const cumulativeRecordCount = rawCount(descriptor.id, raw);
      const recordCount = cumulativeRecordCount - previousRecordCount;
      if (recordCount < 0 || cumulativeRecordCount > input.maximumRecords) {
        await closeCollectorTab();
        return { ok: false, code: "RECORD_CAP_EXCEEDED", message: `${descriptor.id} exceeded its configured record cap.` };
      }
      const observedAt = new Date().toISOString();
      const collectorAnomalies = (pageResult.rawAnomalies ?? []).map((entry) => anomaly(
        descriptor.id,
        entry,
        { pagesOrBatches: pageResult.pagesOrBatches, sourceUrls },
        observedAt
      ));
      if (collectorAnomalies.length > ANOMALIES_PER_PAGE || (state?.anomalies?.length ?? 0) + collectorAnomalies.length > ANOMALIES_PER_SECTION) {
        await closeCollectorTab();
        return { ok: false, code: "ANOMALY_LIMIT_EXCEEDED", message: `${descriptor.id} held more unexpected source records than Star Citizen Data Downloader keeps.`, requestActivities: pageResult.requestActivities ?? [] };
      }

      const observedAccountId = descriptor.id === "profile" ? pageResult.accountId : input.accountId;
      if (descriptor.id === "profile" && !observedAccountId) {
        await closeCollectorTab();
        return { ok: false, code: "ACCOUNT_ID_UNAVAILABLE", message: "The authenticated RSI profile did not expose a handle for account verification." };
      }
      if (descriptor.id === "profile" && observedAccountId.toLowerCase() !== input.accountId.toLowerCase()) {
        await closeCollectorTab();
        return { ok: false, code: "ACCOUNT_ID_MISMATCH", message: "The signed in RSI handle does not match the account authorized for this backup." };
      }
      const shared = {
        ok: true,
        accountId: input.accountId,
        recordCount,
        cumulativeRecordCount,
        changeState: pageResult.changeState ?? "changed",
        requestActivities: pageResult.requestActivities ?? [],
        requestProgress: pageResult.requestProgress ?? null
      };

      if (pageResult.done !== true) {
        // A step that replaced the gathered rows outright is stored as the whole state, and the pages before it are
        // no longer needed. Any other step is stored as just the rows it fetched.
        const checkpoint = pageResult.snapshot === true;
        const text = JSON.stringify(checkpoint
          ? { raw, snapshot: true, sourceUrls, anomalies: mergeAnomalies(state?.anomalies, collectorAnomalies) }
          : { raw: pageResult.raw, snapshot: false, sourceUrls: pageResult.sourceUrls ?? [], anomalies: collectorAnomalies });
        return {
          ...shared,
          parserResults: [],
          resultMode: "deferred",
          done: false,
          cursor: {
            page: pageResult.nextPage ?? ((cursor?.page ?? 1) + 1),
            interactiveState: pageResult.interactiveState ?? null,
            // What a partial backup needs to describe this section if the run stops here.
            lastStep: { pagesOrBatches: pageResult.pagesOrBatches ?? 1, warnings: [...(pageResult.warnings ?? [])], observedAt }
          },
          page: { checkpoint, text },
          // Merged from the stored text, so the state kept in memory is the state a restart would rebuild.
          sectionState: applyPage(descriptor.id, state, JSON.parse(text))
        };
      }

      let parsed;
      try {
        parsed = await parseResults(descriptor, descriptor.id, raw, pageResultWithSources, observedAt);
      } catch (error) {
        await closeCollectorTab();
        return { ok: false, code: "PARSER_REJECTED_PAGE", message: error.message };
      }
      const anomalies = markRetainedReferralRows(mergeAnomalies(state?.anomalies, parsed.anomalies, collectorAnomalies), parsed.parserResults);
      if (anomalies.length > ANOMALIES_PER_SECTION) {
        await closeCollectorTab();
        return { ok: false, code: "ANOMALY_LIMIT_EXCEEDED", message: `${descriptor.id} held more unexpected source records than Star Citizen Data Downloader keeps.`, requestActivities: pageResult.requestActivities ?? [] };
      }
      rsiApi.clearTransientCaches(sectionEndRetain(input));
      return {
        ...shared,
        parserResults: parsed.parserResults.map((result) => Object.freeze({ ...result, anomalies })),
        resultMode: "cumulative",
        done: true,
        cursor: null
      };
    }

    return Object.freeze({
      ...descriptor,
      enabled: true,
      fixtureStatus: "owner-live-test",
      parserVersion: descriptor.version,
      // RSI's status feed (PARSER_HARDENING.md §9.3), read through the worker's cached checker.
      checkStatusPage: (options) => checkStatusPage(options),
      // The smart check at the give-up (§9): the account's public dossier without cookies, then the status feed. The
      // runner logs each as a smart-check activity and stores the diagnosis.
      smartCheck: async ({ handle, beforeStatusRequest }) => {
        const probe = await rsiApi.probePublicPage(handle);
        const status = await checkStatusPage({ beforeRequest: beforeStatusRequest });
        return { probe, status, diagnosis: { probe: probe.probe, status: status.status, reason: status.reason, components: status.components, checkedAt: status.checkedAt } };
      },
      // A billing step first takes back Billing page 1 as the runner kept it, and returns the page it holds, so a
      // restarted worker reads the page once per run (§7.3, D23).
      collectStep: async (input) => {
        if (!BILLING_SECTIONS.has(descriptor.id)) return collectSectionStep(input);
        rsiApi.restorePages((input.retainedPages ?? []).filter((page) => page?.url === BILLING_PAGE_1_URL));
        const result = await collectSectionStep(input);
        return result?.ok === true ? { ...result, retainedPages: rsiApi.retainedPages([BILLING_PAGE_1_URL]) } : result;
      },
      // The state of an unfinished section from its stored pages, in step order.
      rebuildState: ({ pages }) => pages.reduce((state, page) => applyPage(descriptor.id, state, page), null),
      // Normalizes an unfinished section as far as it got, for the partial backup of a run that stopped.
      partialResults: async ({ cursor, sectionState }) => {
        if (!sectionState) return [];
        const lastStep = cursor?.lastStep ?? {};
        const parsed = await parseResults(descriptor, descriptor.id, sectionState.raw, {
          complete: false,
          pagesOrBatches: lastStep.pagesOrBatches ?? 1,
          warnings: lastStep.warnings ?? [],
          sourceUrls: sectionState.sourceUrls ?? []
        }, typeof lastStep.observedAt === "string" ? lastStep.observedAt : undefined);
        const anomalies = markRetainedReferralRows(mergeAnomalies(sectionState.anomalies, parsed.anomalies), parsed.parserResults);
        return parsed.parserResults.map((result) => Object.freeze({ ...result, anomalies }));
      }
    });
  }

  return Object.freeze({ createAdapter, closeCollectorTab, discoverSignedInAccount, identifySignedInAccount });
});
