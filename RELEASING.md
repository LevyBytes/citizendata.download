# Release process

CitizenData uses an owner-controlled release process.

No script in this repository publishes a GitHub Release, submits to the Chrome Web Store, deploys GitHub Pages, changes DNS, signs a CRX, or pushes Git.

## Channels

### Development

Run `npm run package:chromium` in a trusted checkout and load the `dist/chromium/` folder it writes unpacked through `chrome://extensions`. `extension/` alone is not loadable: the packager composes it with `platform/chromium/` and `manifests/chrome.json`.

Unpacked loading is for development and owner-controlled testing only.

### Prerelease

Create the Chrome Web Store item manually, keep its visibility private, and use trusted testers.

The Web Store API cannot create the initial item.

Private, unlisted, and public items receive the same policy review.

After the item exists, retain its public key as owner-controlled release metadata; adding a manifest `key` to stabilize the unpacked development ID is a separate reviewed change.

### Public release

Use the Chrome Web Store as the canonical consumer install and automatic-update channel.

Chrome on Windows and macOS does not treat a GitHub ZIP or self-hosted CRX as a normal consumer installation channel; Linux has broader self-hosting options, but CitizenData should maintain one canonical public channel.

Publish an immutable GitHub Release only after the same reviewed ZIP has been accepted for the selected Web Store release.

### Firefox

There is no Firefox channel. `manifests/firefox.json` and `platform/firefox/` are a scaffold that is not usable or published; the packager refuses `--target firefox` with `FIREFOX_PLATFORM_NOT_IMPLEMENTED` and produces no Firefox artifact. Nothing is submitted to addons.mozilla.org.

## Versioning

The current release is `0.42.2`. `manifests/chrome.json` (packaged as `manifest.json`), its `version_name`, `manifests/firefox.json`, and `package.json` carry the same number, and a test holds them together.

`manifest.version` uses Chrome's one-to-four integer components and must increase for every Web Store upload. Never reuse an uploaded version number.

Schema compatibility and extension storage are separate contracts. The extension's IndexedDB database is at version 4; opening an older database adds the missing stores and keeps what is there. The accounts added with Add new account or a complete verified Account JSON are kept apart from it, in `chrome.storage.local` under `citizendata.accounts.v1`, and Clear All removes that key. A change to either needs its own tests.

## Required gates

1. Verify `LICENSE`, the README attribution request, and `THIRD_PARTY_NOTICES.md` are present, accurate, and included in the applicable source and extension release artifacts.
2. Confirm the exact release scope.
3. Run `npm test` and `npm run verify` from a clean source tree, then the browser checks: `npm run test:dashboard` and `npm run test:extension`. Both run Chrome headless against synthetic data and contact no outside host.
4. Review every manifest permission and host-permission change against the previous release.
5. Review the privacy policy, Limited Use disclosure, dashboard safety wording, and support/security contacts.
6. Run `npm run package:chromium` to compose `dist/chromium/` and create the deterministic ZIP and SHA-256 record; it checks that the folder and the ZIP hold the same files.
7. Inspect the ZIP and prove `manifest.json` is at its root, only reviewed files are present, no private data is present, and no remote executable code is present.
8. Load that exact staged package in a clean browser profile and build a backup of a real account from the hosted dashboard and from a local copy. The automated checks use a synthetic RSI; this step is the only one that meets the real site.
9. Create a draft GitHub Release and attach the exact ZIP, hash, release notes, permission diff, schema compatibility statement, and known limitations without publishing it.
10. Upload the exact ZIP to the private/trusted-tester Chrome Web Store item and complete review/acceptance.
11. The owner decides whether and when to publish the Web Store release.
12. Only after the canonical release is fixed, publish the matching GitHub Release and lock it against later asset/tag replacement where repository settings support release immutability.

## Rollback

Rollback safety requires backward-compatible browser storage and export handling because an older extension can encounter state written by a newer version.

Before enabling Web Store rollback, test the exact upgrade and downgrade paths and preserve the last complete export.

Never use rollback to bypass a required permission, policy, privacy, or schema review.

## GitHub Pages

The website has no build step and is published by GitHub Pages from `main:/docs`; no deployment workflow is required. The public site is served through Cloudflare in front of GitHub Pages, and the privacy policy names both.

Before enabling Pages:

1. Verify `citizendata.download` at the LevyBytes profile level with GitHub's TXT challenge and retain the TXT record.
2. Add the custom domain in repository Pages settings before changing DNS.
3. Configure the apex records using GitHub's documented current values; optionally point `www` to `LevyBytes.github.io` with a CNAME.
4. Avoid wildcard DNS.
5. Enable **Enforce HTTPS** only after GitHub has issued the certificate and reports the domain ready.
6. Before turning on Cloudflare's proxy for the domain, read GitHub's and Cloudflare's current guidance on certificates and HTTPS for a proxied Pages site. Add no Cloudflare feature that injects scripts or analytics into the pages: the site's content security policy allows only its own scripts, and the privacy policy says there is no tracking.
7. Confirm the live site contains no real account data, source captures, private fixtures, or development-only claims.

The committed `docs/CNAME` file records the intended domain but does not replace the repository settings or DNS steps.

Search and sharing metadata in `docs/index.html` uses `https://citizendata.download/` as the public root. After owner-controlled deployment, verify successful public HTTPS responses for the page, `robots.txt`, `sitemap.xml`, the 96px PNG favicon, and the 1200x630 share image. Confirm their content types and crawler access before using Google/Bing URL inspection or Meta's Sharing Debugger; local preview screenshots do not prove live indexing or platform rendering.

The factual WebApplication data intentionally contains no fabricated offer, review, or rating and does not claim eligibility for Google's software-app rich result. Keep title, description, canonical, Open Graph, X tags, and WebSite identity consistent. When the share image's artwork changes, keep its file name, which carries no version number, and have the platforms fetch it again with their own tools, such as Meta's Sharing Debugger and LinkedIn's Post Inspector. Account JSON must never change public metadata.

Google approved the Chrome Web Store listing on November 22, 2026. The dashboard's `EXTENSION_INSTALL_URL` in `docs/scripts/dashboard.js` uses the [canonical Citizen Data Downloader listing](https://chromewebstore.google.com/detail/citizen-data-downloader/ehklbfcpnadaeodflibpihhgimmmhjpd). Developer-mode installation from `dist/chromium` remains a secondary development and source-review path.

## Automation

CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs `npm test`, `npm run verify`, `npm run check:schemas`, and `npm run package:extension` on pull requests and on `main`, and checks every pull request commit for a DCO sign-off. It has read-only repository permissions, no secrets, and actions pinned to full commit SHAs.

Do not add automatic Web Store publication initially.

If upload automation is later approved, use a protected GitHub environment, minimum-scope credentials, an owner approval gate, and exact artifact-hash verification; keep upload and publish as distinct actions.

Never store a Web Store OAuth refresh token, `.pem`, Verified CRX Upload key, or other signing secret in the repository or release artifact.

## Official references

- [Chrome extension distribution](https://developer.chrome.com/docs/extensions/how-to/distribute)
- [Preparing a Chrome Web Store package](https://developer.chrome.com/docs/webstore/prepare)
- [Chrome Web Store API](https://developer.chrome.com/docs/webstore/using-api/)
- [GitHub Pages publishing sources](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)
- [GitHub Pages custom-domain verification](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/verifying-your-custom-domain-for-github-pages)
- [GitHub release immutability](https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/establish-provenance-and-integrity/prevent-release-changes)

