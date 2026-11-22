import { assert, reloadDashboard } from "./assert-build-chooser-reload-and-inventory-state.mjs";
import { evaluate } from "./chrome-process-and-devtools-commands.mjs";

// What the page is made of, read from the document the browser built: the controls every workflow needs, each under
// one identifier, the sections in their order, and the two policy links where they belong.
export async function checkPageStructure() {
  await reloadDashboard();
  const page = await evaluate(`(()=>{
    const ids=[...document.querySelectorAll('[id]')].map(node=>node.id);
    const before=(first,second)=>Boolean(document.querySelector(first).compareDocumentPosition(document.querySelector(second))&Node.DOCUMENT_POSITION_FOLLOWING);
    const scripts=[...document.querySelectorAll('script[src]')].map(node=>node.getAttribute('src'));
    return {
      duplicateIds:ids.filter((id,index)=>ids.indexOf(id)!==index),
      missing:${JSON.stringify(["loadButton", "buildButton", "buildButtonLabel", "parserOverlay", "minimizeOverlay", "closeOverlay", "buildChoices", "buildAccountAction", "buildImagesAction", "collectionControls", "rebindCollection", "pauseCollection",
        "resumeCollection", "cancelCollection", "mediaControls", "mediaCancelOverlay", "mediaSaveOverlay", "mediaStatus", "mediaZipLoadedState", "loadMediaZipButton", "offlineImages", "orgBuildDialog", "orgRosterChecklist", "loadOrgButton",
        "buildOrgButton", "organizationSelector", "membershipList", "organizationSearch", "referralSearchForm", "referralSearch", "referralSearchLabel", "referralSearchCount", "referralOutcome", "badges", "unlockedBadgeGrid", "unlockedBadgeNote",
        "unlockableBadges", "unlockableBadgeGrid", "mediaGalleryDialog", "mediaGalleryImage", "mediaGalleryThumbnails", "inspectorGalleryOpen", "inspectorGalleryThumbnails", "healthAccountFile", "orgFileStatus", "imageFileStatus",
        "collectionActivityImage"])}.filter(id=>!document.getElementById(id)),
      retired:${JSON.stringify(["offlineButton", "densityButton", "rosterConfirmDialog", "organizationRosterButton", "organizationOutcome", "lockedBadges", "buildDialog", "mediaAccount"])}.filter(id=>document.getElementById(id)),
      categories:${JSON.stringify(["gamePackage", "standaloneShip", "shipUpgrade", "reward", "hangarItem", "armor", "weapon", "other", "unknown"])}.filter(group=>!document.querySelector('[data-group="'+group+'"]')),
      loadBeforeBuild:before('#loadButton','#buildButton'),
      offlineBeforeReferrals:before('#offlineImages','#referrals'),
      offlineBeforeSupport:before('#offlineImages','#projectSupport'),
      balancesBeforeHangar:before('[data-rail-section="balances"]','[data-rail-view="hangar"]'),
      selectorBeforeMemberships:before('#organizationSelector','#membershipList'),
      fileStatusInOffline:['healthAccountFile','orgFileStatus','imageFileStatus','mediaStatus'].every(id=>document.getElementById('offlineImages').contains(document.getElementById(id))),
      buildLabel:document.getElementById('buildButtonLabel').textContent,
      activityImage:{hidden:document.getElementById('collectionActivityImage').hidden,hasSource:document.getElementById('collectionActivityImage').hasAttribute('src')},
      noSnippet:['#overview','#inventory','.secondary-grid'].filter(selector=>!document.querySelector(selector).hasAttribute('data-nosnippet')),
      privacyLinksInBody:document.body.querySelectorAll('a[href*="privacy-policy"]').length,
      termsLinks:[...document.body.querySelectorAll('a[href="terms-of-service.html"]')].map(link=>Boolean(link.closest('#projectSupport'))),
      badgeLinks:[...document.querySelectorAll('#unlockedBadgeGrid a, #unlockableBadgeGrid a')].map(link=>({href:link.href,id:link.dataset.badgeId??null,target:link.target})),
      scriptOrder:${JSON.stringify(["schema/account-export.schema.js", "schema/offline-package.schema.js", "scripts/safe-json.js", "scripts/account-document.js", "scripts/organization-document.js", "scripts/zip-store.js",
        "scripts/request-pacing-settings.js", "scripts/pace-controller.js", "scripts/pace-history.js", "scripts/media-policy.js",
        "scripts/media-file-names.js", "scripts/media-materializer.js", "scripts/media-package-builder.js", "scripts/media-package-reader.js", "scripts/canonical-download.js", "scripts/badge-wiki-pages.js",
        "scripts/dashboard.js"])}.map(name=>scripts.indexOf(name)),
      lastScript:scripts.at(-1)
    };
  })()`);
  assert(
    page.duplicateIds.length === 0 && page.missing.length === 0 && page.retired.length === 0 && page.categories.length === 0,
    `The page's controls are not the expected set: ${JSON.stringify({ duplicateIds: page.duplicateIds, missing: page.missing, retired: page.retired, categories: page.categories })}`
  );
  assert(page.loadBeforeBuild && page.offlineBeforeReferrals && page.offlineBeforeSupport && page.balancesBeforeHangar && page.selectorBeforeMemberships && page.fileStatusInOffline, `The page's sections are out of order: ${JSON.stringify(page)}`);
  assert(page.buildLabel === "Build" && page.activityImage.hidden && !page.activityImage.hasSource && page.noSnippet.length === 0, `The Build button, the idle activity image, or the no-snippet marks are wrong: ${JSON.stringify(page)}`);
  assert(page.privacyLinksInBody === 0 && page.termsLinks.length === 1 && page.termsLinks[0] === true, `The policy links are not one Terms link inside Support the project: ${JSON.stringify(page.termsLinks)} and ${page.privacyLinksInBody} privacy links`);
  // Every badge is a link to its page on the community wiki, or to the wiki's list of titles.
  assert(
    page.badgeLinks.length > 0 && page.badgeLinks.every((link) => link.href.startsWith("https://starcitizen.tools/") && link.href.length > "https://starcitizen.tools/".length),
    `A badge does not link to the community wiki: ${JSON.stringify(page.badgeLinks.slice(0, 3))}`
  );
  // Each dependency is present and loads before the application code.
  assert(
    page.scriptOrder.every((position) => position >= 0) && page.scriptOrder.at(-1) === Math.max(...page.scriptOrder) && page.scriptOrder.slice(0, 6).every((position, index, all) => index === 0 || position > all[index - 1]),
    `The page's scripts are missing or out of order: ${JSON.stringify(page.scriptOrder)}`
  );
}
