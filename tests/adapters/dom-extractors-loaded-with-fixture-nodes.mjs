await import("../../extension/adapters/dom-extractors.js");

export function textNode(textContent) {
  return { textContent };
}

export function memberNode({ className, displayName = null, handle = null, rank = null, stars = 0, roles = [] }) {
  const selectors = new Map([
    [".name-wrap .name", displayName ? textNode(displayName) : null],
    [".name-wrap .nick", handle ? textNode(`@${handle}`) : null],
    [".rank .name", rank ? textNode(rank) : null]
  ]);
  return {
    getAttribute(name) { return name === "class" ? className : null; },
    querySelector(selector) { return selectors.get(selector) ?? null; },
    querySelectorAll(selector) {
      if (selector === ".ranking-stars .active, .stars .active") return Array.from({ length: stars }, () => textNode("star"));
      if (selector === ".rolelist .role, .roles .role, .rolelist li") return roles.map(textNode);
      return [];
    }
  };
}
