// Economy -- the two currencies, the artifact shop and the between-match hold.
//
// Design notes, so the rules stay legible next to islands.js / artifacts.js:
//
//  * GOLD is the soft currency. Every finished match pays out (a win pays
//    more than a close loss -- lost by one island -- which pays more than a
//    loss, and points/held islands add on top), so a player who
//    keeps playing can always afford the common artifacts.
//  * CRYSTALS are the scarce currency. They are minted by taking a voyage's
//    objective for the FIRST time (see awardMatchRewards below) and, since
//    P15, by a new title band and day 7 of the streak (progression.js, via
//    grantReward), so the two crystal-priced artifacts are gated behind
//    progress rather than behind grinding Quick Play.
//  * The HOLD is the between-match inventory. Buying puts an artifact in the
//    hold; startGame() loads the whole hold into the match (loadHoldIntoMatch)
//    and clears it, and whatever the player did NOT spend is returned at
//    GAME_OVER (returnUnusedToHold). Only bought items come back -- artifacts
//    that dropped from island captures during the match stay in that match,
//    exactly as before, so drops can't be banked and compound.
//
// Everything persists in one localStorage key and every entry point is
// try/catch'd: a corrupt or unavailable store degrades to "no money, empty
// hold", never to a thrown exception in the middle of a match.

import { ARTIFACT_IDS } from './artifacts.js';

const ECONOMY_KEY = 'seahunter_economy';

// Prices. Common artifacts cost gold; the two that swing a whole match
// (guaranteed kill / skip the opponent's turn) cost crystals instead.
export const PRICES = {
  spyglass:      { gold: 40 },
  spare_parts:   { gold: 60 },
  smoke_bomb:    { gold: 70 },
  kraken_bait:   { crystals: 2 },
  lucky_compass: { crystals: 3 },
};

// Payout table (tunable in one place).
export const REWARDS = {
  win: 50,
  closeLoss: 25,
  loss: 15,
  perPoint: 10,
  perIslandHeld: 5,
  crystalsPerFirstClear: 1,
};

function defaultEconomy() {
  return { gold: 0, crystals: 0, hold: {} }; // hold[artifactId] = count
}

export function loadEconomy() {
  try {
    const raw = window.localStorage.getItem(ECONOMY_KEY);
    if (!raw) return defaultEconomy();
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return defaultEconomy();
    const eco = { ...defaultEconomy(), ...parsed };
    eco.gold = Number.isFinite(eco.gold) ? Math.max(0, Math.floor(eco.gold)) : 0;
    eco.crystals = Number.isFinite(eco.crystals) ? Math.max(0, Math.floor(eco.crystals)) : 0;
    // Drop anything that is not a live artifact id, so a renamed/removed
    // artifact can never resurrect itself out of an old save.
    const hold = {};
    for (const id of ARTIFACT_IDS) {
      const n = Math.floor(eco.hold && eco.hold[id]);
      if (Number.isFinite(n) && n > 0) hold[id] = n;
    }
    eco.hold = hold;
    return eco;
  } catch (e) {
    return defaultEconomy();
  }
}

export function saveEconomy(eco) {
  try {
    window.localStorage.setItem(ECONOMY_KEY, JSON.stringify(eco));
  } catch (e) { /* balance just won't persist across sessions */ }
}

export function getBalance() {
  const eco = loadEconomy();
  return { gold: eco.gold, crystals: eco.crystals };
}

export function getHold() {
  return loadEconomy().hold;
}

export function priceOf(artifactId) {
  return PRICES[artifactId] || null;
}

export function canAfford(artifactId, eco = loadEconomy()) {
  const price = priceOf(artifactId);
  if (!price) return false;
  if (price.gold !== undefined && eco.gold < price.gold) return false;
  if (price.crystals !== undefined && eco.crystals < price.crystals) return false;
  return true;
}

// Buy one artifact into the hold. Returns { ok, msg, balance }.
export function buyArtifact(artifactId) {
  const eco = loadEconomy();
  const price = priceOf(artifactId);
  if (!price) return { ok: false, msg: 'That artifact is not for sale.', balance: getBalance() };
  if (!canAfford(artifactId, eco)) {
    const what = price.crystals !== undefined ? 'crystals' : 'gold';
    return { ok: false, msg: `Not enough ${what}.`, balance: getBalance() };
  }
  if (price.gold !== undefined) eco.gold -= price.gold;
  if (price.crystals !== undefined) eco.crystals -= price.crystals;
  eco.hold[artifactId] = (eco.hold[artifactId] || 0) + 1;
  saveEconomy(eco);
  return { ok: true, msg: 'Stowed in your hold -- it sails with you next match.', balance: getBalance() };
}

// Called at match start. Returns a flat array of artifact ids to seed
// state.p1Artifacts with, and empties the hold (unused ones come back via
// returnUnusedToHold at GAME_OVER).
export function loadHoldIntoMatch() {
  const eco = loadEconomy();
  const loadout = [];
  for (const [id, n] of Object.entries(eco.hold)) {
    for (let i = 0; i < n; i++) loadout.push(id);
  }
  eco.hold = {};
  saveEconomy(eco);
  return loadout;
}

// Called at GAME_OVER. `loadout` is what loadHoldIntoMatch() handed out at
// the start; `remaining` is state.p1Artifacts as it stands now. Per artifact
// id we return min(still held, was loaded) -- so unspent purchases come back
// and in-match drops do not.
export function returnUnusedToHold(loadout = [], remaining = []) {
  try {
    const eco = loadEconomy();
    const count = (arr) => arr.reduce((acc, id) => (acc[id] = (acc[id] || 0) + 1, acc), {});
    const loaded = count(loadout);
    const left = count(remaining);
    for (const [id, n] of Object.entries(loaded)) {
      const back = Math.min(n, left[id] || 0);
      if (back > 0) eco.hold[id] = (eco.hold[id] || 0) + back;
    }
    saveEconomy(eco);
    return eco.hold;
  } catch (e) {
    return getHold();
  }
}

// Called at GAME_OVER, before campaign progress is recorded (so
// `firstCampaignClear` can be decided against the OLD progress).
// Returns { gold, crystals, total } -- what this match just paid.
export function awardMatchRewards({ won, points = 0, oppPoints = 0, islandsHeld = 0, firstCampaignClear = false }) {
  const eco = loadEconomy();
  const closeLoss = !won && oppPoints - points === 1;
  const gold = (won ? REWARDS.win : closeLoss ? REWARDS.closeLoss : REWARDS.loss)
    + Math.max(0, points) * REWARDS.perPoint
    + Math.max(0, islandsHeld) * REWARDS.perIslandHeld;
  const crystals = firstCampaignClear ? REWARDS.crystalsPerFirstClear : 0;
  eco.gold += gold;
  eco.crystals += crystals;
  saveEconomy(eco);
  return { gold, crystals, balance: { gold: eco.gold, crystals: eco.crystals } };
}

// Pays a reward that is not a match payout (a daily goal, the streak, a
// level-up -- see progression.js). Returns the new balance.
export function grantReward({ gold = 0, crystals = 0 } = {}) {
  const eco = loadEconomy();
  eco.gold += Math.max(0, Math.floor(gold));
  eco.crystals += Math.max(0, Math.floor(crystals));
  saveEconomy(eco);
  return { gold: eco.gold, crystals: eco.crystals };
}

export function resetEconomy() {
  saveEconomy(defaultEconomy());
}
