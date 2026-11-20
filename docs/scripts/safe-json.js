(function exposeSafeJson(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.CitizenDataSafeJson = api;
})(typeof globalThis === "object" ? globalThis : this, () => {
  "use strict";

  const MEBIBYTE = 1024 * 1024;
  const DEFAULT_LIMITS = Object.freeze({
    maxBytes: 128 * MEBIBYTE,
    maxDepth: 64,
    maxNodes: 4000000,
    maxStringLength: 1024 * 1024,
    maxArrayItems: 1000000,
    maxObjectProperties: 50000
  });

  // Sticky matching reads a number in place, without copying the rest of the document.
  const NUMBER_PATTERN = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;

  function parseBoundedJson(source, overrides = {}) {
    if (typeof source !== "string") throw new TypeError("JSON input must be text.");
    const limits = { ...DEFAULT_LIMITS, ...overrides };
    const bytes = new TextEncoder().encode(source).byteLength;
    if (bytes > limits.maxBytes) throw new Error(`JSON exceeds the ${limits.maxBytes}-byte limit.`);

    let index = 0;
    let nodes = 0;

    function fail(message) {
      throw new Error(`${message} at character ${index}.`);
    }

    // JSON permits exactly space, tab, line feed, and carriage return between tokens.
    function skipSpace() {
      while (index < source.length) {
        const code = source.charCodeAt(index);
        if (code !== 32 && code !== 9 && code !== 10 && code !== 13) return;
        index += 1;
      }
    }

    function addNode() {
      nodes += 1;
      if (nodes > limits.maxNodes) fail("JSON contains too many values");
    }

    function parseString() {
      if (source[index] !== '"') fail("Expected a JSON string");
      const start = index;
      index += 1;
      let decodedLength = 0;
      while (index < source.length) {
        const code = source.charCodeAt(index);
        if (code === 34) {
          index += 1;
          const raw = source.slice(start, index);
          const value = JSON.parse(raw);
          if (value.length > limits.maxStringLength || decodedLength > limits.maxStringLength) fail("JSON string is too long");
          return value;
        }
        if (code < 32) fail("Unescaped control character in JSON string");
        if (code === 92) {
          index += 1;
          if (index >= source.length) fail("Incomplete JSON escape");
          if (source[index] === "u") {
            if (!/^[0-9a-fA-F]{4}$/u.test(source.slice(index + 1, index + 5))) fail("Invalid Unicode escape");
            index += 5;
          } else {
            if (!'"\\/bfnrt'.includes(source[index])) fail("Invalid JSON escape");
            index += 1;
          }
        } else {
          index += 1;
        }
        decodedLength += 1;
        if (decodedLength > limits.maxStringLength) fail("JSON string is too long");
      }
      fail("Unterminated JSON string");
    }

    function parseNumber() {
      NUMBER_PATTERN.lastIndex = index;
      if (!NUMBER_PATTERN.test(source)) fail("Invalid JSON number");
      index = NUMBER_PATTERN.lastIndex;
    }

    function parseValue(depth) {
      if (depth > limits.maxDepth) fail("JSON nesting is too deep");
      skipSpace();
      addNode();
      const token = source[index];
      if (token === '"') {
        parseString();
        return;
      }
      if (token === "{") {
        parseObject(depth + 1);
        return;
      }
      if (token === "[") {
        parseArray(depth + 1);
        return;
      }
      for (const literal of ["true", "false", "null"]) {
        if (source.startsWith(literal, index)) {
          index += literal.length;
          return;
        }
      }
      parseNumber();
    }

    function parseObject(depth) {
      index += 1;
      skipSpace();
      const keys = new Set();
      let propertyCount = 0;
      if (source[index] === "}") {
        index += 1;
        return;
      }
      while (index < source.length) {
        skipSpace();
        const key = parseString();
        if (keys.has(key)) fail(`Duplicate JSON key ${JSON.stringify(key)}`);
        keys.add(key);
        propertyCount += 1;
        if (propertyCount > limits.maxObjectProperties) fail("JSON object has too many properties");
        skipSpace();
        if (source[index] !== ":") fail("Expected ':' after JSON key");
        index += 1;
        parseValue(depth);
        skipSpace();
        if (source[index] === "}") {
          index += 1;
          return;
        }
        if (source[index] !== ",") fail("Expected ',' or '}' in JSON object");
        index += 1;
      }
      fail("Unterminated JSON object");
    }

    function parseArray(depth) {
      index += 1;
      skipSpace();
      let itemCount = 0;
      if (source[index] === "]") {
        index += 1;
        return;
      }
      while (index < source.length) {
        itemCount += 1;
        if (itemCount > limits.maxArrayItems) fail("JSON array has too many items");
        parseValue(depth);
        skipSpace();
        if (source[index] === "]") {
          index += 1;
          return;
        }
        if (source[index] !== ",") fail("Expected ',' or ']' in JSON array");
        index += 1;
      }
      fail("Unterminated JSON array");
    }

    skipSpace();
    parseValue(0);
    skipSpace();
    if (index !== source.length) fail("Unexpected trailing JSON content");
    return JSON.parse(source);
  }

  return Object.freeze({ DEFAULT_LIMITS, parseBoundedJson });
});
