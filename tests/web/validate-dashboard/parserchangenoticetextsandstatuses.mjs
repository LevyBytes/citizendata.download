// The RSI page-change notice's expected texts and the statuses that carry its entries (PARSER_HARDENING.md §11.4): the
// model's texts and links for each entry, checked in the page, and the synthetic bridge's statuses with one, two or
// a long-coded change, for parser-change-notice-check.mjs.
import { evaluate } from "./chrome-process-and-devtools-commands.mjs";

export const ISSUES = "https://github.com/LevyBytes/citizendata.download/issues";
export const LONG_CODE = `RSI_${"X".repeat(76)}`;

// The model alone: the texts and links of each entry, and the entries that are not shown.
export const MODEL_NOTICES = `(() => {
  const M = window.CitizenDataDashboardModel; const fails = [];
  const eq = (label, actual, expected) => { if (actual !== expected) fails.push(label + ': ' + JSON.stringify(actual) + ' !== ' + JSON.stringify(expected)); };
  const [aside, stop] = M.changeNotices([
    { section: 'buybacks', code: 'RSI_PAGE_NOT_RECOGNIZED', httpStatus: 200, setAside: true, dependents: ['buybackDetails', 'buybackUpgradePrices'], at: '2026-11-21T00:00:00.000Z' },
    { section: 'profile', code: 'RSI_PUBLIC_DOSSIER_CONTRACT_CHANGED', httpStatus: null, setAside: false, dependents: [], at: '2026-11-21T00:01:00.000Z' },
    { section: 'unknown.section', code: 'RSI_PAGE_NOT_RECOGNIZED', httpStatus: 200, setAside: true, dependents: [], at: '2026-11-21T00:02:00.000Z' },
    { section: 'pledges', code: 'not a code', httpStatus: 200, setAside: true, dependents: [], at: '2026-11-21T00:03:00.000Z' }
  ]);
  eq('entries shown', M.changeNotices([{ section: 'unknown.section', code: 'RSI_X' }, { section: 'pledges', code: 'lower' }]).length, 0);
  eq('title', aside.title, 'RSI CHANGED A PAGE: Buybacks');
  eq('prose set aside', aside.prose, "This version can't read it. Skipped; the build continues. Also skipped: Buyback prices, CCU buyback prices.");
  eq('prose stopped', stop.prose, "This version can't read it. The build stopped here.");
  eq('technical', aside.technical, 'Code: RSI_PAGE_NOT_RECOGNIZED');
  eq('request', aside.request, 'Please confirm an existing GitHub issue, or report a new one.');
  const search = new URL(aside.searchLink); const created = new URL(aside.newIssueLink); const stopped = new URL(stop.newIssueLink);
  eq('search address', search.origin + search.pathname, '${ISSUES}');
  eq('search query', [...search.searchParams.keys()].join(','), 'q');
  eq('search text', search.searchParams.get('q'), 'is:issue RSI_PAGE_NOT_RECOGNIZED');
  eq('search encoding', aside.searchLink, '${ISSUES}?q=' + encodeURIComponent('is:issue RSI_PAGE_NOT_RECOGNIZED'));
  eq('new address', created.origin + created.pathname, '${ISSUES}/new');
  eq('new query', [...created.searchParams.keys()].join(','), 'title,body');
  eq('new title', created.searchParams.get('title'), 'RSI page changed: buybacks (RSI_PAGE_NOT_RECOGNIZED)');
  eq('new body', created.searchParams.get('body'), 'Section: buybacks\\nCode: RSI_PAGE_NOT_RECOGNIZED\\nHTTP status: 200\\nAdd anything else you noticed. Do not paste account data.');
  eq('no status', stopped.searchParams.get('body').split('\\n')[2], 'HTTP status: none');
  eq('W-18', M.safeActivityPresentation({ kind: 'section-set-aside', section: 'buybacks', code: 'RSI_PAGE_NOT_RECOGNIZED', at: '2026-11-21T00:00:00.000Z' }).message, 'Skipped Buybacks · RSI_PAGE_NOT_RECOGNIZED. The build continues.');
  eq('W-18 tone', M.safeActivityPresentation({ kind: 'section-set-aside', section: 'buybacks', code: 'RSI_PAGE_NOT_RECOGNIZED' }).tone, 'warning');
  return fails;
})()`;

export const change = (fields) => `Object.assign({ section: 'buybacks', code: 'RSI_PAGE_NOT_RECOGNIZED', httpStatus: 200, setAside: true, dependents: ['buybackDetails'], at: '2026-11-21T00:00:00.000Z' }, ${fields})`;
export const ONE = `[${change("{}")}]`;
export const TWO = `[${change("{}")}, ${change(`{ section: 'pledges', code: ${JSON.stringify(LONG_CODE)}, httpStatus: null, dependents: [], at: '2026-11-21T00:05:00.000Z' }`)}]`;
export const emit = (expression) => evaluate(`(() => { window.__wp6.emit(${expression}); return true; })()`);
export const running = (changes, revision, runId = "run-wp7") => `Object.assign(window.__wp6.running({ runId: ${JSON.stringify(runId)}, detectedChanges: ${changes} }), { statusRevision: ${revision} })`;
export const entries = () => evaluate("document.querySelectorAll('#parserChangeNotice .parser-change-entry').length");
export const frame = () => evaluate("new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))");
