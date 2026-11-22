(function initializeCitizenDataRsiApi(root, factory) {
  "use strict";

  const api = factory(root);
  root.CitizenDataRsiApi = api;
  if (typeof module === "object" && module?.exports) module.exports = api;
})(globalThis, function createCitizenDataRsiApi(root) {
  "use strict";

  const Delta = root.CitizenDataUpdateDelta;
  // The classes of RSI's answers (adapters/rsi-answer-classification.js), which load before this file.
  const Answers = root.CitizenDataRsiAnswers;
  const { RsiReadError } = Answers;

  const RSI_ORIGIN = "https://robertsspaceindustries.com";
  const IDENTIFY_PATH = "/api/spectrum/auth/identify";
  const HANGAR_LOG_PATH = "/api/account/pledgeLog";
  const BUYBACKS_PATH = "/api/account/buybackPledges";
  const ORGANIZATION_MEMBERS_PATH = "/api/orgs/getOrgMembers";
  const GRAPHQL_PATH = "/graphql";
  const LEDGERS = Object.freeze([
    Object.freeze({ key: "storeCredit", path: "/api/account/creditLog" }),
    Object.freeze({ key: "uec", path: "/api/account/uecLog" }),
    Object.freeze({ key: "rec", path: "/api/account/recLog" })
  ]);
  // The store upgrade page's own calls, used only to read the price of a CCU buy-back. The first two tell RSI which
  // upgrade the session is looking at; the third asks its price. None of them buys or changes the account.
  const UPGRADE_AUTH_PATH = "/api/account/v2/setAuthToken";
  const UPGRADE_CONTEXT_PATH = "/api/ship-upgrades/setContextToken";
  const UPGRADE_GRAPHQL_PATH = "/pledge-store/api/upgrade/graphql";
  const UPGRADE_PRICE_QUERY = "query getPrice($from: Int!, $to: Int!) {\n  price(from: $from, to: $to) {\n    amount\n    nativeAmount\n  }\n}\n";
  // Every ship of the store upgrade page with its images, in one answer. The larger image is the one recorded.
  const UPGRADE_SHIPS_QUERY = "query ships {\n  ships {\n    id\n    name\n    medias {\n      slideShow\n      productThumbMediumAndSmall\n    }\n  }\n}\n";
  const UPGRADE_SHIP_IMAGE = /^https:\/\/(?:media\.)?robertsspaceindustries\.com\/[^\s"'<>\\]{1,300}$/u;
  const TOKEN_POST_PATHS = new Set([IDENTIFY_PATH, HANGAR_LOG_PATH, BUYBACKS_PATH, ORGANIZATION_MEMBERS_PATH, GRAPHQL_PATH, UPGRADE_AUTH_PATH, UPGRADE_CONTEXT_PATH, UPGRADE_GRAPHQL_PATH, ...LEDGERS.map((entry) => entry.path)]);
  let upgradeAuthorizedRunId = null;
  const REFERRAL_QUERY_HASH = "a5fe54022da8dd2472bb64f8202528c708f8e72954c344525309477c6c105037";
  const ACCOUNT_DASHBOARD_QUERY_HASH = "91b68a1c3c6c80543fca1f9942a04109c5e3725c170b8f7b5911cabf97b495b0";
  const ROUTE_INFO_QUERY_HASH = "3d69fb2c48ed0866eccf11d1192c2b2473be243f584d15fc34e83206be259e3d";
  const AUTHENTICATED_USER_QUERY = `query GetAuthenticatedUser {
  account {
    isAnonymous
    ... on RsiAuthenticatedAccount {
      avatar
      badges {
        id
        title
        __typename
      }
      badgeIcons {
        favorite {
          icon
          name
          __typename
        }
        organization {
          icon
          name
          url
          __typename
        }
        __typename
      }
      canBeReferred
      createdAt
      displayname
      hasBeenReferred
      hasGameAccess
      hasGamePackage
      hasReferred
      id
      nickname
      profileUrl
      referral_code
      referrerReferralCode
      roles {
        name
        __typename
      }
      status
      probationMessage
      probationUntil
      tmid
      updatedAt
      username
      __typename
    }
    __typename
  }
}`;
  const REFERRAL_PAGE_SIZE = 100;
  // The settings (shared/request-pacing-settings.js) load before this file.
  const REQUEST_TIMEOUT_MS = root.CITIZENDATA_REQUEST_PACING.accountBuild.requestTimeoutMs;
  // No wait inside a step is longer than this; a longer gap becomes a durable request slot (§6.3).
  const MAXIMUM_IN_STEP_WAIT_MS = root.CITIZENDATA_REQUEST_PACING.brakes.maximumInStepWaitMs;
  const OFFSCREEN_PATH = "offscreen/parser.html";
  const HTML_CACHE_TTL_MS = 10 * 60 * 1000;
  const htmlCache = new Map();
  let creatingOffscreen = null;
  let identifiedAccountId = null;
  let activeRequestActivities = null;
  let activeRequestActivityListener = null;
  let activeSourceUrls = null;
  // The answers of the step in progress, kept unread for the evidence of a changed contract (§5.7).
  let activeEvidence = null;
  // The step's journal while it runs in durable request slots (§6.3): the answers of its earlier slots, served again
  // without a request, and every answer of this slot, for the runner to keep until the step ends. Null otherwise.
  let activeJournal = null;
  // The headers a served answer needs; no other header value is kept.
  const JOURNAL_HEADERS = Object.freeze(["content-type", "content-length", "retry-after"]);

  // Where a step stops: its next request is due later than an in-step wait may last.
  class PhaseBoundary extends Error {
    constructor(phase, nextRequestAtMs) {
      super("RSI_STEP_PHASE_BOUNDARY");
      this.name = "PhaseBoundary";
      this.phase = phase;
      this.nextRequestAtMs = nextRequestAtMs;
    }
  }

  // A request's identity within one step: its method, its address and its body.
  function journalKey(url, options) {
    return `${String(options?.method ?? "GET").toUpperCase()} ${url} ${typeof options?.body === "string" ? options.body : ""}`;
  }

  // A kept answer, served as the response it was: its status, final address, the headers above and its text.
  function journalResponse(entry) {
    return {
      ok: entry.status >= 200 && entry.status < 300,
      status: entry.status,
      url: entry.url,
      headers: { get: (name) => Object.hasOwn(entry.headers, String(name).toLowerCase()) ? entry.headers[String(name).toLowerCase()] : null },
      async text() { return entry.text; },
      async json() { return JSON.parse(entry.text); },
      clone() { return journalResponse(entry); }
    };
  }

  // The kept answer of this request from an earlier slot, once; or null when it has not been answered yet.
  function takeJournaled(key) {
    const index = activeJournal.served.findIndex((entry) => entry.key === key);
    if (index < 0) return null;
    const [entry] = activeJournal.served.splice(index, 1);
    return entry;
  }
  const EVIDENCE_BYTES = 2 * 1024 * 1024;
  const EVIDENCE_NAME = /^[A-Za-z0-9_.$@-]{1,80}$/u;

  // An answer kept for evidence: an unread copy of its body, and what the request and answer show of its shape.
  function keepEvidence(response, meta, requestBody = null) {
    if (!activeEvidence) return null;
    const operations = (Array.isArray(requestBody) ? requestBody : [requestBody]).map((question) => question?.operationName).filter((name) => typeof name === "string" && EVIDENCE_NAME.test(name));
    let copy;
    try {
      copy = typeof response.clone === "function" ? response.clone() : null;
    } catch {
      copy = null;
    }
    const entry = { meta, copy, contentType: response.headers.get("content-type"), contentLength: response.headers.get("content-length"), finalUrl: response.url || null, operationNames: [...new Set(operations)].slice(0, 32), topLevelKeys: [] };
    activeEvidence.push(entry);
    return entry;
  }

  // The names of an answer's top level: an object's keys, or the keys of a GraphQL list's answers.
  function topLevelKeysOf(value) {
    const objects = Array.isArray(value) ? value : [value];
    const keys = objects.flatMap((item) => item !== null && typeof item === "object" && !Array.isArray(item) ? Object.keys(item) : []);
    return [...new Set(keys)].filter((key) => EVIDENCE_NAME.test(key)).slice(0, 32);
  }

  // At most 2 MiB of a kept body, read from its copy: the bytes, or none when the body is longer.
  async function evidenceBytes(copy) {
    if (!copy) return { bytes: null, truncated: false };
    if (copy.body && typeof copy.body.getReader === "function") {
      const reader = copy.body.getReader();
      const chunks = [];
      let total = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > EVIDENCE_BYTES) {
          await reader.cancel();
          return { bytes: null, truncated: true };
        }
        chunks.push(value);
      }
      const bytes = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return { bytes, truncated: false };
    }
    const bytes = typeof copy.arrayBuffer === "function" ? new Uint8Array(await copy.arrayBuffer()) : typeof copy.text === "function" ? new TextEncoder().encode(await copy.text()) : null;
    if (!bytes) return { bytes: null, truncated: false };
    return bytes.byteLength > EVIDENCE_BYTES ? { bytes: null, truncated: true } : { bytes, truncated: false };
  }

  async function sha256OfBytes(bytes) {
    const digest = await root.crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  // JSON with object keys sorted, for the finding's key.
  function canonicalJson(value) {
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
    if (value !== null && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
    return JSON.stringify(value);
  }

  // The privacy-safe finding of a changed contract (§5.7): what was asked, what came back and its shape, and a hash
  // of at most 2 MiB of its bytes. No body, header value, cookie or account value enters it.
  async function contractFinding(signal, section) {
    const kept = activeEvidence ?? [];
    const entry = [...kept].reverse().find((candidate) => candidate.meta.route === signal.route && (signal.page === null || candidate.meta.page === signal.page)) ?? kept.at(-1) ?? null;
    const { bytes, truncated } = await evidenceBytes(entry?.copy ?? null);
    // The answer's own length only when it is a whole number of digits: a missing header is not a length of 0.
    const declaredLength = typeof entry?.contentLength === "string" && /^\d{1,16}$/u.test(entry.contentLength) ? Number(entry.contentLength) : null;
    const byteLength = Number.isSafeInteger(declaredLength) ? declaredLength : bytes ? bytes.byteLength : null;
    // Same-origin path and query only: no credentials, fragment or other origin.
    let finalRoute = null;
    const answered = typeof entry?.finalUrl === "string" && URL.canParse(entry.finalUrl) ? new URL(entry.finalUrl) : null;
    if (answered?.origin === RSI_ORIGIN) finalRoute = `${answered.pathname}${answered.search}`.slice(0, 400);
    const contentType = typeof entry?.contentType === "string" ? entry.contentType.slice(0, 120) : null;
    const fields = {
      section,
      code: signal.code,
      method: entry?.meta.method ?? signal.method ?? "GET",
      route: entry?.meta.route ?? signal.route ?? "/",
      page: entry?.meta.page ?? signal.page ?? null,
      httpStatus: entry?.meta.httpStatus ?? signal.httpStatus ?? null,
      contentType,
      byteLength,
      bodySha256: bytes ? await sha256OfBytes(bytes) : null,
      bodyTruncated: truncated,
      finalRoute,
      pageMarkers: {},
      topLevelKeys: entry?.topLevelKeys ?? [],
      operationNames: entry?.operationNames ?? []
    };
    const keyed = [fields.section, fields.code, fields.method, fields.route, fields.page, fields.httpStatus, fields.contentType, fields.byteLength, fields.bodySha256, fields.bodyTruncated, fields.finalRoute, fields.pageMarkers, fields.topLevelKeys, fields.operationNames];
    return {
      findingKey: await sha256OfBytes(new TextEncoder().encode(canonicalJson(keyed))),
      ...fields,
      observedAt: new Date().toISOString(),
      sourceUrls: Array.from(new Set(activeSourceUrls ?? [])).sort()
    };
  }

  async function withRsiToken(operation) {
    const cookie = await chrome.cookies.get({ url: `${RSI_ORIGIN}/`, name: "Rsi-Token" });
    const rsiToken = typeof cookie?.value === "string" && cookie.value ? cookie.value : null;
    if (!rsiToken) throw new RsiReadError({ kind: "user", code: "RSI_SIGNED_OUT", reason: "signed-out" }, { message: "Sign in to RSI, then click Build JSON again." });
    return await operation(rsiToken);
  }

  // An answer of a changed shape: RSI answered in full, and the content is not what the parser reads (§5.2 row 23).
  function contractError(code, request = null, detail = {}) {
    return new RsiReadError({ kind: "contract", code, ...(request ?? {}), ...detail });
  }

  // The request fields a signal names: method, route and page.
  function requestFields(meta) {
    return meta ? { method: meta.method, route: meta.route, page: meta.page } : {};
  }

  function recordSourceUrl(candidate) {
    if (!activeSourceUrls) return;
    const url = new URL(candidate);
    url.hash = "";
    if (url.protocol === "https:" && !url.username && !url.password) activeSourceUrls.push(url.href);
  }

  // One request to RSI, given up after the settings' timeout. It returns the answer with the request's fields, the
  // time it took and RSI's Retry-After; a time-out or a network failure is logged and raised as an RsiReadError.
  async function fetchWithTimeout(url, options) {
    const requestedUrl = new URL(url);
    let requestBody;
    try { requestBody = typeof options?.body === "string" ? JSON.parse(options.body) : null; } catch { requestBody = null; }
    const graphqlPage = Array.isArray(requestBody) ? requestBody[0]?.variables?.page : null;
    const page = Number(requestedUrl.searchParams.get("page") ?? requestBody?.page ?? graphqlPage);
    const requestIdentity = {
      method: String(options?.method ?? "GET").toUpperCase(),
      route: requestedUrl.pathname,
      page: Number.isSafeInteger(page) && page > 0 ? page : null,
      pageCount: null
    };
    // An answer an earlier slot of this step received is served again: no request, no request line.
    const key = activeJournal ? journalKey(url, options) : null;
    const journaled = key ? takeJournaled(key) : null;
    if (journaled) {
      recordSourceUrl(new URL(journaled.url || url).href);
      return { response: journalResponse(journaled), meta: { ...journaled.meta } };
    }
    // The runner awaits each request's start before it is sent; a cancelled job sends nothing further.
    if (activeRequestActivityListener) await activeRequestActivityListener({ kind: "request-started", ...requestIdentity, at: new Date().toISOString() });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const startedAt = Date.now();
    if (activeJournal) activeJournal.lastStartMs = Math.max(activeJournal.lastStartMs ?? 0, startedAt);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      const parsedUrl = new URL(response.url || url);
      recordSourceUrl(parsedUrl.href);
      const elapsedMs = Math.max(0, Date.now() - startedAt);
      const retryAfterMs = Answers.parseRetryAfter(response.headers.get("retry-after"), Date.now());
      // Every answer is kept for the step's later slots, so none is asked for twice: an answer that ends the step drops
      // the journal with it, and one the step goes on past, like a refused CCU call, is served again from here.
      if (activeJournal && typeof response.clone === "function") {
        const headers = Object.fromEntries(JOURNAL_HEADERS.map((name) => [name, response.headers.get(name)]).filter(([, value]) => typeof value === "string"));
        activeJournal.recorded.push({ key, status: response.status, url: response.url || url, headers, text: await response.clone().text(), startedAtMs: startedAt, meta: { ...requestIdentity, elapsedMs, retryAfterMs, httpStatus: response.status } });
      }
      if (activeRequestActivities) {
        activeRequestActivities.push({
          kind: "request-completed",
          ...requestIdentity,
          responseStatus: response.status,
          recordsReceived: null,
          recordsTotal: null,
          retryAfterMs,
          elapsedMs,
          at: new Date().toISOString()
        });
      }
      return { response, meta: { ...requestIdentity, elapsedMs, retryAfterMs, httpStatus: response.status } };
    } catch (error) {
      const timedOut = error?.name === "AbortError";
      if (!timedOut && error?.name !== "TypeError") throw error;
      const elapsedMs = Math.max(0, Date.now() - startedAt);
      if (activeRequestActivities) {
        activeRequestActivities.push({ kind: "request-failed", method: requestIdentity.method, route: requestIdentity.route, page: requestIdentity.page, error: timedOut ? "TIMEOUT" : "NETWORK", elapsedMs, at: new Date().toISOString() });
      }
      // A time-out passes; a TypeError is a network failure, a refused redirect of a JSON call, or CORS after a
      // redirect off RSI, so it is unclear (§5.2 rows 15 and 16).
      throw new RsiReadError({
        kind: timedOut ? "transient" : "ambiguous",
        code: timedOut ? "RSI_REQUEST_TIMEOUT" : "RSI_NETWORK_OR_REDIRECT",
        ...requestFields(requestIdentity),
        elapsedMs
      }, { cause: error });
    } finally {
      clearTimeout(timeout);
    }
  }

  // An answer that is not 2xx, raised with its class (§5.2 rows 2 to 6, 9 and 10).
  function statusError(code, meta, fixedAddress) {
    const kind = Answers.classifyStatus({ status: meta.httpStatus, fixedAddress });
    return new RsiReadError({
      kind: kind === "ok" ? "ambiguous" : kind,
      code,
      httpStatus: meta.httpStatus,
      retryAfterMs: meta.retryAfterMs,
      reason: kind === "user" ? "signed-out" : null,
      ...requestFields(meta),
      elapsedMs: meta.elapsedMs
    });
  }

  function annotateActivity(route, page, detail) {
    if (!activeRequestActivities) return;
    const activity = [...activeRequestActivities].reverse().find((entry) => entry.route === route && (page === null || entry.page === page));
    if (activity) Object.assign(activity, detail);
  }

  // The pages of one step: one, or two when the section has two lanes and a second page is known to exist.
  function pageBatch(input, knownPageCount = null) {
    const page = Number.isSafeInteger(input.cursor?.page) ? input.cursor.page : 1;
    const lanes = Number.isSafeInteger(input.lanes) && input.lanes > 0 ? input.lanes : 2;
    if (lanes < 2 || !Number.isSafeInteger(knownPageCount) || page >= knownPageCount) return [page];
    return [page, page + 1];
  }

  // The gap before a step's next request: the stagger after the previous start. A gap no longer than an in-step wait
  // may last is waited here, as it always was. A longer one is a durable request slot (§6.3): when the time has not
  // come yet, the step stops at it, named by `phase`, the request it comes before.
  async function waitForConcurrentLane(input, index, phase = "second-lane") {
    if (index === 0) return;
    const delayMs = Number.isSafeInteger(input?.concurrentRequestStaggerMs) && input.concurrentRequestStaggerMs >= 0
      ? input.concurrentRequestStaggerMs
      : 0;
    if (delayMs <= 0) return;
    if (!activeJournal || delayMs <= MAXIMUM_IN_STEP_WAIT_MS) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return;
    }
    const dueAtMs = (activeJournal.lastStartMs ?? Date.now()) + delayMs;
    const remainingMs = dueAtMs - Date.now();
    if (remainingMs <= 0) return;
    if (remainingMs <= MAXIMUM_IN_STEP_WAIT_MS) {
      await new Promise((resolve) => setTimeout(resolve, remainingMs));
      return;
    }
    throw new PhaseBoundary(phase, dueAtMs);
  }

  // Runs the requests of one step side by side, the second a moment after the first. When one fails, a request that
  // has not been sent yet is not sent: a step that failed asks RSI for nothing more. When a later lane is a durable
  // slot, the lanes already sent finish first, so their answers are kept.
  async function runLanes(input, items, lane, phase = "second-lane") {
    let failed = false;
    const runs = items.map(async (item, index) => {
      await waitForConcurrentLane(input, index, phase);
      if (failed) throw new Error("RSI_STEP_ABANDONED");
      try {
        return await lane(item, index);
      } catch (error) {
        failed = true;
        throw error;
      }
    });
    try {
      return await Promise.all(runs);
    } catch (error) {
      if (!(error instanceof PhaseBoundary)) throw error;
      const outcomes = await Promise.allSettled(runs);
      const other = outcomes.find((outcome) => outcome.status === "rejected" && !(outcome.reason instanceof PhaseBoundary));
      throw other ? other.reason : error;
    }
  }

  function requestProgress(completed, total, subphase = null) {
    return {
      completed,
      total: Number.isSafeInteger(total) && total > 0 ? total : null,
      totalKnown: Number.isSafeInteger(total) && total > 0,
      subphase
    };
  }

  function previousValue(input, resultSection) {
    return input?.mode === "update" && input.previousSection?.current === true ? input.previousSection.values?.[resultSection] : null;
  }

  function reusePrevious(input, requestProgressValue, warnings = []) {
    return {
      raw: null,
      done: true,
      complete: true,
      pagesOrBatches: 1,
      warnings,
      requestProgress: requestProgressValue,
      reusePrevious: true,
      previousRecordCount: input.previousSection.recordCount,
      changeState: "unchanged"
    };
  }

  function approvedPostUrl(path) {
    const url = new URL(path, RSI_ORIGIN);
    if (url.origin !== RSI_ORIGIN || !TOKEN_POST_PATHS.has(url.pathname)) return null;
    return url.search ? null : url;
  }

  async function postJson(path, body, errorPrefix = "RSI_API") {
    const approvedUrl = approvedPostUrl(path);
    if (!approvedUrl) throw new Error(`${errorPrefix}_ROUTE_NOT_ALLOWED`);
    const requestBody = JSON.stringify(body);
    // A request an earlier slot of this step already sent is answered from the journal, so the transient RSI token is
    // read only for a request that is due (§6.3).
    const kept = activeJournal?.served.some((entry) => entry.key === journalKey(approvedUrl.href, { method: "POST", body: requestBody })) === true;
    const send = async (rsiToken) => {
      const { response, meta } = await fetchWithTimeout(approvedUrl.href, {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        redirect: "error",
        referrerPolicy: "no-referrer",
        headers: {
          "Accept": "application/json",
          "Accept-Language": "en-US,en;q=0.9",
          "Content-Type": "application/json",
          ...(rsiToken === null ? {} : { "X-Rsi-Token": rsiToken })
        },
        body: requestBody
      });
      // Every POST route is a fixed address.
      if (!response.ok) throw statusError(`${errorPrefix}_HTTP_${response.status}`, meta, true);
      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.includes("application/json")) throw new RsiReadError({ kind: "ambiguous", code: `${errorPrefix}_CONTENT_TYPE_CHANGED`, httpStatus: meta.httpStatus, ...requestFields(meta), elapsedMs: meta.elapsedMs });
      lastPostMeta = meta;
      const evidence = keepEvidence(response, meta, body);
      const parsed = await response.json();
      if (evidence) evidence.topLevelKeys = topLevelKeysOf(parsed);
      return parsed;
    };
    return kept ? await send(null) : await withRsiToken(send);
  }

  // The request fields of the last JSON answer, for the refusals its caller finds in the body.
  let lastPostMeta = null;

  function approvedHtmlPath(path) {
    const url = new URL(path, RSI_ORIGIN);
    if (url.origin !== RSI_ORIGIN) return false;
    if (/^\/en\/citizens\/[A-Za-z0-9_-]+(?:\/organizations)?\/?$/u.test(url.pathname) && !url.search) return true;
    if (url.pathname === "/account/pledges") {
      const page = Number(url.searchParams.get("page") ?? "1");
      return Number.isSafeInteger(page) && page >= 1 && [...url.searchParams.keys()].every((key) => ["page", "product-type"].includes(key));
    }
    // One buy-back's own page. It is only ever read; the buy-back itself is never started.
    if (/^\/pledge\/buyback\/[1-9][0-9]{0,15}$/u.test(url.pathname) && !url.search) return true;
    if (url.pathname === "/account/billing") {
      const page = Number(url.searchParams.get("page") ?? "1");
      const pageSize = Number(url.searchParams.get("pagesize") ?? "100");
      return Number.isSafeInteger(page) && page >= 1 && pageSize === 100 && [...url.searchParams.keys()].every((key) => ["page", "pagesize"].includes(key));
    }
    return false;
  }

  function assertSignedInHtml(html, finalUrl, meta = null) {
    const signedOut = () => new RsiReadError({ kind: "user", code: "RSI_SESSION_NOT_AUTHENTICATED", reason: "signed-out", ...requestFields(meta), httpStatus: meta?.httpStatus ?? null });
    const normalized = String(html).replace(/\s+/gu, " ");
    if (/Restricted Area/iu.test(normalized) && /Authorized Personnel Only/iu.test(normalized) && /must be authenticated to reach this area/iu.test(normalized)) {
      throw signedOut();
    }
    const path = new URL(finalUrl).pathname;
    if (/\/(?:connect|auth|login)(?:\/|$)/iu.test(path)) throw signedOut();
  }

  // The addresses that cannot be gone: a 403 or 404 there is unclear until the canary has spoken (§5.2 rows 5, 6).
  function isFixedHtmlPath(pathname) {
    return /^\/en\/citizens\/[A-Za-z0-9_-]+(?:\/organizations)?\/?$/u.test(pathname) || pathname === "/account/pledges" || pathname === "/account/billing";
  }

  // A browser check page of Google's, which RSI's front end can send instead of the page asked for (§5.2 row 13).
  function isBrowserCheck(url) {
    return (url.hostname === "www.google.com" || url.hostname === "www.recaptcha.net") && url.pathname.startsWith("/recaptcha/");
  }

  // `cache: false` is for pages read once and never again in a run. A status listed in `unavailableStatuses` is
  // answered as a page without markup instead of failing the run. `credentials: "omit"` sends no cookie, and then
  // the cache is neither read nor written: it holds the signed-in copy of the same address.
  async function getHtml(path, { cache = true, unavailableStatuses = [], credentials = "include" } = {}) {
    if (!approvedHtmlPath(path)) throw new Error("RSI_HTML_ROUTE_NOT_ALLOWED");
    const url = new URL(path, RSI_ORIGIN).href;
    const useCache = cache && credentials !== "omit";
    recordSourceUrl(url);
    const cached = useCache ? htmlCache.get(url) : null;
    if (cached && Date.now() - cached.cachedAt < HTML_CACHE_TTL_MS) {
      recordSourceUrl(cached.finalUrl);
      return cached;
    }
    const { response, meta } = await fetchWithTimeout(url, {
      method: "GET",
      credentials,
      cache: "no-store",
      redirect: "follow",
      referrerPolicy: "no-referrer",
      headers: { "Accept": "text/html,application/xhtml+xml", "Accept-Language": "en-US,en;q=0.9" }
    });
    if (unavailableStatuses.includes(response.status)) return Object.freeze({ html: null, finalUrl: response.url || url, status: response.status, meta });
    if (!response.ok) throw statusError(`RSI_HTML_HTTP_${response.status}`, meta, isFixedHtmlPath(new URL(url).pathname));
    const answered = new URL(response.url || url);
    if (isBrowserCheck(answered)) throw new RsiReadError({ kind: "user", code: "RSI_CHECK_IN_BROWSER", reason: "check-in-browser", httpStatus: meta.httpStatus, ...requestFields(meta), elapsedMs: meta.elapsedMs });
    if (answered.origin !== RSI_ORIGIN) throw new RsiReadError({ kind: "ambiguous", code: "RSI_HTML_REDIRECTED_OFF_ORIGIN", httpStatus: meta.httpStatus, ...requestFields(meta), elapsedMs: meta.elapsedMs });
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html")) throw new RsiReadError({ kind: "ambiguous", code: "RSI_HTML_CONTENT_TYPE_CHANGED", httpStatus: meta.httpStatus, ...requestFields(meta), elapsedMs: meta.elapsedMs });
    keepEvidence(response, meta);
    const html = await response.text();
    assertSignedInHtml(html, response.url || url, meta);
    const value = Object.freeze({ html, finalUrl: response.url || url, cachedAt: Date.now(), status: response.status, meta });
    if (useCache) htmlCache.set(url, value);
    return value;
  }

  // Page identity (§5.3): the page RSI sent is the page asked for, or the read stops as row 22, before any value of
  // the page is used; the page is dropped from the cache.
  function assertPageRecognized(parsed, page, path) {
    if (parsed?.pageRecognized === true) return;
    htmlCache.delete(new URL(path, RSI_ORIGIN).href);
    throw new RsiReadError({ kind: "ambiguous", code: "RSI_PAGE_NOT_RECOGNIZED", rsiMessage: Answers.bounded(parsed?.pageTitle, 160), httpStatus: page.meta?.httpStatus ?? null, ...requestFields(page.meta), elapsedMs: page.meta?.elapsedMs ?? null });
  }

  async function ensureOffscreenParser() {
    if (await chrome.offscreen.hasDocument()) return;
    if (!creatingOffscreen) {
      creatingOffscreen = chrome.offscreen.createDocument({
        url: OFFSCREEN_PATH,
        reasons: ["DOM_PARSER"],
        justification: "Parse inert RSI account markup returned by fixed read-only endpoints."
      }).finally(() => { creatingOffscreen = null; });
    }
    await creatingOffscreen;
  }

  async function parseMarkup(fragmentType, html, context = {}) {
    await ensureOffscreenParser();
    const response = await chrome.runtime.sendMessage({
      kind: "CITIZENDATA_PARSE_RSI_MARKUP",
      fragmentType,
      html,
      context
    });
    if (!response?.ok || !Object.hasOwn(response, "raw")) throw new Error(response?.message ?? "RSI_MARKUP_PARSE_FAILED");
    return response;
  }

  // An RSI JSON answer whose `success` is not true or 1, raised with RSI's code and message (§5.2 rows 18 and 19).
  function refusalError(response, contractName, meta = lastPostMeta) {
    const refusal = Answers.classifyJsonRefusal(response);
    const safeCode = refusal.rsiCode ? refusal.rsiCode.toUpperCase() : "UNSUCCESSFUL";
    return new RsiReadError({ kind: refusal.kind, code: `${contractName}_RESPONSE_REJECTED_${safeCode}`, rsiCode: refusal.rsiCode, rsiMessage: refusal.rsiMessage, httpStatus: meta?.httpStatus ?? null, ...requestFields(meta), elapsedMs: meta?.elapsedMs ?? null });
  }

  // `allowEmpty`, for the ledgers only (§13.2): RSI answers page 1 of an empty ledger with a page count of 0. That one
  // shape is read as one page; the collector then requires it to hold no row.
  function assertPagedFragment(response, page, contractName, { property = "rendered", allowEmpty = false } = {}) {
    const meta = lastPostMeta;
    if (![true, 1].includes(response?.success)) throw refusalError(response, contractName, meta);
    const data = response?.data;
    const observedPage = Number(data?.page);
    const pageCount = Number(data?.pagecount);
    if (allowEmpty && page === 1 && observedPage === 1 && pageCount === 0 && typeof data?.rendered === "string") return { ...data, page: 1, pagecount: 1 };
    if (!data) throw contractError(`${contractName}_MISSING_DATA`, requestFields(meta));
    if (observedPage !== page) throw contractError(`${contractName}_PAGE_MISMATCH_REQUESTED_${page}_OBSERVED_${Number.isSafeInteger(observedPage) ? observedPage : "UNKNOWN"}`, requestFields(meta));
    if (!Number.isSafeInteger(pageCount) || pageCount < page) throw contractError(`${contractName}_PAGE_COUNT_INVALID`, requestFields(meta));
    if (typeof data[property] !== "string") throw contractError(`${contractName}_${property.toUpperCase()}_MISSING`, requestFields(meta));
    return { ...data, page: observedPage, pagecount: pageCount };
  }

  // One GraphQL answer of an operation, classified (§5.7). A limit's words refuse the step; an error beside the
  // operation's required data is kept as anomaly rows; an error without that data is unclear.
  function graphqlAnswer(answer, operation, anomalyRows, accountId = null) {
    const classified = Answers.classifyGraphqlEnvelope(answer, { name: operation, accountId });
    const meta = lastPostMeta;
    if (classified.kind === "limit" || classified.kind === "ambiguous") {
      const first = classified.errors[0] ?? {};
      throw new RsiReadError({ kind: classified.kind, code: "RSI_GRAPHQL_REJECTED", rsiCode: first.code ?? null, rsiMessage: first.message ?? null, httpStatus: meta?.httpStatus ?? null, ...requestFields(meta), elapsedMs: meta?.elapsedMs ?? null });
    }
    for (const row of classified.anomalyRows) anomalyRows.push(row);
    return answer;
  }

  async function identifyAccount() {
    const response = await postJson(IDENTIFY_PATH, {});
    if (![true, 1].includes(response?.success)) throw refusalError(response, "RSI_IDENTIFY");
    const member = response?.data?.member;
    const accountId = typeof member?.nickname === "string" ? member.nickname.trim() : "";
    if (!accountId || !/^[A-Za-z0-9_-]+$/u.test(accountId)) {
      throw new RsiReadError({ kind: "ambiguous", code: "RSI_IDENTIFY_HANDLE_MISSING", ...requestFields(lastPostMeta) }, { message: "The signed-in RSI account did not expose its dossier handle." });
    }
    if (identifiedAccountId !== accountId) {
      identifiedAccountId = accountId;
      htmlCache.clear();
    }
    return Object.freeze({
      accountId,
      memberId: Number.isSafeInteger(Number(member.id)) ? Number(member.id) : null,
      displayName: typeof member.displayname === "string" ? member.displayname : null,
      avatar: typeof member.avatar === "string" ? member.avatar : null
    });
  }

  async function collectProfile(input) {
    const handle = encodeURIComponent(input.accountId);
    const page = await getHtml(`/en/citizens/${handle}`);
    const parsed = await parseMarkup("profile", page.html, { baseUrl: page.finalUrl });
    assertPageRecognized(parsed, page, `/en/citizens/${handle}`);
    if (!parsed.raw?.handle || parsed.raw.handle.toLowerCase() !== input.accountId.toLowerCase()) throw contractError("RSI_PUBLIC_DOSSIER_IDENTITY_MISMATCH", requestFields(page.meta));
    const anomalyRows = [];
    const [authenticatedEnvelope, dashboardEnvelope] = await runLanes(input, [0, 1], (lane) => lane === 0
      ? postJson(GRAPHQL_PATH, [{ operationName: "GetAuthenticatedUser", variables: {}, query: AUTHENTICATED_USER_QUERY }])
      : postJson(GRAPHQL_PATH, [
        {
          operationName: "getRouteInfo",
          variables: { route: "/account/dashboard", lang: "en" },
          extensions: { persistedQuery: { version: 1, sha256Hash: ROUTE_INFO_QUERY_HASH } }
        },
        {
          operationName: "GetAccountDashboardData",
          variables: {},
          extensions: { persistedQuery: { version: 1, sha256Hash: ACCOUNT_DASHBOARD_QUERY_HASH } }
        }
      ]), "dashboard-badges");
    // getRouteInfo's errors never discard the dashboard account; they are kept beside it. A limit's words still refuse.
    if (Array.isArray(dashboardEnvelope) && Answers.classifyGraphqlErrors(dashboardEnvelope[0]?.errors) === "limit") graphqlAnswer(dashboardEnvelope[0], "getRouteInfo", [], input.accountId);
    const authenticatedAnswer = Array.isArray(authenticatedEnvelope) ? graphqlAnswer(authenticatedEnvelope[0], "GetAuthenticatedUser", anomalyRows, input.accountId) : null;
    const dashboardAnswer = Array.isArray(dashboardEnvelope) ? graphqlAnswer(dashboardEnvelope[1], "GetAccountDashboardData", anomalyRows, input.accountId) : null;
    if (Array.isArray(dashboardEnvelope?.[0]?.errors)) {
      for (const error of dashboardEnvelope[0].errors) {
        anomalyRows.push({ issueCode: "GRAPHQL_PARTIAL_ERROR", message: `RSI answered getRouteInfo with an error beside the dashboard account: ${Answers.bounded(error?.message, 100) ?? "no message"}`, raw: { operation: "getRouteInfo", message: Answers.bounded(error?.message, Answers.MESSAGE_LENGTH), code: Answers.rsiCodeOf(error?.extensions?.code) } });
      }
    }
    const authenticated = authenticatedAnswer?.data?.account ?? null;
    const dashboard = dashboardAnswer?.data?.accountDashboard?.account ?? null;
    if (authenticated?.isAnonymous !== false || typeof authenticated.nickname !== "string"
      || authenticated.nickname.toLowerCase() !== input.accountId.toLowerCase() || !Array.isArray(authenticated.badges)) {
      throw contractError("RSI_AUTHENTICATED_BADGES_CONTRACT_CHANGED");
    }
    if (!dashboard || !Array.isArray(dashboard.featuredBadges)) throw contractError("RSI_DASHBOARD_BADGES_CONTRACT_CHANGED");
    recordSourceUrl(`${RSI_ORIGIN}/account/dashboard`);
    if (typeof authenticated.profileUrl === "string" && authenticated.profileUrl) recordSourceUrl(new URL(authenticated.profileUrl, RSI_ORIGIN).href);

    const trustedResourceUrl = (candidate) => {
      if (typeof candidate !== "string" || !candidate) return null;
      const url = new URL(candidate, RSI_ORIGIN);
      if (url.protocol !== "https:" || url.username || url.password
        || !(url.hostname === "robertsspaceindustries.com" || url.hostname.endsWith(".robertsspaceindustries.com"))) return null;
      return url.href;
    };
    const rawBadgeImage = (candidate, title, role = "badge") => {
      const url = trustedResourceUrl(candidate);
      return url ? { url, role, altText: typeof title === "string" ? title : null, width: null, height: null } : null;
    };
    const favorite = authenticated.badgeIcons?.favorite;
    const favoriteImage = rawBadgeImage(favorite?.icon, favorite?.name, "badge-favorite");
    const featuredBadges = dashboard.featuredBadges.map((entry) => {
      const title = typeof entry?.image?.title === "string" ? entry.image.title : typeof entry?.image?.alt === "string" ? entry.image.alt : null;
      const image = rawBadgeImage(entry?.image?.src, title, "badge-featured");
      const href = trustedResourceUrl(entry?.href);
      return {
        title,
        images: image ? [image] : [],
        relatedUrls: href ? [href] : []
      };
    });
    const imagesByTitle = new Map();
    const addTitleImage = (title, image) => {
      if (typeof title !== "string" || !title || !image) return;
      const images = imagesByTitle.get(title) ?? [];
      if (!images.some((entry) => entry.url === image.url)) images.push(image);
      imagesByTitle.set(title, images);
    };
    addTitleImage(favorite?.name, favoriteImage);
    for (const entry of featuredBadges) for (const image of entry.images) addTitleImage(entry.title, image);
    // A malformed badge row is left out and kept as anomaly evidence; the other badges continue (§5.7).
    const unlockedBadges = authenticated.badges.flatMap((badge, sourceIndex) => {
      const id = badge?.id ?? null;
      const title = badge?.title ?? null;
      if (!(id === null || Number.isSafeInteger(id)) || !(title === null || typeof title === "string" && title.length > 0)
        || (id === null) !== (title === null)) {
        anomalyRows.push({ recordIndex: sourceIndex + 1, pageOrBatch: 1, keySuffix: `badge.${sourceIndex}`, issueCode: "RSI_AUTHENTICATED_BADGE_ROW_CONTRACT_CHANGED", message: `Unlocked badge row ${sourceIndex + 1} did not have the shape Star Citizen Data Downloader reads and was retained for review.`, raw: badge === undefined ? null : badge, retainedInNormalizedData: false });
        return [];
      }
      return [{ sourceIndex, id, title, images: title === null ? [] : [...(imagesByTitle.get(title) ?? [])] }];
    });
    const selectedBadge = typeof favorite?.name === "string" && favorite.name
      ? { title: favorite.name, images: favoriteImage ? [favoriteImage] : [] }
      : null;
    const profileRelatedUrls = new Set([
      ...(Array.isArray(parsed.raw.relatedUrls) ? parsed.raw.relatedUrls : []),
      page.finalUrl,
      `${RSI_ORIGIN}/account/dashboard`,
      `${RSI_ORIGIN}${GRAPHQL_PATH}`
    ]);
    const authenticatedProfileUrl = trustedResourceUrl(authenticated.profileUrl);
    if (authenticatedProfileUrl) profileRelatedUrls.add(authenticatedProfileUrl);
    annotateActivity(new URL(page.finalUrl).pathname, null, { recordsReceived: 1, recordsTotal: 1, pageCount: 1 });
    annotateActivity(GRAPHQL_PATH, null, { recordsReceived: unlockedBadges.length, recordsTotal: unlockedBadges.length, pageCount: 1 });
    return {
      raw: { ...parsed.raw, unlockedBadges, selectedBadge, featuredBadges, relatedUrls: [...profileRelatedUrls] },
      accountId: parsed.raw.handle,
      done: true,
      complete: true,
      pagesOrBatches: 3,
      warnings: anomalyRows.length ? [`${anomalyRows.length} profile source value${anomalyRows.length === 1 ? "" : "s"} did not have the expected shape; exact evidence was retained in dataQuality.anomalies.`] : [],
      rawAnomalies: anomalyRows.map((row, index) => ({ recordIndex: row.recordIndex ?? index + 1, pageOrBatch: row.pageOrBatch ?? 1, keySuffix: row.keySuffix ?? `graphql.${index}`, retainedInNormalizedData: false, ...row })),
      requestProgress: requestProgress(3, 3)
    };
  }

  // The Hangar Log decides whether the hangar is read. While the log holds nothing newer than the earlier build, the
  // earlier build's hangar is kept and no page is asked for. Any new log entry has the whole hangar read again.
  async function collectPledges(input) {
    if (previousValue(input, "pledges") && input.updateSignals?.hangarLog === "unchanged") {
      return reusePrevious(input, requestProgress(0, 0), ["Current Hangar was reused because the exact Hangar Log anchor was unchanged."]);
    }
    const knownPageCount = input.cursor?.interactiveState?.pageCount;
    const pages = pageBatch(input, knownPageCount);
    const results = await runLanes(input, pages, async (pageNumber) => {
      const page = await getHtml(`/account/pledges?page=${pageNumber}&product-type=`);
      const parsed = await parseMarkup("pledges", page.html, { baseUrl: page.finalUrl, page: pageNumber });
      assertPageRecognized(parsed, page, `/account/pledges?page=${pageNumber}&product-type=`);
      if (!Array.isArray(parsed.raw) || pageNumber === 1 && parsed.raw.length === 0) throw contractError("RSI_PLEDGES_CONTRACT_CHANGED", requestFields(page.meta));
      const pageCount = Number.isSafeInteger(parsed.pageCount) ? parsed.pageCount : pageNumber;
      annotateActivity("/account/pledges", pageNumber, { pageCount, recordsReceived: parsed.raw.length });
      return { raw: parsed.raw, pageCount };
    });
    const pageCount = results[0].pageCount;
    if (results.some((result) => result.pageCount !== pageCount)) throw contractError("RSI_PLEDGES_PAGE_COUNT_CHANGED");
    const lastPage = pages.at(-1);
    const done = lastPage >= pageCount;
    return { raw: results.flatMap((result) => result.raw), done, nextPage: done ? null : lastPage + 1, interactiveState: done ? null : { pageCount }, complete: done, pagesOrBatches: lastPage, warnings: done ? [] : [`Pledge pages through ${lastPage} of ${pageCount} collected.`], requestProgress: requestProgress(lastPage, pageCount), changeState: "changed" };
  }

  async function collectHangarLog(input) {
    const knownPageCount = input.cursor?.interactiveState?.pageCount;
    const pages = pageBatch(input, knownPageCount);
    const results = await runLanes(input, pages, async (page) => {
      const data = assertPagedFragment(await postJson(HANGAR_LOG_PATH, { page }), page, "RSI_HANGAR_LOG");
      const parsed = await parseMarkup("hangarLog", data.rendered, { baseUrl: `${RSI_ORIGIN}${HANGAR_LOG_PATH}` });
      annotateActivity(HANGAR_LOG_PATH, page, { pageCount: data.pagecount, recordsReceived: parsed.raw.length });
      return { raw: parsed.raw, pageCount: data.pagecount };
    });
    const pageCount = results[0].pageCount;
    if (results.some((result) => result.pageCount !== pageCount)) throw contractError("RSI_HANGAR_LOG_PAGE_COUNT_CHANGED");
    const lastPage = pages.at(-1);
    const pageRaw = results.flatMap((result) => result.raw);
    const prior = previousValue(input, "hangarLog");
    const accumulated = [...(Array.isArray(input.cursor?.raw) ? input.cursor.raw : []), ...pageRaw];
    if (Array.isArray(prior) && prior.length > 0) {
      const anchor = Delta.findAnchor(accumulated, prior, Delta.hangarRecord);
      if (anchor === 0) return { ...reusePrevious(input, requestProgress(lastPage, pageCount), ["Hangar Log matched the prior exact anchor window."]), pagesOrBatches: lastPage };
      if (anchor > 0) {
        return {
          raw: [...accumulated.slice(0, anchor), ...prior.map(Delta.hangarAsRaw)],
          snapshot: true,
          done: true,
          complete: true,
          pagesOrBatches: lastPage,
          warnings: [`Hangar Log merged ${anchor} new entr${anchor === 1 ? "y" : "ies"} through the prior exact anchor.`],
          requestProgress: requestProgress(lastPage, pageCount),
          changeState: "changed"
        };
      }
    }
    const done = lastPage >= pageCount;
    return {
      raw: done ? accumulated : pageRaw,
      ...(done ? { snapshot: true } : {}),
      done,
      nextPage: done ? null : lastPage + 1,
      interactiveState: done ? null : { pageCount },
      complete: done,
      pagesOrBatches: lastPage,
      warnings: done ? [] : [`Hangar Log pages through ${lastPage} of ${pageCount} collected while searching for the prior exact anchor.`],
      requestProgress: requestProgress(lastPage, pageCount),
      changeState: "changed"
    };
  }

  // The buy-back list follows the Hangar Log in the same way as the hangar.
  async function collectBuybacks(input) {
    if (previousValue(input, "buybacks") && input.updateSignals?.hangarLog === "unchanged") {
      return reusePrevious(input, requestProgress(0, 0), ["Buybacks were reused because the exact Hangar Log anchor was unchanged."]);
    }
    const knownPageCount = input.cursor?.interactiveState?.pageCount;
    const pages = pageBatch(input, knownPageCount);
    const results = await runLanes(input, pages, async (page) => {
      const response = await postJson(BUYBACKS_PATH, { page, pagesize: 100 }, "RSI_BUYBACKS");
      const data = assertPagedFragment(response, page, "RSI_BUYBACKS");
      const listingUrl = `${RSI_ORIGIN}/account/buy-back-pledges?page=${page}&pagesize=100`;
      recordSourceUrl(listingUrl);
      const parsed = await parseMarkup("buybacks", data.rendered, { baseUrl: listingUrl });
      annotateActivity(BUYBACKS_PATH, page, { pageCount: data.pagecount, recordsReceived: parsed.raw.length });
      return { raw: parsed.raw, pageCount: data.pagecount };
    });
    const pageCount = results[0].pageCount;
    if (results.some((result) => result.pageCount !== pageCount)) throw contractError("RSI_BUYBACKS_PAGE_COUNT_CHANGED");
    const lastPage = pages.at(-1);
    const done = lastPage >= pageCount;
    return { raw: results.flatMap((result) => result.raw), done, nextPage: done ? null : lastPage + 1, interactiveState: done ? null : { pageCount }, complete: done, pagesOrBatches: lastPage, warnings: done ? [] : [`Buyback pages through ${lastPage} of ${pageCount} collected.`], requestProgress: requestProgress(lastPage, pageCount), changeState: "changed" };
  }

  // The listed buy-backs that have a page of their own, as one list of buy-back numbers for each item, in list
  // order. Buy-backs of the same item show the same page, so one page is read for an item, not one for a buy-back.
  function buybackPageGroups(buybacks) {
    const groups = new Map();
    for (const buyback of buybacks) {
      if (!Delta.buybackHasPage(buyback)) continue;
      const key = Delta.buybackItemKey(buyback);
      const ids = groups.get(key) ?? [];
      if (!ids.includes(buyback.buybackId)) ids.push(buyback.buybackId);
      groups.set(key, ids);
    }
    return [...groups.values()];
  }

  // The next page to read for each item that has no detail yet: its first buy-back whose page was not tried. An item
  // is settled once one of its pages was read, or once every one of its pages turned out to be unavailable.
  function pendingBuybackPages(groups, rows) {
    const tried = new Map(rows.map((row) => [row?.buybackId, row]));
    const pending = [];
    for (const ids of groups) {
      if (ids.some((id) => tried.has(id) && tried.get(id).unavailable !== true)) continue;
      const next = ids.find((id) => !tried.has(id));
      if (next !== undefined) pending.push(next);
    }
    return pending;
  }

  // Reads one buy-back page for each item, for its price and contents, two pages a step. An item whose detail an
  // earlier backup already holds, under any of its buy-backs, is not read again; the document assembler gives every
  // buy-back of the item that detail. When a page is not available, the page of the item's next buy-back is read.
  // The pages are requested with GET and nothing on them is followed.
  async function collectBuybackDetails(input) {
    const buybacks = input.sectionInputs?.buybacks;
    if (!Array.isArray(buybacks)) throw new Error("RSI_BUYBACK_DETAILS_LIST_UNAVAILABLE");
    const carried = input.previousSection?.current === true && Array.isArray(input.previousSection.values?.buybackDetails) ? input.previousSection.values.buybackDetails : null;
    const kept = new Set((carried ?? []).map((detail) => detail?.buybackId));
    const groups = buybackPageGroups(buybacks).filter((ids) => !ids.some((id) => kept.has(id)));
    const wanted = groups.flat();
    const gathered = Array.isArray(input.cursor?.raw) ? input.cursor.raw : [];
    const pending = pendingBuybackPages(groups, gathered);
    if (pending.length === 0 && gathered.length === 0 && carried) {
      return reusePrevious(input, requestProgress(0, 0), ["Every listed buy-back's item already has its captured detail; no buy-back page was read."]);
    }
    const batch = pending.slice(0, Number.isSafeInteger(input.lanes) && input.lanes > 0 ? input.lanes : 2);
    const rows = await runLanes(input, batch, async (buybackId) => {
      const path = `/pledge/buyback/${buybackId}`;
      const page = await getHtml(path, { cache: false, unavailableStatuses: [404] });
      const capturedAt = new Date().toISOString();
      if (page.html === null) return { buybackId, unavailable: true, reason: `HTTP_${page.status}`, capturedAt };
      // RSI answers at the same path, with or without a language prefix. Any other address is another page.
      const answeredPath = new URL(page.finalUrl).pathname.replace(/\/$/u, "");
      if (!new RegExp(`^/(?:[a-z]{2}/)?pledge/buyback/${buybackId}$`, "u").test(answeredPath)) return { buybackId, unavailable: true, reason: "REDIRECTED", capturedAt };
      const parsed = await parseMarkup("buybackDetail", page.html, { baseUrl: page.finalUrl });
      if (parsed.raw?.recognized !== true || !parsed.raw.title) throw contractError("RSI_BUYBACK_DETAIL_CONTRACT_CHANGED", requestFields(page.meta));
      const { recognized: _recognized, ...detail } = parsed.raw;
      annotateActivity(path, null, { recordsReceived: 1 });
      return { buybackId, ...detail, sourceUrl: `${RSI_ORIGIN}${answeredPath}`, capturedAt };
    });
    const all = [...gathered, ...rows];
    // A page that was not available can add one: the page of the same item's next buy-back.
    const remaining = pendingBuybackPages(groups, all);
    const completed = all.length;
    const total = completed + remaining.length;
    const done = remaining.length === 0;
    const warnings = [];
    if (done) {
      const read = new Set(all.filter((row) => row && row.unavailable !== true).map((row) => row.buybackId));
      // Only the pages of an item that no page could be read for leave a price uncaptured.
      const unavailable = groups.filter((ids) => !ids.some((id) => read.has(id))).reduce((count, ids) => count + ids.length, 0);
      const unpriced = all.filter((row) => row && row.unavailable !== true && !row.price).length;
      if (unavailable) warnings.push(`${unavailable} buy-back page${unavailable === 1 ? " was" : "s were"} not available; ${unavailable === 1 ? "its" : "their"} price was not captured.`);
      if (unpriced) warnings.push(`${unpriced} buy-back page${unpriced === 1 ? "" : "s"} showed no readable price.`);
    } else warnings.push(`Buy-back pages through ${completed} of ${total} read.`);
    return {
      raw: rows,
      rawAnomalies: rows.filter((row) => row.unavailable === true).map((row) => ({
        recordIndex: wanted.indexOf(row.buybackId) + 1,
        pageOrBatch: completed,
        issueCode: "BUYBACK_PAGE_UNAVAILABLE",
        message: `The page of buy-back ${row.buybackId} was not available (${row.reason}).`,
        raw: { buybackId: row.buybackId, reason: row.reason },
        retainedInNormalizedData: false
      })),
      done,
      nextPage: null,
      interactiveState: null,
      complete: done,
      pagesOrBatches: Math.max(1, completed),
      warnings,
      requestProgress: requestProgress(completed, total),
      changeState: completed > 0 ? "changed" : "unchanged"
    };
  }

  // The different CCU buy-backs of a list, in list order, each with the buy-back whose number is given to RSI: the
  // first one RSI still offers, or the first one.
  function buybackUpgradeGroups(buybacks) {
    const groups = new Map();
    for (const buyback of buybacks) {
      const group = Delta.buybackUpgradeGroup(buyback);
      if (!group || !Number.isSafeInteger(buyback.buybackId) || buyback.buybackId < 1) continue;
      const known = groups.get(group.key);
      if (!known) groups.set(group.key, { ...group, buybackId: buyback.buybackId, offered: buyback.state === "available" });
      else if (!known.offered && buyback.state === "available") Object.assign(known, { buybackId: buyback.buybackId, offered: true });
    }
    return [...groups.values()].map(({ offered: _offered, ...group }) => group);
  }

  // A ship of an upgrade, from the store upgrade page's list of ships: RSI's number, name, and image. Null when
  // RSI refuses the list, answers in another shape, or does not list the ship: no price depends on it.
  function upgradeShipIn(answer, shipId) {
    const ships = !answer?.errors && Array.isArray(answer?.data?.ships) ? answer.data.ships : [];
    const ship = ships.find((candidate) => candidate?.id === shipId);
    if (!ship) return null;
    // RSI's larger image of the ship, or its small one for a ship that has no larger one.
    const image = [ship.medias?.slideShow, ship.medias?.productThumbMediumAndSmall].find((address) => typeof address === "string" && UPGRADE_SHIP_IMAGE.test(address)) ?? null;
    const name = typeof ship.name === "string" && ship.name.trim() ? ship.name.trim().slice(0, 200) : null;
    return name || image ? { id: shipId, name, image } : null;
  }

  // The row of the CCU price stage that holds the ships the hangar's CCU pledges start from.
  const HANGAR_UPGRADE_SHIPS_ROW = "hangar-upgrade-ships";

  // The hangar's CCU pledges that carry no image yet of the ship they start from.
  function hangarUpgradesWithoutStartingShip(pledges) {
    return (Array.isArray(pledges) ? pledges : []).filter((pledge) => pledge?.category === "shipUpgrade" && Number.isSafeInteger(pledge.pledgeId) && typeof pledge.title === "string"
      && !(Array.isArray(pledge.images) ? pledge.images : []).some((image) => image?.role === "upgrade-source"));
  }

  // The ship each of those pledges starts from. RSI titles a CCU pledge "Upgrade - <ship it starts from> to <ship it
  // leads to> <edition>" and names both ships as the store upgrade page lists them, so the ship is the listed one
  // whose name the title begins with, the longest when several fit; failing that, the listed ship of that name with
  // "Mk I" after it. A pledge whose ship is not found is left out.
  function hangarStartingShips(pledges, answer) {
    const listed = (!answer?.errors && Array.isArray(answer?.data?.ships) ? answer.data.ships : [])
      .filter((ship) => Number.isSafeInteger(ship?.id) && typeof ship.name === "string" && ship.name.trim())
      .map((ship) => ({ id: ship.id, start: `${ship.name.trim().toLowerCase()} to ` }))
      .sort((left, right) => right.start.length - left.start.length);
    const ships = new Map();
    const matched = [];
    for (const pledge of pledges) {
      const title = pledge.title.replace(/^[^-]{1,40}-\s+/u, "").toLowerCase();
      // RSI has since given some ships a generation mark. A title written before that names the first generation.
      const match = listed.find((ship) => title.startsWith(ship.start)) ?? listed.find((ship) => ship.start === `${title.split(" to ")[0]} mk i to `);
      const ship = match ? ships.get(match.id) ?? upgradeShipIn(answer, match.id) : null;
      if (!ship?.image) continue;
      ships.set(ship.id, ship);
      matched.push({ pledgeId: pledge.pledgeId, shipId: ship.id });
    }
    return { ships: [...ships.values()], pledges: matched };
  }

  // Reads the price RSI asks now for each different CCU buy-back, one upgrade a step. A CCU buy-back has no page:
  // RSI prices it in its store upgrade page, which is told the upgrade (setContextToken) and then asked the price.
  // These prices change, so nothing is taken from an earlier build. An upgrade whose price RSI does not give is
  // listed as unavailable and no other buy-back of that upgrade is tried; a refused or failed call never fails the
  // build. The amount is RSI's `nativeAmount`, in cents of a US dollar. While a buy-back's upgrade is the one named,
  // RSI lists the ships of that upgrade only, so the list is asked in the same request as the price, once for each
  // different ship an upgrade starts from or leads to: it gives that ship's name and image, and costs no request of
  // its own. When the user skips the section, its next step ends it with the prices read so far.
  // When the hangar holds CCU pledges without an image of the ship they start from, the section's first step reads
  // the whole list of ships instead of a price, before any buy-back's upgrade is named: two requests, one that
  // names no upgrade and one that asks the list. A hangar whose CCU pledges all carry that image costs nothing.
  async function collectBuybackUpgradePrices(input) {
    const buybacks = input.sectionInputs?.buybacks;
    if (!Array.isArray(buybacks)) throw new Error("RSI_UPGRADE_PRICES_LIST_UNAVAILABLE");
    const groups = buybackUpgradeGroups(buybacks);
    const gathered = Array.isArray(input.cursor?.raw) ? input.cursor.raw : [];
    const priced = (entries) => entries.filter((entry) => entry?.key !== HANGAR_UPGRADE_SHIPS_ROW);
    const tried = new Set(priced(gathered).map((row) => row?.key));
    const skipped = input.skip === true;
    const pending = skipped ? [] : groups.filter((group) => !tried.has(group.key));
    const hangar = !skipped && gathered.length === 0 ? hangarUpgradesWithoutStartingShip(input.sectionInputs?.pledges) : [];
    const row = (group, detail) => ({ key: group.key, fromShipId: group.fromShipId, toShipId: group.toShipId, toSkuId: group.toSkuId, buybackId: group.buybackId, ...detail, capturedAt: new Date().toISOString() });
    // A call RSI refuses leaves the price unread. A busy or failing server, a lost session, and a timeout are
    // errors of the build like anywhere else.
    const ask = async (path, body) => {
      try {
        return { ok: true, json: await postJson(path, body, "RSI_UPGRADE_PRICE") };
      } catch (error) {
        const refused = /^RSI_UPGRADE_PRICE_(HTTP_4(?:00|04|09|22)|CONTENT_TYPE_CHANGED)$/u.exec(error?.message ?? "");
        if (!refused) throw error;
        return { ok: false, reason: refused[1] };
      }
    };
    // setAuthToken and setContextToken: a refusal with a limit's words is a limit; any other leaves the price unread.
    const opened = (answer) => {
      if (!answer.ok || answer.json?.success === 1) return answer.ok;
      const refusal = refusalError(answer.json, "RSI_UPGRADE_PRICE");
      if (refusal.signal.kind === "limit") throw refusal;
      return false;
    };
    const anomalyRows = [];
    const rows = [];
    if (pending.length > 0 || hangar.length > 0) {
      const authorize = async () => {
        const auth = await ask(UPGRADE_AUTH_PATH, {});
        const authorized = opened(auth);
        if (authorized) upgradeAuthorizedRunId = input.runId;
        await waitForConcurrentLane(input, 1, "context");
        return { opened: authorized, reason: auth.ok ? "AUTH_REFUSED" : auth.reason };
      };
      // The store upgrade session is opened once, in the section's first step.
      const first = gathered.length === 0 ? await authorize() : { opened: true };
      if (first.opened && hangar.length > 0) {
        // No upgrade is named, so RSI lists every ship. A list RSI refuses leaves the pledges as they are.
        await ask(UPGRADE_CONTEXT_PATH, {});
        await waitForConcurrentLane(input, 1, "ships");
        const list = await ask(UPGRADE_GRAPHQL_PATH, [{ operationName: "ships", variables: {}, query: UPGRADE_SHIPS_QUERY }]);
        const found = hangarStartingShips(hangar, list.ok ? (Array.isArray(list.json) ? list.json[0] : list.json) : null);
        // The row is kept also when no ship was found, so the list is asked once. This step reads no price: the
        // first upgrade is read by the next one.
        rows.push({ key: HANGAR_UPGRADE_SHIPS_ROW, ...found, capturedAt: new Date().toISOString() });
      }
      // Without it RSI prices no upgrade, so every upgrade is left without a price in this one step.
      else if (!first.opened) rows.push(...pending.map((group) => row(group, { unavailable: true, reason: first.reason })));
      else if (pending.length > 0) {
        const group = pending[0];
        const tell = () => ask(UPGRADE_CONTEXT_PATH, { fromShipId: group.fromShipId, toShipId: group.toShipId, toSkuId: group.toSkuId, pledgeId: group.buybackId });
        let context = await tell();
        // A build continued later, in another browser session, has not opened the session yet.
        if (!opened(context) && gathered.length > 0 && upgradeAuthorizedRunId !== input.runId) {
          await waitForConcurrentLane(input, 1, "authorize");
          if ((await authorize()).opened) context = await tell();
        }
        if (!opened(context)) rows.push(row(group, { unavailable: true, reason: context.ok ? "CONTEXT_REFUSED" : context.reason }));
        else {
          await waitForConcurrentLane(input, 1, "price-and-ships");
          const priceQuestion = { operationName: "getPrice", variables: { from: group.fromShipId, to: group.toSkuId }, query: UPGRADE_PRICE_QUERY };
          // The ships of this upgrade no list of this build has been read for yet.
          const asked = new Set(gathered.flatMap((entry) => Array.isArray(entry?.shipsAsked) ? entry.shipsAsked : []));
          const wanted = [...new Set([group.fromShipId, group.toShipId])].filter((shipId) => !asked.has(shipId));
          // A price or ship answer with a limit's words refuses the step, so it is tried again.
          const limitIn = (candidates) => {
            for (const candidate of candidates) {
              if (Answers.classifyGraphqlErrors(candidate?.errors) === "limit") graphqlAnswer(candidate, "getPrice", []);
            }
          };
          let answer = await ask(UPGRADE_GRAPHQL_PATH, wanted.length === 0 ? [priceQuestion] : [priceQuestion, { operationName: "ships", variables: {}, query: UPGRADE_SHIPS_QUERY }]);
          let answers = Array.isArray(answer.json) ? answer.json : [answer.json];
          if (answer.ok) limitIn(answers);
          const listed = answer.ok && wanted.length > 0 && !answers[1]?.errors && Array.isArray(answers[1]?.data?.ships);
          const ships = listed ? wanted.map((shipId) => upgradeShipIn(answers[1], shipId)).filter(Boolean) : [];
          // A request with the list in it that RSI refuses, or answers without a price answer, is asked again for the
          // price alone: the list never costs a price.
          if (wanted.length > 0 && (!answer.ok || !answers[0] || answers[0].errors)) {
            await waitForConcurrentLane(input, 1, "price-only-fallback");
            answer = await ask(UPGRADE_GRAPHQL_PATH, [priceQuestion]);
            answers = Array.isArray(answer.json) ? answer.json : [answer.json];
            if (answer.ok) limitIn(answers);
          }
          const first = answers[0];
          const price = first?.data?.price;
          const read = (detail) => row(group, listed ? { ...detail, ships, shipsAsked: wanted } : detail);
          // A proven price beside an error is kept, with the error as anomaly evidence (§5.7).
          const priceKind = answer.ok && first?.errors ? Answers.classifyGraphqlEnvelope(first, "getPrice") : null;
          if (priceKind?.kind === "ok-with-anomalies") anomalyRows.push(...priceKind.anomalyRows.map((entry) => ({ ...entry, raw: { ...entry.raw, buybackId: group.buybackId } })));
          if (!answer.ok) rows.push(read({ unavailable: true, reason: answer.reason }));
          else if (first?.errors && priceKind?.kind !== "ok-with-anomalies") rows.push(read({ unavailable: true, reason: "PRICE_REFUSED" }));
          else if (!price || price.nativeAmount === null || price.nativeAmount === undefined) rows.push(read({ unavailable: true, reason: "NO_PRICE" }));
          // A price that is not a whole number of cents is not guessed at.
          else if (!Number.isSafeInteger(price.nativeAmount) || price.nativeAmount < 0) rows.push(read({ unavailable: true, reason: "PRICE_NOT_UNDERSTOOD" }));
          else {
            rows.push(read({ nativeAmount: price.nativeAmount, amount: Number.isSafeInteger(price.amount) ? price.amount : null }));
            annotateActivity(UPGRADE_GRAPHQL_PATH, null, { recordsReceived: 1 });
          }
        }
      }
    }
    const all = priced([...gathered, ...rows]);
    const completed = all.length;
    const done = skipped || completed >= groups.length;
    const warnings = [];
    if (skipped && completed < groups.length) warnings.push(`The CCU buy-back prices were skipped after ${completed} of ${groups.length} were read.`);
    if (done) {
      const unread = all.filter((entry) => entry?.unavailable === true).length;
      if (unread) warnings.push(`RSI gave no price for ${unread} of ${groups.length} different CCU buy-back${groups.length === 1 ? "" : "s"}; ${unread === 1 ? "it shows" : "they show"} no price.`);
    } else warnings.push(`CCU buy-back prices through ${completed} of ${groups.length} read.`);
    return {
      raw: rows,
      rawAnomalies: [
        ...rows.filter((entry) => entry.unavailable === true).map((entry) => ({
          recordIndex: groups.findIndex((group) => group.key === entry.key) + 1,
          pageOrBatch: completed,
          issueCode: "BUYBACK_UPGRADE_PRICE_UNAVAILABLE",
          message: `RSI gave no price for the CCU buy-back ${entry.buybackId} (${entry.reason}).`,
          raw: { buybackId: entry.buybackId, reason: entry.reason },
          retainedInNormalizedData: false
        })),
        ...anomalyRows.map((entry, index) => ({ recordIndex: Math.max(1, groups.findIndex((group) => group.buybackId === entry.raw.buybackId) + 1), pageOrBatch: completed, keySuffix: `graphql.${index}`, retainedInNormalizedData: true, ...entry }))
      ],
      done,
      nextPage: null,
      interactiveState: null,
      complete: done,
      pagesOrBatches: Math.max(1, completed),
      warnings,
      requestProgress: requestProgress(completed, groups.length),
      changeState: completed > 0 ? "changed" : "unchanged"
    };
  }

  async function collectBillingDocument(section, input) {
    const pageNumber = section === "financial.orders" && Number.isSafeInteger(input.cursor?.page) ? input.cursor.page : 1;
    const page = await getHtml(`/account/billing?page=${pageNumber}&pagesize=100`);
    const parsed = await parseMarkup(section, page.html, { baseUrl: page.finalUrl, page: pageNumber });
    assertPageRecognized(parsed, page, `/account/billing?page=${pageNumber}&pagesize=100`);
    if (section !== "financial.orders") {
      const prior = previousValue(input, section);
      const comparableCurrent = section === "financial.billingTotal" && parsed.raw ? { amount: parsed.raw.amount, currency: parsed.raw.currency } : parsed.raw;
      const comparablePrior = section === "financial.billingTotal" && prior ? { amount: prior.amount, currency: prior.currency } : prior;
      return {
        raw: parsed.raw,
        done: true,
        complete: true,
        pagesOrBatches: 1,
        warnings: [],
        requestProgress: requestProgress(1, 1),
        changeState: prior && Delta.equal(comparableCurrent, comparablePrior) ? "unchanged" : "changed"
      };
    }
    const pageCount = Number.isSafeInteger(parsed.pageCount) ? parsed.pageCount : pageNumber;
    const priorOrders = previousValue(input, "financial.orders");
    if (pageNumber === 1 && Array.isArray(priorOrders) && input.updateSignals?.["financial.billingTotal"] === "unchanged") {
      const expectedPageCount = Math.max(1, Math.ceil(priorOrders.length / 100));
      const expectedFirstPageLength = Math.min(100, priorOrders.length);
      if (pageCount === expectedPageCount && parsed.raw.length === expectedFirstPageLength && Delta.prefixMatches(parsed.raw, priorOrders, Delta.orderRecord)) {
        return { ...reusePrevious(input, requestProgress(1, pageCount), ["Billing orders matched the prior total, page count, and exact newest page." ]), pagesOrBatches: 1 };
      }
    }
    const done = pageNumber >= pageCount;
    annotateActivity("/account/billing", pageNumber, { pageCount, recordsReceived: parsed.raw.length });
    return { raw: parsed.raw, done, nextPage: done ? null : pageNumber + 1, interactiveState: done ? null : { pageCount }, complete: done, pagesOrBatches: pageNumber, warnings: done ? [] : [`Billing order page ${pageNumber} of ${pageCount} collected.`], requestProgress: requestProgress(pageNumber, pageCount), changeState: "changed" };
  }

  async function collectLedgers(input) {
    const ledgerIndex = Number.isSafeInteger(input.cursor?.interactiveState?.ledgerIndex) ? input.cursor.interactiveState.ledgerIndex : 0;
    const batch = Number.isSafeInteger(input.cursor?.interactiveState?.batches) ? input.cursor.interactiveState.batches + 1 : 1;
    const page = Number.isSafeInteger(input.cursor?.page) ? input.cursor.page : 1;
    const ledger = LEDGERS[ledgerIndex];
    // A cursor this extension did not write carries no signal: it stops the run, as today.
    if (!ledger) throw new Error("RSI_LEDGER_CURSOR_INVALID");
    const response = await postJson(ledger.path, { page });
    const data = assertPagedFragment(response, page, "RSI_LEDGER", { allowEmpty: true });
    const parsed = await parseMarkup("ledger", data.rendered, { baseUrl: `${RSI_ORIGIN}${ledger.path}` });
    // An empty ledger holds no row; a row under a page count of 0 is not an answer this reader knows (§13.2).
    if (Number(response?.data?.pagecount) === 0 && parsed.raw.length > 0) throw contractError("RSI_LEDGER_PAGE_COUNT_INVALID", requestFields(lastPostMeta));
    annotateActivity(ledger.path, page, { pageCount: data.pagecount, recordsReceived: parsed.raw.length });
    if (input.mode === "update" && input.previousSection?.current === true) {
      const cursorRaw = input.cursor?.raw ?? { storeCredit: [], uec: [], rec: [] };
      const accumulated = [...(cursorRaw[ledger.key] ?? []), ...parsed.raw];
      const prior = input.previousSection.values?.[`financial.creditLedgers.${ledger.key}`];
      const anchor = Array.isArray(prior) && prior.length > 0 ? Delta.findAnchor(accumulated, prior, Delta.ledgerRecord) : -1;
      const reachedEnd = page >= data.pagecount;
      const ledgerDone = anchor >= 0 || reachedEnd;
      const nextLedgerIndex = ledgerDone ? ledgerIndex + 1 : ledgerIndex;
      const done = ledgerDone && ledgerIndex === LEDGERS.length - 1;
      const nextPage = ledgerDone ? 1 : page + 1;
      const ledgerChanged = anchor !== 0;
      const anyChanged = input.cursor?.interactiveState?.anyChanged === true || ledgerChanged;
      const ledgerValue = anchor === 0
        ? prior.map(Delta.ledgerAsRaw)
        : anchor > 0
          ? [...accumulated.slice(0, anchor), ...prior.map(Delta.ledgerAsRaw)]
          : accumulated;
      const raw = { ...cursorRaw, [ledger.key]: ledgerValue };
      return {
        raw,
        snapshot: true,
        done,
        nextPage: done ? null : nextPage,
        interactiveState: done ? null : { ledgerIndex: nextLedgerIndex, batches: batch, anyChanged },
        complete: done,
        pagesOrBatches: batch,
        warnings: [
          anchor === 0
            ? `${ledger.key} ledger matched the prior exact anchor.`
            : anchor > 0
              ? `${ledger.key} ledger merged ${anchor} new entr${anchor === 1 ? "y" : "ies"} through the prior exact anchor.`
              : reachedEnd
                ? `${ledger.key} ledger required full traversal because no prior anchor was found.`
                : `${ledger.key} ledger page ${page} of ${data.pagecount} collected while searching for the prior exact anchor.`
        ],
        requestProgress: requestProgress(page, data.pagecount, ledger.key),
        changeState: done ? anyChanged ? "changed" : "unchanged" : "changed"
      };
    }
    const raw = { storeCredit: [], uec: [], rec: [], [ledger.key]: parsed.raw };
    const ledgerDone = page >= data.pagecount;
    const done = ledgerDone && ledgerIndex === LEDGERS.length - 1;
    const nextLedgerIndex = ledgerDone ? ledgerIndex + 1 : ledgerIndex;
    const nextPage = ledgerDone ? 1 : page + 1;
    return {
      raw,
      done,
      nextPage: done ? null : nextPage,
      interactiveState: done ? null : { ledgerIndex: nextLedgerIndex, batches: batch },
      complete: done,
      pagesOrBatches: batch,
      warnings: done ? [] : [`${ledger.key} ledger page ${page} of ${data.pagecount} collected.`],
      requestProgress: requestProgress(page, data.pagecount, ledger.key)
    };
  }

  function referralRequest(campaignId, converted, page) {
    return [{
      operationName: "GetReferralRecruitsList",
      variables: { campaignId, converted, display: "ALL_TIME", limit: REFERRAL_PAGE_SIZE, page, sortBy: "NEWEST" },
      extensions: { persistedQuery: { version: 1, sha256Hash: REFERRAL_QUERY_HASH } }
    }];
  }

  function referralCalendarDate(value) {
    if (typeof value !== "string") return null;
    const match = /^(\d{4})-(\d{2})-(\d{2})(?:T|$)/u.exec(value);
    if (!match) return null;
    const candidate = `${match[1]}-${match[2]}-${match[3]}`;
    const timestamp = Date.parse(`${candidate}T00:00:00.000Z`);
    return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === candidate ? candidate : null;
  }

  function referralRaw(entry, converted) {
    const source = entry && typeof entry === "object" && !Array.isArray(entry) ? entry : {};
    const dateCandidate = converted ? source.convertedOn : source.enlistedOn;
    const dateRaw = typeof dateCandidate === "string" && dateCandidate.length > 0 ? dateCandidate : null;
    const displayName = typeof source.displayName === "string" && source.displayName.length > 0 ? source.displayName : null;
    const handle = typeof source.nickname === "string" && source.nickname.length > 0 ? source.nickname : null;
    return {
      recordKey: typeof source.id === "string" && source.id.length > 0 ? source.id : null,
      displayName,
      handle,
      displayNameRaw: typeof source.displayName === "string" ? source.displayName : null,
      nicknameRaw: typeof source.nickname === "string" ? source.nickname : null,
      dateRaw,
      dateLabel: converted ? "purchasedOn" : "enlistedOn",
      dateSortKey: referralCalendarDate(dateRaw),
      images: typeof source.avatar === "string" && source.avatar ? [{ url: new URL(source.avatar, RSI_ORIGIN).href, role: "avatar", altText: displayName, width: null, height: null }] : [],
      relatedUrls: typeof handle === "string" && handle ? [
        `${RSI_ORIGIN}/en/citizens/${encodeURIComponent(handle)}`,
        `${RSI_ORIGIN}/spectrum/messages/member/${encodeURIComponent(handle)}`
      ] : []
    };
  }

  function referralRecordContractIssues(entry, converted) {
    const source = entry && typeof entry === "object" && !Array.isArray(entry) ? entry : {};
    const required = [
      ["ID", source.id],
      ["DISPLAY_NAME", source.displayName],
      ["NICKNAME", source.nickname],
      [converted ? "CONVERTED_ON" : "ENLISTED_ON", converted ? source.convertedOn : source.enlistedOn]
    ];
    const issues = [];
    for (const [field, value] of required) {
      if (value === undefined) issues.push(`${field}_MISSING`);
      else if (value === null) issues.push(`${field}_NULL`);
      else if (typeof value !== "string") issues.push(`${field}_TYPE_${String(typeof value).toUpperCase()}`);
      else if (value.length === 0) issues.push(`${field}_EMPTY`);
    }
    return issues;
  }

  async function collectReferrals(descriptor, input) {
    const page = Number.isSafeInteger(input.cursor?.page) ? input.cursor.page : 1;
    const ladder = descriptor.parserOptions.ladder;
    const kind = descriptor.parserOptions.kind;
    const campaignId = ladder === "legacy" ? "1" : "2";
    const converted = kind === "recruits";
    const response = await postJson(GRAPHQL_PATH, referralRequest(campaignId, converted, page));
    recordSourceUrl(`${RSI_ORIGIN}/en/referral`);
    const partialRows = [];
    const result = graphqlAnswer(Array.isArray(response) ? response[0] : response, "GetReferralRecruitsList", partialRows);
    const list = result?.data?.referralRecruitsList;
    if (!list || !Array.isArray(list.data) || !Number.isSafeInteger(list.recruitsCount) || !Number.isSafeInteger(list.prospectsCount)) throw contractError("RSI_REFERRAL_CONTRACT_CHANGED");
    const total = converted ? list.recruitsCount : list.prospectsCount;
    const partialAnomalies = partialRows.map((row, index) => ({ recordIndex: (page - 1) * REFERRAL_PAGE_SIZE + 1, pageOrBatch: page, keySuffix: `graphql.${index}`, retainedInNormalizedData: true, ...row }));
    const rawAnomalies = [...partialAnomalies, ...list.data.flatMap((entry, index) => {
      const issues = referralRecordContractIssues(entry, converted);
      if (issues.length === 0) return [];
      return [{
        recordIndex: (page - 1) * REFERRAL_PAGE_SIZE + index + 1,
        pageOrBatch: page,
        issueCode: `RSI_REFERRAL_RECORD_${issues.join("_")}`,
        message: `${ladder} ${kind} page ${page} row ${index + 1} contained unexpected RSI source values and was retained for review.`,
        raw: entry === undefined ? null : JSON.parse(JSON.stringify(entry)),
        retainedInNormalizedData: issues.join("_") === "DISPLAY_NAME_EMPTY_NICKNAME_NULL"
      }];
    })];
    const raw = list.data.map((entry) => referralRaw(entry, converted));
    const priorPageSize = input.cursor?.interactiveState?.pageSize;
    const pageSize = Number.isSafeInteger(priorPageSize) && priorPageSize > 0
      ? priorPageSize
      : raw.length > 0 && raw.length < total
        ? raw.length
        : REFERRAL_PAGE_SIZE;
    if (raw.length > pageSize) throw contractError("RSI_REFERRAL_PAGE_SIZE_CHANGED");
    const collected = Math.min((page - 1) * pageSize + raw.length, total);
    const done = collected >= total || raw.length === 0;
    const pageCount = Math.max(1, Math.ceil(total / pageSize));
    annotateActivity(GRAPHQL_PATH, page, { pageCount, recordsReceived: raw.length, recordsTotal: collected });
    const prior = previousValue(input, descriptor.id);
    const accumulated = [...(Array.isArray(input.cursor?.raw) ? input.cursor.raw : []), ...raw];
    if (Array.isArray(prior)) {
      const expectedFirstPageLength = Math.min(pageSize, prior.length);
      if (page === 1 && total === prior.length && raw.length === expectedFirstPageLength && Delta.prefixMatches(raw, prior, Delta.referralRecord)) {
        return { ...reusePrevious(input, requestProgress(1, pageCount, `${ladder} ${kind}`), [`${ladder} ${kind} matched the prior authoritative total and exact newest page.`]), pagesOrBatches: 1, rawAnomalies };
      }
      if (total > prior.length) {
        const anchor = Delta.findAnchor(accumulated, prior, Delta.referralRecord);
        if (anchor >= 0) {
          return {
            raw: [...accumulated.slice(0, anchor), ...prior.map(Delta.referralAsRaw)],
            snapshot: true,
            done: true,
            complete: true,
            pagesOrBatches: page,
            warnings: [
              ...(rawAnomalies.length ? [`${rawAnomalies.length} ${ladder} ${kind} record${rawAnomalies.length === 1 ? "" : "s"} contained unexpected source values; exact raw evidence was retained in dataQuality.anomalies.`] : []),
              `${ladder} ${kind} merged ${anchor} new record${anchor === 1 ? "" : "s"} through the prior exact anchor.`
            ],
            rawAnomalies,
            requestProgress: requestProgress(page, pageCount, `${ladder} ${kind}`),
            changeState: "changed"
          };
        }
      }
    }
    return {
      raw: done && input.mode === "update" ? accumulated : raw,
      ...(done && input.mode === "update" ? { snapshot: true } : {}),
      done,
      nextPage: done ? null : page + 1,
      interactiveState: done ? null : { pageSize, pageCount, total },
      complete: done,
      pagesOrBatches: page,
      warnings: [
        ...(rawAnomalies.length ? [`${rawAnomalies.length} ${ladder} ${kind} record${rawAnomalies.length === 1 ? "" : "s"} contained unexpected source values; exact raw evidence was retained in dataQuality.anomalies.`] : []),
        ...(done ? [] : [`${ladder} ${kind} page ${page} collected (${collected} of ${total}).`])
      ],
      rawAnomalies,
      requestProgress: requestProgress(page, pageCount, `${ladder} ${kind}`),
      changeState: "changed"
    };
  }

  async function collectOrganizationMemberships(input) {
    const handle = encodeURIComponent(input.accountId);
    const page = await getHtml(`/en/citizens/${handle}/organizations`);
    const parsed = await parseMarkup("organizations.memberships", page.html, { baseUrl: page.finalUrl });
    assertPageRecognized(parsed, page, `/en/citizens/${handle}/organizations`);
    annotateActivity(new URL(page.finalUrl).pathname, null, { pageCount: 1, recordsReceived: parsed.raw.length, recordsTotal: parsed.raw.length });
    return { raw: parsed.raw, done: true, complete: true, pagesOrBatches: 1, warnings: [], requestProgress: requestProgress(1, 1) };
  }

  async function collectOrganizationMembers(descriptor, input) {
    const sid = descriptor.parserOptions.organizationSid;
    const page = Number.isSafeInteger(input.cursor?.page) ? input.cursor.page : 1;
    const response = await postJson(ORGANIZATION_MEMBERS_PATH, { symbol: sid, search: "", pagesize: 32, page });
    if (![true, 1].includes(response?.success)) throw refusalError(response, "RSI_ORGANIZATION_MEMBERS");
    const data = response?.data;
    if (!data || !Number.isSafeInteger(data.totalrows) || typeof data.html !== "string") throw contractError("RSI_ORGANIZATION_MEMBERS_CONTRACT_CHANGED");
    const parsed = await parseMarkup("organizations.members", data.html, { organizationSid: sid, baseUrl: `${RSI_ORIGIN}/en/orgs/${sid}/members` });
    const pageCount = Math.max(1, Math.ceil(data.totalrows / 32));
    const done = page >= pageCount;
    annotateActivity(ORGANIZATION_MEMBERS_PATH, page, { pageCount, recordsReceived: parsed.raw.length, recordsTotal: Math.min(page * 32, data.totalrows) });
    return { raw: parsed.raw, done, nextPage: done ? null : page + 1, interactiveState: done ? null : { pageCount }, complete: done, pagesOrBatches: page, warnings: done ? [] : [`${sid} roster page ${page} of ${pageCount} collected.`], requestProgress: requestProgress(page, pageCount, sid) };
  }

  // The canary (§5.4): the run's own identify call, sent before a step whose last attempt was unclear. It raises the
  // canary's own signal when RSI is limiting, the session is gone or another account is signed in. When identify is
  // itself unclear after an unclear 403, 404, content type or network failure of a JSON call, one credentialed read of
  // the hangar's first page tells a working session from a limit.
  const SESSION_CHECK_AFTER = /(?:_HTTP_403|_HTTP_404|_CONTENT_TYPE_CHANGED)$|^RSI_NETWORK_OR_REDIRECT$/u;

  async function runCanary(input) {
    const fromCanary = (error) => error?.signal ? new RsiReadError({ ...error.signal, fromCanary: true }, { cause: error, message: error.message }) : error;
    let identity;
    try {
      identity = await identifyAccount();
    } catch (error) {
      const previous = input.canaryAfterSignal ?? null;
      const sessionCheck = error?.signal?.kind === "ambiguous" && previous?.method === "POST" && SESSION_CHECK_AFTER.test(previous.code ?? "");
      if (!sessionCheck) throw fromCanary(error);
      await waitForConcurrentLane(input, 1, "session-check");
      let hangar;
      try {
        hangar = await getHtml("/account/pledges?page=1&product-type=", { cache: false });
      } catch (checkError) {
        throw fromCanary(checkError);
      }
      const parsed = await parseMarkup("pledges", hangar.html, { baseUrl: hangar.finalUrl, page: 1 });
      // A recognized hangar shows the session works; the step's real requests follow.
      if (!Array.isArray(parsed.raw) || parsed.raw.length === 0) throw fromCanary(error);
      await waitForConcurrentLane(input, 1, "step");
      return;
    }
    if (identity.accountId.toLowerCase() !== String(input.accountId ?? "").toLowerCase()) {
      throw new RsiReadError({ kind: "user", code: "ACCOUNT_CHANGED", reason: "account-changed", method: "POST", route: IDENTIFY_PATH, fromCanary: true });
    }
    await waitForConcurrentLane(input, 1, "step");
  }

  // A failed step's error as a new object of this extension: the same message and signal, the step's request lines,
  // and the thrown value as its cause. A browser's or another realm's error is never changed.
  function failedStepError(error, requestActivities) {
    const message = typeof error?.message === "string" && error.message ? error.message : "RSI_READ_FAILED";
    const wrapped = error?.signal ? new RsiReadError(error.signal, { cause: error, message }) : new Error(message, { cause: error });
    wrapped.requestActivities = requestActivities;
    return wrapped;
  }

  async function collectStep(descriptor, input) {
    const priorActivities = activeRequestActivities;
    const priorActivityListener = activeRequestActivityListener;
    const priorSourceUrls = activeSourceUrls;
    activeRequestActivities = [];
    activeRequestActivityListener = typeof input?.onRequestActivity === "function" ? input.onRequestActivity : null;
    activeSourceUrls = [];
    const priorEvidence = activeEvidence;
    activeEvidence = [];
    const priorJournal = activeJournal;
    // Durable request slots: the runner passes the journal of the step's earlier slots, or an empty one.
    const journal = Array.isArray(input?.requestSlots?.journal) ? input.requestSlots.journal : null;
    activeJournal = journal ? { served: [...journal], recorded: [...journal], lastStartMs: journal.reduce((latest, entry) => Math.max(latest, entry.startedAtMs ?? 0), 0) || null } : null;
    try {
      if (input?.canary === true) await runCanary(input);
      let result;
      if (descriptor.id === "profile") result = await collectProfile(input);
      else if (descriptor.id === "pledges") result = await collectPledges(input);
      else if (descriptor.id === "hangarLog") result = await collectHangarLog(input);
      else if (descriptor.id === "buybacks") result = await collectBuybacks(input);
      else if (descriptor.id === "buybackDetails") result = await collectBuybackDetails(input);
      else if (descriptor.id === "buybackUpgradePrices") result = await collectBuybackUpgradePrices(input);
      else if (["financial.balances", "financial.billingTotal", "financial.orders", "financial.subscriptions"].includes(descriptor.id)) result = await collectBillingDocument(descriptor.id, input);
      else if (descriptor.id === "financial.ledgers") result = await collectLedgers(input);
      else if (descriptor.id.startsWith("referrals.")) result = await collectReferrals(descriptor, input);
      else if (descriptor.id === "organizations.memberships") result = await collectOrganizationMemberships(input);
      else if (descriptor.id.startsWith("organizations.members.")) result = await collectOrganizationMembers(descriptor, input);
      else throw new Error(`No background collector is registered for ${descriptor.id}.`);
      // Each buy-back detail records the address of its own page, so the section does not list them all again.
      const sourceUrls = descriptor.id === "buybackDetails" ? [] : Array.from(new Set(activeSourceUrls)).sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
      return { ...result, requestActivities: activeRequestActivities, sourceUrls };
    } catch (error) {
      // A durable request slot: the step stops here, and its answers so far go to the runner to keep.
      if (error instanceof PhaseBoundary && activeJournal) {
        return { pendingPhase: { phase: error.phase, nextRequestAtMs: error.nextRequestAtMs, journal: activeJournal.recorded }, requestActivities: activeRequestActivities, sourceUrls: [] };
      }
      const wrapped = failedStepError(error, activeRequestActivities);
      // A changed contract leaves its finding before the answer is let go. So does an unclear answer, which the runner
      // reads as a changed contract when it comes again after a canary that answered normally (§7.7, §10).
      if (error?.signal?.kind === "contract" || error?.signal?.kind === "ambiguous") {
        try {
          wrapped.contractFinding = await contractFinding(error.signal, descriptor.id);
        } catch {
          wrapped.contractFinding = null;
        }
      }
      throw wrapped;
    } finally {
      activeJournal = priorJournal;
      activeEvidence = priorEvidence;
      activeRequestActivities = priorActivities;
      activeRequestActivityListener = priorActivityListener;
      activeSourceUrls = priorSourceUrls;
    }
  }

  // Drops every cached page except the addresses in `retain`.
  function clearTransientCaches({ retain = [] } = {}) {
    for (const url of [...htmlCache.keys()]) if (!retain.includes(url)) htmlCache.delete(url);
  }

  // The cached copies of `urls` that the runner keeps with the run: each page's text, final address and status.
  function retainedPages(urls) {
    return urls.map((url) => [url, htmlCache.get(url)]).filter(([, value]) => typeof value?.html === "string")
      .map(([url, value]) => Object.freeze({ url, html: value.html, finalUrl: value.finalUrl, status: value.status }));
  }

  // Puts pages the runner kept back into the cache, as if just read, unless the cache holds them already. Only an
  // address the client reads signed in is taken.
  function restorePages(pages) {
    for (const page of Array.isArray(pages) ? pages : []) {
      if (typeof page?.url !== "string" || typeof page.html !== "string" || htmlCache.has(page.url)) continue;
      const url = new URL(page.url);
      if (url.origin !== RSI_ORIGIN || !approvedHtmlPath(`${url.pathname}${url.search}`)) continue;
      const finalUrl = typeof page.finalUrl === "string" && new URL(page.finalUrl).origin === RSI_ORIGIN ? page.finalUrl : page.url;
      htmlCache.set(page.url, Object.freeze({ html: page.html, finalUrl, cachedAt: Date.now(), status: Number.isSafeInteger(page.status) ? page.status : 200, meta: null }));
    }
  }

  // The smart check's request without cookies (§9.2). "answered": a 2xx dossier of this handle; "refused": an answer
  // in the limit or transient class, a time-out among them; "failed": any other answer, or a network failure. The
  // dossier is recognized by its page marker (§5.3) and its parsed handle.
  async function probePublicPage(handle) {
    const accountId = typeof handle === "string" ? handle.trim() : "";
    const startedAt = Date.now();
    const outcome = (probe, httpStatus = null) => ({ probe, httpStatus, elapsedMs: Math.max(0, Date.now() - startedAt) });
    if (!/^[A-Za-z0-9_-]{1,60}$/u.test(accountId)) return outcome("failed");
    const url = `${RSI_ORIGIN}/en/citizens/${encodeURIComponent(accountId)}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, { method: "GET", credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer", redirect: "follow", signal: controller.signal });
      const kind = Answers.classifyStatus({ status: response.status, fixedAddress: false });
      if (kind === "limit" || kind === "transient") return outcome("refused", response.status);
      if (kind !== "ok") return outcome("failed", response.status);
      const parsed = await parseMarkup("profile", await response.text(), { baseUrl: response.url || url }).catch(() => null);
      const handleShown = typeof parsed?.raw?.handle === "string" ? parsed.raw.handle.toLowerCase() : null;
      return outcome(parsed?.pageRecognized === true && handleShown === accountId.toLowerCase() ? "answered" : "failed", response.status);
    } catch (error) {
      return outcome(error?.name === "AbortError" ? "refused" : "failed");
    } finally {
      clearTimeout(timeout);
    }
  }

  // RSI's status feed (§9.3), for the status-page checker: the settings' one address, never with cookies.
  const STATUS_FEED_URL = root.CITIZENDATA_REQUEST_PACING.smartCheck.statusFeedUrl;
  function fetchStatusFeed(url, init = {}) {
    if (url !== STATUS_FEED_URL) return Promise.reject(new TypeError("Only RSI's status feed is read this way."));
    return fetch(STATUS_FEED_URL, { ...init, method: "GET", credentials: "omit" });
  }

  return Object.freeze({
    BUYBACKS_PATH,
    GRAPHQL_PATH,
    HANGAR_LOG_PATH,
    IDENTIFY_PATH,
    ORGANIZATION_MEMBERS_PATH,
    clearTransientCaches,
    retainedPages,
    restorePages,
    collectStep,
    fetchStatusFeed,
    identifyAccount,
    probePublicPage
  });
});
