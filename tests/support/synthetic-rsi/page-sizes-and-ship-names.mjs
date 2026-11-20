export const ORIGIN = "https://robertsspaceindustries.com";
export const MEDIA = "https://media.robertsspaceindustries.com/synthetic";
export const PLEDGES_PER_PAGE = 10;
export const BUYBACKS_PER_PAGE = 100;
// RSI returns the Hangar Log and the credit ledgers 25 rows to a page.
export const LOG_ROWS_PER_PAGE = 25;
export const ORDERS_PER_PAGE = 100;
export const REFERRALS_PER_PAGE = 100;
export const MEMBERS_PER_PAGE = 32;
export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
// Real ship and maker names, so the Hangar Link export's ship table has something to match. One title is spelled
// the way RSI sells a special edition, and the last ship is invented, so it is in nobody's table.
export const SHIPS = [
  ["Aurora MR", "Roberts Space Industries", "RSI"],
  ["Mustang Alpha", "Consolidated Outland", "CNOU"],
  ["Avenger Titan", "Aegis Dynamics", "AEGS"],
  ["Cutlass Black", "Drake Interplanetary", "DRAK"],
  ["Gladius", "Aegis Dynamics", "AEGS"],
  ["Freelancer", "Musashi Industrial & Starflight Concern", "MISC"],
  ["Constellation Andromeda", "Roberts Space Industries", "RSI"],
  ["Carrack", "Anvil Aerospace", "ANVL"],
  ["Mustang Omega : AMD Edition", "Consolidated Outland", "CNOU"],
  ["Synthetic Prototype", "Synthetic Works", "SYNW"]
];
// RSI names an upgrade by two plain ship names.
export const UPGRADE_SHIPS = SHIPS.filter(([name]) => !name.includes(":")).map(([name]) => name);
// RSI's number of the first of those ships in the store upgrade page's list; the others follow.
export const HANGAR_SHIP_ID = 900;
export const INSURANCE = ["Lifetime Insurance", "120 Month Insurance", "6 Month Insurance", "3 Month Insurance", "2 Month Insurance"];
