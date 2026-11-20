(function initializeCitizenDataCcuReconciliation(root, factory) {
  "use strict";

  const api = factory();
  root.CitizenDataCcuReconciliation = api;
  if (typeof module === "object" && module?.exports) module.exports = api;
})(globalThis, function createCitizenDataCcuReconciliation() {
  "use strict";

  const DECIMAL = /^(-?)(\d+)(?:\.(\d{1,4}))?$/u;

  function parseDecimal(value) {
    if (typeof value !== "string") return null;
    const match = DECIMAL.exec(value);
    if (!match) return null;
    const scale = (match[3] ?? "").length;
    const integer = BigInt(`${match[1]}${match[2]}${match[3] ?? ""}`);
    return { integer, scale };
  }

  function formatDecimal(integer, scale) {
    const negative = integer < 0n;
    const digits = (negative ? -integer : integer).toString().padStart(scale + 1, "0");
    const whole = scale ? digits.slice(0, -scale) : digits;
    const fraction = scale ? digits.slice(-scale).replace(/0+$/u, "") : "";
    return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
  }

  function addMoney(left, right) {
    if (!left || !right || left.currency !== right.currency) return null;
    const a = parseDecimal(left.amount);
    const b = parseDecimal(right.amount);
    if (!a || !b) return null;
    const scale = Math.max(a.scale, b.scale);
    const integer = a.integer * 10n ** BigInt(scale - a.scale) + b.integer * 10n ** BigInt(scale - b.scale);
    return Object.freeze({ amount: formatDecimal(integer, scale), currency: left.currency });
  }

  function moneyEquals(left, right) {
    if (!left || !right || left.currency !== right.currency) return false;
    const a = parseDecimal(left.amount);
    const b = parseDecimal(right.amount);
    if (!a || !b) return false;
    const scale = Math.max(a.scale, b.scale);
    return a.integer * 10n ** BigInt(scale - a.scale) === b.integer * 10n ** BigInt(scale - b.scale);
  }

  function money(value) {
    if (!value || !parseDecimal(value.amount) || typeof value.currency !== "string" || !value.currency) return null;
    return Object.freeze({ amount: value.amount, currency: value.currency });
  }

  function reconcile(pledge, events, options = {}) {
    if (!pledge || !Array.isArray(events)) throw new TypeError("A pledge and Hangar Log event array are required.");
    if (!Number.isSafeInteger(pledge.pledgeId) || pledge.pledgeId < 0) {
      return Object.freeze({
        history: Object.freeze([]),
        finalValue: money(pledge.baseValue),
        warnings: Object.freeze(["CCU history was not reconciled because the pledge has no stable RSI pledge ID."])
      });
    }
    const relevant = events.filter(event => {
      const parsed = event?.parsed;
      return parsed && ["ccuApplied", "upgradeApplied"].includes(parsed.type ?? parsed.eventKind)
        && (event.subjectId === pledge.pledgeId || parsed.pledgeId === pledge.pledgeId);
    });
    const ordered = options.eventsNewestFirst === false ? relevant : [...relevant].reverse();
    let running = money(pledge.baseValue);
    const warnings = [];
    const history = [];
    for (const [index, event] of ordered.entries()) {
      const parsed = event.parsed;
      if (typeof parsed.fromShip !== "string" || !parsed.fromShip.trim() || typeof parsed.toShip !== "string" || !parsed.toShip.trim()) {
        warnings.push(`Skipped CCU event ${event.fingerprint ?? index}: ship endpoints were incomplete.`);
        continue;
      }
      const cost = money(parsed.cost);
      const explicitCumulative = money(parsed.cumulativeValue);
      const calculated = cost === null ? null : addMoney(running, cost);
      if (explicitCumulative && calculated && !moneyEquals(explicitCumulative, calculated)) {
        warnings.push(`CCU event ${event.fingerprint ?? index} supplied a cumulative value that differs from the exact running calculation.`);
      }
      running = explicitCumulative ?? calculated;
      const eventKey = event.fingerprint && event.occurrenceOrdinal ? `${event.fingerprint}:${event.occurrenceOrdinal}` : null;
      history.push(Object.freeze({
        stepKey: eventKey ? `ccu:${eventKey}` : `ccu:${index + 1}:${parsed.fromShip.trim()}->${parsed.toShip.trim()}`,
        fromShip: parsed.fromShip.trim(),
        toShip: parsed.toShip.trim(),
        appliedDateRaw: typeof parsed.appliedDateRaw === "string" && parsed.appliedDateRaw.trim() ? parsed.appliedDateRaw.trim() : event.rawTimestamp ?? null,
        cost,
        cumulativeValue: running,
        sourceEventKeys: Object.freeze(eventKey ? [eventKey] : [])
      }));
    }
    return Object.freeze({ history: Object.freeze(history), finalValue: running, warnings: Object.freeze(warnings) });
  }

  return Object.freeze({ addMoney, moneyEquals, reconcile });
});
