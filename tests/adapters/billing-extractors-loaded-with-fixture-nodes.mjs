await import("../../extension/adapters/billing-extractors.js");

export const Extractors = globalThis.CitizenDataBillingExtractors;
export const baseUrl = "https://robertsspaceindustries.com/en/account/billing?page=1&pagesize=100";

export function anchor(href) {
  return { getAttribute(name) { return name === "href" ? href : null; } };
}

export function field(label, value) {
  return {
    querySelector() { return { textContent: label }; },
    cloneNode() { return { textContent: value, querySelector() { return { remove() {} }; } }; }
  };
}

export function strongField(label, value) {
  const boundary = { tagName: "BR", textContent: "", nextSibling: null };
  const valueNode = { textContent: value, nextSibling: boundary };
  return { textContent: `${label}:`, nextSibling: valueNode };
}
