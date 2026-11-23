# Firefox platform: not implemented

There is no Firefox extension. This folder marks where the Firefox platform overlay will go. `manifests/firefox.json` is a metadata scaffold only: it is not usable, not tested in Firefox, not packaged and not published. `npm run package:chromium` builds the only extension; `node scripts/package-extension.mjs --target firefox` stops with `FIREFOX_PLATFORM_NOT_IMPLEMENTED` and writes nothing.

The browser-neutral source in `extension/` stays shared. A file there is not Chromium-only just because it calls the `chrome` namespace, which Firefox also provides. Each incompatibility is decided from evidence when the Firefox work is done.

## What the Firefox work still needs

- **Background runtime.** Firefox Manifest V3 runs background code as background scripts or an event page, not as Chromium's `background.service_worker`. `platform/chromium/service-worker.js` loads its files with `importScripts()`, which an event page does not have. The scaffold manifest therefore declares no background.
- **Page parsing.** Chromium parses RSI pages in an offscreen document (`platform/chromium/offscreen/`). Firefox has no `offscreen` API; its background page can parse with `DOMParser` directly, through a Firefox parser adapter. The scaffold manifest does not ask for the `offscreen` permission.
- **Gecko identity.** AMO requires an add-on ID, which can never change after the first upload, and a minimum Firefox version. The scaffold carries the proposed `citizendata@citizendata.download` and `153.0`; both are to be confirmed before any upload.
- **Data collection disclosure.** New AMO add-ons must declare `data_collection_permissions` in `browser_specific_settings.gecko`. The declaration is not in the scaffold and needs review first.
- **Packaging and acceptance.** A Firefox target for the composer and packager, `web-ext lint`, signing, and Firefox acceptance tests of the extension itself. `npm run test:firefox` checks the website in Firefox, not an extension.
