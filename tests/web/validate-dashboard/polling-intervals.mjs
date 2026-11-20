// How often a condition that is waited for is looked at again.
export const POLL_MS = 20;
// Showing that something does not happen needs a stretch of time in which it could have. The page works on what
// it was given within a few milliseconds, with no network, so this stretch is room enough. Nothing else in this
// suite waits for a fixed time.
const QUIET_MS = 150;
export const quiet = (milliseconds = QUIET_MS) => new Promise((resolve) => setTimeout(resolve, milliseconds));
