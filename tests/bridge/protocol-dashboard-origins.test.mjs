import assert from "node:assert/strict";
import test from "node:test";
import { Protocol } from "./protocol-under-test.mjs";

test("the hosted dashboard is one exact origin", () => {
  assert.equal(Protocol.isDashboardLocation("https://citizendata.download", "/"), true);
  assert.equal(Protocol.isDashboardLocation("https://citizendata.download", "/index.html"), true);
  for (const origin of [
    "http://citizendata.download",
    "https://www.citizendata.download",
    "https://citizendata.download.example",
    "https://example.invalid",
    "chrome-extension://abcdefghijklmnopabcdefghijklmnop",
    ""
  ]) {
    assert.equal(Protocol.isDashboardLocation(origin, "/"), false, origin);
  }
  assert.deepEqual([...Protocol.DASHBOARD_ORIGINS], ["https://citizendata.download"]);
});

test("a local copy is recognised by docs/index.html in any folder and by nothing else", () => {
  for (const pathname of [
    "/C:/Users/someone/Downloads/citizendata.download/docs/index.html",
    "/D:/a%20folder%20with%20spaces/docs/index.html",
    "/home/someone/src/citizendata/docs/index.html",
    "/docs/index.html"
  ]) {
    assert.equal(Protocol.isLocalDashboardPath(pathname), true, pathname);
    assert.equal(Protocol.isDashboardLocation("file://", pathname), true, pathname);
    // Chrome reports a file page's origin as the string "null".
    assert.equal(Protocol.isDashboardLocation("null", pathname), true, pathname);
  }
  for (const pathname of [
    "/C:/Users/someone/Downloads/citizendata.download/docs/privacy-policy.html",
    "/C:/Users/someone/Downloads/citizendata.download/other/index.html",
    "/C:/Users/someone/Downloads/docs/index.html/extra",
    "/C:/Users/someone/Downloads/mydocs/index.html",
    "/C:/Users/someone/Downloads/docs/index.htm",
    "/C:/Users/someone/Downloads//docs/index.html",
    "docs/index.html",
    "",
    null,
    42
  ]) {
    assert.equal(Protocol.isLocalDashboardPath(pathname), false, String(pathname));
    assert.equal(Protocol.isDashboardLocation("file://", pathname), false, String(pathname));
  }
  // A path longer than any real one is refused before it is stored or shown.
  assert.equal(Protocol.isLocalDashboardPath(`/${"a".repeat(2048)}/docs/index.html`), false);
  // A hosted origin never becomes a local copy because of its path.
  assert.equal(Protocol.isLocalDashboardOrigin("https://citizendata.download"), false);
  assert.equal(Protocol.isDashboardLocation("https://example.invalid", "/x/docs/index.html"), false);
});

test("Chrome file-page origins are canonicalized without trusting other file paths", () => {
  assert.equal(Protocol.canonicalDashboardOrigin("file://"), "file://");
  assert.equal(Protocol.canonicalDashboardOrigin("null"), "file://");
  assert.equal(Protocol.postMessageTarget("file://"), "*");
  assert.equal(Protocol.postMessageTarget("null"), "*");
  assert.equal(Protocol.messageOriginMatches("null", "file://"), true);
  assert.equal(Protocol.messageOriginMatches("null", "null"), true);
  assert.equal(Protocol.messageOriginMatches("file://", "file://"), false);
  assert.equal(Protocol.messageOriginMatches("https://citizendata.download", "https://citizendata.download"), true);
  assert.equal(Protocol.messageOriginMatches("https://evil.example", "https://citizendata.download"), false);
});
