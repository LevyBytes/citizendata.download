(function initializeCitizenDataNormalization(root, factory) {
  "use strict";

  const api = factory(root);
  root.CitizenDataNormalization = api;
  if (typeof module === "object" && module?.exports) module.exports = api;
})(globalThis, function createCitizenDataNormalization(root) {
  "use strict";

  const DECIMAL = /^-?[0-9]+(?:\.[0-9]{1,4})?$/u;
  const SAFE_HANDLE = /^[A-Za-z0-9_-]+$/u;
  const ISO_DATE = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/u;

  function plain(value, label) {
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
      throw new TypeError(`${label} must be a plain object.`);
    }
    return value;
  }

  function list(value, label) {
    if (!Array.isArray(value)) throw new TypeError(`${label} must be an array.`);
    return value;
  }

  function text(value, label) {
    if (typeof value !== "string" || !value.trim()) throw new TypeError(`${label} must be nonempty text.`);
    return value.trim().replace(/\s+/gu, " ");
  }

  function nullableText(value, label) {
    if (value === null || value === undefined || value === "") return null;
    return text(value, label);
  }

  function rawText(value, label, { nullable = false } = {}) {
    if ((value === null || value === undefined) && nullable) return null;
    if (typeof value !== "string") throw new TypeError(`${label} must be text${nullable ? " or null" : ""}.`);
    return value.trim();
  }

  function integer(value, label, { nullable = false, minimum = 0 } = {}) {
    if ((value === null || value === undefined) && nullable) return null;
    const candidate = typeof value === "string" && /^\d+$/u.test(value.trim()) ? Number(value.trim()) : value;
    if (!Number.isSafeInteger(candidate) || candidate < minimum) throw new TypeError(`${label} must be a safe integer of at least ${minimum}.`);
    return candidate;
  }

  function booleanOrNull(value, label) {
    if (value === null || value === undefined) return null;
    if (typeof value !== "boolean") throw new TypeError(`${label} must be true, false, or null.`);
    return value;
  }

  function boolean(value, label) {
    if (typeof value !== "boolean") throw new TypeError(`${label} must be true or false.`);
    return value;
  }

  function oneOf(value, allowed, label) {
    if (!allowed.includes(value)) throw new TypeError(`${label} is not recognized.`);
    return value;
  }

  function decimal(value, label) {
    if (typeof value !== "string" || !DECIMAL.test(value)) throw new TypeError(`${label} must be an exact decimal string with at most four fractional digits.`);
    return value;
  }

  function money(value, label, { nullable = true } = {}) {
    if ((value === null || value === undefined) && nullable) return null;
    const source = plain(value, label);
    const currency = text(source.currency, `${label}.currency`).toUpperCase();
    if (!/^[A-Z]{3}$/u.test(currency)) throw new TypeError(`${label}.currency must be a three-letter currency code.`);
    return Object.freeze({
      amount: decimal(source.amount, `${label}.amount`),
      currency
    });
  }

  function dateTime(value, label) {
    const source = text(value, label);
    const time = Date.parse(source);
    if (!Number.isFinite(time)) throw new TypeError(`${label} must be an ISO 8601 date-time.`);
    return new Date(time).toISOString();
  }

  function dateOrNull(value, label) {
    if (value === null || value === undefined || value === "") return null;
    const source = text(value, label);
    if (!ISO_DATE.test(source) || Number.isNaN(Date.parse(`${source}T00:00:00Z`))) throw new TypeError(`${label} must be a proven ISO 8601 calendar date or null.`);
    return source;
  }

  function context(input, parserVersion) {
    const source = plain(input, "Parser context");
    const lastObservedAt = dateTime(source.observedAt, "context.observedAt");
    return Object.freeze({
      firstObservedAt: dateTime(source.firstObservedAt ?? lastObservedAt, "context.firstObservedAt"),
      lastObservedAt,
      parserVersion: text(source.parserVersion ?? parserVersion, "context.parserVersion")
    });
  }

  function utf8(value) {
    if (typeof TextEncoder === "function") return new TextEncoder().encode(value);
    throw new Error("UTF-8 encoding is unavailable in this execution context.");
  }

  async function sha256Hex(value) {
    const subtle = root.crypto?.subtle;
    if (!subtle) throw new Error("SHA-256 is unavailable in this execution context.");
    const digest = await subtle.digest("SHA-256", utf8(String(value)));
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  }

  async function stableKey(namespace, parts) {
    const name = text(namespace, "Key namespace").toLowerCase().replace(/[^a-z0-9.-]+/gu, "-");
    const values = list(parts, "Key parts").map((part, index) => {
      if (!["string", "number", "boolean"].includes(typeof part) && part !== null) throw new TypeError(`Key part ${index} is not scalar.`);
      const encoded = part === null ? "null" : String(part).normalize("NFC");
      return `${encoded.length}:${encoded}`;
    });
    return `${name}:${await sha256Hex(values.join("|"))}`;
  }

  function normalizeHttpsUrl(value, label) {
    const source = text(value, label);
    let url;
    try { url = new URL(source); } catch { throw new TypeError(`${label} must be an absolute HTTPS URL.`); }
    if (url.protocol !== "https:" || url.username || url.password) throw new TypeError(`${label} must be an HTTPS URL without credentials.`);
    url.hash = "";
    url.hostname = url.hostname.toLowerCase();
    const entries = Array.from(url.searchParams.entries()).sort(([leftKey, leftValue], [rightKey, rightValue]) => leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue));
    url.search = "";
    for (const [key, entryValue] of entries) url.searchParams.append(key, entryValue);
    return url.href;
  }

  async function imageReference(input, fallbackRole, fallbackAlt) {
    const source = plain(input, "Image reference");
    const url = normalizeHttpsUrl(source.url ?? source.sourceUrl ?? source.normalizedUrl, "image.url");
    return Object.freeze({
      imageKey: await sha256Hex(url),
      normalizationVersion: 1,
      role: text(source.role ?? fallbackRole, "image.role"),
      url,
      altText: nullableText(source.altText ?? fallbackAlt, "image.altText"),
      width: source.width === null || source.width === undefined ? null : integer(source.width, "image.width", { minimum: 1 }),
      height: source.height === null || source.height === undefined ? null : integer(source.height, "image.height", { minimum: 1 }),
      mimeTypeHint: nullableText(source.mimeTypeHint, "image.mimeTypeHint")
    });
  }

  async function imageReferences(value, fallbackRole, fallbackAlt) {
    const records = value === null || value === undefined ? [] : list(value, "Images");
    const normalized = [];
    for (const record of records) normalized.push(await imageReference(record, fallbackRole, fallbackAlt));
    const keys = new Set();
    // RSI's placeholder picture is not an image of the record and is never recorded.
    const isPlaceholder = root.CitizenDataAccountDocument.isPlaceholderImage;
    return Object.freeze(normalized.filter(record => !isPlaceholder(record) && !keys.has(record.imageKey) && keys.add(record.imageKey)));
  }

  function safeHandle(value, label, { nullable = false } = {}) {
    const candidate = nullable ? nullableText(value, label) : text(value, label);
    if (candidate === null) return null;
    if (!SAFE_HANDLE.test(candidate)) throw new TypeError(`${label} contains unsupported characters.`);
    return candidate;
  }

  function cloneJson(value, label) {
    try {
      const textValue = JSON.stringify(value);
      if (textValue === undefined) throw new Error();
      return JSON.parse(textValue);
    } catch {
      throw new TypeError(`${label} must contain plain JSON data.`);
    }
  }

  return Object.freeze({
    DECIMAL,
    boolean,
    booleanOrNull,
    cloneJson,
    context,
    dateOrNull,
    dateTime,
    decimal,
    imageReference,
    imageReferences,
    integer,
    list,
    money,
    normalizeHttpsUrl,
    nullableText,
    oneOf,
    plain,
    rawText,
    safeHandle,
    sha256Hex,
    stableKey,
    text
  });
});
