import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { assert } from "./assert-build-chooser-reload-and-inventory-state.mjs";
import { command, evaluate } from "./chrome-process-and-devtools-commands.mjs";
import { checkFloatingGeometry } from "./geometry-probe-prelude-and-floating-geometry-check.mjs";
import { POLL_MS, quiet } from "./polling-intervals.mjs";
import { downloadDirectory, exportReceipts } from "./run-options-and-work-folders.mjs";

export async function chooseExport(values) {
  await evaluate(`(() => {
    for (const [id, value] of Object.entries(${JSON.stringify(values)})) {
      const control = document.getElementById(id);
      control.value = value;
      control.dispatchEvent(new Event('change', {bubbles:true}));
    }
  })()`);
}

export async function checkExportPlacement(label) {
  assert(await evaluate(`(() => {
    const support = document.querySelector('#projectSupport').getBoundingClientRect();
    const card = document.querySelector('#exportData').getBoundingClientRect();
    const footer = document.querySelector('.community-footer').getBoundingClientRect();
    const sideBySide = card.left>=support.right-2 && Math.abs(card.top-support.top)<2;
    const stacked = Math.abs(card.left-support.left)<2 && Math.abs(card.width-support.width)<2 && card.top>=support.bottom && card.top-support.bottom<=14;
    return (sideBySide||stacked) && card.bottom<=footer.top && support.bottom<=footer.top;
  })()`), `${label}: Support the project and Export data do not use the intended desktop or stacked layout above the footer.`);
}

export async function checkExportDialog(label) {
  await checkFloatingGeometry('#exportDialog', label);
  const failures = await evaluate(`(() => {
    const failures = [];
    const dialog = document.querySelector('#exportDialog');
    const bounds = dialog.getBoundingClientRect();
    for (const node of dialog.querySelectorAll('select, input, label, fieldset, #exportSummary, #exportMessages')) {
      if (!node.getClientRects().length) continue;
      const rect = node.getBoundingClientRect();
      if (rect.left<bounds.left-1||rect.right>bounds.right+1) failures.push((node.id||node.tagName)+' escapes the dialog');
      if (node.scrollWidth>node.clientWidth+1) failures.push((node.id||node.tagName)+' overflows horizontally');
    }
    if (!dialog.contains(document.activeElement)) failures.push('keyboard focus escaped modal');
    return failures;
  })()`);
  assert(failures.length === 0, `${label}: ${failures.join('; ')}`);
}

export async function downloadExport(expectedName, selector = '#exportDownload') {
  const expectedStem = expectedName.replace(/\.json$/u, "");
  const escapedStem = expectedStem.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const expectedPattern = new RegExp(`^${escapedStem}-\\d{4}-\\d{2}-\\d{2}-\\d{6}-\\d{3}Z\\.json$`, "u");
  const previous = new Set(await readdir(downloadDirectory));
  assert(await evaluate(`!document.querySelector(${JSON.stringify(selector)}).disabled`), `${expectedName}: download control is disabled.`);
  await command('Runtime.evaluate', {expression:`document.querySelector(${JSON.stringify(selector)}).click()`,userGesture:true,returnByValue:true});
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    const newFiles = (await readdir(downloadDirectory)).filter(name => !previous.has(name) && name.endsWith('.json'));
    for (const fileName of newFiles) {
      const filePath = path.join(downloadDirectory, fileName);
      if (path.dirname(path.resolve(filePath)) !== path.resolve(downloadDirectory)) throw new Error('Downloaded filename escaped the test directory.');
      let contents;
      let data;
      try { contents = await readFile(filePath, 'utf8'); data = JSON.parse(contents); } catch { continue; }
      assert(expectedPattern.test(fileName), `Expected a timestamped ${expectedStem} JSON download, received ${fileName}.`);
      assert(!contents.includes('\r') && contents.endsWith('\n'), `${fileName}: downloaded JSON is not LF terminated.`);
      exportReceipts.push({fileName, bytes:Buffer.byteLength(contents), parsed:true});
      return data;
    }
    await quiet(POLL_MS);
  }
  throw new Error(`Actual JSON download did not complete: ${expectedName}`);
}
