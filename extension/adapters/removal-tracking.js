(function initializeCitizenDataRemovalTracking(root, factory) {
  "use strict";

  const api = factory(root.CitizenDataUpdateDelta);
  root.CitizenDataRemovalTracking = api;
  if (typeof module === "object" && module?.exports) module.exports = api;
})(globalThis, function createCitizenDataRemovalTracking(Delta) {
  "use strict";

  if (!Delta) throw new Error("CitizenDataUpdateDelta must load before removal-tracking.js.");

  // Finds records RSI listed in the earlier backup and no longer lists, and decides what the new Hangar Log says
  // about each one:
  //
  // - A new log entry names the record: the log accounts for it. It leaves the list, as it always did. RSI's own
  //   removal notices ("automated removal of 0$ CCUs") are log entries like any other.
  // - No new log entry names it: the record is kept with the state "not-reconcilable".
  //
  // Only the difference between two backups can support such a claim, so nothing is claimed unless the earlier backup
  // is intact and complete, the new list was read in full, and the earlier log's newest entries are found exactly
  // inside the new log. Otherwise the backup records that the comparison did not run, and why.
  const LISTS = Object.freeze({
    pledges: Object.freeze({ idKey: "pledgeId", listedStates: Object.freeze(["current"]) }),
    buybacks: Object.freeze({ idKey: "buybackId", listedStates: Object.freeze(["available", "unavailable"]) })
  });
  const KEPT_STATE = "not-reconcilable";

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function completeResult(results, section) {
    return results.some((result) => result?.section === section && result.outcome?.status === "complete");
  }

  function notCompared(reason, kept = 0) {
    return { status: "not-compared", reason, missing: 0, explained: 0, notReconcilable: 0, returned: 0, kept };
  }

  // The entries the new log holds in front of the earlier log's newest entries, or null when those entries are not
  // found in the new log exactly as they were.
  function newLogRows(currentLog, previousLog) {
    if (!Array.isArray(currentLog) || !Array.isArray(previousLog)) return null;
    if (previousLog.length === 0) return currentLog;
    const anchor = Delta.findAnchor(currentLog, previousLog, Delta.hangarRecord);
    return anchor < 0 ? null : currentLog.slice(0, anchor);
  }

  // Why no removal can be claimed for any list in this backup, or null when the two Hangar Logs line up.
  function logReason({ document, previous, previousVerified, results, reusedSections }) {
    if (!previous) return "no-earlier-backup";
    if (previousVerified !== true) return "earlier-backup-not-verified";
    if (previous.sync?.sectionOutcomes?.hangarLog?.status !== "complete") return "earlier-hangar-log-incomplete";
    const checked = completeResult(results, "hangarLog") || reusedSections.includes("hangarLog");
    if (!checked || document.sync?.sectionOutcomes?.hangarLog?.status !== "complete") return "hangar-log-not-read";
    return null;
  }

  function reconcileList(list, { document, previous, results, comparedAt, reason, added }) {
    const { idKey, listedStates } = LISTS[list];
    const earlier = Array.isArray(previous?.[list]) ? previous[list] : [];
    const listRead = completeResult(results, list);
    // A list this run did not read is still the earlier one, kept records included.
    if (!listRead) return notCompared(reason ?? "list-not-read", (document[list] ?? []).filter((record) => record?.state === KEPT_STATE).length);
    const listReason = reason ?? (previous.sync?.sectionOutcomes?.[list]?.status !== "complete" ? "earlier-list-incomplete" : null);
    const listed = new Map(document[list].filter((record) => Number.isSafeInteger(record?.[idKey])).map((record) => [record[idKey], record]));
    const named = new Set((added ?? []).map((row) => row?.subjectId).filter(Number.isSafeInteger));
    const counts = { missing: 0, explained: 0, notReconcilable: 0, returned: 0 };
    const kept = [];
    for (const record of earlier) {
      const id = record?.[idKey];
      if (!Number.isSafeInteger(id)) continue;
      const wasKept = record.state === KEPT_STATE;
      const now = listed.get(id);
      if (now) {
        // RSI lists it. A record that had gone missing keeps that history beside its normal state.
        if (record.removal) now.removal = { ...clone(record.removal), returnedAt: wasKept ? comparedAt : record.removal.returnedAt ?? null };
        if (wasKept) counts.returned += 1;
        continue;
      }
      if (wasKept) {
        // Carried forward until RSI lists it again, or until a new log entry names it: the log then accounts for it.
        if (listReason === null && named.has(id)) counts.explained += 1;
        else kept.push(clone(record));
        continue;
      }
      if (listReason !== null || !listedStates.includes(record.state)) continue;
      counts.missing += 1;
      if (named.has(id)) {
        counts.explained += 1;
        continue;
      }
      counts.notReconcilable += 1;
      kept.push({
        ...clone(record),
        state: KEPT_STATE,
        removal: { lastSeenAt: record.observation?.lastObservedAt ?? previous.exportedAt, firstMissingAt: comparedAt, returnedAt: null }
      });
    }
    document[list] = [...document[list], ...kept];
    return listReason === null ? { status: "compared", reason: null, ...counts, kept: kept.length } : notCompared(listReason, kept.length);
  }

  // Changes `document` in place: adds the kept records to its hangar and buy-back lists and records the comparison
  // under sync.removalTracking. `results` are the section results this backup was assembled from, `reusedSections`
  // the sections this collection confirmed unchanged against RSI without a new result.
  function reconcile({ document, previous = null, previousVerified = false, results = [], reusedSections = [], comparedAt }) {
    let reason = logReason({ document, previous, previousVerified, results, reusedSections });
    const added = reason === null ? newLogRows(document.hangarLog, previous.hangarLog) : null;
    if (reason === null && added === null) reason = "hangar-log-not-aligned";
    const tracking = { comparedAt, comparedWithExportedAt: previous?.exportedAt ?? null };
    for (const list of Object.keys(LISTS)) tracking[list] = reconcileList(list, { document, previous, results, comparedAt, reason, added });
    document.sync.removalTracking = tracking;
    return tracking;
  }

  return Object.freeze({ KEPT_STATE, LISTS, newLogRows, reconcile });
});
