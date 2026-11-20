export const checks = [];
export const failedChecks = [];
export const errors = [];
export const modes = [];
export const remoteAttempts = [];
export const screenshotWarnings = [];
// The steps are modules of their own; a module reads another's variable and assigns it through these.
export let browser;
export let server;
export let version;
export let playwrightVersion;
export let takingScreenshot = false;
export const setBrowser = value => { browser = value; };
export const setServer = value => { server = value; };
export const setVersion = value => { version = value; };
export const setPlaywrightVersion = value => { playwrightVersion = value; };
export const setTakingScreenshot = value => { takingScreenshot = value; };
