export const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
// How often a condition that is waited for is looked at again.
export const POLL_MS = 20;
// Showing that something does not happen needs a stretch of time in which it could have. This is that stretch, and
// the only fixed wait of the check apart from the scenario about Chrome's own 30 second limits. Without its pace the
// extension asks RSI again within a few tens of milliseconds, so the stretch holds room for many requests.
export const QUIET_MS = 250;
