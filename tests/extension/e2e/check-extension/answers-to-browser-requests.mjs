import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { chrome, rsi } from "./browser-pages-and-account-in-use.mjs";
import { docsRoot } from "./dashboard-copy-without-image-spacing.mjs";
import { gate } from "./held-rsi-requests.mjs";
import { HOSTED_ORIGIN, MEDIA_ORIGIN, PNG, RSI_ORIGIN, mime } from "./origins-keys-and-stand-in-image.mjs";

export const unexpectedRequests = [];
// Every image the dashboard asked RSI's image host for.
export const mediaRequests = [];
// Every download Chrome began, with the name it suggested and how it ended.
export const downloadEvents = [];

async function fulfil(requestId, status, contentType, body, location = null, extraHeaders = []) {
  await chrome.send("Fetch.fulfillRequest", {
    requestId,
    responseCode: status,
    responseHeaders: [{ name: "Content-Type", value: contentType }, { name: "Cache-Control", value: "no-store" }, ...(location ? [{ name: "Location", value: location }] : []), ...extraHeaders],
    body: Buffer.from(body).toString("base64")
  });
}

// Answers every paused request locally: RSI from the synthetic account, the hosted dashboard from docs/.
export async function answerPausedRequest({ requestId, request }) {
  const url = new URL(request.url);
  try {
    if (url.origin === RSI_ORIGIN) {
      const headers = Object.fromEntries(Object.entries(request.headers ?? {}).map(([name, value]) => [name.toLowerCase() === "x-rsi-token" ? "X-Rsi-Token" : name, value]));
      const held = gate;
      if (held && held.matches(request)) {
        held.arrive();
        await held.released;
      }
      // A redirect is handed to Chrome to follow, as it follows RSI's own.
      const response = await rsi.fetch(request.url, { method: request.method, headers, body: request.postData, redirect: "manual" });
      await fulfil(requestId, response.status, response.headers.get("content-type"), await response.text(), response.headers.get("location"));
      return;
    }
    if (url.origin === MEDIA_ORIGIN) {
      // RSI's image host answers any origin, without credentials. The dashboard asks; the extension never does.
      mediaRequests.push({ url: request.url, hasCookie: Object.keys(request.headers ?? {}).some((name) => name.toLowerCase() === "cookie"), referrer: request.headers?.Referer ?? request.headers?.referer ?? null });
      await fulfil(requestId, 200, "image/png", Buffer.concat([PNG, Buffer.from(url.pathname)]), null, [{ name: "Access-Control-Allow-Origin", value: "*" }]);
      return;
    }
    if (url.origin === HOSTED_ORIGIN) {
      const file = path.join(docsRoot, decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname));
      if (!file.startsWith(docsRoot + path.sep) || !existsSync(file)) await fulfil(requestId, 404, "text/plain", "Not found");
      else await fulfil(requestId, 200, mime[path.extname(file).toLowerCase()] ?? "application/octet-stream", await readFile(file));
      return;
    }
    unexpectedRequests.push(request.url);
    await chrome.send("Fetch.failRequest", { requestId, errorReason: "BlockedByClient" });
  } catch (error) {
    // The requester went away, as when the worker is stopped on purpose in the middle of a request.
    if (!/Invalid InterceptionId|Invalid state for continueInterceptedRequest/u.test(error.message)) {
      console.error(`Request ${request.url} could not be answered: ${error.message}`);
      process.exitCode = 1;
    }
  }
}
