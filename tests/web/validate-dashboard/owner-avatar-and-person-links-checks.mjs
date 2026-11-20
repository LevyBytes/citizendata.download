import { assert } from "./assert-build-chooser-reload-and-inventory-state.mjs";
import { evaluate, waitFor } from "./chrome-process-and-devtools-commands.mjs";

export async function checkOwnerAvatar(rowsSelector, label) {
  await waitFor(`(() => {
    const row = [...document.querySelectorAll(${JSON.stringify(`${rowsSelector} tr`)})].find(item => item.cells[1]?.textContent.includes('@DirectorGunner'));
    const image = row?.querySelector('img');
    return image && !image.hidden && image.complete && image.naturalWidth > 0;
  })()`);
  assert(await evaluate(`(() => {
    const row = [...document.querySelectorAll(${JSON.stringify(`${rowsSelector} tr`)})].find(item => item.cells[1]?.textContent.includes('@DirectorGunner'));
    const image = row?.querySelector('img');
    const rect = image?.getBoundingClientRect();
    const reference = window.CITIZENDATA_PROFILE_AVATARS.DirectorGunner;
    const entry = window.CITIZENDATA_PROFILE_MEDIA[reference.imageKey];
    const expectedPath = typeof entry === 'string' ? entry : entry.relativePath;
    return image?.getAttribute('src') === expectedPath
      && image.naturalWidth > 0 && image.naturalHeight > 0 && Math.abs(rect.width - 32) <= 1 && Math.abs(rect.height - 32) <= 1;
  })()`), `${label}: DirectorGunner avatar did not use the approved local asset.`);
}

export async function checkPersonLinks(rowsSelector, recordsExpression, label, { demoProspects = false, localAvatars = false } = {}) {
  const failures = await evaluate(`(() => {
    const failures = [];
    const records = ${recordsExpression};
    const rows = [...document.querySelectorAll(${JSON.stringify(`${rowsSelector} tr`)})];
    const value = cell => { const copy = cell.cloneNode(true); copy.querySelectorAll('.collection-cell-label').forEach(node => node.remove()); return copy.textContent.trim(); };
    const safeTarget = anchor => anchor?.target === '_blank' && anchor.relList.contains('noopener') && anchor.relList.contains('noreferrer');
    for (const row of rows) {
      const handle = value(row.cells[1]).replace(/^@/, '');
      const record = records.find(item => item.handle === handle);
      if (!record) {
        if (!value(row.cells[0]).includes('Redacted Member') || row.querySelector('a')) failures.push('unexpected row or link without a public handle');
        continue;
      }
      const moniker = row.cells[0].querySelector('a');
      const username = row.cells[1].querySelector('a');
      const encoded = encodeURIComponent(record.handle);
      const monikerUrl = ${demoProspects} ? 'https://robertsspaceindustries.com/enlist?referral=STAR-GN2F-6JLW' : 'https://robertsspaceindustries.com/spectrum/messages/member/' + encoded;
      const usernameUrl = ${demoProspects} ? monikerUrl : 'https://robertsspaceindustries.com/en/citizens/' + encoded;
      if (moniker?.href !== monikerUrl || username?.href !== usernameUrl) failures.push(record.handle + ': wrong moniker or username destination');
      if (moniker?.textContent.trim() !== record.displayName || username?.textContent.trim() !== '@' + record.handle) failures.push(record.handle + ': moniker and username were conflated');
      if (!safeTarget(moniker) || !safeTarget(username)) failures.push(record.handle + ': external link target or rel is missing');
      if (${localAvatars}) {
        const reference = window.CITIZENDATA_PROFILE_AVATARS?.[record.handle];
        const media = window.CITIZENDATA_PROFILE_MEDIA?.[reference?.imageKey];
        const expectedPath = typeof media === 'string' ? media : media?.relativePath;
        const image = row.querySelector('.person-avatar');
        if (!expectedPath || !image || image.hidden || image.getAttribute('src') !== expectedPath || !image.src.startsWith('file:')) failures.push(record.handle + ': local profile avatar is missing');
      }
    }
    return failures;
  })()`);
  assert(failures.length === 0, `${label}: ${failures.join('; ')}`);
  if (localAvatars) {
    await waitFor(`(() => {
      const rows = [...document.querySelectorAll(${JSON.stringify(`${rowsSelector} tr`)})].filter(row => row.cells[1].querySelector('a'));
      return rows.length > 0 && rows.every(row => { const image=row.querySelector('.person-avatar');return image && !image.hidden && image.complete && image.naturalWidth > 0 && image.naturalHeight > 0; });
    })()`);
  }
}
