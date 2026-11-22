// The synthetic bridge the Build Status checks drive the panel through, and the page helpers they share: a status
// pushed, a node's property read, two animation frames waited for, and the emulated media features set.
import { command, evaluate } from "./chrome-process-and-devtools-commands.mjs";

// A synthetic bridge of this check's own session: STATUS pushes, and GET_STATUS and the run starts answered.
export const INSTALL_BRIDGE = `(() => {
  const session = crypto.randomUUID(); const nonce = 'w'.repeat(40); const origin = location.protocol === 'file:' ? 'null' : location.origin;
  const send = (type, payload, requestId) => window.dispatchEvent(new MessageEvent('message', { source: window, origin, data: { channel: 'citizendata.dashboard.v1', protocolVersion: 2, type, requestId: requestId || crypto.randomUUID(),
    bridgeSessionId: session, nonce, payload } }));
  const wp6 = { session, status: { status: 'idle', activeJob: null }, start: { ok: false, code: 'TEST_DECLINED', message: 'Synthetic start declined.' } };
  wp6.emit = (status) => { wp6.status = status; send('STATUS', { status }); };
  wp6.job = (fields) => Object.assign({ jobId: 'job-wp6', runId: 'run-wp6', status: 'running', mode: 'update', currentSection: 'pledges', sectionCount: 3, completedSections: 1, requestProgressBySection: {}, activityLog: [], failure: null,
    pace: { factor: 2, warning: null, waitingUntil: null, statusPage: null } }, fields);
  wp6.running = (fields, status) => Object.assign({ status: 'running', hasActiveJob: true, controlSessionBound: true, requiresRebind: false, continuable: false, activeJob: wp6.job(fields || {}) }, status || {});
  wp6.activities = (count, from) => Array.from({ length: count }, (_, index) => ({ kind: 'request-started', method: 'GET', route: '/account/pledges', page: (from || 1) + index, pageCount: null, at: new Date(Date.now() - 60000 + index * 1000).toISOString(),
    section: 'pledges', seq: (from || 1) + index }));
  window.addEventListener('message', (event) => {
    const request = event.data;
    if (event.source !== window || request?.channel !== 'citizendata.dashboard.v1' || request.bridgeSessionId !== session || request.nonce !== nonce) return;
    if (request.type === 'GET_STATUS') send('RESPONSE', { ok: true, status: wp6.status }, request.requestId);
    else if (['PROPOSE_BUILD', 'CONTINUE_PARTIAL', 'PROPOSE_ORGANIZATION_ROSTER'].includes(request.type)) send('RESPONSE', wp6.start, request.requestId);
  });
  window.__wp6 = wp6;
  send('BRIDGE_READY', { extensionVersion: '0.42.1', capabilities: { buildJson: true } });
  return true;
})()`;

export const LIMITED = "window.__wp6.running({ pace: { factor: 4, warning: 'limited', waitingUntil: null, statusPage: null } })";
export const W1 = "Potential website issue or rate limiting. Slowing down.";
export const read = (selector, property = "textContent") => evaluate(`document.querySelector(${JSON.stringify(selector)})?.${property}`);
export const emit = (expression) => evaluate(`(() => { window.__wp6.emit(${expression}); return true; })()`);
export const frame = () => evaluate("new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))");
export const media = (features) => command("Emulation.setEmulatedMedia", { features });
