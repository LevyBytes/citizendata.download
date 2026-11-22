import assert from "node:assert/strict";
import { launchReport, launchWithFallback } from "../../../support/chrome-test-launch.mjs";
import { ChromePipe } from "../chrome-pipe.mjs";
import { answerPausedRequest, downloadEvents } from "./answers-to-browser-requests.mjs";
import { chrome, extensionId, extensionOrigin, setChrome, setExtensionId, setExtensionOrigin, setSettings, settings } from "./browser-pages-and-account-in-use.mjs";
import { extensionUnderTest } from "./extension-copy-without-pacing.mjs";
import { downloads, executable, options, profile } from "./options-and-run-folders.mjs";
import { TOKEN } from "./origins-keys-and-stand-in-image.mjs";

export async function launchChromeWithTheExtension() {
  // No name resolves, so nothing leaves this machine even if a request were to escape interception.
  const extraArguments = ["--host-resolver-rules=MAP * ~NOTFOUND"];
  const headless = !options.headed;
  setChrome(await launchWithFallback((renderingFlags) => ChromePipe.launch({ executable, profile, headless, renderingFlags, extraArguments }), {
    report: (name, flags, why = null) => console.log(`${launchReport(executable, name, [...flags, ...(headless ? ["--headless=new"] : []), ...extraArguments])}${why ? ` (${why})` : ""}`)
  }));
  chrome.on((message) => {
    if (message.method === "Browser.downloadWillBegin") downloadEvents.push({ guid: message.params.guid, name: message.params.suggestedFilename, state: "started" });
    if (message.method === "Browser.downloadProgress" && message.params.state !== "inProgress") {
      const begun = downloadEvents.find((event) => event.guid === message.params.guid);
      if (begun) begun.state = message.params.state;
    }
    if (message.method === "Fetch.requestPaused") void answerPausedRequest(message.params);
  });
  await chrome.send("Fetch.enable", { patterns: [{ urlPattern: "http://*", requestStage: "Request" }, { urlPattern: "https://*", requestStage: "Request" }] });
  await chrome.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: downloads, eventsEnabled: true });

  setSettings(await chrome.newPage("chrome://extensions"));
  await settings.waitFor("typeof chrome !== 'undefined' && Boolean(chrome.developerPrivate)", 15000, "the extensions page");
  // Chrome runs unpacked extensions only while Developer mode is on.
  await settings.evaluate("chrome.developerPrivate.updateProfileConfiguration({ inDeveloperMode: true })");
  setExtensionId((await chrome.send("Extensions.loadUnpacked", { path: extensionUnderTest })).id);
  setExtensionOrigin(`chrome-extension://${extensionId}`);
  await chrome.waitForTarget((target) => target.type === "service_worker" && target.url.startsWith(extensionOrigin), 20000, "the extension service worker");
  const installed = await settings.evaluate(`chrome.developerPrivate.getExtensionsInfo({ includeDisabled: true }).then((items) => items.filter((item) => item.id === ${JSON.stringify(extensionId)}).map((item) => ({ state: item.state, fileAccess: `
    + `item.fileAccess?.isActive, manifestErrors: item.manifestErrors.length, runtimeErrors: item.runtimeErrors.map((error) => error.message) }))[0])`);
  assert.deepEqual(installed, { state: "ENABLED", fileAccess: true, manifestErrors: 0, runtimeErrors: [] }, "The unpacked extension did not load cleanly with file access.");
  await chrome.send("Storage.setCookies", { cookies: [{ name: "Rsi-Token", value: TOKEN, domain: "robertsspaceindustries.com", path: "/", secure: true, httpOnly: true }] });
}
