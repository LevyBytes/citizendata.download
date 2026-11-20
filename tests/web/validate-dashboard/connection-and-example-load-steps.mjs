import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromeErrors, command, evaluate, exceptions, pending, remoteRequests, setSocket, socket, waitFor, waitForFile, waitForJson } from "./chrome-process-and-devtools-commands.mjs";
import { downloadDirectory, profileDirectory, repositoryRoot, statusOnly } from "./run-options-and-work-folders.mjs";

// Connects to the page Chrome opened and loads the dashboard with its example account.
const activePortFile = path.join(profileDirectory, "DevToolsActivePort");
await waitForFile(activePortFile);
const [port] = (await readFile(activePortFile, "utf8")).trim().split(/\r?\n/u);
const targets = await waitForJson(`http://127.0.0.1:${port}/json/list`);
const page = targets.find((target) => target.type === "page");
if (!page) throw new Error("Chrome exposed no page target.");
setSocket(new WebSocket(page.webSocketDebuggerUrl));
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});
socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    const request = pending.get(message.id);
    pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
    return;
  }
  if (message.method === "Runtime.exceptionThrown") exceptions.push(message.params.exceptionDetails.text);
  if (message.method === "Network.requestWillBeSent" && /^https?:/u.test(message.params.request.url)) remoteRequests.push(message.params.request.url);
});
socket.addEventListener("close", () => {
  for (const request of pending.values()) {
    clearTimeout(request.timer);
    request.reject(new Error(`Chrome DevTools connection closed.\n${chromeErrors}`));
  }
  pending.clear();
});

await command("Page.enable");
await command("Runtime.enable");
await command("Network.enable");
try {
  await command('Browser.setDownloadBehavior', {behavior:'allow',downloadPath:downloadDirectory,eventsEnabled:true});
} catch {
  await command('Page.setDownloadBehavior', {behavior:'allow',downloadPath:downloadDirectory});
}
await command("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1800, screenWidth: 1600, screenHeight: 1800, deviceScaleFactor: 1, mobile: false });
await command("Page.navigate", { url: pathToFileURL(path.join(repositoryRoot, "docs", "index.html")).href });
await waitFor("document.readyState==='complete' && document.querySelectorAll('#inventoryRows tr').length===3 && document.querySelectorAll('#referralRows tr').length===window.CITIZENDATA_DEMO_DATA.referrals.current.prospects.length");
if (!statusOnly) await evaluate("document.fonts.ready.then(()=>true)");
