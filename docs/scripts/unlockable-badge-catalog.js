(() => {
  "use strict";

  const catalogue = Array.isArray(globalThis.CITIZENDATA_BADGE_CATALOG) ? globalThis.CITIZENDATA_BADGE_CATALOG : [];
  const unlockable = [];

  function catalogueEntry(section, title) {
    return catalogue.find((entry) => entry?.section === section && entry?.title === title) ?? null;
  }

  function addCatalogueBadge(section, title) {
    const entry = catalogueEntry(section, title);
    if (!entry?.images?.[0]) return;
    unlockable.push(Object.freeze({
      title,
      section,
      images: Object.freeze([entry.images[0]]),
      sourcePage: entry.sourcePage
    }));
  }

  function addGuideBadges(category, ranks) {
    const entry = catalogueEntry("Guide titles", category);
    if (!entry) return;
    for (let index = 0; index < ranks.length; index += 1) {
      const image = entry.images?.[index];
      if (!image) continue;
      unlockable.push(Object.freeze({
        title: `${category} ${ranks[index]}`,
        section: "Guide titles",
        images: Object.freeze([image]),
        sourcePage: entry.sourcePage
      }));
    }
  }

  for (const title of [
    "Civilian", "Scout", "Mercenary", "Bounty Hunter", "Colonel", "Freelancer", "Rear Admiral", "Vice Admiral",
    "High Admiral", "Grand Admiral", "Lt. Commander", "Space Marshal", "Wing Commander", "Completionist", "Praetorian", "Legatus"
  ]) addCatalogueBadge("Backer titles", title);

  for (const title of [
    "Recruiter", "Private", "Corporal", "Sergeant", "Lieutenant", "Captain", "Major", "Lt. Colonel", "Colonel",
    "Brigadier General", "Major General", "Lt. General"
  ]) addCatalogueBadge("Recruitment titles", title);

  const allGuideRanks = ["Escort", "Instructor", "Counselor", "Mentor", "Guru", "Master"];
  addGuideBadges("Beginner Basics", allGuideRanks);
  addGuideBadges("FPS Combat", allGuideRanks);
  addGuideBadges("Medical", ["Escort", "Instructor"]);
  addGuideBadges("Mining", allGuideRanks);
  addGuideBadges("Missions & Reputation", allGuideRanks);
  addGuideBadges("Racing", ["Instructor"]);
  addGuideBadges("Refresher Basics", ["Escort"]);
  addGuideBadges("Refueling", ["Escort", "Instructor"]);
  addGuideBadges("Salvaging", ["Escort", "Instructor"]);
  addGuideBadges("Touring", allGuideRanks);
  addGuideBadges("Trading", allGuideRanks);
  addGuideBadges("Vehicle Combat", allGuideRanks);

  for (const title of ["Cartographer", "Predator", "Apex Predator", "Prospector", "Guardian Angel", "Sapper Badge"])
    addCatalogueBadge("Minigame titles", title);

  for (const title of ["2953 Pirate Aggressor", "2953 Vanduul Aggressor", "2953 Master-At-Arms", "2953 Tonk Commander", "999th Test Squadron"])
    addCatalogueBadge("Arena Commander titles", title);

  for (const title of ["Most Valuable Poster", "Subscriber"]) addCatalogueBadge("Other titles", title);

  globalThis.CITIZENDATA_UNLOCKABLE_BADGES = Object.freeze(unlockable);
})();
