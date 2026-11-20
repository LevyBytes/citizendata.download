import { LOG_ROWS_PER_PAGE, MEDIA, SHIPS } from "./page-sizes-and-ship-names.mjs";
import { dayBefore, money } from "./text-date-and-money-formats.mjs";
import { buildBuyback, buildPledge } from "./generated-pledges-and-buybacks.mjs";

// The invented account: who it belongs to, how much of everything it holds, and the records themselves.
export function createAccount(options = {}) {
  const handle = options.handle ?? "SyntheticCitizen";
  const counts = {
    pledges: 25, buybacks: 230, orders: 120, storeCredit: 60, uec: 30, rec: 6,
    // Hangar Log rows older than the current pledges: things that were melted or gifted away long ago.
    olderHangarLogRows: 40,
    prospects: 150, recruits: 12, legacyRecruits: 3, organizationMembers: 70,
    ...options.counts
  };
  const organization = { sid: options.organizationSid ?? "SYNTH", name: "Synthetic Flight Wing" };
  // RSI's own page size unless a test asks how the collector copes with a different one.
  const hangarLogRowsPerPage = options.hangarLogRowsPerPage ?? LOG_ROWS_PER_PAGE;
  const state = {
    handle,
    signedIn: true,
    pledges: Array.from({ length: counts.pledges }, (_, index) => buildPledge(index)),
    buybacks: Array.from({ length: counts.buybacks }, (_, index) => buildBuyback(index, options.upgradeBuybacksFrom)),
    orders: Array.from({ length: counts.orders }, (_, index) => ({ id: `SYN${String(100000 + index)}`, placed: dayBefore(index).short, cents: 1500 + (index % 30) * 500, item: `Synthetic order item ${index + 1}` })),
    ledgers: Object.fromEntries([["storeCredit", counts.storeCredit], ["uec", counts.uec], ["rec", counts.rec]].map(([key, count]) => [
      key,
      Array.from({ length: count }, (_, index) => ({ when: `${dayBefore(index).short}, 5:${String(10 + index % 50).padStart(2, "0")} pm`, amount: (index % 3 === 0 ? -1 : 1) * (5 + index % 9), detail: `Synthetic ${key} entry ${index + 1}` }))
    ])),
    referrals: {
      prospects: Array.from(
        { length: counts.prospects },
        (_, index) => ({ id: `prospect-${index + 1}`, displayName: `Prospect ${index + 1}`, nickname: `Prospect_${index + 1}`, enlistedOn: dayBefore(index).iso, convertedOn: null, avatar: `${MEDIA}/avatar-p${index % 9}.jpg` })
      ),
      recruits: Array.from(
        { length: counts.recruits },
        (_, index) => ({ id: `recruit-${index + 1}`, displayName: `Recruit ${index + 1}`, nickname: `Recruit_${index + 1}`, enlistedOn: dayBefore(index + 400).iso, convertedOn: dayBefore(index + 30).iso, avatar: `${MEDIA}/avatar-r${index % 9}.jpg` })
      ),
      legacyRecruits: Array.from(
        { length: counts.legacyRecruits },
        (_, index) => ({ id: `legacy-${index + 1}`, displayName: `Legacy ${index + 1}`, nickname: `Legacy_${index + 1}`, enlistedOn: dayBefore(index + 3000).iso, convertedOn: dayBefore(index + 2900).iso, avatar: `${MEDIA}/avatar-l${index % 9}.jpg` })
      )
    },
    // How many buy-backs the account may still make with store credit, shown on every buy-back page.
    buybackTokens: 2,
    // Buy-back numbers whose own page answers 404, and numbers RSI sends on to the store instead.
    buybackPagesMissing: new Set(),
    buybackPagesRedirected: new Set(),
    // Numbers whose page keeps its buy-back markers but has lost its heading, as after a layout change.
    buybackPagesWithoutHeading: new Set(),
    members: Array.from(
      { length: counts.organizationMembers },
      (_, index) => ({ handle: `Member_${index + 1}`, name: `Member ${index + 1}`, restricted: index % 11 === 10, main: index % 2 === 0, stars: index % 6, rank: ["Recruit", "Pilot", "Captain"][index % 3] })
    ),
    hangarLog: []
  };
  // Every pledge has a creation row, newest first, so the log and the hangar agree.
  state.hangarLog = [
    ...state.pledges.map((pledge, index) => ({ when: `${dayBefore(index).short}, 4:${String(10 + index % 50).padStart(2, "0")} pm`, id: pledge.id, name: pledge.title, detail: `Created by ${handle}, value: ${money(pledge.valueCents)}` })),
    ...Array.from({ length: counts.olderHangarLogRows }, (_, index) => {
      const [ship] = SHIPS[index % SHIPS.length];
      const cents = 2000 + (index % 25) * 500;
      return {
        when: `${dayBefore(counts.pledges + index).short}, 9:${String(10 + index % 50).padStart(2, "0")} am`, id: 10000000 + index, name: `Standalone Ships - ${ship}`,
        detail: index % 2 ? `Reclaimed by ${handle} for ${money(cents)}` : `Gifted to SyntheticFriend_${index}, value: ${money(cents)}`
      };
    })
  ];
  return { handle, counts, organization, hangarLogRowsPerPage, state };
}
