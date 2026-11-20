import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadClassicScript } from "../extension/load-classic-script.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const { api: Protocol } = await loadClassicScript(path.join(root, "extension", "shared", "protocol.js"), "CitizenDataProtocol");
export const requestId = "9ce964ad-d251-4a39-a28e-7f0a66ef3fa2";
export const bridgeSessionId = "7edaf049-6334-49bd-9069-a1253e114892";
export const nonce = "0123456789abcdef0123456789abcdef0123456789abcdef";
