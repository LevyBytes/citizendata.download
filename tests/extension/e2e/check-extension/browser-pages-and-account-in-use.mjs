// A classic script shared with the unit tests; it attaches itself to globalThis.
await import("../../../support/synthetic-rsi.js");
export const { createSyntheticRsi, buildBuybackDetail, upgradePriceCents } = globalThis.CitizenDataSyntheticRsi;

export let rsi = createSyntheticRsi();
export let chrome;
export let extensionId;
export let extensionOrigin;
export let settings;
export let extensionPage;
export let dashboard;
export let dashboardTabId;
export let recoveryBackup = null;
// The parts of this check are separate modules. A module reads another's variable, and assigns it through these.
export const setRsi = (value) => { rsi = value; };
export const setExtensionPage = (value) => { extensionPage = value; };
export const setDashboard = (value) => { dashboard = value; };
export const setDashboardTabId = (value) => { dashboardTabId = value; };
export const setRecoveryBackup = (value) => { recoveryBackup = value; };
export const setChrome = (value) => { chrome = value; };
export const setSettings = (value) => { settings = value; };
export const setExtensionId = (value) => { extensionId = value; };
export const setExtensionOrigin = (value) => { extensionOrigin = value; };
