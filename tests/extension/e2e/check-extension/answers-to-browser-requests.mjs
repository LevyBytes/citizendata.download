import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { chrome, rsi } from "./browser-pages-and-account-in-use.mjs";
import { docsRoot } from "./dashboard-copy-without-image-spacing.mjs";
import { gate, refusal } from "./held-rsi-requests.mjs";
import { HOSTED_ORIGIN, MEDIA_ORIGIN, PNG, RSI_ORIGIN, STATUS_ORIGIN, mime } from "./origins-keys-and-stand-in-image.mjs";

export const unexpectedRequests = [];
// Every image the dashboard asked RSI's image host for.
export const mediaRequests = [];
// Every download Chrome began, with the name it suggested and how it ended.
export const downloadEvents = [];
// A scenario's change to one file of the hosted dashboard as it is served: (pathname, bytes) => bytes.
let hostedChange = null;
export const changeHostedFile = (change) => { hostedChange = change; };
// A scenario's change to the synthetic account's answers as Chrome receives them: (request, text) => text.
let answerChange = null;
export const changeRsiAnswers = (change) => { answerChange = change; };

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
    if (url.origin === RSI_ORIGIN || url.origin === STATUS_ORIGIN) {
      const headers = Object.fromEntries(Object.entries(request.headers ?? {}).map(([name, value]) => [name.toLowerCase() === "x-rsi-token" ? "X-Rsi-Token" : name, value]));
      // A limit the scenario holds answers in RSI's place, with its Retry-After.
      const limit = refusal;
      if (limit?.refuses(request)) {
        await fulfil(requestId, limit.status, "text/html", "<html><body>Too Many Requests</body></html>", null, [{ name: "Retry-After", value: String(limit.retryAfterSeconds) }]);
        return;
      }
      const held = gate;
      if (held?.matches(request)) {
        held.arrive();
        await held.released;
        if (held.answer) {
          const { status, contentType = "text/html", body = "", retryAfterSeconds = null } = held.answer;
          await fulfil(requestId, status, contentType, body, null, retryAfterSeconds === null ? [] : [{ name: "Retry-After", value: String(retryAfterSeconds) }]);
          return;
        }
      }
      // A redirect is handed to Chrome to follow, as it follows RSI's own.
      const response = await rsi.fetch(request.url, { method: request.method, headers, body: request.postData, redirect: "manual" });
      const retryAfter = response.headers.get("retry-after");
      const text = await response.text();
      await fulfil(requestId, response.status, response.headers.get("content-type"), answerChange ? answerChange(request, text) : text, response.headers.get("location"), retryAfter === null ? [] : [{ name: "Retry-After", value: retryAfter }]);
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
      else await fulfil(requestId, 200, mime[path.extname(file).toLowerCase()] ?? "application/octet-stream", hostedChange ? hostedChange(url.pathname, await readFile(file)) : await readFile(file));
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
