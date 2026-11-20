// What the synthetic RSI shows for one pledge, in the shape the backup records it.
export function expectedPledge(shown, index) {
  const dollars = (cents) => ({ amount: (cents / 100).toFixed(2), currency: "USD" });
  return {
    pledgeId: shown.id,
    title: shown.title,
    availability: shown.availability,
    createdDateRaw: shown.created,
    containsSummary: shown.contains,
    sourcePage: Math.floor(index / 10) + 1,
    state: "current",
    meltValue: dollars(shown.valueCents),
    baseValue: dollars(shown.configurationCents),
    meltEligible: shown.meltable,
    giftEligible: shown.giftable,
    items: [
      ...shown.items.map((item) => ({ name: item.title, kind: item.kind, manufacturer: item.liner ? `${item.liner.name} (${item.liner.code})` : null, customName: item.customName, section: "items" })),
      ...shown.alsoContains.map((title) => ({ name: title, kind: null, manufacturer: null, customName: null, section: "alsoContains" }))
    ]
  };
}

export function recordedPledge(record) {
  const { pledgeId, title, availability, createdDateRaw, containsSummary, sourcePage, state, meltValue, baseValue, meltEligible, giftEligible } = record;
  return {
    pledgeId, title, availability, createdDateRaw, containsSummary, sourcePage, state, meltValue, baseValue, meltEligible, giftEligible,
    items: record.items.map(({ name, kind, manufacturer, customName, section }) => ({ name, kind, manufacturer, customName, section }))
  };
}
