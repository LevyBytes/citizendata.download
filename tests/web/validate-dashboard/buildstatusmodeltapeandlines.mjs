// The second half of the Build Status model matrix (PARSER_HARDENING.md §11.1, §11.3), as page source that
// buildstatusmodelmatrix.mjs joins to the first: the caution tape's rows, the log lines W-17, W-19 and W-24, their
// tone, the section labels, and no dash or hyphen in a text. It reads the first half's names.
export const MODEL_TAPE_AND_LINES = `
  const tape = (status, media) => M.cautionPresentation(status, media || null, now).text;
  const issue = { status: 'issue', components: [{ name: 'Platform', state: 'disrupted' }] };
  eq('tape 1', tape({ activeJob: job({ pace: { warning: 'slow', statusPage: issue } }) }), 'RSI reports a problem: Platform (disrupted).');
  eq('tape 1 limited', tape({ activeJob: job({ pace: { warning: 'limited', statusPage: issue } }) }), 'RSI reports a problem: Platform (disrupted).');
  eq('tape 2', tape({ activeJob: job({ pace: { warning: 'limited' } }) }), T.limited);
  eq('tape 3', tape({ activeJob: job({ pace: { warning: 'slow' } }) }), T.slow);
  eq('tape 4', tape({ activeJob: null }, { active: true, warning: 'limited' }), T.limited);
  eq('tape 5', tape({ retryNotBefore: future, startDiagnosis: { probe: 'not-run', status: 'unknown', reason: 'no-permission', components: [] } }), T.startRefused + ' ' + T.statusNotChecked);
  eq('tape 6', tape({ retryNotBefore: future, activeJob: failed({ code: 'RSI_RATE_LIMITED' }) }), T.limited);
  eq('tape 6 ended', tape({ retryNotBefore: past, activeJob: failed({ code: 'RSI_RATE_LIMITED' }) }), '');
  eq('tape 7', tape({}, { stoppedWithRemaining: true }), T.imagesLeft);
  eq('tape paused', tape({ activeJob: job({ status: 'paused', pace: { warning: 'limited' } }) }), '');
  eq('tape none', tape({ activeJob: job({}) }), '');
  const line = (activity) => M.safeActivityPresentation(Object.assign({ at: past, section: 'buybacks' }, activity));
  eq('W-17', line({ kind: 'rate-limited', signal: { code: 'RSI_HTML_HTTP_429' }, waitMs: 61400 }).message, 'RSI refused Buybacks · RSI_HTML_HTTP_429 · retry in 61 s.');
  eq('W-24', line({ kind: 'free-retry', signal: { code: 'RSI_TIMEOUT' }, waitMs: 2000 }).message, 'Retrying Buybacks once · RSI_TIMEOUT.');
  const pair = M.activityRows([{ kind: 'smart-check', at: past, section: 'buybacks', check: 'public-page', outcome: 'failed', httpStatus: null, seq: 4 }, { kind: 'smart-check', at: past, section: 'buybacks', check: 'status-page', outcome: 'unknown',
    httpStatus: null, seq: 5 }]);
  eq('W-19', pair.map((row) => row.message).join('|'), 'Check · without login: no answer · RSI status: unavailable.');
  eq('W-19 key', pair[0].key, 'seq:4');
  eq('W-19 status read', line({ kind: 'smart-check', check: 'status-page', outcome: 'issue' }).message, 'Check · RSI status: problem.');
  eq('warning tone', [line({ kind: 'rate-limited', waitMs: 1 }).tone, line({ kind: 'free-retry' }).tone, pair[0].tone, line({ kind: 'request-failed', error: 'TIMEOUT', method: 'GET', route: '/account/pledges' }).tone].join(','),
    'warning,warning,warning,warning');
  eq('labels', [M.collectionSectionPresentation('buybackDetails').label, M.collectionSectionPresentation('buybackUpgradePrices').label].join('|'), 'Buyback prices|CCU buyback prices');
  const dashes = new RegExp('[' + String.fromCharCode(8211, 8212) + '-]', 'u');
  for (const [key, value] of Object.entries(T)) if (dashes.test(value)) fails.push('a dash or hyphen in ' + key);
  for (const text of [waiting.summary, refused.summary, partial.summary, stopped.summary, M.countdownText(waiting.countdown, later)]) if (dashes.test(text)) fails.push('a dash or hyphen in ' + text);
`;
