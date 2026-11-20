// What a test can read and set of the stand-in browser.
export function harnessState(clock) {
  const harness = {
    clock,
    rsiPermission: true,
    signedIn: true,
    fileAccess: true,
    workerStarts: 0,
    cookieReads: 0,
    offscreenDocuments: [],
    // Everything the extension wrote to the console. It is expected to write nothing.
    consoleCalls: [],
    badges: new Map(),
    local: new Map(),
    session: new Map(),
    alarms: new Map(),
    tabs: new Map(),
    repository: null,
    rsi: null
  };
  return harness;
}

export function recordingConsoleFor(harness, options) {
  return Object.fromEntries(["log", "info", "warn", "error", "debug", "trace"].map((level) => [level, (...values) => {
    harness.consoleCalls.push({ level, text: values.map(String).join(" ") });
    if (options.echoConsole) console[level](...values);
  }]));
}
