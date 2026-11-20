import { MONTHS } from "./page-sizes-and-ship-names.mjs";

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/gu, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

// A date that moves one day back per step from a fixed start, so newer records sort first and every run agrees.
export function dayBefore(index) {
  const date = new Date(Date.UTC(2026, 9, 1) - index * 86400000);
  return { long: `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}`, short: `${MONTHS[date.getUTCMonth()].slice(0, 3)} ${date.getUTCDate()} ${date.getUTCFullYear()}`, iso: date.toISOString() };
}

export function money(cents) {
  return `$${(cents / 100).toFixed(2)} USD`;
}

export function pager(page, pageCount, query = "") {
  if (pageCount <= 1) return "";
  const next = page < pageCount ? `<a class="raquo" href="?page=${page + 1}${query}">&raquo;</a>` : "";
  return `<div class="pager"><a href="?page=1${query}">1</a><a href="?page=${pageCount}${query}">${pageCount}</a>${next}</div>`;
}

// RSI splits a shown price into the whole amount and a raised remainder.
export function splitPrice(cents) {
  const [whole, fraction] = (cents / 100).toFixed(2).split(".");
  return `$${whole}<span class="super">.${fraction} <span class="currency">USD</span></span>`;
}
