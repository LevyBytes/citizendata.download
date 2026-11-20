import { EXTENSION_ID, HOSTED_DASHBOARD_URL, Model, Protocol } from "./extension-files-and-identifiers.mjs";
import { tabLocation } from "./dashboard-tab-location.mjs";

// Gives the harness `openTab`: a tab that stands in for a dashboard page and sends what its content script would.
export function addTabOpener(world, deliver) {
  const { harness } = world;

  harness.openTab = (url = HOSTED_DASHBOARD_URL, tabOptions = {}) => {
    const tab = { id: ++world.tabSequence, url, incognito: tabOptions.incognito === true, closed: false, events: [], approvalSignals: 0, bridgeSessionId: null, nonce: null };
    const newSession = () => {
      tab.bridgeSessionId = globalThis.crypto.randomUUID();
      tab.nonce = `${globalThis.crypto.randomUUID()}${globalThis.crypto.randomUUID()}`;
    };
    newSession();
    harness.tabs.set(tab.id, tab);
    const sender = (overrides = {}) => ({ id: EXTENSION_ID, frameId: 0, url: tab.url, tab: { id: tab.id, url: tab.url, incognito: tab.incognito }, ...overrides });
    const handle = {
      id: tab.id,
      events: tab.events,
      get url() { return tab.url; },
      get origin() { return tabLocation(tab).origin; },
      get path() { return tabLocation(tab).pathname; },
      get bridgeSessionId() { return tab.bridgeSessionId; },
      get approvalSignals() { return tab.approvalSignals; },
      get badge() { return harness.badges.get(tab.id) ?? ""; },
      // What the content script sends when a page request passed its own checks. `forge` replaces parts of the
      // message or of the sender Chrome reports, for tests of what the worker refuses.
      request(type, payload = null, forge = {}) {
        const envelope = Protocol.makeEnvelope({ type, requestId: globalThis.crypto.randomUUID(), bridgeSessionId: tab.bridgeSessionId, nonce: tab.nonce, payload });
        const location = tabLocation(tab);
        return deliver({ kind: "DASHBOARD_REQUEST", dashboardOrigin: location.origin, dashboardPath: location.pathname, envelope: { ...envelope, ...forge.envelope }, ...forge.message }, sender(forge.sender));
      },
      hello(forge = {}) {
        return deliver({ kind: "LOCAL_DASHBOARD_HELLO", dashboardPath: tabLocation(tab).pathname, ...forge.message }, sender(forge.sender));
      },
      build() { return handle.request("PROPOSE_BUILD", Model.buildDefaultPlan()); },
      status() { return handle.request("GET_STATUS").then((response) => response.status); },
      lastEvent() { return tab.events.at(-1) ?? null; },
      // The page was reloaded: the same tab with a new bridge session.
      reload() {
        newSession();
        tab.events.length = 0;
        return handle;
      },
      navigate(nextUrl) {
        tab.url = nextUrl;
        return handle.reload();
      },
      close() { tab.closed = true; }
    };
    return handle;
  };
}
