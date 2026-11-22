(function initializeCitizenDataPlanValidation(root, factory) {
  "use strict";

  const api = factory(root);
  root.CitizenDataPlanValidation = api;
  if (typeof module === "object" && module?.exports) module.exports = api;
})(globalThis, function createCitizenDataPlanValidation(root) {
  "use strict";

  // The request pacing settings (shared/request-pacing-settings.js) load before this file.
  const PACING = root.CITIZENDATA_REQUEST_PACING;
  if (!PACING) throw new Error("request-pacing-settings.js must load before plan-validation.js.");

  const ALLOWED_SECTIONS = Object.freeze([
    "profile",
    "pledges",
    "hangarLog",
    "buybacks",
    "buybackDetails",
    "buybackUpgradePrices",
    "financial.balances",
    "financial.billingTotal",
    "financial.ledgers",
    "financial.orders",
    "financial.subscriptions",
    "referrals.current.prospects",
    "referrals.current.recruits",
    "referrals.legacy.recruits",
    "organizations.memberships"
  ]);
  // The plan floors are derived from the settings: the lowest account section interval, and the roster interval.
  const MINIMUM_DELAY_MS = Math.min(...Object.values(PACING.accountBuild.sections).map((section) => section.intervalMs));
  const ORGANIZATION_ROSTER_MINIMUM_DELAY_MS = PACING.organizationRosters.intervalMs;
  // The one canonical order of the account sections: identity, then Hangar Log, then the rest.
  const SECTION_ORDER = PACING.accountBuild.sectionOrder;
  const MAXIMUM_DELAY_MS = 120000;
  const MAXIMUM_SECTION_RECORDS = 100000;
  const MAXIMUM_ORGANIZATION_ROSTER_RECORDS = 50000;
  const MAXIMUM_ORGANIZATIONS_PER_ROSTER_RUN = 64;
  const PLAN_KEYS = Object.freeze(["maximumRecordsBySection", "minimumInterRequestDelayMs", "selectedSections"]);
  const ORGANIZATION_SID_PATTERN = /^[A-Z0-9][A-Z0-9_-]{0,63}$/u;

  function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value) && Object.prototype.toString.call(value) === "[object Object]";
  }

  function organizationRosterSid(section) {
    if (typeof section !== "string" || !section.startsWith("organizations.members.")) return null;
    const sid = section.slice("organizations.members.".length);
    return ORGANIZATION_SID_PATTERN.test(sid) ? sid : null;
  }

  function organizationRosterSection(sid) {
    if (typeof sid !== "string" || !ORGANIZATION_SID_PATTERN.test(sid)) throw new TypeError("Organization SID must be 1 to 64 uppercase letters, digits, underscores, or hyphens.");
    return `organizations.members.${sid}`;
  }

  function isCanonicalSubsequence(sections) {
    const positions = sections.map((section) => SECTION_ORDER.indexOf(section));
    return positions.every((position, index) => position >= 0 && (index === 0 || position > positions[index - 1]));
  }

  function validatePlan(input) {
    if (!isPlainObject(input)) return { ok: false, code: "INVALID_PLAN", message: "The proposed plan must be an object." };
    const keys = Object.keys(input).sort();
    if (keys.length !== PLAN_KEYS.length || keys.some((key, index) => key !== PLAN_KEYS[index])) {
      return { ok: false, code: "UNEXPECTED_PLAN_FIELD", message: "The proposal contains a field that the extension does not own." };
    }
    if (!Array.isArray(input.selectedSections) || input.selectedSections.length === 0) {
      return { ok: false, code: "EMPTY_PLAN", message: "Select at least one account-data section." };
    }
    if (input.selectedSections.length > MAXIMUM_ORGANIZATIONS_PER_ROSTER_RUN || new Set(input.selectedSections).size !== input.selectedSections.length) {
      return { ok: false, code: "DUPLICATE_SECTION", message: "Selected sections must be unique." };
    }
    const rosterSections = input.selectedSections.filter((section) => organizationRosterSid(section));
    if (input.selectedSections.some((section) => !ALLOWED_SECTIONS.includes(section) && !organizationRosterSid(section))) {
      return { ok: false, code: "UNKNOWN_SECTION", message: "The proposal contains an unrecognized or separately authorized section." };
    }
    if (rosterSections.length && rosterSections.length !== input.selectedSections.length) {
      return { ok: false, code: "ROSTER_PLAN_NOT_SEPARATE", message: "Organization rosters require a separate run containing only selected organization rosters." };
    }
    // An account plan names its sections in the canonical order; a continuation may leave finished ones out.
    // A roster plan keeps the order the user checked.
    if (!rosterSections.length && !isCanonicalSubsequence(input.selectedSections)) {
      return { ok: false, code: "NONCANONICAL_SECTION_ORDER", message: "Account sections must follow the extension's section order: account identity first, then Hangar Log." };
    }
    if (!Number.isSafeInteger(input.minimumInterRequestDelayMs) || input.minimumInterRequestDelayMs < MINIMUM_DELAY_MS || input.minimumInterRequestDelayMs > MAXIMUM_DELAY_MS) {
      return { ok: false, code: "INVALID_PACING", message: `Pacing must be between ${MINIMUM_DELAY_MS} and ${MAXIMUM_DELAY_MS} milliseconds.` };
    }
    if (rosterSections.length && input.minimumInterRequestDelayMs < ORGANIZATION_ROSTER_MINIMUM_DELAY_MS) {
      return { ok: false, code: "ROSTER_PACING_TOO_FAST", message: `Organization-roster pacing must be at least ${ORGANIZATION_ROSTER_MINIMUM_DELAY_MS} milliseconds.` };
    }
    if (!isPlainObject(input.maximumRecordsBySection)) {
      return { ok: false, code: "INVALID_CAPS", message: "Record caps must be a section-keyed object." };
    }
    const capKeys = Object.keys(input.maximumRecordsBySection);
    if (capKeys.length !== input.selectedSections.length || capKeys.some((section) => !input.selectedSections.includes(section))) {
      return { ok: false, code: "CAP_SCOPE_MISMATCH", message: "Every selected section must have exactly one extension-bounded record cap." };
    }
    for (const [section, cap] of Object.entries(input.maximumRecordsBySection)) {
      if (!Number.isSafeInteger(cap) || cap < 1 || cap > MAXIMUM_SECTION_RECORDS) {
        return { ok: false, code: "INVALID_CAP", message: `Record caps must be integers from 1 through ${MAXIMUM_SECTION_RECORDS}.` };
      }
      if (organizationRosterSid(section) && cap > MAXIMUM_ORGANIZATION_ROSTER_RECORDS) {
        return { ok: false, code: "ROSTER_CAP_EXCEEDED", message: `Organization-roster caps cannot exceed ${MAXIMUM_ORGANIZATION_ROSTER_RECORDS} members.` };
      }
    }
    return {
      ok: true,
      value: Object.freeze({
        selectedSections: Object.freeze([...input.selectedSections]),
        maximumRecordsBySection: Object.freeze({ ...input.maximumRecordsBySection }),
        minimumInterRequestDelayMs: input.minimumInterRequestDelayMs
      })
    };
  }

  return Object.freeze({
    ALLOWED_SECTIONS,
    MINIMUM_DELAY_MS,
    ORGANIZATION_ROSTER_MINIMUM_DELAY_MS,
    MAXIMUM_DELAY_MS,
    SECTION_ORDER,
    MAXIMUM_SECTION_RECORDS,
    MAXIMUM_ORGANIZATION_ROSTER_RECORDS,
    MAXIMUM_ORGANIZATIONS_PER_ROSTER_RUN,
    ORGANIZATION_SID_PATTERN,
    organizationRosterSid,
    organizationRosterSection,
    validatePlan
  });
});
