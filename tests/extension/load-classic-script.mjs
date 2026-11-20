import { readFile } from "node:fs/promises";
import vm from "node:vm";

export async function loadClassicScript(path, globalName) {
  const source = await readFile(path, "utf8");
  const context = vm.createContext({
    module: { exports: {} },
    console,
    URL,
    TextEncoder,
    TextDecoder,
    Uint8Array,
    ArrayBuffer,
    DataView,
    Blob,
    crypto: globalThis.crypto
  });
  context.globalThis = context;
  vm.runInContext(source, context, { filename: path });
  return { api: context[globalName] ?? context.module.exports, context, source };
}

export async function loadClassicScripts(paths, globals = {}) {
  const context = vm.createContext({ console, URL, ...globals });
  context.globalThis = context;
  for (const path of paths) {
    const source = await readFile(path, "utf8");
    vm.runInContext(source, context, { filename: path });
  }
  return context;
}
