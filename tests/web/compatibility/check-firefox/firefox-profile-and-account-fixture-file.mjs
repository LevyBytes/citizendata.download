import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { baseAccountDocument } from "../../../fixtures/account-document.mjs";
import { downloads, profile, scratch } from "./options-and-evidence-folders.mjs";

await import('../../../../shared/account-document.js');

const prefs = {
  'browser.download.folderList': 2, 'browser.download.dir': downloads,
  'browser.download.useDownloadDir': true, 'browser.download.alwaysOpenPanel': false,
  'browser.helperApps.neverAsk.saveToDisk': 'application/json,application/octet-stream',
  'browser.download.always_ask_before_handling_new_types': false,
  'browser.shell.checkDefaultBrowser': false, 'browser.startup.homepage_override.mstone': 'ignore',
  'datareporting.policy.dataSubmissionEnabled': false, 'toolkit.telemetry.enabled': false,
  'browser.newtabpage.enabled': false, 'browser.newtabpage.activity-stream.feeds.telemetry': false
};
await writeFile(path.join(profile, 'user.js'), Object.entries(prefs).map(([key, value]) => `user_pref(${JSON.stringify(key)}, ${JSON.stringify(value)});`).join('\n') + '\n');
const fixture = baseAccountDocument();
fixture.account.handle = 'CompatibilityCitizen'; fixture.profile.handle = 'CompatibilityCitizen';
export const fixtureFile = path.join(scratch, 'compatibility-example.json');
await writeFile(fixtureFile, JSON.stringify(await globalThis.CitizenDataAccountDocument.stampIntegrity(fixture)));
