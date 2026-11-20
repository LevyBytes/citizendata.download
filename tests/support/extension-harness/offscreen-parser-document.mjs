import path from "node:path";
import vm from "node:vm";
import { DOMParser } from "../mini-dom.mjs";
import { EXTENSION_ID, extensionRoot, source } from "./extension-files-and-identifiers.mjs";
import { copy, realmCopier } from "./message-copies-between-realms.mjs";

// Gives the function that loads the extension's offscreen parser once and hands it markup to parse.
export function offscreenParser(world) {
  const { recordingConsole } = world;

  function ensureOffscreen() {
    if (world.offscreen) return world.offscreen;
    const listeners = [];
    const sandbox = { DOMParser, URL, console: recordingConsole, chrome: { runtime: { id: EXTENSION_ID, onMessage: { addListener: (listener) => listeners.push(listener) } } } };
    const context = vm.createContext(sandbox);
    const local = realmCopier(context);
    for (const file of ["adapters/dom-extractors.js", "adapters/billing-extractors.js", "offscreen/parser.js"]) vm.runInContext(source(file), context, { filename: path.join(extensionRoot, file) });
    world.offscreen = {
      parse: (message) => new Promise((resolve) => {
        let handled = false;
        for (const listener of listeners) handled = listener(local(message), local({ id: EXTENSION_ID }), (response) => resolve(copy(response))) === true || handled;
        if (!handled) resolve(undefined);
      })
    };
    return world.offscreen;
  }

  return ensureOffscreen;
}
