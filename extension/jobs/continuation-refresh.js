(function initializeCitizenDataContinuationRefresh(root, factory) {
  "use strict";

  const api = factory(root.CITIZENDATA_REQUEST_PACING);
  root.CitizenDataContinuationRefresh = api;
  if (typeof module === "object" && module?.exports) module.exports = api;
})(globalThis, function createCitizenDataContinuationRefresh(pacing) {
  "use strict";

  // The canonical Account Data order of the settings file (§4.8).
  const SECTION_ORDER = Object.freeze([...(pacing?.accountBuild?.sectionOrder ?? [])]);

  // The sections in canonical order when every one is an Account Data section; otherwise, as for an organization
  // roster's checklist, in the order given.
  function canonicalOrder(sections) {
    if (!sections.every((section) => SECTION_ORDER.includes(section))) return [...sections];
    return [...sections].sort((left, right) => SECTION_ORDER.indexOf(left) - SECTION_ORDER.indexOf(right));
  }

  function hasProfileBadgeCoverage(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)
      || !Array.isArray(value.unlockedBadges)
      || !Array.isArray(value.featuredBadges)
      || !Object.hasOwn(value, "selectedBadge")
      || !value.badgeCollection || typeof value.badgeCollection !== "object" || Array.isArray(value.badgeCollection)) return false;
    const collection = value.badgeCollection;
    for (const field of ["rawRows", "nonNullRows", "nullRows", "uniqueIdTitlePairs", "exactDuplicateRows"]) {
      if (!Number.isSafeInteger(collection[field]) || collection[field] < 0) return false;
    }
    if (collection.rawRows !== value.unlockedBadges.length
      || collection.nonNullRows + collection.nullRows !== collection.rawRows
      || collection.uniqueIdTitlePairs + collection.exactDuplicateRows !== collection.nonNullRows) return false;
    if (value.selectedBadge !== null && (!value.selectedBadge || typeof value.selectedBadge !== "object" || !Array.isArray(value.selectedBadge.images))) return false;
    return value.unlockedBadges.every((badge, index) => badge && typeof badge === "object" && badge.sourceIndex === index && Array.isArray(badge.images))
      && value.featuredBadges.every((badge) => badge && typeof badge === "object" && Array.isArray(badge.images));
  }

  function prepare(input) {
    const failedJob = input?.failedJob;
    const stagedResults = Array.isArray(input?.stagedResults) ? input.stagedResults : [];
    const currentParserVersions = input?.currentParserVersions && typeof input.currentParserVersions === "object" ? input.currentParserVersions : {};
    const resultSectionsForSection = input?.resultSectionsForSection && typeof input.resultSectionsForSection === "object" ? input.resultSectionsForSection : {};
    const selected = Array.isArray(failedJob?.plan?.selectedSections) ? failedJob.plan.selectedSections : [];
    const sectionIndex = Number.isSafeInteger(failedJob?.sectionIndex) && failedJob.sectionIndex >= 0 && failedJob.sectionIndex < selected.length ? failedJob.sectionIndex : -1;
    if (sectionIndex < 0) throw new TypeError("A failed continuation job requires a valid unfinished section index.");

    const completedSections = selected.slice(0, sectionIndex);
    const remainingSections = selected.slice(sectionIndex);
    const resultsBySection = new Map(stagedResults.filter((result) => result && typeof result.section === "string").map((result) => [result.section, result]));
    const resultIsCurrent = (section) => {
      const currentVersion = currentParserVersions[section];
      if (typeof currentVersion !== "string" || !currentVersion) return false;
      const resultSections = Array.isArray(resultSectionsForSection[section]) && resultSectionsForSection[section].length
        ? resultSectionsForSection[section]
        : [section];
      const current = resultSections.every((resultSection) => {
        const result = resultsBySection.get(resultSection);
        return result?.outcome?.status === "complete";
      });
      if (!current) return false;
      return section !== "profile" || hasProfileBadgeCoverage(resultsBySection.get("profile")?.value);
    };
    // A section the stopped run confirmed unchanged against RSI left no result of its own; the saved backup holds
    // it. It is as finished as a section with a result. Version numbers are not compared: a new number alone never
    // has a finished section collected again.
    const confirmedUnchanged = new Set(Array.isArray(input?.reusedSections) ? input.reusedSections : []);
    const reuseIsCurrent = (section) => confirmedUnchanged.has(section) && typeof currentParserVersions[section] === "string";
    const refreshSections = completedSections.filter((section) => !resultIsCurrent(section) && !reuseIsCurrent(section));
    const resumeSection = remainingSections[0];
    const preserveResumeCursor = typeof currentParserVersions[resumeSection] === "string";
    const priorCompleted = Number.isSafeInteger(failedJob.completedSectionsBeforeContinuation) && failedJob.completedSectionsBeforeContinuation >= 0
      ? failedJob.completedSectionsBeforeContinuation
      : 0;
    const baselineSectionCount = Number.isSafeInteger(failedJob.baselineSectionCount) && failedJob.baselineSectionCount > 0
      ? failedJob.baselineSectionCount
      : selected.length;

    return Object.freeze({
      // A refresh section joins the unfinished ones at its canonical place; no finished section is read again for it.
      selectedSections: Object.freeze(canonicalOrder([...refreshSections, ...remainingSections])),
      refreshSections: Object.freeze(refreshSections),
      remainingSections: Object.freeze(remainingSections),
      resumeSection,
      preserveResumeCursor,
      baselineSectionCount,
      completedSectionsBeforeContinuation: Math.max(0, priorCompleted + sectionIndex - refreshSections.length)
    });
  }

  return Object.freeze({ hasProfileBadgeCoverage, prepare });
});
