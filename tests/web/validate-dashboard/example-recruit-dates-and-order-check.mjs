import { assert } from "./assert-build-chooser-reload-and-inventory-state.mjs";
import { evaluate } from "./chrome-process-and-devtools-commands.mjs";

// Official public dossier dates verified for the owner-selected example recruits.
export const exampleRecruitDates = {
  DirectorGunner: ["Dec 15, 2015", "2015-12-15"],
  CZenStar: ["Oct 16, 2013", "2013-10-16"],
  GOD_Shive: ["Jan 3, 2013", "2013-01-03"],
  Xist: ["Mar 17, 2014", "2014-03-17"],
  Citizen404: ["Oct 9, 2013", "2013-10-09"],
  SpearmintVR: ["Nov 20, 2013", "2013-11-20"],
  MunkenTEST: ["Dec 27, 2013", "2013-12-27"],
  Krystal: ["Nov 9, 2012", "2012-11-09"],
  ChromeNinja: ["Feb 17, 2014", "2014-02-17"]
};

export async function checkExampleRecruitOrder(ladder, order) {
  assert(await evaluate(`(() => {
    const dates = ${JSON.stringify(exampleRecruitDates)};
    const expected = window.CITIZENDATA_DEMO_DATA.referrals[${JSON.stringify(ladder)}].recruits.map(record => record.handle)
      .sort((left,right) => dates[left][1].localeCompare(dates[right][1]) * (${JSON.stringify(order)} === 'oldest' ? 1 : -1));
    const rows = [...document.querySelectorAll('#referralRows tr')];
    return rows.length === expected.length && rows.every((row,index) =>
      row.cells[1].querySelector('a')?.textContent === '@' + expected[index]
      && row.cells[2].querySelector('.collection-cell-value')?.textContent === dates[expected[index]][0]);
  })()`), `${ladder} recruits did not display the researched dates in ${order}-first order.`);
}
