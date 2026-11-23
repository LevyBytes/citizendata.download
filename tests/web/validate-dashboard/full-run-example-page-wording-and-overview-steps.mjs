import { assert } from "./assert-build-chooser-reload-and-inventory-state.mjs";
import { evaluate, waitFor } from "./chrome-process-and-devtools-commands.mjs";
import { checkSubscriptionTier } from "./subscription-tier-and-fixtures-checks.mjs";

// The full run.
export const publicHeadSnapshot = await evaluate("document.head.outerHTML");
await checkSubscriptionTier('Imperator', '$440.00', 'rgb(219, 175, 112)');
assert(
  await evaluate("document.querySelector('#detailRec').textContent==='7,500' && !document.querySelector('#recBalance') && document.querySelector('#subscriptionNote').hidden"),
  'Subscriptions did not replace only the REC summary tile while preserving the detailed REC balance.'
);

const formerConceptLabel = ["CONCEPT", " MOCKUP"].join("");
assert(await evaluate("document.querySelector('.brand small').textContent==='LOCAL BACKUP TOOL FOR YOUR STAR CITIZEN ACCOUNT DATA'"), 'Header does not use the approved local-backup wording.');
assert(await evaluate(`!document.body.innerText.includes(${JSON.stringify(formerConceptLabel)})`), "Concept badge remains visible.");
assert(await evaluate("(()=>{const ids=['loadButton','buildButton'];const rects=ids.map(id=>document.getElementById(id).getBoundingClientRect());return rects[0].left<rects[1].left})()"), "Top actions are not ordered Load then Build.");
assert(await evaluate("!document.querySelector('#balances').innerText.toLowerCase().includes('current observed balance')"), "Balance filler prose remains.");
assert(await evaluate("!document.body.innerText.includes('What this document can prove') && !document.body.innerText.includes('Inspect records without losing context')"), "Removed dashboard headings remain visible.");
assert(
  await evaluate("document.querySelector('#snapshotEyebrow').textContent==='EXAMPLE ACCOUNT' && document.querySelector('#mainOrganization').textContent==='TEST' && document.querySelector('#organizationRank').textContent==='RECRUIT'"),
  "Example identity values did not render."
);
assert(await evaluate("(()=>{const panel=document.querySelector('#badges');panel.open=false;const collapsed=getComputedStyle(panel.querySelector('summary'),'::after').content;panel.open=true;const expanded=getComputedStyle(panel.querySelector('summary')"
  + ",'::after').content;panel.open=false;return collapsed.includes('+')&&expanded!==collapsed&&!expanded.includes('+')})()"), "Badges disclosure is missing its collapsed or expanded indicator.");
assert(await evaluate("!document.querySelector('#overview').innerText.includes('DATA STATE') && document.querySelector('.snapshot-state .state-emblem')?.getAttribute('src')==='assets/citizendata.svg' && document.querySelector('.brand-icon')"
  + "?.getAttribute('src')==='assets/citizendata.svg'"), "Hero state heading or logo does not match the requested presentation.");
await waitFor("(()=>{const image=document.querySelector('.snapshot-state .state-emblem');return image.complete&&image.naturalWidth>0})()");
assert(await evaluate("document.querySelector('#accountHandle').textContent==='DownloadCitizen' && document.querySelector('#railAccount').textContent==='DownloadCitizen' && document.querySelector('#railExported').textContent==='example.json' && "
  + "!document.querySelector('#railSchema') && !/schema/i.test(document.querySelector('.rail-evidence').innerText)"), "Example name, filename, or simplified loaded-document sidebar is incorrect.");
assert(await evaluate("(()=>{const section=document.querySelector('#offlineImages'),loaded=document.querySelector('#mediaZipLoadedState');return "
  + "section?.textContent.includes('Star Citizen Data Downloader reads the public image links stored in the open document')"
  + "&&section.textContent.includes('Use Build in the header to start or return to an image download')&&loaded?.textContent==='Images Zip Loaded'&&!loaded.hidden&&document.querySelector('#loadMediaZipButton')?.textContent==='Load Images ZIP'})()"), "The"
  + " requested dashboard image workflow guidance or the example account's loaded ZIP state is missing.");
assert(await evaluate("(()=>{const badge=document.querySelector('#mediaZipLoadedState'),button=document.querySelector('#loadMediaZipButton'),actions=badge.parentElement,badgeRect=badge.getBoundingClientRect(),buttonRect=button.getBoundingClientRect(),"
  + "actionsRect=actions.getBoundingClientRect();return badgeRect.right<=buttonRect.left&&badgeRect.left>=actionsRect.left-1&&buttonRect.right<=actionsRect.right+1&&getComputedStyle(badge).color==='rgb(217, 184, 106)'})()"), "Loaded Images ZIP badge is "
  + "not gold, contained, and positioned before the load button.");
assert(await evaluate(`(() => {
  const expected = {
    supportIssues:'https://github.com/LevyBytes/citizendata.download/issues',
    supportStar:'https://github.com/LevyBytes/citizendata.download',
    supportSpectrum:'https://robertsspaceindustries.com/spectrum/messages/member/DirectorGunner',
    supportEnlist:'https://enlistcitizen.com/',
    supportWiki:'https://starcitizen.tools/',
    supportTest:'https://discord.gg/test'
  };
  // The thanks sit behind a down arrow that is closed until the visitor opens it.
  const thanks = document.querySelector('#projectSupport details.support-thanks');
  const arrow = thanks?.querySelector('summary');
  if (!thanks || thanks.open || arrow.getAttribute('aria-label') !== 'Special thanks' || arrow.textContent !== '' || arrow.getBoundingClientRect().height < 24) return false;
  if (parseFloat(getComputedStyle(arrow, '::before').borderTopWidth) !== 8 || thanks.querySelector('p').checkVisibility()) return false;
  if (thanks.querySelector('p').textContent !== 'Special thanks to starcitizen.tools and my friends in ' + ['TEST', 'Squadron'].join(' ') + ' and the community for putting up with me all these years 🍺😂') return false;
  // The arrow points up while the thanks are closed and down once they are open.
  const turned = () => getComputedStyle(arrow, '::before').transform;
  const closedArrow = turned();
  arrow.click();
  const shown = thanks.open && thanks.querySelector('p').checkVisibility() && turned() === 'none';
  arrow.click();
  if (!shown || thanks.open || closedArrow !== 'matrix(-1, 0, 0, -1, 0, 0)' || turned() !== closedArrow) return false;
  // The referral line is the paragraph directly before the special thanks.
  const enlist = document.getElementById('supportEnlist')?.parentElement;
  if (enlist?.textContent !== 'New to SC? Looking for a Star Citizen Referral Code? See EnlistCitizen.com.' || !enlist.nextElementSibling?.classList.contains('support-thanks')) return false;
  const ids = [...Object.keys(expected), 'supportFeature'];
  if (!ids.every(id => {
    const anchor = document.getElementById(id);
    return anchor?.tagName === 'A' && document.querySelector('#projectSupport').contains(anchor)
      && anchor.target === '_blank' && anchor.relList.contains('noopener') && anchor.relList.contains('noreferrer');
  })) return false;
  if (!Object.entries(expected).every(([id,url]) => document.getElementById(id).href === url)) return false;
  const feature = new URL(document.getElementById('supportFeature').href);
  return feature.origin === 'https://github.com' && feature.pathname === '/LevyBytes/citizendata.download/issues/new'
    && feature.searchParams.get('title') === 'Feature request: ' && Boolean(feature.searchParams.get('body')?.trim());
})()`), "Project support links have incorrect destinations, feature-request fields, or external-link attributes.");
