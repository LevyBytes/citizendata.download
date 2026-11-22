// The answer classification of the RSI adapter, loaded as the worker loads it, for the tests of RSI's answer classes.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadClassicScripts } from "../extension/load-classic-script.mjs";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export const Answers = (await loadClassicScripts([path.join(root, "extension", "adapters", "rsi-answer-classification.js")])).CitizenDataRsiAnswers;

export const plain = (value) => JSON.parse(JSON.stringify(value));
