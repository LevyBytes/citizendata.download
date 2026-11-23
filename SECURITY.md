# Security policy

CitizenData backs up Star Citizen game account data: your public RSI dossier, hangar and buybacks, store credit and order history, referrals, and organization memberships. It records no personally identifying information such as an email address, a postal address, payment card details, or a password, and it never stores your RSI session token.

## Supported versions

The latest release is supported.

## Reporting a vulnerability

Report a vulnerability privately through this repository's Security tab ("Report a vulnerability").

Keep credentials, session tokens, and working exploits out of public issues; send them only in the private report.

## What the design guarantees

Each point below is checked by the tests named in the [README](README.md#development).

- **No server.** There is no server that receives your data. Neither part uploads anything, and neither contains analytics, telemetry, or tracking.
- **Least permission.** The extension asks for `alarms`, `cookies`, `offscreen`, `storage`, and `unlimitedStorage`. Its required host is `https://robertsspaceindustries.com/*`. The status feed host `https://status.robertsspaceindustries.com/*` is optional and is used only for diagnosis; status feed requests omit credentials and account data. `unlimitedStorage` gives no access to anything: it stops Chrome from clearing what the extension stores.
- **The session token.** RSI's own account requests need its session token, which is why the extension has the `cookies` permission. The token is read from the browser for each request that needs it and sent only to RSI. It is read transiently, never stored: it does not appear in the backup, in messages to the dashboard, in logs, or in the extension's storage. The extension reads no other cookie, no password, and no MFA value.
- **What a backup holds.** A backup holds no credential: no password, MFA value, session token, or cookie. It records no postal address: the billing and shipping address of each order are always empty, and the schema allows nothing else. Billing records keep each payment's date, status, amount, and the payment processor as RSI's billing page names it. The rest of a backup is game account data: your handle, display name, and public profile; the handles and names of your referrals and of the members of organization rosters you collect; and the history of your account: pledges, buy-backs, orders, subscriptions, balances, and the Hangar Log.
- **Read only.** The extension sends requests only to a fixed list of RSI routes held in the extension.
- **The dashboard cannot steer requests.** It can send only a closed set of typed requests. A build plan is checked by the extension: known sections only, a record limit for each, and a pacing floor. A URL, method, header, body, or selector in a request is refused. Two requests carry a file: an account file, or an Orgs JSON, that the user opened in the dashboard, handed over to be kept. These files record the addresses their data was read from, so they are the only requests that may contain addresses; the extension stores the file as data and requests no address found in it. The account requests carry no more than an account key of the extension's form (`rsi:` and a handle), and are refused with anything else.
- **What an approved dashboard can do.** Build in the dashboard is the user's action; the extension's run authorization is its own check that the request is one it accepts, not a second confirmation. A dashboard page the extension answers can start only the fixed, checked read operations above, and can read the builds, rosters, and images the extension retains and hands to the dashboard. If such a page were compromised, it could do the same, and no more: it cannot receive the session token, choose an RSI address or request, or have the extension change anything on the account.
- **Who may ask.** The extension answers the top frame of `https://citizendata.download` in a normal window. A copy of the dashboard opened from disk is answered only after the user approves that exact file in the extension popup, and the approval can be removed there. Each dashboard session has its own nonce, a request is accepted once, and a build can be controlled only by the session that started it; another session of the same origin must take it over explicitly.
- **What a page is given when it loads.** A dashboard that has just loaded is given the accounts added with Add new account or a complete verified Account JSON: each one's handle and name, and which was chosen last. While Build history is on, which it is unless you turn it off, it is also given the latest finished build of each account the extension holds, so that a reload shows your accounts again. Only the pages named under "Who may ask" are answered. With Build history off, a page receives the summaries but is given a build only as the result of a run.
- **One account per build.** The extension identifies the signed-in RSI account before reading anything and stops if the account changes. A partial backup cannot be continued for a different account. A build or roster run the dashboard starts for the account it shows names that account, and the extension declines the run, before reading any section, when RSI is signed in to another account. Add new account asks RSI only which account is signed in and starts no build.
- **Stop on the unexpected.** A build stops and reports why when RSI's answer is not what the reader expects: a changed page layout, a lost session, a refused request, or a page other than the one asked for. It does not record empty or guessed values.
- **The saved backup is replaced only by a finished build.** A failed or cancelled build leaves it as it was. A complete account file opened in the dashboard is checked again by the extension. Its bounded handle and display name can enter the account registry whether Build history is on or off; the full file is kept only while Build history is on, when the extension holds no build of that account or an older one. It never replaces a newer build and takes in nothing while a build is in progress. A file taken in this way is no basis for the next build, which reads the whole account from RSI again. The rosters of an Orgs JSON opened in the dashboard go only into a retained build under the same conditions, and only for organizations the account is a member of. The SHA-256 shows that a file is intact, not who wrote it: a file changed by another tool that also rewrote the hash would pass, as it would when opened with Load JSON.
- **Integrity.** Each fetched page is stored with a SHA-256 that is checked when the page is read back. Each backup carries a SHA-256 of its content, and the dashboard checks it and the schema before showing or exporting a file.
- **No remote code.** Both parts ship every script they run. There is no `eval`, no string-to-code execution, and no markup injection, and the content security policies allow only their own scripts.
- **Images.** The dashboard downloads account images only when asked, from RSI's two public image hosts, without credentials or referrer. With Build history on, the dashboard hands each downloaded image to the extension, which stores it; the extension is given no address and requests no image itself. It accepts only AVIF, GIF, JPEG, PNG, and WebP bytes whose content matches the stated type and SHA-256 hash, and the dashboard checks the hash again before it shows or reuses a kept image.

## Release security

Every release must review the manifest permission diff, bundled code, schema changes, storage migrations, privacy text, deterministic package hash, and remote-code scan.

Never commit a `.pem`, Web Store OAuth refresh token, Verified CRX Upload key, account backup, or signing material.

GitHub publication and Chrome Web Store publication are separate owner-controlled actions.
