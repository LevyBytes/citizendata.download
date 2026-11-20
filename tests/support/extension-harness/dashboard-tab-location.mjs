export function tabLocation(tab) {
  const url = new URL(tab.url);
  return url.protocol === "file:" ? { origin: "file://", pathname: url.pathname } : { origin: url.origin, pathname: url.pathname };
}

// Whether Chrome would have injected the dashboard bridge into this tab.
export function hasBridge(harness, tab) {
  if (tab.closed || tab.incognito) return false;
  const url = new URL(tab.url);
  if (url.protocol === "file:") return harness.fileAccess && /\/docs\/index\.html$/u.test(url.pathname);
  return url.origin === "https://citizendata.download";
}
