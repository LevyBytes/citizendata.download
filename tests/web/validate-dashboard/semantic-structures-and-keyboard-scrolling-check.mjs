import { assert, reloadDashboard } from "./assert-build-chooser-reload-and-inventory-state.mjs";
import { command, evaluate, waitFor } from "./chrome-process-and-devtools-commands.mjs";

// The page's collections and groups as semantic elements (audit item 6): the badge, membership and thumbnail
// collections are lists of their links or buttons; the referral search is a search landmark; the organization file
// actions a named group; the inventory's scroll area a named region without a tab stop of its own, which the keyboard
// still scrolls: Tab moves through the rows' buttons and brings each into view, so every row is reached; and the
// full-size image link has a destination and a name.

const LISTS = `(() => {
  const list = (selector, child) => { const node = document.querySelector(selector); const items = [...node.children];
    return { tag: node.localName, items: items.length, wrong: items.filter((item) => item.localName !== 'li' || item.children.length !== 1 || item.children[0].localName !== child).length }; };
  return { unlocked: list('#unlockedBadgeGrid', 'a'), unlockable: list('#unlockableBadgeGrid', 'a'), memberships: list('#membershipList', 'button'),
    inspector: list('#inspectorGalleryThumbnails', 'button'), gallery: list('#mediaGalleryThumbnails', 'button') };
})()`;

async function press(key, code, keyCode) {
  await command("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode: keyCode });
  await command("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: keyCode });
}

export async function checkSemanticStructures() {
  await reloadDashboard();
  // A record with images, selected, and its gallery open: every collection has entries.
  await evaluate("document.querySelector('.media-gallery-trigger').closest('tr').querySelector('.record-button').click(); document.querySelector('.media-gallery-trigger').click(); true");
  await waitFor("document.querySelector('#mediaGalleryDialog').open && document.querySelector('#mediaGalleryThumbnails').children.length > 0 && document.querySelector('#inspectorGalleryThumbnails').children.length > 0");
  const lists = await evaluate(LISTS);
  const misshapen = Object.entries(lists).filter(([, list]) => list.tag !== "ul" || list.items === 0 || list.wrong > 0);
  assert(misshapen.length === 0, `A collection is not a list of its links or buttons: ${JSON.stringify(misshapen)}`);
  const link = await evaluate("(() => { const link = document.querySelector('#mediaGalleryFull'); return { href: link.getAttribute('href'), named: Boolean(link.getAttribute('aria-label') || link.querySelector('img').alt) }; })()");
  assert(Boolean(link.href) && link.named, `The full-size image link lacks a destination or a name: ${JSON.stringify(link)}`);
  await evaluate("document.querySelector('#mediaGalleryDialog').close(); true");

  // The accessibility tree the browser builds from them, with the panels that hold them open.
  await evaluate(`(() => { window.__closedPanels = ['#unlockedBadgeGrid', '#membershipList'].map((selector) => document.querySelector(selector).closest('details')).filter((panel) => panel && !panel.open);
    for (const panel of window.__closedPanels) panel.open = true; return true; })()`);
  await command("Accessibility.enable");
  const tree = await command("Accessibility.getFullAXTree");
  await command("Accessibility.disable");
  await evaluate("(() => { for (const panel of window.__closedPanels) panel.open = false; return true; })()");
  const nodes = tree.nodes.filter((node) => !node.ignored);
  const has = (role, name) => nodes.some((node) => node.role?.value === role && (name === null || node.name?.value === name));
  const expected = [["list", "RSI account badges"], ["list", "Organization memberships"], ["list", "Selected record image thumbnails"], ["search", null], ["group", "Organization data actions"], ["region", "Account inventory"]];
  const missing = expected.filter(([role, name]) => !has(role, name));
  assert(missing.length === 0, `The accessibility tree lacks: ${JSON.stringify(missing)}`);
  const shell = await evaluate("(() => { const shell = document.querySelector('.table-shell'); return { tag: shell.localName, tabindex: shell.getAttribute('tabindex'), role: shell.getAttribute('role'), search: " +
    "document.querySelector('#referralSearchForm').localName }; })()");
  assert(shell.tag === "section" && shell.tabindex === null && shell.role === null && shell.search === "search", `The inventory region or the referral search is not its semantic element: ${JSON.stringify(shell)}`);

  // Keyboard scrolling: with the scroll area shorter than its rows, Tab from the first row's button reaches the last
  // row's button, and the area scrolls so the focused button is in view.
  await evaluate("document.querySelector('.table-shell').style.maxHeight = '120px'; document.querySelector('.table-shell').scrollTop = 0; document.querySelector('.table-shell .record-button').focus(); true");
  const last = await evaluate("[...document.querySelectorAll('#inventoryRows button')].length");
  for (let index = 1; index < last; index += 1) await press("Tab", "Tab", 9);
  // The rows' buttons alone: the column sort buttons in the table's header come before the first row's.
  const scrolled = await evaluate(`(() => { const shell = document.querySelector('.table-shell'); const buttons = [...shell.querySelectorAll('#inventoryRows button')];
    const area = shell.getBoundingClientRect(); const box = document.activeElement.getBoundingClientRect();
    return { top: shell.scrollTop, room: shell.scrollHeight - shell.clientHeight, onLast: document.activeElement === buttons.at(-1), inView: box.top >= area.top - 1 && box.bottom <= area.bottom + 1 }; })()`);
  await evaluate("document.querySelector('.table-shell').style.maxHeight = ''; true");
  assert(scrolled.room > 0 && scrolled.top > 0 && scrolled.onLast && scrolled.inView, `Tab did not reach and scroll to the inventory's last row: ${JSON.stringify(scrolled)}`);
}
