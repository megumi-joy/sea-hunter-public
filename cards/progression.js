// Progression -- player level, rank, daily goals, the login streak and the
// Fleet collection. Phase P15 "Progression and retention".
//
// Same shape as economy.js and voyage.js's progress store: pure rules plus one
// localStorage key, every access try/catch'd, so a private-mode browser or a
// corrupt save degrades to "a fresh level 1 captain", never to a thrown error
// on a game screen. No DOM here; render/progress.js paints all of it.
//
// What already existed and is reused rather than duplicated:
//   * gold and crystals live in economy.js -- goal, streak and level rewards
//     are paid through its grantReward(), never through a second wallet;
//   * the campaign is voyage.js's twenty missions (loadVoyageProgress);
//   * identity is profile.js, and the only server sync is leaderboard.js's
//     existing score POST (see syncFields below).

import { grantReward } from './economy.js';

const KEY = 'seahunter_progression';
export const MAX_LEVEL = 30;

// ---- level and title ------------------------------------------------------

// Eight bands over thirty levels. The band a level falls in is its title.
export const TITLES = [
  { from: 1,  name: 'Deckhand' },
  { from: 4,  name: 'Boatswain' },
  { from: 8,  name: 'Helmsman' },
  { from: 12, name: 'Gunner' },
  { from: 16, name: 'Quartermaster' },
  { from: 20, name: 'First Mate' },
  { from: 24, name: 'Captain' },
  { from: 28, name: 'Commodore' },
];

export function titleOf(level) {
  let t = TITLES[0];
  for (const b of TITLES) if (level >= b.from) t = b;
  return t.name;
}

// XP needed to go from `level` to level + 1. A gentle ramp: level 2 is one
// win away, level 30 is roughly a hundred and fifty matches in.
export function xpToNext(level) {
  return 100 + (level - 1) * 25;
}

export function levelOf(xp) {
  let level = 1;
  let into = Math.max(0, Math.floor(xp || 0));
  while (level < MAX_LEVEL && into >= xpToNext(level)) {
    into -= xpToNext(level);
    level++;
  }
  const need = level < MAX_LEVEL ? xpToNext(level) : 0;
  return { level, into: need ? into : 0, need, title: titleOf(level) };
}

export const XP = { win: 100, closeLoss: 60, loss: 40, perCapture: 10, goal: 40 };

// Every level-up pays a little gold; entering a new title band pays a crystal.
export const LEVEL_REWARD = { gold: 30, bandCrystals: 1 };

// ---- rank -----------------------------------------------------------------

// Three cups (the P13 rank_3 / rank_2 / rank_1 items), three divisions each,
// four pips per division. A win adds a pip, a plain loss takes one, a close
// loss holds. A division floor is never lost, so a bad evening cannot undo a
// promotion.
export const RANK_TIERS = [
  { name: 'Bronze', item: 'rank_3' },
  { name: 'Silver', item: 'rank_2' },
  { name: 'Gold',   item: 'rank_1' },
];
export const PIPS_PER_DIVISION = 4;
const DIVISIONS = ['III', 'II', 'I'];
const RANK_STEPS = RANK_TIERS.length * DIVISIONS.length * PIPS_PER_DIVISION;

export function rankOf(points) {
  const p = Math.max(0, Math.min(RANK_STEPS, Math.floor(points || 0)));
  const div = Math.min(RANK_TIERS.length * DIVISIONS.length - 1, Math.floor(p / PIPS_PER_DIVISION));
  const tier = RANK_TIERS[Math.floor(div / DIVISIONS.length)];
  const top = p >= RANK_STEPS;
  return {
    points: p,
    name: `${tier.name} ${DIVISIONS[div % DIVISIONS.length]}`,
    item: tier.item,
    pips: top ? PIPS_PER_DIVISION : p - div * PIPS_PER_DIVISION,
    floor: div * PIPS_PER_DIVISION,
  };
}

// ---- daily goals ----------------------------------------------------------

// `stat` names the per-match number in recordMatch() that advances the goal.
export const GOALS = {
  win:        { text: 'Win a match',                         need: 1, stat: 'wins',       gold: 40 },
  capture2:   { text: 'Capture two islands',                 need: 2, stat: 'captures',   gold: 40 },
  drawWin:    { text: 'Win a match with a drawn round in it', need: 1, stat: 'drawWins',   gold: 60 },
  reveal5:    { text: 'Reveal five hidden enemy cards',      need: 5, stat: 'reveals',    gold: 40 },
  play3:      { text: 'Finish three matches',                need: 3, stat: 'matches',    gold: 40 },
  voyageNode: { text: 'Clear an enemy fleet on a voyage',    need: 1, stat: 'voyageWins', gold: 50 },
  closeFight: { text: 'Win a match by a single island',      need: 1, stat: 'closeWins',  gold: 50 },
};
const GOAL_IDS = Object.keys(GOALS);

export const STREAK_REWARDS = { 3: { gold: 50 }, 7: { gold: 100, crystals: 1 } };

// Local calendar day, so goals roll over at the player's own midnight.
export function dayKey(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function dayBefore(key) {
  const [y, m, d] = key.split('-').map(Number);
  return dayKey(new Date(y, m - 1, d - 1));
}

// Three goals per day, picked from the date so every device shows the same
// three for the same day; "win a match" is always one of them.
function goalsFor(key) {
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const rest = GOAL_IDS.filter((id) => id !== 'win');
  const a = rest.splice(h % rest.length, 1)[0];
  const b = rest[(h >>> 7) % rest.length];
  return ['win', a, b].map((id) => ({ id, n: 0, done: false }));
}

// ---- persistence ----------------------------------------------------------

function fresh() {
  return {
    xp: 0,
    rank: 0,
    day: '',
    goals: [],
    streak: { count: 0, last: '' },
    seen: { cards: {}, islands: {} },
    owned: { islands: {} },
    matches: 0,
  };
}

export function loadProgress() {
  try {
    const raw = window.localStorage.getItem(KEY);
    const p = raw ? { ...fresh(), ...JSON.parse(raw) } : fresh();
    p.seen = { cards: {}, islands: {}, ...(p.seen || {}) };
    p.owned = { islands: {}, ...(p.owned || {}) };
    p.streak = { count: 0, last: '', ...(p.streak || {}) };
    if (!Number.isFinite(p.xp)) p.xp = 0;
    if (!Number.isFinite(p.rank)) p.rank = 0;
    return rollDay(p);
  } catch (e) {
    return rollDay(fresh());
  }
}

export function saveProgress(p) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(p));
  } catch (e) { /* progress just will not persist */ }
}

// A new local day deals three new goals. The streak is not touched here -- it
// only advances when a match is actually finished on that day.
function rollDay(p, now = new Date()) {
  const today = dayKey(now);
  if (p.day !== today || !Array.isArray(p.goals) || p.goals.length !== 3) {
    p.day = today;
    p.goals = goalsFor(today);
  }
  return p;
}

// The streak as the menu shows it: a run broken yesterday reads as 0 today.
export function streakView(p = loadProgress()) {
  const today = dayKey();
  const alive = p.streak.last === today || p.streak.last === dayBefore(today);
  const count = alive ? p.streak.count : 0;
  return { count, playedToday: p.streak.last === today, pip: count ? ((count - 1) % 7) + 1 : 0 };
}

// ---- the match result -----------------------------------------------------

// `stats` = { won, score: [mine, theirs], captures, reveals, drawRounds,
// voyage, seenCards, seenIslands, capturedIslands }. The three lists feed the
// Fleet collection: seen = appeared face-up on the board or as the contested
// island, owned island = captured at least once. Applies XP, rank, goals and
// the streak, pays every reward through economy.js, saves once, and returns
// what happened -- the results ladder animates exactly this.
export function recordMatch(stats) {
  const p = loadProgress();
  const before = { xp: p.xp, level: levelOf(p.xp), rank: rankOf(p.rank) };
  const [mine, theirs] = stats.score || [0, 0];
  const won = !!stats.won;
  const kind = won ? 'win' : (theirs - mine === 1 ? 'close' : 'loss');

  const perMatch = {
    wins: won ? 1 : 0,
    matches: 1,
    captures: stats.captures || 0,
    reveals: stats.reveals || 0,
    drawWins: won && stats.drawRounds > 0 ? 1 : 0,
    voyageWins: won && stats.voyage ? 1 : 0,
    closeWins: won && mine - theirs === 1 ? 1 : 0,
  };

  let xpGain = (kind === 'win' ? XP.win : kind === 'close' ? XP.closeLoss : XP.loss)
    + perMatch.captures * XP.perCapture;

  const goalsDone = [];
  const goalGold = { gold: 0, crystals: 0 };
  p.goals.forEach((g) => {
    const def = GOALS[g.id];
    if (!def || g.done) return;
    g.n = Math.min(def.need, g.n + (perMatch[def.stat] || 0));
    if (g.n >= def.need) {
      g.done = true;
      goalsDone.push(g.id);
      goalGold.gold += def.gold;
      xpGain += XP.goal;
    }
  });

  let streakDay = 0;
  let streakReward = null;
  const today = dayKey();
  if (p.streak.last !== today) {
    p.streak.count = p.streak.last === dayBefore(today) ? p.streak.count + 1 : 1;
    p.streak.last = today;
    streakDay = p.streak.count;
    streakReward = STREAK_REWARDS[((streakDay - 1) % 7) + 1] || null;
  }

  p.xp += xpGain;
  const after = levelOf(p.xp);
  const levelUps = [];
  const levelGold = { gold: 0, crystals: 0 };
  for (let l = before.level.level + 1; l <= after.level; l++) {
    levelUps.push({ level: l, title: titleOf(l), newTitle: titleOf(l) !== titleOf(l - 1) });
    levelGold.gold += LEVEL_REWARD.gold;
    if (titleOf(l) !== titleOf(l - 1)) levelGold.crystals += LEVEL_REWARD.bandCrystals;
  }

  const floor = before.rank.floor;
  p.rank = kind === 'win' ? p.rank + 1 : kind === 'loss' ? Math.max(floor, p.rank - 1) : p.rank;
  p.matches = (p.matches || 0) + 1;
  (stats.seenCards || []).forEach((id) => { p.seen.cards[id] = 1; });
  (stats.seenIslands || []).forEach((id) => { p.seen.islands[id] = 1; });
  (stats.capturedIslands || []).forEach((id) => { p.seen.islands[id] = 1; p.owned.islands[id] = 1; });
  saveProgress(p);

  const bonus = {
    gold: goalGold.gold + levelGold.gold + (streakReward ? streakReward.gold || 0 : 0),
    crystals: levelGold.crystals + (streakReward ? streakReward.crystals || 0 : 0),
  };
  const balance = (bonus.gold || bonus.crystals) ? grantReward(bonus) : null;

  return {
    kind, xpGain, before, after: { xp: p.xp, level: after, rank: rankOf(p.rank) },
    levelUps, goalsDone, goalGold, streakDay, streakReward, bonus, balance,
  };
}

// Extra fields for the existing leaderboard POST (leaderboard.js). The
// server's model ignores fields it does not know today; they are there for
// when it stores them, and cost nothing until then.
export function syncFields() {
  const p = loadProgress();
  const lv = levelOf(p.xp);
  return { level: lv.level, title: lv.title, xp: p.xp, rank: rankOf(p.rank).name };
}

// Debug-only seeding for the screenshot pass (?seed=progress). Never called
// without the flag.
export function seedDemo({ nearLevelUp = false } = {}) {
  const p = fresh();
  p.xp = nearLevelUp ? 1175 : 520;
  p.rank = 9;
  rollDay(p);
  p.goals[0].n = 0;
  p.goals[1].n = 1;
  p.goals[2].done = true;
  p.goals[2].n = GOALS[p.goals[2].id].need;
  p.streak = { count: 2, last: dayBefore(dayKey()) };
  p.seen.cards = { battleship: 1, cruiser: 1, destroyer: 1, submarine: 1, mine: 1, plane: 1, sea_hunter: 1 };
  p.seen.islands = { radar: 1, maneuver: 1, two_island: 1 };
  p.owned.islands = { radar: 1 };
  saveProgress(p);
}
