import { EXTENSION_ID, RSI_TOKEN, manifest } from "./extension-files-and-identifiers.mjs";
import { copy } from "./message-copies-between-realms.mjs";
import { hasBridge, tabLocation } from "./dashboard-tab-location.mjs";
import { storageArea } from "./chrome-storage-and-alarms.mjs";

// The `chrome` object one worker instance sees. `guard` keeps a stopped worker from ever getting an answer.
export function chromeApi(world, instance, guard) {
  const { clock, harness } = world;
  const { scheduleAlarm, clearAlarm } = world.alarms;
  const ensureOffscreen = world.ensureOffscreen;
  const event = (name) => ({ addListener: (listener) => instance.listeners[name].push(listener) });
  const chrome = {
    runtime: {
      id: EXTENSION_ID,
      getManifest: () => instance.local(manifest),
      getURL: (relativePath) => `chrome-extension://${EXTENSION_ID}/${relativePath}`,
      onInstalled: event("installed"),
      onStartup: event("startup"),
      onMessage: event("message"),
      sendMessage: guard(async (message) => {
        if (message?.kind !== "CITIZENDATA_PARSE_RSI_MARKUP" || !harness.offscreenDocuments.length) throw new Error("Could not establish connection. Receiving end does not exist.");
        return ensureOffscreen().parse(message);
      })
    },
    storage: { local: storageArea(harness.local, guard), session: storageArea(harness.session, guard) },
    alarms: {
      onAlarm: event("alarm"),
      create: guard(async (name, info) => {
        clearAlarm(name);
        // Chrome does not fire an installed extension's alarm sooner than 30 seconds.
        const periodInMinutes = info.periodInMinutes === undefined ? null : Math.max(0.5, info.periodInMinutes);
        const delayInMinutes = Math.max(0.5, info.delayInMinutes ?? periodInMinutes ?? 0.5);
        const alarm = { name, periodInMinutes, scheduledTime: info.when ?? clock.now + delayInMinutes * 60000 };
        harness.alarms.set(name, alarm);
        scheduleAlarm(alarm);
      }),
      get: guard(async (name) => {
        const alarm = harness.alarms.get(name);
        return alarm ? { name, scheduledTime: alarm.scheduledTime, ...(alarm.periodInMinutes ? { periodInMinutes: alarm.periodInMinutes } : {}) } : undefined;
      }),
      getAll: guard(async () => [...harness.alarms.values()].map((alarm) => ({ name: alarm.name, scheduledTime: alarm.scheduledTime, ...(alarm.periodInMinutes ? { periodInMinutes: alarm.periodInMinutes } : {}) }))),
      clear: guard(async (name) => clearAlarm(name))
    },
    // The account host's grant, and the optional status host's, granted unless a test sets `statusPermission` false.
    permissions: { contains: guard(async ({ origins = [] } = {}) => origins.every((origin) => (origin.startsWith("https://status.robertsspaceindustries.com/") ? harness.statusPermission !== false : harness.rsiPermission))) },
    cookies: {
      get: guard(async (details) => {
        harness.cookieReads += 1;
        return details.name === "Rsi-Token" && harness.signedIn ? { name: "Rsi-Token", value: RSI_TOKEN } : null;
      })
    },
    offscreen: {
      hasDocument: guard(async () => harness.offscreenDocuments.length > 0),
      createDocument: guard(async (details) => { harness.offscreenDocuments.push(copy(details)); })
    },
    action: {
      setBadgeText: guard(async ({ tabId, text }) => {
        if (!harness.tabs.has(tabId) || harness.tabs.get(tabId).closed) throw new Error(`No tab with id: ${tabId}.`);
        harness.badges.set(tabId, text);
      }),
      setBadgeBackgroundColor: guard(async () => {}),
      setTitle: guard(async () => {})
    },
    tabs: {
      sendMessage: guard(async (tabId, message) => {
        const tab = harness.tabs.get(tabId);
        if (!tab || !hasBridge(harness, tab)) throw new Error("Could not establish connection. Receiving end does not exist.");
        if (message.kind === "LOCAL_DASHBOARD_PING") return new URL(tab.url).protocol === "file:" ? { dashboardPath: tabLocation(tab).pathname } : undefined;
        if (message.kind === "LOCAL_DASHBOARD_APPROVED") tab.approvalSignals += 1;
        if (message.kind === "DASHBOARD_EVENT") tab.events.push(copy(message.payload));
        return undefined;
      })
    }
  };
  return chrome;
}
