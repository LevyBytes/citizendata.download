import vm from "node:vm";

// Chrome passes messages and stored values as JSON-compatible copies.
export function copy(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

// A copy whose objects belong to the receiving context, as a value Chrome hands to a script belongs to that script's
// own realm. The extension's "plain object" checks compare against its own Object.prototype.
export function realmCopier(context) {
  const revive = vm.runInContext("(text) => JSON.parse(text)", context);
  return (value) => value === undefined ? undefined : revive(JSON.stringify(value));
}
