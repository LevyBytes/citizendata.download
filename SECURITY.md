# Security policy

CitizenData handles private account, purchase, billing, referral, and organization data, so security reports should minimize further exposure.

## Supported versions

The latest release is supported.

## Reporting a vulnerability

Report a vulnerability privately through this repository's Security tab ("Report a vulnerability").

Do not post credentials, account backups, live RSI markup, tokens, private screenshots, referral identities, organization-member records, or a working exploit in a public issue.

If private reporting is unavailable, disclose only that a private contact is needed; do not attach sensitive evidence publicly.

## What the design guarantees

Each point below is checked by the tests named in the [README](README.md#development).

- **No server.** There is no server that receives your data. Neither part uploads anything, and neither contains analytics, telemetry, or tracking.
- **Least permission.** The extension asks for `alarms`, `cookies`, `offscreen`, `storage`, and `unlimitedStorage`, and for one host: `https://robertsspaceindustries.com/*`. `unlimitedStorage` gives no access to anything: it stops Chrome from clearing what the extension stores.
- **The session token.** RSI's own account requests need its session token, which is why the extension has the `cookies` permission. The token is read from the browser for each request that needs it and sent only to RSI. It is read transiently, never stored: it does not appear in the backup, in messages to the dashboard, in logs, or in the extension's storage. The extension reads no other cookie, no password, and no MFA value.
- **Read only.** The extension sends requests only to a fixed list of RSI routes held in the extension.
- **The dashboard cannot steer requests.** It can send only a closed set of typed requests. A build plan is checked by the extension: known sections only, a record limit for each, and a pacing floor. A URL, method, header, body, or selector in a request is refused. Two requests carry a file: an account file, or an Orgs JSON, that the user opened in the dashboard, handed over to be kept. These files record the addresses their data was read from, so they are the only requests that may contain addresses; the extension stores the file as data and requests no address found in it.
- **Who may ask.** The extension answers the top frame of `https://citizendata.download` in a normal window. A copy of the dashboard opened from disk is answered only after the user approves that exact file in the extension popup, and the approval can be removed there. Each dashboard session has its own nonce, a request is accepted once, and a build can be controlled only by the session that started it; another session of the same origin must take it over explicitly.
- **What a page is given when it loads.** While Build history is on, which it is unless you turn it off, a dashboard that has just loaded is given the latest finished build, so that a reload shows your account again. Only the pages named under "Who may ask" are answered. With Build history off, a page is given a build only as the result of a run.
- **One account per build.** The extension identifies the signed-in RSI account before reading anything and stops if the account changes. A partial backup cannot be continued for a different account.
- **Stop on the unexpected.** A build stops and reports why when RSI's answer is not what the reader expects: a changed page layout, a lost session, a refused request, or a page other than the one asked for. It does not record empty or guessed values.
- **The saved backup is replaced only by a finished build.** A failed or cancelled build leaves it as it was. While Build history is on, a complete account file opened in the dashboard counts as a finished build: the extension keeps it when it holds no build of that account, or an older one, after checking the schema and the SHA-256 itself. It never replaces a newer build and takes in nothing while a build is in progress. The rosters of an Orgs JSON opened in the dashboard go into that build under the same conditions, and only for organizations the account is a member of. The SHA-256 shows that a file is intact, not who wrote it: a file changed by another tool that also rewrote the hash would pass, as it would when opened with Load JSON.
- **Integrity.** Each fetched page is stored with a SHA-256 that is checked when the page is read back. Each backup carries a SHA-256 of its content, and the dashboard checks it and the schema before showing or exporting a file.
- **No remote code.** Both parts ship every script they run. There is no `eval`, no string-to-code execution, and no markup injection, and the content security policies allow only their own scripts.
- **Images.** The dashboard downloads account images only when asked, from RSI's two public image hosts, without credentials or referrer. With Build history on, the dashboard hands each downloaded image to the extension, which stores it; the extension is given no address and requests no image itself. It accepts only AVIF, GIF, JPEG, PNG, and WebP bytes whose content matches the stated type and SHA-256 hash, and the dashboard checks the hash again before it shows or reuses a kept image.

## Release security

Every release must review the manifest permission diff, bundled code, schema changes, storage migrations, privacy text, deterministic package hash, and remote-code scan.

Never commit a `.pem`, Web Store OAuth refresh token, Verified CRX Upload key, account backup, or signing material.

GitHub publication and Chrome Web Store publication are separate owner-controlled actions.
