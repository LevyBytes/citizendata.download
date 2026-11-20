import { money } from "./text-date-and-money-formats.mjs";
import { buildPledge } from "./generated-pledges-and-buybacks.mjs";

// What a test can have happen to the invented account between builds.
export function accountChanges({ state, handle }) {
  return {
    // Melts a pledge as its owner would: it leaves the hangar, the log records the reclaim under the pledge's
    // number, and it joins the front of the buy-back list under that same number.
    meltPledge(id) {
      const index = state.pledges.findIndex((pledge) => pledge.id === id);
      if (index < 0) throw new Error(`The synthetic account holds no pledge ${id}.`);
      const [pledge] = state.pledges.splice(index, 1);
      state.melted = (state.melted ?? 0) + 1;
      state.hangarLog.unshift({ when: `Oct 3 2026, 7:${String(10 + state.melted).padStart(2, "0")} pm`, id: pledge.id, name: pledge.title, detail: `Reclaimed by ${handle} for ${money(pledge.valueCents)}` });
      const buyback = { id: pledge.id, title: pledge.title, date: "October 3, 2026", contains: pledge.contains, upgraded: false, upgrade: pledge.title.startsWith("Upgrade - ") ? { fromShipId: "11", toShipId: "101", toSkuId: "5999" } : null };
      state.buybacks.unshift(buyback);
      return buyback;
    },
    // Buys a pledge back: it leaves the buy-back list, and the log records the buy-back under its number.
    buyBack(id) {
      const index = state.buybacks.findIndex((buyback) => buyback.id === id);
      if (index < 0) throw new Error(`The synthetic account lists no buy-back ${id}.`);
      const [buyback] = state.buybacks.splice(index, 1);
      state.boughtBack = (state.boughtBack ?? 0) + 1;
      state.hangarLog.unshift({ when: `Oct 4 2026, 8:${String(10 + state.boughtBack).padStart(2, "0")} pm`, id: buyback.id, name: buyback.title, detail: `Buy-back by ${handle} - order #SYNBB${state.boughtBack}` });
      return buyback;
    },
    // RSI stops listing a pledge ("pledges") or a buy-back ("buybacks") and writes nothing to the Hangar Log.
    removeSilently(list, id) {
      const index = state[list].findIndex((record) => record.id === id);
      if (index < 0) throw new Error(`The synthetic account lists no ${list} record ${id}.`);
      return { record: state[list].splice(index, 1)[0], index };
    },
    // RSI stops listing it and logs the removal itself, in one of the two wordings its log uses.
    removeWithLogNotice(list, id, wording = "automated removal of 0$ CCUs") {
      const removed = this.removeSilently(list, id);
      state.loggedRemovals = (state.loggedRemovals ?? 0) + 1;
      state.hangarLog.unshift({ when: `Oct 5 2026, 9:${String(10 + state.loggedRemovals).padStart(2, "0")} am`, id, name: removed.record.title, detail: wording });
      return removed;
    },
    // RSI lists a removed record again where it was.
    restore(list, removed) {
      state[list].splice(removed.index, 0, removed.record);
    },
    // Adds newer pledges at the front, each with its Hangar Log row, as a real account grows.
    addPledges(count) {
      const start = state.pledges.length + (state.addedPledges ?? 0) + 1000;
      state.addedPledges = (state.addedPledges ?? 0) + count;
      for (let index = 0; index < count; index += 1) {
        const pledge = { ...buildPledge(start + index), id: 40000000 + start + index, created: "October 2, 2026" };
        state.pledges.unshift(pledge);
        state.hangarLog.unshift({ when: `Oct 2 2026, 6:${String(10 + index).padStart(2, "0")} pm`, id: pledge.id, name: pledge.title, detail: `Created by ${handle}, value: ${money(pledge.valueCents)}` });
      }
    }
  };
}
