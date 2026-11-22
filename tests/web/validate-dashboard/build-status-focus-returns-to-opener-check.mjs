import { assert } from "./assert-build-chooser-reload-and-inventory-state.mjs";
import { loadFixture } from "./captures-viewport-and-fixture-loading.mjs";
import { evaluate, waitFor } from "./chrome-process-and-devtools-commands.mjs";

// Final acceptance criterion 31 of PARSER_HARDENING.md: closing Build Status returns focus to the control that
// explicitly opened it. Build, and the roster action through its Build Orgs JSON dialog, are each given focus back; a
// choice inside the panel keeps the opener it was reached from; an opener that is gone, hidden or disabled hands focus
// to Build. It runs after the focused steps, through the caution check's synthetic bridge, which declines each start.

const active = "document.activeElement?.id || document.activeElement?.tagName";
const closePanel = "document.querySelector('#closeOverlay').focus(); document.querySelector('#closeOverlay').click()";

async function closedTo(expected, message) {
  await evaluate(closePanel);
  const focused = await evaluate(active);
  assert(await evaluate("document.querySelector('#parserOverlay').hidden") && focused === expected, `${message}: focus is on ${focused}`);
}

// The roster action opens Build Orgs JSON, as a keyboard user would (focused first) or as a mouse does in a browser
// that does not focus a clicked button; Start begins the chosen roster, and the declined start leaves Build Status
// open behind its message, which is then closed.
async function openFromRosterAction({ focused = true } = {}) {
  await evaluate(`(() => { const button = document.querySelector('#buildOrgButton'); ${focused ? "button.focus();" : "document.activeElement?.blur();"} button.click(); return true; })()`);
  await waitFor("document.querySelector('#orgBuildDialog').open");
  await evaluate(`(() => { const first = document.querySelector('#orgRosterChecklist input[type=checkbox]'); first.checked = true; first.dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector('#orgBuildStart').click(); return true; })()`);
  await waitFor("!document.querySelector('#orgBuildDialog').open && document.querySelector('#messageDialog').open && !document.querySelector('#parserOverlay').hidden");
  await evaluate("document.querySelector('#messageDialog .button-primary').click()");
  await waitFor("!document.querySelector('#messageDialog').open");
}

export async function checkBuildStatusFocusReturnsToOpener() {
  assert(await evaluate("Boolean(window.__wp6)"), "The caution check's synthetic bridge is not connected.");
  // A start the extension declines plainly, with no cool-down, and an idle status.
  await evaluate(`(() => { window.__wp6.start = { ok: false, code: 'TEST_DECLINED', message: 'Synthetic start declined.' };
    window.__wp6.emit(Object.assign({ status: 'idle', hasActiveJob: false, activeJob: null, retryNotBefore: null }, { statusRevision: 80 }));
    document.querySelector('#parserOverlay').hidden = true; return true; })()`);
  // The roster action needs an account of the user's own with organizations: the example account, as a local file.
  await loadFixture("focus-return-account.json");
  await waitFor("!document.querySelector('#buildOrgButton').disabled");

  // Build opens the panel; a choice inside it keeps Build as the opener.
  await evaluate("document.querySelector('#buildButton').focus(); document.querySelector('#buildButton').click()");
  await waitFor("!document.querySelector('#parserOverlay').hidden && !document.querySelector('#buildChoices').hidden");
  await closedTo("buildButton", "Close did not return focus to Build, which opened the panel");
  await evaluate("document.querySelector('#buildButton').click()");
  await waitFor("!document.querySelector('#buildChoices').hidden");
  await evaluate("document.querySelector('#buildAccountAction').focus(); document.querySelector('#buildAccountAction').click()");
  await waitFor("document.querySelector('#messageDialog').open");
  await evaluate("document.querySelector('#messageDialog .button-primary').click()");
  await waitFor("!document.querySelector('#messageDialog').open && !document.querySelector('#parserOverlay').hidden");
  await closedTo("buildButton", "A choice inside the panel took the place of Build as its opener");

  // The roster action opens it: focus goes back to the roster action.
  await openFromRosterAction();
  await closedTo("buildOrgButton", "Close did not return focus to the roster action that opened the panel");
  await openFromRosterAction({ focused: false });
  await closedTo("buildOrgButton", "Close did not return focus to a roster action that a click left unfocused");

  // An opener that is hidden, disabled or gone when the panel closes hands focus to Build.
  for (const [label, change, undo] of [
    ["hidden", "button.hidden = true", "button.hidden = false"],
    ["disabled", "button.disabled = true", "button.disabled = false"],
    ["gone", "window.__opener = { button, parent: button.parentNode, next: button.nextSibling }; button.remove()", "window.__opener.parent.insertBefore(window.__opener.button, window.__opener.next)"]
  ]) {
    await openFromRosterAction();
    await evaluate(`(() => { const button = document.querySelector('#buildOrgButton'); ${change}; return true; })()`);
    await closedTo("buildButton", `An opener that is ${label} did not hand focus to Build`);
    await evaluate(`(() => { const button = window.__opener?.button ?? document.querySelector('#buildOrgButton'); ${undo}; return true; })()`);
  }
  assert(await evaluate("document.querySelectorAll('#buildOrgButton').length === 1"), "The roster action was not put back.");
}
