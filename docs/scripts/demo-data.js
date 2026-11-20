(() => {
  "use strict";

  const observedAt = "2026-11-17T00:00:00Z";
  const observation = Object.freeze({ firstObservedAt: observedAt, lastObservedAt: observedAt, parserVersion: "synthetic-demo" });

  function image(imageKey, role, pathName, altText, width, height, mimeTypeHint) {
    return {
      imageKey,
      normalizationVersion: 1,
      role,
      url: `https://example.invalid/citizendata-demo/${pathName}`,
      altText,
      width,
      height,
      mimeTypeHint
    };
  }

  function containedItem(recordKey, name, kind, category, images = []) {
    return { recordKey, name, kind, category, quantity: 1, images, catalogIdentifiers: [] };
  }

  function listingSource(section) {
    return [{
      kind: "listing",
      url: section === "buybacks"
        ? "https://robertsspaceindustries.com/en/account/buy-back-pledges"
        : "https://robertsspaceindustries.com/en/account/pledges",
      observedAt
    }];
  }

  function completeOutcome(records) {
    return {
      status: "complete",
      parserVersion: "synthetic-demo",
      startedAt: observedAt,
      endedAt: observedAt,
      records,
      pagesOrBatches: 1,
      warnings: []
    };
  }

  function referral(recordKey, displayName, handle, dateLabel, dateRaw, dateSortKey, images = []) {
    return { recordKey, displayName, handle, dateLabel, dateRaw, dateSortKey, images, observation };
  }

  function profileImages(handle) {
    const reference = globalThis.CITIZENDATA_PROFILE_AVATARS?.[handle];
    return reference ? [reference] : [];
  }

  // Owner-selected example dates from public dossiers, bundled for presentation.
  const exampleRecruitDates = {
    "DirectorGunner": [
      "Dec 15, 2015",
      "2015-12-15"
    ],
    "CZenStar": [
      "Oct 16, 2013",
      "2013-10-16"
    ],
    "GOD_Shive": [
      "Jan 3, 2013",
      "2013-01-03"
    ],
    "Xist": [
      "Mar 17, 2014",
      "2014-03-17"
    ],
    "Citizen404": [
      "Oct 9, 2013",
      "2013-10-09"
    ],
    "SpearmintVR": [
      "Nov 20, 2013",
      "2013-11-20"
    ],
    "MunkenTEST": [
      "Dec 27, 2013",
      "2013-12-27"
    ],
    "Krystal": [
      "Nov 9, 2012",
      "2012-11-09"
    ],
    "ChromeNinja": [
      "Feb 17, 2014",
      "2014-02-17"
    ]
  };

  function recruit(key, moniker, handle) {
    const [dateRaw, dateSortKey] = exampleRecruitDates[handle];
    return referral(key, moniker, handle, "purchasedOn", dateRaw, dateSortKey, profileImages(handle));
  }

  // Selected public profile facts are presentation examples.
  // Unexposed roles stay unknown.
  function member(organizationSid, handle, displayName, rank, rankStars, membershipType) {
    return { recordKey: `${organizationSid}-${handle}`, organizationSid, visibility: "public", displayName, handle, membershipType, rank, rankStars, roles: [], images: profileImages(handle), observation };
  }

  function redactedMember(organizationSid) {
    return { recordKey: `${organizationSid}-redacted-example`, organizationSid, visibility: "restricted", displayName: null, handle: null, membershipType: null, rank: null, rankStars: null, roles: [], images: [], observation };
  }

  // Presentation fixtures only. Parsed history and prices belong to the collection adapter.
  // The example cost split is illustrative; only the $185 total is owner supplied.
  globalThis.CITIZENDATA_DEMO_PLEDGE_DETAILS = {
    "demo-pledge-1": {
      meltValue: { amount: "185.00", currency: "USD" },
      baseValue: { amount: "165.00", currency: "USD" },
      ccuHistory: [{
        fromShip: "F7C-M Super Hornet",
        toShip: "F7C-M Hornet Heartseeker Mk I",
        appliedDateRaw: "February 12, 2021",
        cost: { amount: "20.00", currency: "USD" },
        cumulativeValue: { amount: "185.00", currency: "USD" }
      }]
    },
    "demo-buyback-1": { buybackPrice: { amount: "5.00", currency: "USD" } },
    "demo-buyback-2": { buybackPrice: { amount: "45.00", currency: "USD" } },
    "demo-buyback-3": { buybackPrice: { amount: "70.00", currency: "USD" } },
    "demo-buyback-4": { buybackPrice: { amount: "275.00", currency: "USD" } }
  };

  // Reviewed example articles only; the full item catalog is a separate feature.
  // Ship articles describe the fitted hull, not the entire package.
  globalThis.CITIZENDATA_DEMO_WIKI_ARTICLES = Object.freeze({
    "demo-pledge-1": { name: "F7C-M Super Hornet Heartseeker Mk I", title: "F7C-M_Super_Hornet_Heartseeker_Mk_I" },
    "demo-pledge-2": { name: "AMD Never Settle Space Edition", title: "AMD_Never_Settle_Space_Edition" },
    "demo-pledge-3": { name: "The Lamp", title: "The_Lamp" },
    "demo-buyback-1": { name: 'Custodian "CitizenCon 2947" SMG', title: 'Custodian_"CitizenCon_2947"_SMG' },
    "demo-buyback-2": { name: "Aurora Mk II", title: "Aurora_Mk_II" },
    "demo-buyback-4": { name: "Eclipse", title: "Eclipse" }
  });

  globalThis.CITIZENDATA_DEMO_DATA = Object.freeze({
    schemaVersion: 1,
    generator: { name: "CitizenData synthetic demo", version: "0.1.0" },
    exportedAt: observedAt,
    account: { localAccountId: "00000000-0000-4000-8000-000000000001", ueeCitizenRecord: 42, handle: "DownloadCitizen" },
    profile: {
      displayName: "Download Citizen",
      handle: "DownloadCitizen",
      displayTitle: "Clearance Level Ultra",
      enlistedOnRaw: "October 18, 2012",
      location: null,
      languages: [],
      website: null,
      biography: null,
      mainOrganizationSid: "TEST",
      organizationRank: "RECRUIT",
      dossierBadgeTitle: "Clearance Level Ultra",
      // The identifiers are RSI's own for these two badges. Their artwork comes from the bundled badge catalogue.
      unlockedBadges: [
        { sourceIndex: 0, id: 577, title: "Aggressor", images: [] },
        { sourceIndex: 1, id: 848, title: "Clearance Level Ultra", images: [] }
      ],
      images: [
        image("b094e5ac8e5b1dd2bf15a913f99bf46d1f555e13dcc595ccf13b6663970a0e9a", "avatar", "example-avatar.png", "Example account avatar", 300, 210, "image/png"),
        image("e0f66a56e69402d4c354059a850ce6c28cb74c4b5dec4ff3b0e58725ea313595", "dossierBadge", "clearance-level-ultra.png", "Clearance Level Ultra dossier badge", 144, 144, "image/png")
      ],
      observation
    },
    pledges: [
      {
        pledgeId: null,
        recordKey: "demo-pledge-3",
        title: "Decorations - The Lamp",
        category: "hangarItem",
        availability: "Attributed",
        state: "current",
        createdDateRaw: "September 10, 2016",
        containsSummary: "Contains The Lamp",
        items: [containedItem("lamp-item", "The Lamp", "Hangar decoration", "hangarItem", [image("b313a7a23d597a18b87682cb319471fe496714cfc22e79dd814206ffa7105c55", "thumbnail", "the-lamp-item.jpg", "The Lamp", 216, 133, "image/jpeg")])],
        images: [image("3b0c664ba825d8659ad656c078c433aad234e5e36710027800ca4f396d88116c", "thumbnail", "subscribers_vault_thumbnail", "Decorations - The Lamp", 165, 165, "image/jpeg")],
        sourceLinks: listingSource("pledges"),
        meltValue: null,
        meltEligible: null,
        baseValue: null,
        ccuHistory: [],
        catalogIdentifiers: [],
        observation
      },
      {
        pledgeId: null,
        recordKey: "demo-pledge-2",
        title: "Package - AMD Never Settle Space Edition",
        category: "gamePackage",
        availability: "Attributed",
        state: "current",
        createdDateRaw: "September 2, 2014",
        containsSummary: "Contains Mustang Omega : AMD Edition and 7 items",
        items: [
          containedItem("amd-mustang", "Mustang Omega : AMD Edition", "Ship", "standaloneShip", [image("1cdb29a19e9f3f3a6437ea04238a92fa5fdc9d67a4341d6c7417f4a50583dfee", "thumbnail", "mustang-omega-amd.png", "Mustang Omega : AMD Edition", 216, 133, "image/png")]),
          containedItem("amd-starting-money", "Starting Money: 1,000 UEC", "Credits", "other", [image("d65b4c522214e6288dd508f80c320ad474aa512681d3b5d3b746fc5ded61e651", "thumbnail", "starting-money.jpg", "Starting Money: 1,000 UEC", 216, 133, "image/jpeg")]),
          containedItem("amd-insurance", "2 Month Insurance", "Insurance", "other", [image("22d68a0eea5d1a0ee5989c7950c8b21138714934f131a2f81a3209e2d46738b0", "thumbnail", "lifetime-insurance.jpg", "2 Month Insurance", 216, 133, "image/jpeg")]),
          containedItem("amd-download", "Star Citizen Digital Download", "Digital access", "other", [image("27896a973f5794ebeb88b6060ea5ec6e7ad7a25e93baf87fdb12a4d8461dc3db", "thumbnail", "star-citizen-download.jpg", "Star Citizen Digital Download", 216, 133, "image/jpeg")]),
          containedItem("amd-legacy-ac", "Legacy AC", "Digital access", "other", [image("48245210ff898860e1e1ea08a1f0d7ffb0a6c50f3e4f35923f99a109147ee11f", "thumbnail", "legacy-arena-commander.jpg", "Legacy Arena Commander", 216, 133, "image/jpeg")]),
          containedItem("amd-hangar", "Self-Land Hangar", "Hangar", "hangarItem"),
          containedItem("amd-manual", "Digital Star Citizen Manual", "Digital item", "other"),
          containedItem("amd-s42-download", "Squadron 42 Digital Download", "Digital access", "other")
        ],
        images: [image("7d7ca77a0ffbba902012ccd52089ad56070fce33b8cb621995634382f4523b9e", "thumbnail", "amd-never-settle.png", "Package - AMD Never Settle Space Edition", 165, 165, "image/png")],
        sourceLinks: listingSource("pledges"),
        meltValue: null,
        meltEligible: null,
        baseValue: null,
        ccuHistory: [],
        catalogIdentifiers: [],
        observation
      },
      {
        pledgeId: null,
        recordKey: "demo-pledge-1",
        title: "Package - Weekend Warrior - LTI",
        category: "gamePackage",
        availability: "Attributed",
        state: "current",
        createdDateRaw: "October 22, 2013",
        containsSummary: "Contains F7C-M Hornet Heartseeker Mk I and 10 items",
        items: [
          containedItem("weekend-starting-money", "Starting Money: 5,000 UEC", "Credits", "other", [image("d65b4c522214e6288dd508f80c320ad474aa512681d3b5d3b746fc5ded61e651", "thumbnail", "starting-money.jpg", "Starting Money: 5,000 UEC", 216, 133, "image/jpeg")]),
          containedItem("weekend-lti", "Lifetime Insurance", "Insurance", "other", [image("22d68a0eea5d1a0ee5989c7950c8b21138714934f131a2f81a3209e2d46738b0", "thumbnail", "lifetime-insurance.jpg", "Lifetime Insurance", 216, 133, "image/jpeg")]),
          containedItem("weekend-download", "Star Citizen Digital Download", "Digital access", "other", [image("27896a973f5794ebeb88b6060ea5ec6e7ad7a25e93baf87fdb12a4d8461dc3db", "thumbnail", "star-citizen-download.jpg", "Star Citizen Digital Download", 216, 133, "image/jpeg")]),
          containedItem("weekend-heartseeker", "F7C-M Hornet Heartseeker Mk I", "Ship", "standaloneShip", [image("b2194780b9c3582324c34f521fff36fef7aa1c3b0bd63e0fa116d8147bd93504", "thumbnail", "heartseeker-mk1.jpg", "F7C-M Hornet Heartseeker Mk I", 216, 133, "image/jpeg")]),
          containedItem("weekend-hangar", "Aeroview Hangar", "Hangar", "hangarItem"),
          containedItem("weekend-soundtrack", "Digital Game Soundtrack", "Digital item", "other"),
          containedItem("weekend-star-map", "Digital Star Map", "Digital item", "other"),
          containedItem("weekend-s42-manual", "Digital Squadron 42 Manual", "Digital item", "other"),
          containedItem("weekend-sc-manual", "Digital Star Citizen Manual", "Digital item", "other"),
          containedItem("weekend-s42-download", "Squadron 42 Digital Download", "Digital access", "other"),
          containedItem("weekend-arclight", "Model II Arclight Sidearm", "Weapon", "weapon")
        ],
        images: [image("48b39228b05c2d94f7f9a6359e256943af70ecb31d20676914765cf08f641de2", "thumbnail", "subscribers_vault_thumbnail", "Package - Weekend Warrior - LTI", 165, 165, "image/jpeg")],
        sourceLinks: listingSource("pledges"),
        meltValue: null,
        meltEligible: null,
        baseValue: null,
        ccuHistory: [],
        catalogIdentifiers: [],
        observation
      }
    ],
    hangarLog: [],
    buybacks: [
      {
        buybackId: null,
        recordKey: "demo-buyback-2",
        kind: "ordinary",
        title: "Package - Citizen Starter Pack",
        category: "gamePackage",
        state: "available",
        reclaimDateRaw: "May 19, 2026",
        containsSummary: "Contains Aurora Mk II and 12 items",
        availability: "Available",
        images: [image("2128736229f7727168a8a74463117c7b13a8cfb8205738594af80cf456c5d9b8", "thumbnail", "citizen-starter-pack.jpg", "Package - Citizen Starter Pack", 165, 165, "image/jpeg")],
        sourceLinks: listingSource("buybacks"),
        buybackPrice: null,
        items: [],
        catalogIdentifiers: [],
        upgrade: null,
        observation
      },
      {
        buybackId: null,
        recordKey: "demo-buyback-1",
        kind: "ordinary",
        title: "Add-Ons - Kastak Arms Custodian SMG - CitizenCon 2947",
        category: "weapon",
        state: "available",
        reclaimDateRaw: "October 27, 2017",
        containsSummary: "Contains Kastak Arms Custodian SMG - CitizenCon 2947 Edition",
        availability: "Available",
        images: [image("e35faf39521ed71bc23a7e914305cc3a55a19edfa025a65d72008803a79380f9", "thumbnail", "custodian-smg.jpg", "Kastak Arms Custodian SMG - CitizenCon 2947", 165, 165, "image/jpeg")],
        sourceLinks: listingSource("buybacks"),
        buybackPrice: null,
        items: [],
        catalogIdentifiers: [],
        upgrade: null,
        observation
      },
      {
        // The buy-back date is the first day of the Eclipse concept sale, 2017-05-19.
        buybackId: null,
        recordKey: "demo-buyback-4",
        kind: "ordinary",
        title: "Standalone Ship - Aegis Eclipse LTI",
        category: "standaloneShip",
        state: "available",
        reclaimDateRaw: "May 19, 2017",
        containsSummary: "Contains Eclipse and 4 items",
        availability: "Available",
        images: [image("ec1bcedad810297fef8ca3dfb193853091049232ea0813422a636d589219c37d", "thumbnail", "aegis-eclipse-lti.jpg", "Standalone Ship - Aegis Eclipse LTI", 165, 165, "image/jpeg")],
        sourceLinks: listingSource("buybacks"),
        buybackPrice: null,
        items: [],
        catalogIdentifiers: [],
        upgrade: null,
        observation
      },
      {
        buybackId: null,
        recordKey: "demo-buyback-3",
        kind: "ordinary",
        title: "Standalone Ships - Argo Combo Pack - LTI",
        category: "standaloneShip",
        state: "available",
        reclaimDateRaw: "August 25, 2016",
        containsSummary: "Contains 2 ships and 4 items",
        availability: "Available",
        images: [image("ccc1161adf1f0f41888f8a644461b2b08875f10ced3f97e0e6b997a0ec71e0c1", "thumbnail", "argo-combo-pack-lti.jpg", "Standalone Ships - Argo Combo Pack - LTI", 165, 165, "image/jpeg")],
        sourceLinks: listingSource("buybacks"),
        buybackPrice: null,
        items: [],
        catalogIdentifiers: [],
        upgrade: null,
        observation
      }
    ],
    financial: {
      balances: {
        storeCredit: { amount: "395.00", unit: "USD", observedAt },
        uec: { amount: "42000", unit: "UEC", observedAt },
        rec: { amount: "7500", unit: "REC", observedAt }
      },
      billingTotal: { amount: "1069.42", currency: "USD", observedAt, source: "billingPageTotal" },
      creditLedgers: { storeCredit: [], uec: [], rec: [] },
      subscriptions: [
        {
          subscriptionId: "example-centurion",
          plan: "Centurion Monthly Plan",
          state: "ended",
          startDateRaw: "May 1, 2022",
          endDateRaw: "November 1, 2025",
          recurringState: null,
          amount: null,
          totalPaid: { amount: "420.00", currency: "USD" },
          totalTimeRaw: "42 months",
          payments: [],
          images: [],
          observation
        },
        {
          subscriptionId: "example-imperator",
          plan: "Imperator Monthly Plan",
          state: "active",
          startDateRaw: "November 1, 2026",
          endDateRaw: "December 1, 2026",
          recurringState: "Recurring",
          amount: { amount: "20.00", currency: "USD" },
          totalPaid: { amount: "20.00", currency: "USD" },
          totalTimeRaw: "1 month",
          payments: [{ rawTimestamp: "November 1, 2026", processor: null, status: "paid", amount: { amount: "20.00", currency: "USD" } }],
          images: [],
          observation
        }
      ],
      orders: []
    },
    referrals: {
      current: {
        prospects: [
          referral("current-prospect-1", "Christopher Blair", "ChristopherBlair", "enlistedOn", "March 11, 2026", "2026-03-11"),
          referral("current-prospect-2", "Arthur Dent", "ArthurDent", "enlistedOn", "February 18, 2026", "2026-02-18"),
          referral("current-prospect-3", "Sarah Connor", "SarahConnor", "enlistedOn", "January 7, 2026", "2026-01-07"),
          referral("current-prospect-4", "Rose Tyler", "BadWolf", "enlistedOn", "January 1, 2026", "2026-01-01")
        ],
        recruits: [
          recruit("current-recruit-directorgunner", "DirectorGunner", "DirectorGunner"),
          recruit("current-recruit-1", "Citizen Ed", "CZenStar"),
          recruit("current-recruit-2", "Shive", "GOD_Shive"),
          recruit("current-recruit-3", "Xist", "Xist"),
          recruit("current-recruit-4", "Citizen 404", "Citizen404")
        ]
      },
      legacy: {
        prospects: [
          referral("legacy-prospect-1", "Ford Prefect", "FordPrefect", "enlistedOn", "December 9, 2024", "2024-12-09"),
          referral("legacy-prospect-2", "John Connor", "JohnConnor", "enlistedOn", "October 1, 2024", "2024-10-01"),
          referral("legacy-prospect-3", "The Doctor", "TenthDoctor", "enlistedOn", "July 17, 2024", "2024-07-17"),
          referral("legacy-prospect-4", "Todd Marshall", "Maniac", "enlistedOn", "June 3, 2024", "2024-06-03")
        ],
        recruits: [
          recruit("legacy-recruit-directorgunner", "DirectorGunner", "DirectorGunner"),
          recruit("legacy-recruit-1", "Spearmint", "SpearmintVR"),
          recruit("legacy-recruit-2", "Munken", "MunkenTEST"),
          recruit("legacy-recruit-3", "[TEST] Krystal LeChuck", "Krystal"),
          recruit("legacy-recruit-4", "ChromeNinja", "ChromeNinja")
        ]
      }
    },
    organizations: {
      memberships: [
        { sid: "TEST", name: "TEST", membershipType: "main", memberCount: 24652, rank: "RECRUIT", archetype: null, language: null, primaryActivity: null, secondaryActivity: null, recruiting: null, rolePlay: null, commitment: null, exclusive: null, images: [image("568f5e512c91fa58aa8d226cf2ed742e7d2292013a1972123a79c4de3903a710", "emblem", "test-emblem.png", "TEST organization emblem", 165, 165, "image/png")], observation },
        { sid: "MMHC", name: "Million Mile High Club", membershipType: "affiliate", memberCount: 117, rank: "Recruit", archetype: null, language: null, primaryActivity: null, secondaryActivity: null, recruiting: null, rolePlay: null, commitment: null, exclusive: null, images: [image("4f9347b97f073a4bf0256e92b75c95eb52602fc53e5b07250fc78e6a327d04c5", "emblem", "mmhc-emblem.png", "Million Mile High Club emblem", 165, 165, "image/png")], observation }
      ],
      members: [
        member("TEST", "Montoya", "Montoya", "Admiral", 5, "main"),
        member("TEST", "DirectorGunner", "DirectorGunner", "Captain", 3, "main"),
        member("TEST", "ChromeNinja", "ChromeNinja", "Rear Admiral", 4, "main"),
        member("TEST", "O-Lefty", "O-Lefty", "Rear Admiral", 4, "main"),
        member("TEST", "wmk", "wmk", "Lieutenant", 2, "main"),
        member("TEST", "Tincup", "Tincup", "Cadet", 0, "main"),
        member("TEST", "Knax", "Knax", "Rear Admiral", 4, "main"),
        member("TEST", "mromutt", "mromutt", "Rear Admiral", 4, "main"),
        member("TEST", "Citizen404", "Citizen 404", "Admiral", 5, "main"),
        member("TEST", "GOD_Shive", "Shive", "Rear Admiral", 4, "main"),
        member("TEST", "Xist", "Xist", "Rear Admiral", 4, "main"),
        member("TEST", "MunkenTEST", "Munken", "Rear Admiral", 4, "main"),
        member("TEST", "Krystal", "[TEST] Krystal LeChuck", "Rear Admiral", 4, "main"),
        member("TEST", "Arrangingstars", "Arrangingstars", "Lieutenant", 2, "main"),
        redactedMember("TEST"),
        member("MMHC", "DirectorGunner", "DirectorGunner", "Recruit", 0, "affiliate"),
        member("MMHC", "Xist", "Xist", "Proprietor", 2, "affiliate"),
        member("MMHC", "SpearmintVR", "Spearmint", "Proprietor", 2, "affiliate"),
        member("MMHC", "Proxus-CIG", "Proxus-CIG", "Entrepreneur", 3, "affiliate"),
        member("MMHC", "Morphologis", "Morphologis", "Recruit", 0, "affiliate"),
        member("MMHC", "CZenStar", "Citizen Ed", "Proprietor", 2, "affiliate"),
        member("MMHC", "Lady_Glume", "Lady Glume", "Proprietor", 2, "affiliate"),
        redactedMember("MMHC")
      ]
    },
    sync: {
      sectionOutcomes: {
        profile: completeOutcome(1),
        pledges: completeOutcome(3),
        hangarLog: completeOutcome(0),
        buybacks: completeOutcome(4),
        "financial.balances": completeOutcome(3),
        "financial.billingTotal": completeOutcome(1),
        "financial.creditLedgers.storeCredit": completeOutcome(0),
        "financial.creditLedgers.uec": completeOutcome(0),
        "financial.creditLedgers.rec": completeOutcome(0),
        "financial.orders": completeOutcome(0),
        "financial.subscriptions": completeOutcome(2),
        "referrals.current.prospects": completeOutcome(4),
        "referrals.current.recruits": completeOutcome(5),
        "referrals.legacy.prospects": completeOutcome(4),
        "referrals.legacy.recruits": completeOutcome(5),
        "organizations.memberships": completeOutcome(2)
      },
      organizationMemberOutcomes: {},
      checkpoints: {},
      runs: []
    },
    integrity: { algorithm: "SHA-256", contentHash: "0000000000000000000000000000000000000000000000000000000000000000" }
  });
})();
