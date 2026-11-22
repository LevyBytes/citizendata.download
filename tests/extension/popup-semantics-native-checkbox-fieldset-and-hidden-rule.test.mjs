// The popup's accessibility semantics (audit item 6): the build history setting is a native checkbox, whose checked
// state needs no ARIA kept in step; the question asked when it is turned off is a fieldset named by its legend; and
// the hidden attribute hides an element by a last [hidden] rule, without !important.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DOMParser } from "../support/mini-dom.mjs";

const html = await readFile(new URL("../../extension/popup/popup.html", import.meta.url), "utf8");
const css = await readFile(new URL("../../extension/popup/popup.css", import.meta.url), "utf8");
const document = new DOMParser().parseFromString(html, "text/html");

test("the build history setting is a native checkbox with no ARIA role or state of its own", () => {
  const input = document.querySelector("#historyEnabled");
  assert.equal(input.getAttribute("type"), "checkbox");
  for (const attribute of ["role", "aria-checked", "aria-pressed"]) assert.equal(input.getAttribute(attribute) ?? null, null, attribute);
  assert.equal(input.parentNode.localName, "label", "the visible text labels it");
});

test("the question when history is turned off is a fieldset whose legend names it", () => {
  const group = document.querySelector("#historyOffQuestion");
  assert.equal(group.localName, "fieldset");
  assert.equal(group.getAttribute("role") ?? null, null);
  assert.equal(group.children[0].localName, "legend");
  assert.equal(group.children[0].getAttribute("id"), "historyOffText");
  assert.deepEqual(group.children.slice(1).map((child) => child.localName), ["button", "button"]);
});

test("[hidden] is the stylesheet's last rule and needs no !important", () => {
  assert.equal(css.includes("!important"), false);
  const rules = css.replace(/\/\*[\s\S]*?\*\//gu, "").split("}").map((rule) => rule.trim()).filter(Boolean);
  assert.equal(rules.at(-1), "[hidden] { display: none;");
  // No rule of higher specificity sets display on an element the popup hides by its attribute.
  for (const id of ["approvalView", "approvalNote", "approvalActions", "historyOffQuestion", "historyRecoveryNote", "imagesDelete", "historyProblem", "openExtensionDetails", "grantRsiAccess"]) {
    assert.equal(new RegExp(`#${id}\\b[^{]*\\{[^}]*display`, "u").test(css), false, id);
  }
});
