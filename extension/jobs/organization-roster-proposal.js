(function initializeCitizenDataOrganizationRosterProposal(root, factory) {
  "use strict";

  const api = factory(root.CitizenDataPlanValidation);
  root.CitizenDataOrganizationRosterProposal = api;
  if (typeof module === "object" && module?.exports) module.exports = api;
})(globalThis, function createCitizenDataOrganizationRosterProposal(Plans) {
  "use strict";

  if (!Plans) throw new Error("CitizenDataPlanValidation must load before organization-roster-proposal.js.");

  function isExactPayload(value) {
    return value !== null
      && typeof value === "object"
      && !Array.isArray(value)
      && Object.getPrototypeOf(value) === Object.prototype
      && Object.keys(value).length === 1
      && Object.hasOwn(value, "organizationSids")
      && Array.isArray(value.organizationSids);
  }

  function build(payload, registry) {
    if (!isExactPayload(payload) || payload.organizationSids.length < 1 || payload.organizationSids.length > Plans.MAXIMUM_ORGANIZATIONS_PER_ROSTER_RUN) {
      return { ok: false, code: "INVALID_ROSTER_REQUEST", message: "Choose between one and 64 saved organization memberships." };
    }
    let sections;
    try {
      sections = payload.organizationSids.map(Plans.organizationRosterSection);
    } catch {
      return { ok: false, code: "INVALID_ORGANIZATION_SID", message: "A selected organization SID is invalid." };
    }
    if (new Set(sections).size !== sections.length) return { ok: false, code: "DUPLICATE_ORGANIZATION_SID", message: "Each organization may be selected once." };
    const expectedRoute = "/api/orgs/getOrgMembers";
    const adapters = sections.map((section) => registry?.getCandidateAdapter?.(section));
    if (adapters.some((adapter, index) => adapter?.separateAuthorization !== true || adapter.route !== expectedRoute || adapter.section !== sections[index])) {
      return { ok: false, code: "ROSTER_ADAPTER_UNAVAILABLE", message: "A fixed organization-roster adapter is unavailable." };
    }
    const checked = Plans.validatePlan({
      selectedSections: sections,
      maximumRecordsBySection: Object.fromEntries(sections.map((section) => [section, Plans.MAXIMUM_ORGANIZATION_ROSTER_RECORDS])),
      minimumInterRequestDelayMs: Plans.ORGANIZATION_ROSTER_MINIMUM_DELAY_MS
    });
    if (!checked.ok) return checked;
    return {
      ok: true,
      value: Object.freeze({
        organizationSids: Object.freeze(sections.map(Plans.organizationRosterSid)),
        sections: Object.freeze(sections),
        route: expectedRoute,
        plan: checked.value,
        parserVersions: Object.freeze(Object.fromEntries(sections.map((section, index) => [section, adapters[index].version])))
      })
    };
  }

  return Object.freeze({ build, isExactPayload });
});
