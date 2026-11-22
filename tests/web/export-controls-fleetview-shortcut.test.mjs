import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { docsRoot } from "./dashboard-scripts-under-test.mjs";

class Element {
  constructor(id) {
    this.id = id;
    this.listeners = new Map();
    this.value = id === "exportPreset" ? "inventory" : "";
    this.hidden = false;
    this.disabled = false;
    this.childElementCount = 0;
  }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  click() { this.listeners.get("click")?.({ preventDefault() {} }); }
  append() { this.childElementCount += 1; }
  remove() {}
  replaceChildren() { this.childElementCount = 0; }
  focus() {}
  querySelector() { return { checked: false }; }
  querySelectorAll() { return []; }
}

async function controlsWith(exports, callbacks = {}) {
  const ids = [
    "exportDialog", "exportForm", "exportButton", "fleetviewExportButton", "exportPreset", "exportOrganizationSid",
    "exportDownload", "exportSummary", "exportMessages", "exportInventoryOptions", "exportReferralOptions",
    "exportCustomOptions", "exportOrganizationOptions", "exportClose"
  ];
  const elements = new Map(ids.map((id) => [id, new Element(id)]));
  let downloaded = null;
  const document = {
    body: { append(anchor) { downloaded = anchor; } },
    createElement: (tag) => new Element(tag),
    getElementById: (id) => elements.get(id)
  };
  const context = vm.createContext({
    Blob, CitizenDataExports: exports, document,
    URL: { createObjectURL: () => "blob:fleet", revokeObjectURL() {} },
    window: { addEventListener() {}, clearTimeout() {}, setTimeout: () => 1 }
  });
  const source = await readFile(path.join(docsRoot, "scripts", "export-controls.js"), "utf8");
  vm.runInContext(source, context);
  context.CitizenDataExportControls.bind({
    getSnapshot: () => ({ document: { pledges: [1] }, sourceFileName: "account.json", example: false }),
    ...callbacks
  });
  return { elements, downloaded: () => downloaded };
}

test("Export FleetView immediately downloads loaded hangar data as Hangar Link JSON", async () => {
  const selections = [];
  const started = [];
  const exports = {
    inspectExport: (_document, selection) => { selections.push(structuredClone(selection)); return { canExport: true, errors: [] }; },
    createExport: (_document, selection) => {
      selections.push(structuredClone(selection));
      return { text: "{}\n", mimeType: "application/json", fileName: "fleet.json", warnings: ["One warning"] };
    }
  };
  const controls = await controlsWith(exports, { onDownloadStarted: (...args) => started.push(args) });
  controls.elements.get("fleetviewExportButton").click();
  const expected = { preset: "inventory", inventoryScope: "hangar", format: "hangar-link", example: false, sourceFileName: "account.json" };
  assert.deepEqual(selections, [expected, expected]);
  assert.deepEqual(started, [["fleet.json", ["One warning"]]]);
  assert.equal(controls.downloaded().download, "fleet.json");
});

test("Export FleetView reports invalid loaded data without starting a download", async () => {
  const failures = [];
  const exports = {
    inspectExport: () => ({ canExport: false, errors: ["Hangar data is unavailable."] }),
    createExport: () => { throw new Error("createExport must not run"); }
  };
  const controls = await controlsWith(exports, { onDownloadFailed: (message) => failures.push(message) });
  controls.elements.get("fleetviewExportButton").click();
  assert.deepEqual(failures, ["Hangar data is unavailable."]);
  assert.equal(controls.downloaded(), null);
});
