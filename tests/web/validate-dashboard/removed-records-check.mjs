import { assert, reloadDashboard } from "./assert-build-chooser-reload-and-inventory-state.mjs";
import { loadFixture, setViewport } from "./captures-viewport-and-fixture-loading.mjs";
import { evaluate } from "./chrome-process-and-devtools-commands.mjs";

// A record RSI no longer lists is shown first, in its own colour, with wording that carries the meaning by itself.
export async function checkRemovedRecords() {
  await reloadDashboard();
  await loadFixture('removed-records-fixture.json', `
    const removal = { lastSeenAt: '2026-11-01T12:00:00.000Z', firstMissingAt: '2026-11-19T12:00:00.000Z', returnedAt: null };
    const ghost = documentCopy.pledges[documentCopy.pledges.length - 1];
    ghost.state = 'not-reconcilable';
    ghost.removal = removal;
    const returned = documentCopy.pledges[0];
    returned.removal = { ...removal, returnedAt: '2026-11-19T12:00:00.000Z' };
    const ghostBuyback = documentCopy.buybacks[documentCopy.buybacks.length - 1];
    ghostBuyback.state = 'not-reconcilable';
    ghostBuyback.removal = removal;
    window.__removed = { ghost: ghost.recordKey, returned: returned.recordKey, ghostBuyback: ghostBuyback.recordKey, pledges: documentCopy.pledges.length, buybacks: documentCopy.buybacks.length };
  `);
  // Text against the row's own background, measured from the computed colours: 4.5 to 1 for normal text.
  const rowState = (view, key, select = false) => evaluate(`(() => {
    document.querySelector('[data-view="${view}"]').click();
    const row = document.querySelector('#inventoryRows tr[data-record-key="' + window.__removed[${JSON.stringify(key)}] + '"]');
    // The dashboard selects the first row by itself, so the row is measured unselected only after another is chosen.
    if (${select}) row.querySelector('.record-button').click();
    else [...document.querySelectorAll('#inventoryRows tr')].filter((other) => other !== row).at(-1).querySelector('.record-button').click();
    const channels = (value) => value.match(/[0-9.]+/g).slice(0, 3).map(Number);
    const luminance = (value) => { const [r, g, b] = channels(value).map((channel) => { const c = channel / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    const ratio = (foreground, background) => { const [high, low] = [luminance(foreground), luminance(background)].sort((left, right) => right - left); return (high + 0.05) / (low + 0.05); };
    const cells = [...row.querySelectorAll('td')];
    const backgrounds = [...new Set(cells.map((cell) => getComputedStyle(cell).backgroundColor))];
    // Only a removed record carries a label; every row shows its amount in that cell.
    const label = row.querySelector('.state-label');
    const texts = [label, row.querySelector('.inventory-amount'), row.querySelector('.record-button b'), row.querySelector('.record-button small'), ...cells.slice(1)].filter(Boolean);
    const labelBox = (label ?? row).getBoundingClientRect();
    const rowBox = row.getBoundingClientRect();
    return {
      first: document.querySelector('#inventoryRows tr') === row, classes: [...row.classList].sort(), label: label?.textContent ?? null, amount: row.querySelector('.inventory-amount')?.textContent ?? null, backgrounds, channels: channels(backgrounds[0]),
      lowestContrast: Math.min(...texts.map((node) => ratio(getComputedStyle(node).color, backgrounds[0]))),
      labelInsideRow: labelBox.left >= rowBox.left - 1 && labelBox.right <= rowBox.right + 1 && labelBox.width > 0,
      hangar: document.querySelector('#hangarTotal').textContent + '/' + document.querySelector('#hangarTabCount').textContent + '/' + document.querySelector('#railHangarCount').textContent,
      buybacks: document.querySelector('#buybackTotal').textContent + '/' + document.querySelector('#buybacksTabCount').textContent + '/' + document.querySelector('#railBuybackCount').textContent,
      rows: document.querySelectorAll('#inventoryRows tr').length, counts: window.__removed,
      facts: [...document.querySelectorAll('#inspectorFacts > div')].map((fact) => [fact.querySelector('dt').textContent, fact.querySelector('dd').textContent]),
      note: document.querySelector('#inspectorNote').textContent
    };
  })()`);
  for (const width of [1440, 380]) {
    await setViewport(width);
    const ghost = await rowState('hangar', 'ghost');
    const [red, green, blue] = ghost.channels;
    assert(
      ghost.first && ghost.classes.includes('record-ghost') && ghost.label === 'POTENTIAL GHOST REMOVAL' && typeof ghost.amount === 'string' && ghost.amount.length > 0 && ghost.backgrounds.length === 1,
      `${width}: a potential ghost removal is not the first hangar row with its own label and one row colour: ${JSON.stringify(ghost)}`
    );
    assert(red > green * 2 && red > blue * 2, `${width}: the potential ghost removal row is not red: ${ghost.backgrounds[0]}`);
    assert(ghost.lowestContrast >= 4.5 && ghost.labelInsideRow, `${width}: the potential ghost removal row is not readable (lowest contrast ${ghost.lowestContrast.toFixed(2)}, label inside row ${ghost.labelInsideRow}).`);
    // The account's counts are what RSI lists; the removed record is shown in the list without being counted.
    assert(ghost.rows === ghost.counts.pledges && ghost.hangar === `${ghost.counts.pledges - 1}/${ghost.counts.pledges - 1}/${ghost.counts.pledges - 1} records`, `${width}: a removed pledge was counted as held: ${ghost.hangar} for ${ghost.rows} rows`);
    const selected = await rowState('hangar', 'ghost', true);
    assert(
      selected.classes.includes('selected') && selected.backgrounds[0] !== ghost.backgrounds[0] && selected.channels[0] > selected.channels[1] * 2 && selected.lowestContrast >= 4.5,
      `${width}: the selected potential ghost removal row lost its colour or its contrast: ${JSON.stringify(selected.backgrounds)} ${selected.lowestContrast.toFixed(2)}`
    );
    assert(JSON.stringify(selected.facts.filter(([name]) => ['State', 'Last Seen', 'First Missing', 'Listed Again', 'Hangar Log'].includes(name))) === JSON.stringify([
      ["State", "POTENTIAL GHOST REMOVAL"], ["Last Seen", "November 1, 2026"], ["First Missing", "November 19, 2026"], ["Hangar Log", "No entry names this pledge"]
    ]) && selected.note.includes('Keep your earlier backup files'), `${width}: the inspector did not state the facts of a potential ghost removal: ${JSON.stringify(selected.facts)} ${selected.note}`);
    // A buy-back is shown the same way: the rule and the wording are the same for both lists.
    const ghostBuyback = await rowState('buybacks', 'ghostBuyback', true);
    assert(
      ghostBuyback.first && ghostBuyback.classes.includes('record-ghost') && ghostBuyback.label === 'POTENTIAL GHOST REMOVAL' && ghostBuyback.lowestContrast >= 4.5 && ghostBuyback.labelInsideRow && ghostBuyback.channels[0] > ghostBuyback.channels[1] * 2,
      `${width}: a buy-back RSI no longer lists is not shown first under the same label and colour: ${JSON.stringify(ghostBuyback)}`
    );
    assert(ghostBuyback.buybacks === `${ghostBuyback.counts.buybacks - 1}/${ghostBuyback.counts.buybacks - 1}/${ghostBuyback.counts.buybacks - 1} `
      + `records` && ghostBuyback.facts.some(([name, value]) => name === 'Hangar Log' && value === 'No entry names this buy-back') && ghostBuyback.note.includes('Keep your earlier backup files'), `${width}: a removed buy-back was counted as held or its `
      + `inspector did not state the facts: ${JSON.stringify(ghostBuyback.facts)} ${ghostBuyback.buybacks}`);
  }
  await setViewport(1440);
  const returned = await rowState('hangar', 'returned', true);
  assert(!returned.classes.some((name) => name.startsWith('record-')) && returned.label === null && returned.facts.some(([name, value]) => name === 'Listed Again' && value === 'November 19, 2026') && returned.facts.some(([name,
    value]) => name === 'State' && value === 'current') && !returned.facts.some(([name]) => name === 'Hangar Log'), `A record RSI lists again should look like any other and keep its history: ${JSON.stringify(returned)}`);
  // The wording can be searched for, since the stored state is named differently.
  const found = await evaluate(`(() => {
    const search = document.querySelector('#recordSearch');
    search.value = 'ghost removal';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    const keys = [...document.querySelectorAll('#inventoryRows tr')].map((row) => row.dataset.recordKey);
    search.value = '';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    return { keys, ghost: window.__removed.ghost };
  })()`);
  assert(JSON.stringify(found.keys) === JSON.stringify([found.ghost]), `Searching for the label did not find the potential ghost removal alone: ${JSON.stringify(found)}`);
}
