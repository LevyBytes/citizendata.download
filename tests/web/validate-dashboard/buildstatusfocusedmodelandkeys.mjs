// What the focused Build Status steps share (PARSER_HARDENING.md §15.2): the model's own steps as one page
// expression, the warning texts and pace they show, a running status of a revision, a key pressed, and the panel's
// controls a user can reach.
import { command } from "./chrome-process-and-devtools-commands.mjs";

export const MODEL = `(() => {
  const M = window.CitizenDataDashboardModel; const T = M.TEXTS; const fails = [];
  const eq = (label, actual, expected) => { if (actual !== expected) fails.push(label + ': ' + JSON.stringify(actual) + ' !== ' + JSON.stringify(expected)); };
  const present = (status, extra) => M.buildPresentation(status, Object.assign({ bridgeConnected: true, nowMs: Date.now() }, extra || {}));
  // A status from an older extension: no pace, partial, revision or detected changes.
  const older = { status: 'running', hasActiveJob: true, controlSessionBound: true, activeJob: { jobId: 'j-old', runId: 'r-old', status: 'running', currentSection: 'pledges', sectionCount: 3, completedSections: 1, activityLog: [] } };
  try {
    const shown = present(older);
    eq('older status', [shown.row, shown.badge, shown.controls.pause, shown.controls.skip].join('|'), '11|COLLECTING|true|false');
    eq('older tape', M.cautionPresentation(older, null).text, '');
    eq('older notices', M.changeNotices(older.activeJob.detectedChanges ?? []).length, 0);
  } catch (error) {
    fails.push('an older status threw: ' + error.message);
  }
  // The image job: its own operation, and none of the account run's controls.
  const media = present({}, { media: { phase: 'running', detail: 'Working.' } });
  const on = Object.entries(media.controls).filter(([key, value]) => key !== 'resumeLabel' && value === true).map(([key]) => key);
  eq('image kind', [media.jobKind, media.operation, on.join(',')].join('|'), 'media|Downloading offline images|');
  // §11.3: no text names a rate, a request count or a factor, and none says RSI is working.
  const future = new Date(Date.now() + 90000).toISOString();
  const texts = [...Object.values(T),
    present({ activeJob: { jobId: 'j', runId: 'r', status: 'running', currentSection: 'pledges', activityLog: [], pace: { warning: 'limited', waitingUntil: future } } }).summary,
    present({ hasActiveJob: false, retryNotBefore: future, startDiagnosis: { probe: 'not-run', status: 'ok', reason: null, components: [] } }).summary,
    present({ continuable: true, retryNotBefore: future, activeJob: { jobId: 'j', runId: 'r', status: 'failed', failure: { code: 'RSI_RATE_LIMITED', message: 'Stopped.', detail: { diagnosis: { probe: 'refused', status: 'unknown', reason: 'unreadable',
      components: [] } } } } }).summary,
    M.safeActivityPresentation({ kind: 'rate-limited', at: new Date().toISOString(), section: 'buybacks', signal: { code: 'RSI_HTML_HTTP_429' }, waitMs: 61400 }).message,
    M.safeActivityPresentation({ kind: 'free-retry', at: new Date().toISOString(), section: 'buybacks', signal: { code: 'RSI_TIMEOUT' }, waitMs: 2000 }).message];
  const named = [/\\bfactor\\b/iu, /\\brequests?\\b/iu, /\\bper (second|minute|hour)\\b/iu, /%/u, /\\bworking\\b/iu, /\\btimes (slower|faster)\\b/iu];
  for (const text of texts) for (const pattern of named) if (pattern.test(text)) fails.push(JSON.stringify(text) + ' names ' + pattern);
  return fails;
})()`;

export const SLOW = "RSI is answering slowly. Slowing down.";
export const LIMITED_PACE = "{ factor: 4, warning: 'limited', waitingUntil: null, statusPage: null }";
export const running = (fields, revision) => `Object.assign(window.__wp6.running(${fields}), { statusRevision: ${revision} })`;
export async function press(key, code, keyCode, text = undefined) {
  await command("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode: keyCode, ...(text === undefined ? {} : { text }) });
  await command("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: keyCode });
}
// The panel's controls a user can reach: visible, enabled, and not taken out of the tab order.
export const PANEL_CONTROLS = "[...document.querySelectorAll('#parserOverlay button, #parserOverlay a[href]')].filter((node) => node.getClientRects().length > 0 && !node.disabled && node.tabIndex >= 0).map((node) => node.id)";
