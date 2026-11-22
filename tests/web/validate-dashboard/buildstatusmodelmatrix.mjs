// The Build Status model alone, in the page (PARSER_HARDENING.md §11.1 to §11.3): every row of §11.2, the tape's rows
// of §11.1, and the texts of §11.3, as one page expression that returns its failures. The rows are here; the tape and
// the log lines are in buildstatusmodeltapeandlines.mjs.
import { MODEL_TAPE_AND_LINES } from "./buildstatusmodeltapeandlines.mjs";

const MODEL_ROWS = `
  const M = window.CitizenDataDashboardModel; const T = M.TEXTS; const fails = [];
  const now = Date.now(); const future = new Date(now + 90000).toISOString(); const past = new Date(now - 1000).toISOString(); const later = now + 100000;
  const eq = (label, actual, expected) => { if (actual !== expected) fails.push(label + ': ' + JSON.stringify(actual) + ' !== ' + JSON.stringify(expected)); };
  const job = (fields) => Object.assign({ jobId: 'job-wp6', runId: 'run-wp6', status: 'running', currentSection: 'pledges', sectionCount: 3, completedSections: 1, activityLog: [], failure: null, pace: { factor: 2, warning: null, waitingUntil: null,
    statusPage: null } }, fields);
  const present = (status, extra) => M.buildPresentation(status, Object.assign({ bridgeConnected: true, nowMs: now }, extra || {}));
  const failed = (failure, fields) => job(Object.assign({ status: 'failed', failure }, fields || {}));
  eq('row 1', present({}, { protocolMismatch: true, extensionVersion: '0.41.9' }).badge, 'UPDATE REQUIRED');
  eq('row 2', present({}, { media: { phase: 'running', detail: 'Working.' } }).badge, 'DOWNLOADING');
  eq('row 3', present({}, { media: { phase: 'ready' } }).badge, 'READY TO SAVE');
  eq('row 4', present({}, { media: { phase: 'completed', badge: 'COMPLETED', stoppedWithRemaining: true, detail: 'Done.' } }).summary, 'Done. ' + T.imagesLeft);
  eq('row 5', present({}, { connecting: true }).badge, 'CONNECTING');
  eq('row 6', present({}, { bridgeConnected: false }).badge, 'DISCONNECTED');
  eq('row 7', M.validateStatus({ activeJob: { status: 'exploded' } }), null);
  eq('row 7 revision', M.validateStatus({ statusRevision: -1 }), null);
  eq('row 8', present({ requiresRebind: true, activeJob: job({}) }).badge, 'RECONNECT REQUIRED');
  const waiting = present({ activeJob: job({ pace: { warning: 'limited', waitingUntil: future } }) });
  eq('row 9', [waiting.row, waiting.badge, waiting.summary.startsWith('RSI refused. Retrying in ') && waiting.summary.endsWith('.')].join('|'), '9|COLLECTING|true');
  eq('row 9 after', M.countdownText(waiting.countdown, later), 'RSI refused. Retrying now.');
  eq('row 10', present({ activeJob: job({ pace: { warning: 'slow' } }) }).row, 10);
  eq('row 11', present({ activeJob: job({}) }).row, 11);
  eq('row 12', present({ activeJob: job({ status: 'paused' }) }).badge, 'PAUSED');
  const refused = present({ hasActiveJob: false, retryNotBefore: future, startDiagnosis: { probe: 'not-run', status: 'ok', reason: null, components: [], checkedAt: past }, activeJob: job({ status: 'complete' }) });
  eq('row 13', [refused.row, refused.badge, refused.operation].join('|'), '13|CONNECTED|Ready to build again');
  eq('row 13 before', refused.summary.startsWith('RSI refused the start. Build again in '), true);
  eq('row 13 after', M.countdownText(refused.countdown, later), 'RSI refused the start. Build when ready.');
  const partial = present({ activeJob: job({ status: 'partial', mode: 'update', setAsideSections: ['buybackDetails', 'hangarLog'] }) });
  eq('row 14', [partial.badge, partial.operation, partial.summary, partial.controls.resume].join('|'),
    'COMPLETED WITH OMISSIONS|Account backup saved with skipped sections|Partial backup. Not read: Buyback prices, Hangar Log. Your last complete backup stays in use.|false');
  eq('row 14 first build', present({ activeJob: job({ status: 'partial', mode: 'baseline', setAsideSections: ['unknown.section'] }) }).summary, 'Partial backup. Not read: one or more account sections.');
  eq('row 15', present({ activeJob: job({ status: 'complete' }) }).badge, 'COMPLETED');
  const probes = { refused: T.probeRefused, answered: T.probeAnswered, failed: T.probeFailed, 'not-run': T.startRefused };
  const statuses = [
    [{ status: 'ok', reason: null, components: [] }, T.statusOk],
    [{ status: 'issue', reason: null, components: [{ name: 'Platform', state: 'disrupted' }, { name: 'Persistent Universe', state: 'unresolved issue' }] }, 'RSI reports a problem: Platform (disrupted), Persistent Universe (unresolved issue).'],
    [{ status: 'issue', reason: null, components: [] }, T.statusIssue],
    [{ status: 'unknown', reason: 'no-permission', components: [] }, T.statusNotChecked],
    [{ status: 'unknown', reason: 'unreadable', components: [] }, T.statusUnreadable]
  ];
  for (const probe of Object.keys(probes)) {
    for (const [result, text] of statuses) {
      const diagnosis = Object.assign({ probe, checkedAt: past }, result);
      const shown = present({ continuable: true, retryNotBefore: future, activeJob: failed({ code: 'RSI_RATE_LIMITED', message: 'RSI kept refusing requests.', detail: { signal: null, diagnosis } }) });
      const label = 'row 16 ' + probe + ' ' + result.status + ' ' + result.reason;
      eq(label, M.countdownText(shown.countdown, later), 'RSI kept refusing, so the run stopped. Your data is kept. ' + probes[probe] + ' ' + text + ' Continue when ready.');
      eq(label + ' before', shown.summary.endsWith(' Continue in ' + shown.summary.split(' Continue in ')[1]) && shown.summary.includes(probes[probe] + ' ' + text + ' Continue in '), true);
      eq(label + ' unavailable', shown.unavailableUntil, future);
    }
  }
  eq('row 16 no diagnosis', M.countdownText(present({ continuable: true, retryNotBefore: future, activeJob: failed({ code: 'RSI_RATE_LIMITED', detail: { diagnosis: null } }) }).countdown, later),
    'RSI kept refusing, so the run stopped. Your data is kept. Continue when ready.');
  for (const [code, text] of [['RSI_SIGNED_OUT', T.signedOut], ['RSI_ACCOUNT_CHANGED', T.accountChanged], ['RSI_CHECK_IN_BROWSER', T.browserCheck], ['RUN_LIFETIME_REACHED', T.lifetime]]) {
    eq('row 17 ' + code, present({ continuable: true, activeJob: failed({ code, message: 'Stopped.' }) }).summary, text);
  }
  eq('row 18', present({ continuable: true, activeJob: failed({ code: 'RSI_PLEDGES_CONTRACT_CHANGED', message: 'Changed.', detail: { signal: { kind: 'contract' } } }) }).summary, T.schemaChanged);
  eq('row 19', present({ continuable: true, activeJob: failed({ code: 'RSI_READ_FAILED', message: 'Failed.' }, { currentSection: 'buybacks' }) }).row, 19);
  const stopped = present({ continuable: false, retryNotBefore: future, activeJob: failed({ code: 'RSI_RATE_LIMITED', message: 'RSI kept refusing requests.' }) });
  eq('row 20', [stopped.row, stopped.badge, stopped.operation, stopped.tone].join('|'), '20|CONNECTED|Ready to build again|warning');
  eq('row 20 after', M.countdownText(stopped.countdown, later), 'The last run stopped before anything was saved. Build when ready.');
  eq('row 20 lifetime', M.countdownText(present({ continuable: false, activeJob: failed({ code: 'RUN_LIFETIME_REACHED', message: 'Time.' }) }).countdown, later), 'The last run stopped before anything was saved. Build when ready.');
  eq('row 21', present({ continuable: false, activeJob: failed({ code: 'RSI_REFERRAL_CONTRACT_CHANGED', message: 'Changed.' }) }).summary, T.schemaChanged);
  eq('row 22', present({ activeJob: job({ status: 'cancelled' }) }).badge, 'CANCELLED');
  eq('row 23', present({ activeJob: null }).badge, 'CONNECTED');
  const roster = present({ activeJob: job({ jobKind: 'organizationData', currentSection: 'organizations.members.TEST', status: 'complete' }) });
  eq('roster kind', [roster.jobKind, roster.operation].join('|'), 'roster|Organization Data complete');
  eq('account skip', present({ activeJob: job({ currentSection: 'buybackUpgradePrices' }) }).controls.skip, true);
  eq('roster skip', present({ activeJob: job({ jobKind: 'organizationData', currentSection: 'organizations.members.TEST' }) }).controls.skip, false);
  eq('roster continue', present({ continuable: true, activeJob: failed({ code: 'RSI_READ_FAILED', message: 'Failed.' }, { jobKind: 'organizationData', currentSection: 'organizations.members.TEST' }) }).controls.resumeLabel, 'Continue Organization Data');
`;

export const MODEL_MATRIX = `(() => {${MODEL_ROWS}${MODEL_TAPE_AND_LINES}  return fails;
})()`;
