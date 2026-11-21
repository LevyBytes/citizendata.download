(function exposeAccountDocument(root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.CitizenDataAccountDocument = api;
})(typeof globalThis === "object" ? globalThis : this, (root) => {
  "use strict";

  const HEX_SHA256 = /^[a-f0-9]{64}$/u;
  const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u;
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

  function isObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function pointerSegment(segment) {
    return segment.replaceAll("~1", "/").replaceAll("~0", "~");
  }

  function resolveReference(rootSchema, reference) {
    if (typeof reference !== "string" || !reference.startsWith("#/")) throw new Error(`Unsupported schema reference: ${reference}`);
    let current = rootSchema;
    for (const rawSegment of reference.slice(2).split("/")) {
      const segment = pointerSegment(rawSegment);
      if (!isObject(current) || !Object.hasOwn(current, segment)) throw new Error(`Unresolved schema reference: ${reference}`);
      current = current[segment];
    }
    return current;
  }

  function typeMatches(value, expected) {
    if (expected === "null") return value === null;
    if (expected === "array") return Array.isArray(value);
    if (expected === "object") return isObject(value);
    if (expected === "integer") return Number.isSafeInteger(value);
    if (expected === "number") return typeof value === "number" && Number.isFinite(value);
    return typeof value === expected;
  }

  function sameJsonValue(left, right) {
    return canonicalize(left) === canonicalize(right);
  }

  function validateFormat(value, format) {
    if (format === "date-time") return DATE_TIME.test(value) && !Number.isNaN(Date.parse(value));
    if (format === "uuid") return UUID.test(value);
    if (format === "uri") {
      try {
        const parsed = new URL(value);
        return Boolean(parsed.protocol);
      } catch {
        return false;
      }
    }
    return true;
  }

  function validateWithSchema(value, schema, options = {}) {
    if (!isObject(schema)) throw new TypeError("A JSON Schema object is required.");
    const rootSchema = options.rootSchema ?? schema;
    const errors = [];
    const maximumErrors = Number.isSafeInteger(options.maximumErrors) && options.maximumErrors > 0 ? options.maximumErrors : 100;

    function add(path, keyword, message) {
      if (errors.length < maximumErrors) errors.push(Object.freeze({ path, keyword, message }));
    }

    function branchValid(candidate, branchSchema) {
      const branch = validateWithSchema(candidate, branchSchema, { rootSchema, maximumErrors: 1 });
      return branch.valid;
    }

    function visit(candidate, currentSchema, path) {
      if (errors.length >= maximumErrors) return;
      if (currentSchema === true) return;
      if (currentSchema === false) {
        add(path, "falseSchema", "Value is rejected by the schema.");
        return;
      }
      if (!isObject(currentSchema)) throw new TypeError(`Invalid schema at ${path}.`);

      if (currentSchema.$ref !== undefined) {
        visit(candidate, resolveReference(rootSchema, currentSchema.$ref), path);
        if (errors.length >= maximumErrors) return;
      }

      if (Array.isArray(currentSchema.allOf)) {
        for (const child of currentSchema.allOf) visit(candidate, child, path);
      }
      if (Array.isArray(currentSchema.oneOf)) {
        const matches = currentSchema.oneOf.filter((child) => branchValid(candidate, child)).length;
        if (matches !== 1) add(path, "oneOf", `Value must match exactly one alternative; matched ${matches}.`);
      }
      if (Array.isArray(currentSchema.anyOf) && !currentSchema.anyOf.some((child) => branchValid(candidate, child))) {
        add(path, "anyOf", "Value must match at least one alternative.");
      }
      if (currentSchema.if !== undefined) {
        const selected = branchValid(candidate, currentSchema.if) ? currentSchema.then : currentSchema.else;
        if (selected !== undefined) visit(candidate, selected, path);
      }

      if (currentSchema.const !== undefined && !sameJsonValue(candidate, currentSchema.const)) add(path, "const", "Value does not match the required constant.");
      if (Array.isArray(currentSchema.enum) && !currentSchema.enum.some((item) => sameJsonValue(candidate, item))) add(path, "enum", "Value is not in the accepted set.");

      if (currentSchema.type !== undefined) {
        const types = Array.isArray(currentSchema.type) ? currentSchema.type : [currentSchema.type];
        if (!types.some((type) => typeMatches(candidate, type))) {
          add(path, "type", `Expected ${types.join(" or ")}.`);
          return;
        }
      }

      if (typeof candidate === "string") {
        if (Number.isSafeInteger(currentSchema.minLength) && candidate.length < currentSchema.minLength) add(path, "minLength", `Text must contain at least ${currentSchema.minLength} characters.`);
        if (Number.isSafeInteger(currentSchema.maxLength) && candidate.length > currentSchema.maxLength) add(path, "maxLength", `Text must contain at most ${currentSchema.maxLength} characters.`);
        if (typeof currentSchema.pattern === "string" && !new RegExp(currentSchema.pattern, "u").test(candidate)) add(path, "pattern", "Text does not match the required pattern.");
        if (typeof currentSchema.format === "string" && !validateFormat(candidate, currentSchema.format)) add(path, "format", `Text is not a valid ${currentSchema.format}.`);
      }

      if (typeof candidate === "number") {
        if (!Number.isFinite(candidate)) add(path, "finite", "Numbers must be finite.");
        if (typeof currentSchema.minimum === "number" && candidate < currentSchema.minimum) add(path, "minimum", `Number must be at least ${currentSchema.minimum}.`);
        if (typeof currentSchema.maximum === "number" && candidate > currentSchema.maximum) add(path, "maximum", `Number must be at most ${currentSchema.maximum}.`);
      }

      if (Array.isArray(candidate)) {
        if (Number.isSafeInteger(currentSchema.minItems) && candidate.length < currentSchema.minItems) add(path, "minItems", `Array must contain at least ${currentSchema.minItems} items.`);
        if (Number.isSafeInteger(currentSchema.maxItems) && candidate.length > currentSchema.maxItems) add(path, "maxItems", `Array must contain at most ${currentSchema.maxItems} items.`);
        if (currentSchema.uniqueItems === true) {
          const seen = new Set();
          for (const item of candidate) {
            const key = canonicalize(item);
            if (seen.has(key)) {
              add(path, "uniqueItems", "Array items must be unique.");
              break;
            }
            seen.add(key);
          }
        }
        if (currentSchema.items !== undefined) candidate.forEach((item, index) => visit(item, currentSchema.items, `${path}/${index}`));
      }

      if (isObject(candidate)) {
        const properties = isObject(currentSchema.properties) ? currentSchema.properties : {};
        if (Array.isArray(currentSchema.required)) {
          for (const key of currentSchema.required) if (!Object.hasOwn(candidate, key)) add(path, "required", `Required property ${JSON.stringify(key)} is missing.`);
        }
        if (currentSchema.propertyNames !== undefined) for (const key of Object.keys(candidate)) visit(key, currentSchema.propertyNames, `${path}/<propertyName>`);
        for (const [key, item] of Object.entries(candidate)) {
          const itemPath = `${path}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`;
          if (Object.hasOwn(properties, key)) visit(item, properties[key], itemPath);
          else if (currentSchema.additionalProperties === false) add(itemPath, "additionalProperties", `Unexpected property ${JSON.stringify(key)}.`);
          else if (isObject(currentSchema.additionalProperties) || typeof currentSchema.additionalProperties === "boolean") visit(item, currentSchema.additionalProperties, itemPath);
        }
      }
    }

    visit(value, schema, "$");
    return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
  }

  function assertValid(value, schema, label = "JSON document") {
    const result = validateWithSchema(value, schema);
    if (result.valid) return value;
    const summary = result.errors.slice(0, 8).map((error) => `${error.path}: ${error.message}`).join("\n");
    const problem = new Error(`${label} does not satisfy its schema:\n${summary}`);
    problem.code = "SCHEMA_VALIDATION_FAILED";
    problem.validationErrors = result.errors;
    throw problem;
  }

  function validateUnicode(value) {
    for (let index = 0; index < value.length; index += 1) {
      const code = value.charCodeAt(index);
      if (code >= 0xd800 && code <= 0xdbff) {
        const next = value.charCodeAt(index + 1);
        if (!(next >= 0xdc00 && next <= 0xdfff)) throw new TypeError("JCS input contains an unpaired high surrogate.");
        index += 1;
      } else if (code >= 0xdc00 && code <= 0xdfff) {
        throw new TypeError("JCS input contains an unpaired low surrogate.");
      }
    }
  }

  function canonicalize(value, active = new Set()) {
    if (value === null || typeof value === "boolean") return JSON.stringify(value);
    if (typeof value === "string") {
      validateUnicode(value);
      return JSON.stringify(value);
    }
    if (typeof value === "number") {
      if (!Number.isFinite(value)) throw new TypeError("JCS numbers must be finite.");
      return JSON.stringify(value);
    }
    if (typeof value !== "object") throw new TypeError(`JCS cannot encode ${typeof value}.`);
    if (active.has(value)) throw new TypeError("JCS cannot encode circular data.");
    active.add(value);
    try {
      if (Array.isArray(value)) {
        if (Object.keys(value).some((key) => !/^(?:0|[1-9][0-9]*)$/u.test(key) || Number(key) >= value.length)) throw new TypeError("JCS arrays cannot contain named properties.");
        for (let index = 0; index < value.length; index += 1) if (!Object.hasOwn(value, index)) throw new TypeError("JCS arrays cannot contain holes.");
        const output = value.map((item) => {
          return canonicalize(item, active);
        });
        return `[${output.join(",")}]`;
      }
      const prototype = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null) throw new TypeError("JCS objects must be plain JSON objects.");
      const keys = Object.keys(value).sort();
      const output = keys.map((key) => {
        validateUnicode(key);
        return `${JSON.stringify(key)}:${canonicalize(value[key], active)}`;
      });
      return `{${output.join(",")}}`;
    } finally {
      active.delete(value);
    }
  }

  function integrityPayload(document) {
    if (!isObject(document)) throw new TypeError("Account document must be an object.");
    const integrity = isObject(document.integrity) ? document.integrity : {};
    if (integrity.algorithm !== undefined && integrity.algorithm !== "SHA-256") throw new Error("Only SHA-256 document integrity is supported.");
    const payload = { ...document, integrity: { algorithm: "SHA-256" } };
    return canonicalize(payload);
  }

  async function sha256Hex(text) {
    const cryptoApi = root.crypto?.subtle ? root.crypto : (typeof require === "function" ? require("node:crypto").webcrypto : null);
    if (!cryptoApi?.subtle) throw new Error("Web Crypto SHA-256 is unavailable.");
    const bytes = new TextEncoder().encode(text);
    const digest = new Uint8Array(await cryptoApi.subtle.digest("SHA-256", bytes));
    return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  async function calculateIntegrity(document) {
    return sha256Hex(integrityPayload(document));
  }

  async function stampIntegrity(document) {
    const contentHash = await calculateIntegrity(document);
    return { ...document, integrity: { algorithm: "SHA-256", contentHash } };
  }

  async function verifyIntegrity(document) {
    const expected = document?.integrity?.contentHash;
    if (document?.integrity?.algorithm !== "SHA-256" || typeof expected !== "string" || !HEX_SHA256.test(expected)) return false;
    return expected === await calculateIntegrity(document);
  }

  async function acceptAccountDocument(document, schema) {
    assertValid(document, schema, "Account export");
    if (!await verifyIntegrity(document)) {
      const problem = new Error("Account export integrity verification failed.");
      problem.code = "INTEGRITY_VERIFICATION_FAILED";
      throw problem;
    }
    return document;
  }

  // RSI shows this picture where a record has none. It is not an image of the record.
  const RSI_PLACEHOLDER_IMAGE = /^https:\/\/(?:[a-z0-9-]+\.)*robertsspaceindustries\.com\/static\/images\/Temp\/default-image\.png(?:[?#]|$)/iu;

  function isPlaceholderImage(image) {
    const url = typeof image === "string" ? image : image?.url ?? image?.sourceUrl ?? image?.normalizedUrl;
    return typeof url === "string" && RSI_PLACEHOLDER_IMAGE.test(url);
  }

  // Takes that picture out of every list of images a document holds, in place.
  function removePlaceholderImages(value) {
    if (!value || typeof value !== "object") return value;
    for (const [key, child] of Object.entries(value)) {
      if (key !== "images" || !Array.isArray(child)) removePlaceholderImages(child);
      else if (child.some(isPlaceholderImage)) value.images = child.filter((image) => !isPlaceholderImage(image));
    }
    return value;
  }

  return Object.freeze({
    acceptAccountDocument,
    assertValid,
    calculateIntegrity,
    canonicalize,
    integrityPayload,
    isPlaceholderImage,
    removePlaceholderImages,
    stampIntegrity,
    validateWithSchema,
    verifyIntegrity
  });
});
