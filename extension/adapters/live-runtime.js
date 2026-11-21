(function initializeCitizenDataLiveRuntime(root, factory) {
  "use strict";

  const api = factory(root);
  root.CitizenDataLiveRuntime = api;
  if (typeof module === "object" && module?.exports) module.exports = api;
})(globalThis, function createCitizenDataLiveRuntime(root) {
  "use strict";

  const parsers = root.CitizenDataPureParsers;
  const rsiApi = root.CitizenDataRsiApi;

  async function closeCollectorTab() {
    rsiApi.clearTransientCaches();
  }

  async function discoverSignedInAccount() {
    const identity = await rsiApi.identifyAccount();
    return identity.accountId;
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

  function jsonEvidence(value) {
    try {
      const serialized = JSON.stringify(value);
      return serialized === undefined ? null : JSON.parse(serialized);
    } catch {
      return null;
    }
  }

  function boundedMessage(value, fallback) {
    const message = typeof value === "string" && value.trim() ? value.trim() : fallback;
    return message.slice(0, 1000);
  }

  function anomaly(section, candidate, metadata, observedAt) {
    const recordIndex = Number.isSafeInteger(candidate?.recordIndex) && candidate.recordIndex > 0 ? candidate.recordIndex : 1;
    const pageOrBatch = Number.isSafeInteger(candidate?.pageOrBatch) && candidate.pageOrBatch > 0
      ? candidate.pageOrBatch
      : Number.isSafeInteger(metadata.pagesOrBatches) && metadata.pagesOrBatches > 0 ? metadata.pagesOrBatches : null;
    const issueCode = typeof candidate?.issueCode === "string" && /^[A-Z0-9_]+$/u.test(candidate.issueCode)
      ? candidate.issueCode.slice(0, 200)
      : "PARSER_REJECTED_RECORD";
    return Object.freeze({
      anomalyKey: `${section}:${recordIndex}:${pageOrBatch ?? "unknown"}`,
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

  async function parseArrayResilient(parser, raw, context, metadata, parserOptions, section) {
    try {
      return { parserResult: await parser(raw, context, { ...metadata, ...parserOptions }), anomalies: Object.freeze([]) };
    } catch (collectionError) {
      const value = [];
      const acceptedRaw = [];
      const rejected = [];
      for (const [index, record] of raw.entries()) {
        try {
          const parsed = await parser([record], context, { ...metadata, warnings: [], ...parserOptions });
          value.push(...arrayValueOf(parsed));
          acceptedRaw.push(record);
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
      if (acceptedRaw.length > 0 && rejected.length > 0) {
        try {
          const reparsed = await parser(acceptedRaw, context, { ...metadata, ...parserOptions });
          if (Array.isArray(reparsed?.value)) value.splice(0, value.length, ...reparsed.value);
        } catch {
          // Individually normalized records remain retained in source order.
        }
      }
      if (rejected.length === 0) {
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
      const warning = "RSI exposes one shared prospects dataset. CitizenData collected it once and retained it in both ladder views.";
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
    return Object.freeze({
      ...descriptor,
      enabled: true,
      fixtureStatus: "owner-live-test",
      parserVersion: descriptor.version,
      // One collection step. `input.cursor` is the small stored position; `input.sectionState` is what the section has
      // gathered so far, kept in memory by the caller. A step that does not end the section returns its own page as
      // text to be stored once, and the state with that page merged in. The step that ends the section normalizes the
      // whole section, once, and returns the parser results.
      collectStep: async (input) => {
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
          return { ok: false, code: "RSI_READ_FAILED", message: error.message };
        }

        const previousRecordCount = rawCount(descriptor.id, state?.raw ?? null);
        if (pageResult.reusePrevious === true) {
          const cumulativeRecordCount = pageResult.previousRecordCount;
          if (input.previousSection?.current !== true || !Number.isSafeInteger(cumulativeRecordCount) || cumulativeRecordCount < 0 || cumulativeRecordCount > input.maximumRecords) {
            await closeCollectorTab();
            return { ok: false, code: "INVALID_UPDATE_REUSE", message: `${descriptor.id} could not prove a current bounded previous section.` };
          }
          if (pageResult.done) rsiApi.clearTransientCaches();
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
        const anomalies = mergeAnomalies(state?.anomalies, parsed.anomalies, collectorAnomalies);
        rsiApi.clearTransientCaches();
        return {
          ...shared,
          parserResults: parsed.parserResults.map((result) => Object.freeze({ ...result, anomalies })),
          resultMode: "cumulative",
          done: true,
          cursor: null
        };
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
        const anomalies = mergeAnomalies(sectionState.anomalies, parsed.anomalies);
        return parsed.parserResults.map((result) => Object.freeze({ ...result, anomalies }));
      }
    });
  }

  return Object.freeze({ createAdapter, closeCollectorTab, discoverSignedInAccount });
});
