import { ORIGIN } from "./page-sizes-and-ship-names.mjs";
import { html, json } from "./answer-shapes-and-paging.mjs";
import { STATUS_ORIGIN } from "./status-feed-answers.mjs";

// The answer a planned failure gives: a status with a JSON body, a page, GraphQL errors beside optional data, or the
// short page the stand-in has always sent. `headers` are added to any of them.
function plannedAnswer(failure) {
  let answer;
  if (failure.graphqlErrors) answer = json([{ ...(failure.data === undefined ? {} : { data: failure.data }), errors: failure.graphqlErrors }], failure.status);
  else if (failure.json !== undefined) answer = json(failure.json, failure.status);
  else if (failure.html !== undefined) answer = { ...html(failure.html), status: failure.status };
  else answer = { status: failure.status, contentType: "text/html", body: "Synthetic failure" };
  if (failure.contentType) answer.contentType = failure.contentType;
  if (failure.location) answer.location = failure.location;
  return { ...answer, headers: { ...failure.headers } };
}

// Gives the stand-in for fetch: it records each request, applies latency, limiters and planned failures, and follows
// redirects the way Chrome does.
export function createFetch({ route, statusRoute, requests, failures, limiters, timing, now, wait }) {
  async function fetch(input, init = {}) {
    let url = new URL(String(input));
    const method = String(init.method ?? "GET").toUpperCase();
    if (url.origin !== ORIGIN && url.origin !== STATUS_ORIGIN) throw new TypeError(`Synthetic RSI refused a request to ${url.origin}.`);
    let body = null;
    if (typeof init.body === "string") {
      try { body = JSON.parse(init.body); } catch { body = null; }
    }
    const tokenSent = Boolean(init.headers?.["X-Rsi-Token"]);
    // A request sent with `credentials: "omit"` carries no cookie, so a limiter can tell the connection from the account.
    const credentialsOmitted = init.credentials === "omit";
    const record = { method, origin: url.origin, path: url.pathname, page: Number(url.searchParams.get("page") ?? body?.page ?? 0) || null, at: now(), tokenSent, credentialsOmitted };
    // The store upgrade page's queries share one address; the query asked tells them apart.
    if (Array.isArray(body) && typeof body[0]?.operationName === "string") record.operations = body.map((question) => question?.operationName);
    requests.push(record);
    if (timing.latencyMs > 0) await wait(timing.latencyMs);
    if (init.signal?.aborted) throw Object.assign(new Error("The operation was aborted."), { name: "AbortError" });
    const failure = failures.find((candidate) => candidate.remaining > 0 && candidate.matches(record));
    // Every limiter counts every request; the first that refuses it gives the answer.
    let answer = limiters.map((limiter) => limiter.answer(record)).find(Boolean) ?? null;
    if (answer) record.limited = true;
    else if (failure) {
      failure.remaining -= 1;
      if (failure.network) throw new TypeError("Synthetic network failure.");
      if (failure.delayMs > 0) await wait(failure.delayMs);
      answer = plannedAnswer(failure);
    } else if (url.origin === STATUS_ORIGIN) {
      answer = statusRoute(url, method);
    } else if (method === "POST" && !tokenSent) {
      answer = json({ success: 0, code: "ErrNotAuthenticated" }, 403);
    } else {
      answer = route(url, method, body ?? {});
    }
    // Chrome follows a redirect itself and reports the address that answered. A caller that asks for the redirect
    // itself, as the Chrome check does so Chrome can follow it, gets the 302 and its Location. A caller that refuses
    // redirects, as the extension's JSON calls do, gets the TypeError Chrome raises.
    if (answer.location && init.redirect === "error") throw new TypeError("Failed to fetch: a redirect was refused.");
    for (let hops = 0; answer.location && init.redirect !== "manual" && hops < 5; hops += 1) {
      url = new URL(answer.location, ORIGIN);
      record.redirectedTo = url.pathname;
      answer = url.origin === ORIGIN ? route(url, method, body ?? {}) : { status: 200, contentType: "text/html; charset=UTF-8", body: "<!doctype html><title>Elsewhere</title>" };
    }
    const finalUrl = url.href;
    const location = answer.location ? new URL(answer.location, ORIGIN).href : null;
    const headers = Object.fromEntries(Object.entries(answer.headers ?? {}).map(([name, value]) => [name.toLowerCase(), String(value)]));
    headers["content-type"] = answer.contentType ?? null;
    if (location) headers.location = location;
    return {
      ok: answer.status >= 200 && answer.status < 300,
      status: answer.status,
      url: finalUrl,
      headers: { get: (name) => headers[String(name).toLowerCase()] ?? null },
      json: async () => typeof answer.body === "string" ? JSON.parse(answer.body) : JSON.parse(JSON.stringify(answer.body)),
      text: async () => typeof answer.body === "string" ? answer.body : JSON.stringify(answer.body),
      clone() { return { ...this }; },
      // The body as bytes, for the contract evidence that hashes what RSI sent.
      arrayBuffer: async () => new TextEncoder().encode(typeof answer.body === "string" ? answer.body : JSON.stringify(answer.body)).buffer
    };
  }

  return fetch;
}
