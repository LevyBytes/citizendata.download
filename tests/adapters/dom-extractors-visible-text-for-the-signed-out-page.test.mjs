// The signed-out page is recognised from the text a reader sees, read without layout and within a bound (audit item
// 6): the three phrases in separate blocks are found; the same phrases only in script, style, template, noscript or
// hidden content are not; and a page past the bound is not read whole.
import assert from "node:assert/strict";
import test from "node:test";
import { DOMParser } from "../support/mini-dom.mjs";
import "./dom-extractors-loaded-with-fixture-nodes.mjs";

const Extractors = globalThis.CitizenDataDomExtractors;
const parse = (body) => new DOMParser().parseFromString(`<html><head><title>My Hangar</title></head><body>${body}</body></html>`, "text/html");
const PHRASES = ["Restricted Area", "Authorized Personnel Only", "You must be authenticated to reach this area."];

test("the signed-out page's phrases in separate blocks are read as one visible text", () => {
  const page = parse(`<main><h1>${PHRASES[0]}</h1><div><p>${PHRASES[1]}</p><p><span>${PHRASES[2]}</span></p></div></main>`);
  assert.deepEqual(Extractors.extractSessionIdentity(page), { state: "signed-out", handle: null });
});

test("the phrases only in content no reader sees do not make a page signed out", () => {
  for (const [name, wrap] of [
    ["script", (text) => `<script>const message = "${text}";</script>`],
    ["style", (text) => `<style>/* ${text} */</style>`],
    ["template", (text) => `<template><p>${text}</p></template>`],
    ["noscript", (text) => `<noscript>${text}</noscript>`],
    ["hidden", (text) => `<div hidden><p>${text}</p></div>`],
    ["aria-hidden", (text) => `<div aria-hidden="true">${text}</div>`],
    ["display none", (text) => `<div style="color: red; display: none">${text}</div>`],
    ["visibility hidden", (text) => `<div style="visibility:hidden">${text}</div>`]
  ]) {
    const page = parse(`<main><h1>My Hangar</h1>${PHRASES.map(wrap).join("")}</main>`);
    assert.notEqual(Extractors.extractSessionIdentity(page).state, "signed-out", name);
  }
});

test("a page past the bound is not read whole: phrases after 100,000 visible characters are not reached", () => {
  const filler = `<p>${"Hangar entry. ".repeat(8_000)}</p>`;
  const page = parse(`${filler}<h1>${PHRASES[0]}</h1><p>${PHRASES[1]}</p><p>${PHRASES[2]}</p>`);
  const started = performance.now();
  assert.notEqual(Extractors.extractSessionIdentity(page).state, "signed-out");
  assert.ok(performance.now() - started < 1_000, "the bounded walk is quick");
  // Within the bound, the same page is recognised.
  const short = parse(`<p>${"Hangar entry. ".repeat(100)}</p><h1>${PHRASES[0]}</h1><p>${PHRASES[1]}</p><p>${PHRASES[2]}</p>`);
  assert.equal(Extractors.extractSessionIdentity(short).state, "signed-out");
});
