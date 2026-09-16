// Voyage -- a campaign mission you sail through, rather than a single battle.
//
// Each mission is a small chart of nodes connected by sea lanes. The fleet
// starts at the home port, spends moves to travel a lane, and whatever sits on
// the node it reaches is resolved on arrival: an enemy fleet starts a card
// battle (the ordinary engine, no special rules), a cache pays out, a storm
// costs moves, a port restores them. Clearing the mission means reaching the
// goal node -- which is guarded, so the last stop is always a fight.
//
// This module is pure data and rules: no DOM, no localStorage, no engine
// imports. That keeps it testable on its own and keeps the "where am I on the
// chart" state separate from "what is happening in this battle" (store.state),
// which is what lets a battle return to the chart instead of the menu.

export const NODE = {
  PORT: 'port',
  FLEET: 'fleet',
  CACHE: 'cache',
  STORM: 'storm',
  GOAL: 'goal',
};

export const NODE_INFO = {
  [NODE.PORT]:  { title: 'Port',        note: 'Refit: restores moves.' },
  [NODE.FLEET]: { title: 'Enemy fleet', note: 'A card battle blocks the lane.' },
  [NODE.CACHE]: { title: 'Cache',       note: 'Salvage: gold for the hold.' },
  [NODE.STORM]: { title: 'Storm',       note: 'Rough water costs extra moves.' },
  [NODE.GOAL]:  { title: 'Objective',   note: 'Guarded. Take it to finish the voyage.' },
};

// ── Deterministic RNG ────────────────────────────────────────────────────────
// Missions are generated, not authored, so the same mission id must always
// produce the same chart -- otherwise a player who leaves mid-voyage comes
// back to a different map. mulberry32 is enough for layout decisions.
function rng(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const MISSION_COUNT = 20;

// Mission difficulty ramps in five bands of four missions. Within a band the
// AI level is fixed and only the chart grows, so a player feels the map open
// up before the opponent gets sharper.
function bandOf(missionId) {
  return Math.min(4, Math.floor((missionId - 1) / 4));
}

export function missionMeta(missionId) {
  const band = bandOf(missionId);
  return {
    id: missionId,
    name: MISSION_NAMES[missionId - 1] || `Voyage ${missionId}`,
    difficulty: [1, 1, 2, 2, 3][band],
    rows: 3 + Math.min(2, band),          // chart height in lanes
    columns: 4 + band,                    // how far the objective sits
    moves: 8 + band * 3,                  // travel budget for the whole chart
  };
}

const MISSION_NAMES = [
  'Home Waters', 'The Shallows', 'Salt Marsh Run', 'Broken Reef',
  'Smugglers Lane', 'The Doldrums', 'Cutter Bay', 'Iron Channel',
  'Widow Rocks', 'The Long Crossing', 'Blackwater Sound', 'Gallows Point',
  'The Maelstrom', 'Cinder Isles', 'Bone Shoal', 'The Narrows',
  'Ashen Harbour', 'Leviathan Deep', 'The Last Reach', 'Admiralty',
];

// ── Chart generation ─────────────────────────────────────────────────────────
// The chart is a column graph: one home port on the left, one objective on the
// right, and `columns` ranks of 1-3 nodes between them. Every node links only
// to nodes in the next column, so there is always a way forward, never a way
// back -- a voyage is a crossing, not a maze to wander.
export function generateChart(missionId) {
  const meta = missionMeta(missionId);
  const next = rng(missionId * 7919 + 13);
  const columns = [];

  columns.push([{ kind: NODE.PORT }]);
  for (let c = 1; c <= meta.columns; c++) {
    const width = 1 + Math.floor(next() * Math.min(3, meta.rows));
    const rank = [];
    for (let i = 0; i < width; i++) {
      rank.push({ kind: pickKind(next, c, meta.columns) });
    }
    // A rank of nothing but hazards would be a wall, not a choice: make sure
    // at least one node in every rank can be entered without a fight.
    if (rank.length > 1 && rank.every((n) => n.kind === NODE.FLEET)) {
      rank[Math.floor(next() * rank.length)].kind = next() < 0.5 ? NODE.CACHE : NODE.PORT;
    }
    columns.push(rank);
  }
  columns.push([{ kind: NODE.GOAL }]);

  const nodes = [];
  columns.forEach((rank, c) => {
    rank.forEach((node, i) => {
      const id = `n${c}_${i}`;
      // Lay the rank out down the middle of the chart, then jitter it so the
      // columns do not read as a grid.
      const span = 100 / (rank.length + 1);
      const y = span * (i + 1) + (next() - 0.5) * 8;
      nodes.push({
        id,
        kind: node.kind,
        column: c,
        x: 6 + (c * 88) / (columns.length - 1),
        y: Math.max(10, Math.min(90, y)),
        links: [],
        cleared: false,
        visited: false,
      });
    });
  });

  // Link every node to the whole next rank. Chart width is at most 3, so this
  // stays readable, and it keeps every node reachable.
  const byColumn = (c) => nodes.filter((n) => n.column === c);
  for (let c = 0; c < columns.length - 1; c++) {
    const here = byColumn(c), there = byColumn(c + 1);
    here.forEach((n) => { n.links = there.map((t) => t.id); });
  }

  const start = nodes[0];
  start.visited = true;
  start.cleared = true;

  return {
    missionId,
    name: meta.name,
    difficulty: meta.difficulty,
    nodes,
    startId: start.id,
    goalId: nodes[nodes.length - 1].id,
    shipAt: start.id,
    movesLeft: meta.moves,
    movesTotal: meta.moves,
    gold: 0,
    done: false,
    won: false,
  };
}

function pickKind(next, column, lastColumn) {
  const r = next();
  // Fights get denser the closer the chart gets to the objective; the first
  // rank stays soft so a voyage never opens on a wall.
  const fightChance = column === 1 ? 0.3 : 0.35 + (column / lastColumn) * 0.3;
  if (r < fightChance) return NODE.FLEET;
  if (r < fightChance + 0.2) return NODE.CACHE;
  if (r < fightChance + 0.33) return NODE.STORM;
  return NODE.PORT;
}

// ── Rules ────────────────────────────────────────────────────────────────────

export function nodeById(chart, id) {
  return chart.nodes.find((n) => n.id === id) || null;
}

export function moveCost(chart, toId) {
  const to = nodeById(chart, toId);
  return to && to.kind === NODE.STORM ? 2 : 1;
}

export function canMove(chart, toId) {
  if (!chart || chart.done) return false;
  const from = nodeById(chart, chart.shipAt);
  if (!from || !from.links.includes(toId)) return false;
  // A node with an enemy fleet still on it blocks the lane past it, but you
  // may always sail INTO it -- that is how the battle starts.
  return chart.movesLeft >= moveCost(chart, toId);
}

// Sail to a node. Returns what happened so the caller can start a battle, pay
// out, or end the voyage -- this module never touches the game engine itself.
export function move(chart, toId) {
  if (!canMove(chart, toId)) return { ok: false, msg: 'Cannot sail there.' };
  const to = nodeById(chart, toId);
  chart.movesLeft -= moveCost(chart, toId);
  chart.shipAt = toId;
  to.visited = true;

  if (to.kind === NODE.FLEET || to.kind === NODE.GOAL) {
    return { ok: true, battle: true, node: to, msg: `Enemy fleet at ${NODE_INFO[to.kind].title}.` };
  }

  to.cleared = true;
  if (to.kind === NODE.CACHE) {
    const haul = 25 + (chart.difficulty - 1) * 15;
    chart.gold += haul;
    return { ok: true, gold: haul, node: to, msg: `Salvaged ${haul} gold.` };
  }
  if (to.kind === NODE.PORT) {
    const refit = Math.min(3, chart.movesTotal - chart.movesLeft);
    chart.movesLeft += refit;
    return { ok: true, node: to, msg: refit ? `Refit at port: +${refit} moves.` : 'Port already at full stores.' };
  }
  return { ok: true, node: to, msg: NODE_INFO[to.kind].note };
}

// Called after a battle that a voyage node started.
export function resolveBattle(chart, won) {
  const node = nodeById(chart, chart.shipAt);
  if (!node) return { done: false };
  if (won) {
    node.cleared = true;
    chart.gold += node.kind === NODE.GOAL ? 120 : 40;
    if (node.kind === NODE.GOAL) {
      chart.done = true;
      chart.won = true;
      return { done: true, won: true };
    }
    return { done: false, won: true };
  }
  // A lost battle does not end the voyage outright -- it costs the crossing
  // time, which is what actually ends it when the budget runs out.
  chart.movesLeft -= 2;
  if (chart.movesLeft <= 0) {
    chart.movesLeft = 0;
    chart.done = true;
    chart.won = false;
    return { done: true, won: false };
  }
  return { done: false, won: false };
}

export function isStranded(chart) {
  if (!chart || chart.done) return false;
  const from = nodeById(chart, chart.shipAt);
  if (!from) return true;
  return !from.links.some((id) => chart.movesLeft >= moveCost(chart, id));
}

// ── Persistence ──────────────────────────────────────────────────────────────
const VOYAGE_KEY = 'seahunter_voyage';
const VOYAGE_PROGRESS_KEY = 'seahunter_voyage_progress';

export function saveVoyage(chart) {
  try {
    if (chart) window.localStorage.setItem(VOYAGE_KEY, JSON.stringify(chart));
    else window.localStorage.removeItem(VOYAGE_KEY);
  } catch (e) { /* the voyage just will not survive a reload */ }
}

export function loadVoyage() {
  try {
    const raw = window.localStorage.getItem(VOYAGE_KEY);
    if (!raw) return null;
    const chart = JSON.parse(raw);
    return chart && Array.isArray(chart.nodes) ? chart : null;
  } catch (e) {
    return null;
  }
}

export function loadVoyageProgress() {
  try {
    const raw = window.localStorage.getItem(VOYAGE_PROGRESS_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed.unlocked !== 'number') return { unlocked: 1, cleared: {} };
    return { unlocked: parsed.unlocked, cleared: parsed.cleared || {} };
  } catch (e) {
    return { unlocked: 1, cleared: {} };
  }
}

export function recordVoyageResult(missionId, won) {
  const progress = loadVoyageProgress();
  if (won) {
    progress.cleared[missionId] = true;
    if (missionId >= progress.unlocked && missionId < MISSION_COUNT) {
      progress.unlocked = missionId + 1;
    }
  }
  try {
    window.localStorage.setItem(VOYAGE_PROGRESS_KEY, JSON.stringify(progress));
  } catch (e) { /* progress just will not persist */ }
  return progress;
}
