(function initializeCitizenDataHangarLogDelta(root, factory) {
  "use strict";

  const api = factory();
  root.CitizenDataHangarLogDelta = api;
  if (typeof module === "object" && module?.exports) module.exports = api;
})(globalThis, function createCitizenDataHangarLogDelta() {
  "use strict";

  const DEFAULT_OVERLAP_SIZE = 20;

  function eventKey(event) {
    if (!event || typeof event.fingerprint !== "string" || !/^[a-f0-9]{64}$/u.test(event.fingerprint)) throw new TypeError("Hangar Log events require a SHA-256 fingerprint.");
    if (!Number.isSafeInteger(event.occurrenceOrdinal) || event.occurrenceOrdinal < 1) throw new TypeError("Hangar Log events require a positive occurrence ordinal.");
    return `${event.fingerprint}:${event.occurrenceOrdinal}`;
  }

  function checkpoint(events, observedAt, overlapSize = DEFAULT_OVERLAP_SIZE) {
    if (!Array.isArray(events)) throw new TypeError("Hangar Log events must be an array.");
    if (!Number.isSafeInteger(overlapSize) || overlapSize < 2 || overlapSize > 100) throw new TypeError("Overlap size must be from 2 through 100.");
    return Object.freeze({
      version: 1,
      order: "newest-first",
      anchorWindow: Object.freeze(events.slice(0, overlapSize).map(eventKey)),
      observedAt: String(observedAt),
      overlapSize
    });
  }

  function findWindow(haystack, needle) {
    if (!needle.length) return -1;
    outer: for (let start = 0; start <= haystack.length - needle.length; start += 1) {
      for (let offset = 0; offset < needle.length; offset += 1) if (haystack[start + offset] !== needle[offset]) continue outer;
      return start;
    }
    return -1;
  }

  function reconcile(currentEvents, previousCheckpoint, options = {}) {
    if (!Array.isArray(currentEvents)) throw new TypeError("Current Hangar Log events must be an array.");
    const keys = currentEvents.map(eventKey);
    if (new Set(keys).size !== keys.length) return Object.freeze({ ok: false, code: "DUPLICATE_EVENT_KEY", newEvents: Object.freeze([]), checkpoint: null });
    if (options.captureComplete === false) return Object.freeze({ ok: false, code: "INCOMPLETE_CAPTURE", newEvents: Object.freeze([]), checkpoint: null });
    if (currentEvents.some(event => event.kind === "unknown" || event.parsed?.recognized === false)) {
      return Object.freeze({ ok: false, code: "UNKNOWN_EVENT_GRAMMAR", newEvents: Object.freeze([]), checkpoint: null });
    }
    const observedAt = options.observedAt ?? new Date().toISOString();
    const overlapSize = options.overlapSize ?? previousCheckpoint?.overlapSize ?? DEFAULT_OVERLAP_SIZE;
    if (!previousCheckpoint) {
      if (options.mode !== "baseline") return Object.freeze({ ok: false, code: "BASELINE_REQUIRED", newEvents: Object.freeze([]), checkpoint: null });
      return Object.freeze({
        ok: true,
        code: "BASELINE_ESTABLISHED",
        newEvents: Object.freeze([...currentEvents]),
        checkpoint: checkpoint(currentEvents, observedAt, overlapSize)
      });
    }
    if (previousCheckpoint.version !== 1 || previousCheckpoint.order !== "newest-first" || !Array.isArray(previousCheckpoint.anchorWindow)) {
      return Object.freeze({ ok: false, code: "UNSUPPORTED_CHECKPOINT", newEvents: Object.freeze([]), checkpoint: null });
    }
    const start = findWindow(keys, previousCheckpoint.anchorWindow);
    if (start < 0) return Object.freeze({ ok: false, code: "LOST_ANCHOR", newEvents: Object.freeze([]), checkpoint: null });
    return Object.freeze({
      ok: true,
      code: start === 0 ? "CURRENT" : "DELTA_FOUND",
      newEvents: Object.freeze(currentEvents.slice(0, start)),
      checkpoint: checkpoint(currentEvents, observedAt, overlapSize)
    });
  }

  return Object.freeze({ DEFAULT_OVERLAP_SIZE, checkpoint, eventKey, reconcile });
});
