// Where Switch Account is in the page: below the account avatar, in the account card, and no longer among the top
// bar's actions. Its menu is a manual popover, so the browser shows it in the top layer, which the card cannot clip.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const html = await readFile(new URL("../../docs/index.html", import.meta.url), "utf8");
// The text of the element that opens with `start`, up to its own closing tag, counting nested elements of its name.
function elementFrom(start, name) {
  const from = html.indexOf(start);
  assert.notEqual(from, -1, `${start} is not in the page`);
  const tags = new RegExp(`<${name}\\b|</${name}>`, "gu");
  tags.lastIndex = from;
  let depth = 0;
  for (let match = tags.exec(html); match; match = tags.exec(html)) {
    depth += match[0].startsWith("</") ? -1 : 1;
    if (depth === 0) return html.slice(from, tags.lastIndex);
  }
  throw new Error(`${start} is not closed`);
}

test("Switch Account is not among the top bar's actions, which keep Load JSON and Build", () => {
  const actions = elementFrom('<div class="top-actions">', "div");
  assert.equal(actions.includes('id="switchAccountButton"'), false);
  assert.equal(actions.includes('id="accountPopup"'), false);
  assert.ok(actions.includes('id="loadButton"') && actions.includes('id="buildButton"'));
  assert.equal(html.includes("account-switcher"), false);
});

test("the button follows the avatar in the account controls, the first part of the account card's identity", () => {
  const main = elementFrom('<div class="identity-main">', "div");
  const controls = elementFrom('<div class="identity-account-controls">', "div");
  assert.ok(main.slice('<div class="identity-main">'.length).trimStart().startsWith('<div class="identity-account-controls">'));
  const avatar = elementFrom('<div class="avatar" id="avatar"', "div");
  const afterAvatar = controls.slice(controls.indexOf(avatar) + avatar.length).trimStart();
  const button = '<button class="button button-quiet switch-account-button" type="button" id="switchAccountButton" aria-haspopup="menu" aria-expanded="false" '
    + 'aria-controls="accountMenu">Switch Account<span class="switch-account-arrow" aria-hidden="true"></span></button>';
  assert.ok(afterAvatar.startsWith(button), afterAvatar.slice(0, 200));
  assert.ok(controls.includes('<div class="account-popup" id="accountPopup" popover="manual" hidden>'));
  assert.ok(controls.includes('id="accountMenu" role="menu" aria-labelledby="switchAccountButton"'));
});
