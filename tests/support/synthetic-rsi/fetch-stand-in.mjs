import { ORIGIN } from "./page-sizes-and-ship-names.mjs";
import { json } from "./answer-shapes-and-paging.mjs";

// Gives the stand-in for fetch: it records each request, applies latency and planned failures, and follows redirects.
export function createFetch({ route, requests, failures, timing, now, wait }) {
  async function fetch(input, init = {}) {
    let url = new URL(String(input));
    const method = String(init.method ?? "GET").toUpperCase();
    if (url.origin !== ORIGIN) throw new TypeError(`Synthetic RSI refused a request to ${url.origin}.`);
    let body = null;
    if (typeof init.body === "string") {
      try { body = JSON.parse(init.body); } catch { body = null; }
    }
    const tokenSent = Boolean(init.headers?.["X-Rsi-Token"]);
    const record = { method, path: url.pathname, page: Number(url.searchParams.get("page") ?? body?.page ?? 0) || null, at: now(), tokenSent };
    // The store upgrade page's queries share one address; the query asked tells them apart.
    if (Array.isArray(body) && typeof body[0]?.operationName === "string") record.operations = body.map((question) => question?.operationName);
    requests.push(record);
    if (timing.latencyMs > 0) await wait(timing.latencyMs);
    if (init.signal?.aborted) throw Object.assign(new Error("The operation was aborted."), { name: "AbortError" });
    const failure = failures.find((candidate) => candidate.remaining > 0 && candidate.matches(record));
    let answer;
    if (failure) {
      failure.remaining -= 1;
      if (failure.network) throw new TypeError("Synthetic network failure.");
      answer = { status: failure.status, contentType: "text/html", body: "Synthetic failure" };
    } else if (method === "POST" && !tokenSent) {
      answer = json({ success: 0, code: "ErrNotAuthenticated" }, 403);
    } else {
      answer = route(url, method, body ?? {});
    }
    // A browser follows a redirect itself and reports the address that answered. A caller that asks for the
    // redirect itself, as the Chrome check does so Chrome can follow it, gets the 302 and its Location.
    for (let hops = 0; answer.location && init.redirect !== "manual" && hops < 5; hops += 1) {
      url = new URL(answer.location, ORIGIN);
      record.redirectedTo = url.pathname;
      answer = route(url, method, body ?? {});
    }
    const finalUrl = url.href;
    const location = answer.location ? new URL(answer.location, ORIGIN).href : null;
    return {
      ok: answer.status >= 200 && answer.status < 300,
      status: answer.status,
      url: finalUrl,
      headers: { get: (name) => name.toLowerCase() === "content-type" ? answer.contentType : name.toLowerCase() === "location" ? location : null },
      json: async () => typeof answer.body === "string" ? JSON.parse(answer.body) : JSON.parse(JSON.stringify(answer.body)),
      text: async () => typeof answer.body === "string" ? answer.body : JSON.stringify(answer.body)
    };
  }

  return fetch;
}
