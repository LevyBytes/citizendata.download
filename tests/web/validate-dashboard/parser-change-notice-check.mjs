import { assert } from "./assert-build-chooser-reload-and-inventory-state.mjs";
import { setViewport } from "./captures-viewport-and-fixture-loading.mjs";
import { evaluate, waitFor } from "./chrome-process-and-devtools-commands.mjs";
import { quiet } from "./polling-intervals.mjs";
import { emit, entries, frame, ISSUES, LONG_CODE, MODEL_NOTICES, ONE, TWO, change, running } from "./parserchangenoticetextsandstatuses.mjs";

// The notice that RSI changed a page (PARSER_HARDENING.md §11.4): its exact prose and separate technical line, its
// two links carrying the section id, the code and the HTTP status and nothing else, 13 px prose, no sideways overflow,
// one stable append per entry, no open, expand, focus or scroll of the panel, W-27 with the notice for a stop, and an
// empty notice once the next run starts. It runs after the Build Status check, through that check's synthetic bridge.

export async function checkParserChangeNotice() {
  const failures = await evaluate(MODEL_NOTICES);
  assert(failures.length === 0, `The notice's texts or links: ${failures.join(" | ")}`);

  // The markup: the first child of the panel's body, an alert region that is not atomic, hidden while empty.
  const markup = await evaluate(`(() => { const notice = document.querySelector('#parserChangeNotice');
    return [document.querySelector('#parserOverlayBody').firstElementChild === notice, notice.className, notice.getAttribute('role'), notice.getAttribute('aria-atomic'), notice.hidden, notice.children.length]; })()`);
  assert(JSON.stringify(markup) === JSON.stringify([true, "parser-change-notice", "alert", "false", true, 0]), `The notice's markup differs from the plan: ${JSON.stringify(markup)}`);

  // A notice that arrives while the panel is closed leaves it closed; it is appended once.
  await evaluate("document.querySelector('#parserOverlay').hidden = true");
  await emit(running(ONE, 58));
  await waitFor("document.querySelectorAll('#parserChangeNotice .parser-change-entry').length === 1");
  assert(await evaluate("document.querySelector('#parserOverlay').hidden"), "A notice opened the closed panel.");

  // Opened by Build, minimized by the user: a new entry keeps the panel minimized, the focus where it was and the
  // panel's scroll; the first entry keeps its node.
  await evaluate("document.querySelector('#buildButton').click()");
  await waitFor("!document.querySelector('#parserOverlay').hidden");
  await evaluate("document.querySelector('#parserOverlay').classList.contains('minimized') || document.querySelector('#minimizeOverlay').click()");
  await evaluate("window.__wp7 = { first: document.querySelector('#parserChangeNotice .parser-change-entry') }; document.querySelector('#buildButton').focus(); true");
  await emit(running(TWO, 59));
  await waitFor("document.querySelectorAll('#parserChangeNotice .parser-change-entry').length === 2");
  const kept = await evaluate(`(() => ({ minimized: document.querySelector('#parserOverlay').classList.contains('minimized'), expanded: document.querySelector('#minimizeOverlay').getAttribute('aria-expanded'),
    focus: document.activeElement === document.querySelector('#buildButton'), first: document.querySelector('#parserChangeNotice .parser-change-entry') === window.__wp7.first }))()`);
  assert(kept.minimized && kept.expanded === "false" && kept.focus && kept.first, `A new notice entry changed the panel, the focus or the first entry: ${JSON.stringify(kept)}`);

  // The same entries again append nothing and change nothing in the notice.
  const unchanged = await evaluate(`new Promise((resolve) => { const records = []; const observer = new MutationObserver((list) => records.push(...list));
    observer.observe(document.querySelector('#parserChangeNotice'), { subtree: true, childList: true, characterData: true, attributes: true });
    window.__wp6.emit(Object.assign(window.__wp6.running({ runId: 'run-wp7', detectedChanges: ${TWO} }), { statusRevision: 60 }));
    setTimeout(() => { observer.disconnect(); resolve(records.length); }, 300); })`);
  assert(unchanged === 0 && await entries() === 2, `A repeated status changed the notice: ${unchanged} changes`);

  // Expanded: the exact content, the technical line apart from the prose, 13 px prose, and the links.
  await evaluate("document.querySelector('#minimizeOverlay').click()");
  await frame();
  const shown = await evaluate(`(() => { const entry = document.querySelector('#parserChangeNotice .parser-change-entry'); const parts = [...entry.children];
    const links = [...entry.querySelectorAll('a')];
    return { tags: parts.map((part) => part.tagName + (part.className ? '.' + part.className : '')).join(','), texts: parts.map((part) => part.textContent),
      sizes: [...entry.querySelectorAll('b, p')].map((part) => parseFloat(getComputedStyle(part).fontSize)), mono: getComputedStyle(entry.querySelector('.parser-change-technical')).fontFamily,
      links: links.map((link) => [link.textContent, link.getAttribute('href'), link.target, link.rel]), html: entry.innerHTML.includes('<script') };
  })()`);
  assert(shown.tags === "B,P,P.parser-change-technical,P,P"
    && JSON.stringify(shown.texts.slice(0, 4)) === JSON.stringify(["RSI CHANGED A PAGE: Buybacks", "This version can't read it. Skipped; the build continues. Also skipped: Buyback prices.", "Code: RSI_PAGE_NOT_RECOGNIZED",
      "Please confirm an existing GitHub issue, or report a new one."])
    && shown.texts[4] === "Existing issues New issue" && shown.sizes.every((size) => size >= 13) && /monospace/u.test(shown.mono) && !shown.html,
  `The notice entry differs from the plan: ${JSON.stringify(shown)}`);
  const body = "Section: buybacks\nCode: RSI_PAGE_NOT_RECOGNIZED\nHTTP status: 200\nAdd anything else you noticed. Do not paste account data.";
  const expectedLinks = [
    ["Existing issues", `${ISSUES}?q=${encodeURIComponent("is:issue RSI_PAGE_NOT_RECOGNIZED")}`, "_blank", "noopener noreferrer"],
    ["New issue", `${ISSUES}/new?title=${encodeURIComponent("RSI page changed: buybacks (RSI_PAGE_NOT_RECOGNIZED)")}&body=${encodeURIComponent(body)}`, "_blank", "noopener noreferrer"]
  ];
  assert(JSON.stringify(shown.links) === JSON.stringify(expectedLinks), `The notice's links differ from the plan: ${JSON.stringify(shown.links)}`);
  assert(await evaluate("document.querySelector('#supportIssues').getAttribute('href')") === ISSUES, "The notice's address is not the one the dashboard links.");

  // A long code wraps inside the panel at half the width, with no sideways scroll.
  const viewport = await evaluate("[window.innerWidth, window.innerHeight]");
  await setViewport(Math.round(viewport[0] / 2), Math.round(viewport[1] / 2));
  await frame();
  const overflow = await evaluate(`(() => { const overlay = document.querySelector('#parserOverlay'); const entry = document.querySelectorAll('#parserChangeNotice .parser-change-entry')[1];
    return { overlay: overlay.scrollWidth <= overlay.clientWidth + 1, entry: entry.scrollWidth <= entry.clientWidth + 1, code: entry.querySelector('.parser-change-technical').textContent }; })()`);
  await setViewport(viewport[0], viewport[1]);
  assert(overflow.overlay && overflow.entry && overflow.code === `Code: ${LONG_CODE}`, `A long code made the notice scroll sideways: ${JSON.stringify(overflow)}`);

  // A run that a change stopped: W-27 in the panel and the same notice, its sentence the stop's.
  await emit(`Object.assign({ status: 'failed', hasActiveJob: false, continuable: false, activeJob: window.__wp6.job({ runId: 'run-wp7', status: 'failed', currentSection: 'profile',
    failure: { code: 'RSI_READ_FAILED', message: 'Changed.', detail: { signal: { kind: 'contract', code: 'RSI_PUBLIC_DOSSIER_CONTRACT_CHANGED' }, diagnosis: null } },
    detectedChanges: [...${TWO}, ${change("{ section: 'profile', code: 'RSI_PUBLIC_DOSSIER_CONTRACT_CHANGED', httpStatus: 410, setAside: false, dependents: [], at: '2026-11-21T00:09:00.000Z' }")}] }) }, { statusRevision: 61 })`);
  await waitFor("document.querySelectorAll('#parserChangeNotice .parser-change-entry').length === 3");
  const stop = await evaluate(`(() => { const entry = document.querySelectorAll('#parserChangeNotice .parser-change-entry')[2];
    return [document.querySelector('#overlayDetail').textContent, entry.querySelector('p').textContent, entry.querySelector('.parser-change-technical').textContent]; })()`);
  assert(JSON.stringify(stop) === JSON.stringify(["RSI changed a schema. Please report it on GitHub.", "This version can't read it. The build stopped here.", "Code: RSI_PUBLIC_DOSSIER_CONTRACT_CHANGED"]),
    `The stop's W-27 or notice differs: ${JSON.stringify(stop)}`);

  // The next run starts: the notice empties and hides.
  await emit(running("[]", 62, "run-wp7-next"));
  await waitFor("document.querySelector('#parserChangeNotice').hidden && document.querySelectorAll('#parserChangeNotice .parser-change-entry').length === 0");
  await quiet();
  await emit("Object.assign({ status: 'idle', hasActiveJob: false, activeJob: null }, { statusRevision: 63 })");
  await evaluate("document.querySelector('#parserOverlay').hidden = true");
}
