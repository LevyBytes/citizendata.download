// Identify answers RSI refuses or accepts, and the stored keys of the start's cool-down, for the run start tests.

export const IDENTIFY = "/api/spectrum/auth/identify";

export const RETRY_NOT_BEFORE_KEY = "citizendata.retryNotBefore";

export const STATUS_ORIGIN = "https://status.robertsspaceindustries.com";

export const statusReads = (harness) => harness.rsi.requests.filter((request) => request.origin === STATUS_ORIGIN);

export const identifies = (harness) => harness.rsi.requests.filter((request) => request.path === IDENTIFY);

export const refused = (retryAfter = "1") => ({ status: 429, contentType: "text/html", html: "Too Many Requests", headers: { "retry-after": retryAfter } });
