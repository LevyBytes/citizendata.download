import { assert } from "./assert-build-chooser-reload-and-inventory-state.mjs";
import { setViewport } from "./captures-viewport-and-fixture-loading.mjs";
import { evaluate, waitFor } from "./chrome-process-and-devtools-commands.mjs";
import { checkDashboardGeometry } from "./dashboard-geometry-check.mjs";
import { publicHeadSnapshot } from "./full-run-example-page-wording-and-overview-steps.mjs";
import { checkPersonLinks } from "./owner-avatar-and-person-links-checks.mjs";
import { checkResponsiveGeometry } from "./responsive-geometry-check.mjs";

await evaluate(`(async () => {
  const stampedDocument = await window.CitizenDataAccountDocument.stampIntegrity(structuredClone(window.CITIZENDATA_DEMO_DATA));
  const transfer = new DataTransfer();
  transfer.items.add(new File([JSON.stringify(stampedDocument)], 'example-without-media-package.json', {type:'application/json'}));
  const input = document.querySelector('#jsonFileInput');
  input.files = transfer.files;
  input.dispatchEvent(new Event('change', {bubbles:true}));
})()`);
await waitFor("document.querySelector('#snapshotEyebrow').textContent==='LOADED ACCOUNT SNAPSHOT' || document.querySelector('#messageDialog').open");
const localLoadResult = await evaluate(`({
  eyebrow:document.querySelector('#snapshotEyebrow').textContent,
  heading:document.querySelector('#messageDialog h2').textContent,
  detail:document.querySelector('#messageDialog p').textContent
})`);
assert(localLoadResult.eyebrow === 'LOADED ACCOUNT SNAPSHOT', `Canonical local account fixture was rejected: ${localLoadResult.heading}: ${localLoadResult.detail}`);
await evaluate("document.querySelector('#messageDialog').close()");
assert(await evaluate("document.head.outerHTML") === publicHeadSnapshot, "Loading account JSON changed the public sharing or search metadata.");
assert(await evaluate("['avatarImage','organizationEmblemImage'].every(id=>document.getElementById(id).hidden&&!document.getElementById(id).hasAttribute('src')) && document.querySelector('#displayTitle').textContent==='Clearance Level Ultra' && "
  + "!document.querySelector('#dossierBadgeImage').hidden && document.querySelector('#dossierBadgeImage').getAttribute('src').startsWith('assets/badges/') && !document.querySelector('#dossierBadgeImage').parentElement.hidden && "
  + "document.querySelector('#mainOrganization').textContent==='TEST'"), "Loaded JSON without an Images ZIP lost private-media fallbacks or its bundled local badge asset.");
assert(
  await evaluate("document.querySelector('#railExported').textContent==='example-without-media-package.json' && [...document.querySelectorAll('.membership-emblem')].every(image=>image.hidden&&!image.hasAttribute('src'))"),
  "Loaded file name or unavailable organization emblem fallback is incorrect."
);
for (const ladder of ['current', 'legacy']) {
  await evaluate(`document.querySelector('[data-referral-path="${ladder}.prospects"]').click()`);
  await checkPersonLinks('#referralRows', `window.CITIZENDATA_DEMO_DATA.referrals.${ladder}.prospects`, `loaded JSON ${ladder} prospects`);
  assert(await evaluate("![...document.querySelectorAll('#referralRows a')].some(anchor=>anchor.href.includes('/enlist?referral='))"), "The bundled example referral override leaked into a loaded JSON file.");
}
await evaluate("document.querySelector('[data-referral-path=\"current.prospects\"]').click()");
for (const width of [1780, 1280, 1000, 900, 640, 480, 390, 320]) {
  await setViewport(width);
  await checkResponsiveGeometry(`local JSON text fallbacks at ${width}px`);
  await checkDashboardGeometry(`local JSON whole dashboard at ${width}px`);
}

await evaluate(`(async () => {
  const documentCopy = structuredClone(window.CITIZENDATA_DEMO_DATA);
  documentCopy.account.ueeCitizenRecord = null;
  documentCopy.profile.enlistedOnRaw = null;
  documentCopy.profile.organizationRank = null;
  for (const membership of documentCopy.organizations.memberships) membership.rank = null;
  const stampedDocument = await window.CitizenDataAccountDocument.stampIntegrity(documentCopy);
  const transfer = new DataTransfer();
  transfer.items.add(new File([JSON.stringify(stampedDocument)], 'example-missing-metadata.json', {type:'application/json'}));
  const input = document.querySelector('#jsonFileInput');
  input.files = transfer.files;
  input.dispatchEvent(new Event('change', {bubbles:true}));
})()`);
await waitFor("document.querySelector('#messageDialog').open");
const missingMetadataResult = await evaluate(`({
  exported:document.querySelector('#railExported').textContent,
  heading:document.querySelector('#messageDialog h2').textContent,
  detail:document.querySelector('#messageDialog p').textContent
})`);
assert(missingMetadataResult.exported === 'example-missing-metadata.json' && missingMetadataResult.heading === 'Account file verified', `Missing-metadata canonical fixture was rejected: ${missingMetadataResult.heading}: ${missingMetadataResult.detail}`);
await evaluate("document.querySelector('#messageDialog').close()");
assert(
  await evaluate("document.querySelector('#citizenRecordNumber').textContent==='record unavailable' && document.querySelector('#enlistedOn').textContent==='Unavailable' && document.querySelector('#organizationRank').textContent==='Unavailable'"),
  "Missing source metadata was silently presented as a real value."
);
for (const width of [1280, 390, 320]) {
  await setViewport(width);
  await checkResponsiveGeometry(`unavailable metadata at ${width}px`);
  await checkDashboardGeometry(`unavailable metadata at ${width}px`);
}
