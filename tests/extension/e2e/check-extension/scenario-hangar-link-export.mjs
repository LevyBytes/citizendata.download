import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { dashboard, rsi } from "./browser-pages-and-account-in-use.mjs";
import { out } from "./options-and-run-folders.mjs";
import { click } from "./page-clicks-and-extension-pages.mjs";
import { assertStep } from "./scenario-runner.mjs";
import { waitForExportedFile } from "./stored-state-alarms-and-saved-files.mjs";

export async function hangarLinkExport() {
  // The dashboard still shows the backup the extension just built; this writes it for Hangar Link and Fleetview.
  const expected = rsi.state.pledges.length + rsi.state.buybacks.length;
  await click(dashboard, "exportButton");
  await dashboard.waitFor("document.getElementById('exportDialog').open", 5000, "the export dialog to open");
  await dashboard.evaluate(`(() => {
    for (const [id, value] of [["exportPreset", "inventory"], ["exportInventoryScope", "both"], ["exportFormat", "hangar-link"]]) {
      const control = document.getElementById(id);
      control.value = value;
      control.dispatchEvent(new Event("change", { bubbles: true }));
    }
  })()`);
  const offered = await dashboard.evaluate("({ summary: document.getElementById('exportSummary').textContent, disabled: document.getElementById('exportDownload').disabled, errors: [...document.querySelectorAll('#exportMessages .export-error')].map((node) "
    + "=> node.textContent), warnings: [...document.querySelectorAll('#exportMessages .export-warning')].map((node) => node.textContent) })");
  assertStep(
    !offered.disabled && offered.errors.length === 0 && offered.summary.startsWith(`${expected} records`),
    `The dashboard did not offer a Hangar Link file for the backup it just built (run this scenario together with full-backup): ${JSON.stringify(offered)}`
  );
  // A backup made by this build has every field the export uses.
  assertStep(!offered.warnings.some((warning) => /predates|Left out/u.test(warning)), `A fresh backup was reported as incomplete: ${JSON.stringify(offered.warnings)}`);
  await writeFile(path.join(out, "dashboard-hangar-link-export.png"), await dashboard.screenshot());
  await click(dashboard, "exportDownload");
  const file = await waitForExportedFile("-hangar-link-");
  const data = JSON.parse(file.text);
  assert.deepEqual([data.type, data.version, data.pledges.length], ["hangarlink", 1, expected]);
  const hangar = data.pledges.filter((record) => !record.buyback);
  assert.equal(hangar.length, rsi.state.pledges.length);
  assertStep(
    data.pledges.every((record) => Object.keys(record).length === 26 && record.hangar === rsi.state.handle && /^\d{4}-\d{2}-\d{2}$/u.test(record.date) && /^\d+$/u.test(record.pledgeId)),
    "A Hangar Link record lacks a field, the account handle, a date, or its pledge number."
  );
  const ships = hangar.flatMap((record) => record.items.filter((item) => item.kind === "Ship"));
  const drawn = ships.filter((item) => item.slug).length;
  // Every ship but the invented one is named by a slug Fleetview can draw.
  assertStep(ships.length > 0 && ships.every((item) => Boolean(item.slug) === (item.title !== "Synthetic Prototype")), `Ships were not matched to Hangar Link slugs: ${JSON.stringify(ships.filter((item) => !item.slug).map((item) => item.title))}`);
  assertStep(
    hangar.some((record) => record.alsoContains.length > 0) && hangar.some((record) => record.giftable) && ships.some((item) => item.itemCustomName) && ships.every((item) => item.liner),
    "The file lacks also-contains lists, gift flags, custom names, or maker lines the pages showed."
  );
  await click(dashboard, "exportClose");
  return { records: data.pledges.length, ships: ships.length, shipsWithFleetviewModel: drawn, bytes: file.text.length, warnings: offered.warnings.length };
}
