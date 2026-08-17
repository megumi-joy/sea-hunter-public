// Sea Hunter — bundled
(function(){
"use strict";

// ── cards.js ──
// Card definitions — mirrors src/games/sea_hunter/cards.py
// ability: { name, desc, trigger } — trigger: 'on_win'|'on_death'|'passive'|'on_attack'
const CARDS = {
  plane:              { id: 'plane',              name: 'Plane',             abbr: 'PL', strength: 1, emoji: '✈️',  ability: { name: 'Airstrike',    desc: 'Ignores Reserve wall — can target Reserve directly', trigger: 'passive' } },
  coastal_artillery:  { id: 'coastal_artillery',  name: 'Coastal Artillery', abbr: 'CA', strength: 0, emoji: '🏰',  ability: { name: 'Fortify',      desc: 'On win: next attack against you misses', trigger: 'on_win' } },
  battleship:         { id: 'battleship',         name: 'Battleship',        abbr: 'BS', strength: 5, emoji: '🚢',  ability: { name: 'Broadside',    desc: 'On attack: also hits adjacent enemy slot', trigger: 'on_attack' } },
  cruiser:            { id: 'cruiser',            name: 'Cruiser',           abbr: 'CR', strength: 4, emoji: '⛵',  ability: { name: 'Pursuit',      desc: 'On win: attack again immediately', trigger: 'on_win' } },
  destroyer:          { id: 'destroyer',          name: 'Destroyer',         abbr: 'DE', strength: 3, emoji: '🔱',  ability: { name: 'Torpedo',      desc: 'Can attack Reserve even if Front is alive', trigger: 'passive' } },
  patrol_ship:        { id: 'patrol_ship',        name: 'Patrol Ship',       abbr: 'PS', strength: 2, emoji: '🚤',  ability: { name: 'Scout',        desc: 'Reveals one face-down enemy card before combat', trigger: 'passive' } },
  sea_hunter:         { id: 'sea_hunter',         name: 'Sea Hunter',        abbr: 'SH', strength: 1, emoji: '🎯',  ability: { name: 'Precision',    desc: 'Never triggers DRAW — wins ties instead', trigger: 'passive' } },
  landing_craft:      { id: 'landing_craft',      name: 'Landing Craft',     abbr: 'LC', strength: 0, emoji: '🛥️', ability: { name: 'Reinforcement',desc: 'On death: draw one extra card next round', trigger: 'on_death' } },
  submarine:          { id: 'submarine',          name: 'Submarine',         abbr: 'SB', strength: 0, emoji: '🤿',  ability: { name: 'Stealth',      desc: 'Stays face-down until it attacks', trigger: 'passive' } },
  mine:               { id: 'mine',               name: 'Mine',              abbr: 'MN', strength: 0, emoji: '💣',  ability: { name: 'Chain React',  desc: 'On death: destroys adjacent enemy card too', trigger: 'on_death' } },
};

const IMPACT = {
  plane:             { plane:'DRAW', coastal_artillery:'WIN', battleship:'LOSS', cruiser:'LOSS', destroyer:'WIN', patrol_ship:'WIN', sea_hunter:'WIN', landing_craft:'NONE', submarine:'NONE', mine:'NONE' },
  coastal_artillery: { plane:'LOSS', coastal_artillery:'DRAW', battleship:'WIN', cruiser:'WIN', destroyer:'WIN', patrol_ship:'WIN', sea_hunter:'WIN', landing_craft:'LOSS', submarine:'NONE', mine:'NONE' },
  battleship:        { plane:'WIN', coastal_artillery:'LOSS', battleship:'DRAW', cruiser:'WIN', destroyer:'WIN', patrol_ship:'WIN', sea_hunter:'WIN', landing_craft:'WIN', submarine:'LOSS', mine:'DRAW' },
  cruiser:           { plane:'WIN', coastal_artillery:'LOSS', battleship:'LOSS', cruiser:'DRAW', destroyer:'WIN', patrol_ship:'WIN', sea_hunter:'WIN', landing_craft:'WIN', submarine:'LOSS', mine:'DRAW' },
  destroyer:         { plane:'LOSS', coastal_artillery:'LOSS', battleship:'LOSS', cruiser:'LOSS', destroyer:'DRAW', patrol_ship:'WIN', sea_hunter:'WIN', landing_craft:'WIN', submarine:'WIN', mine:'DRAW' },
  patrol_ship:       { plane:'LOSS', coastal_artillery:'LOSS', battleship:'LOSS', cruiser:'LOSS', destroyer:'LOSS', patrol_ship:'DRAW', sea_hunter:'WIN', landing_craft:'WIN', submarine:'WIN', mine:'DRAW' },
  sea_hunter:        { plane:'LOSS', coastal_artillery:'LOSS', battleship:'LOSS', cruiser:'LOSS', destroyer:'LOSS', patrol_ship:'LOSS', sea_hunter:'DRAW', landing_craft:'WIN', submarine:'WIN', mine:'DRAW' },
  landing_craft:     { plane:'NONE', coastal_artillery:'WIN', battleship:'LOSS', cruiser:'LOSS', destroyer:'LOSS', patrol_ship:'LOSS', sea_hunter:'LOSS', landing_craft:'DRAW', submarine:'NONE', mine:'WIN' },
  submarine:         { plane:'NONE', coastal_artillery:'NONE', battleship:'WIN', cruiser:'WIN', destroyer:'LOSS', patrol_ship:'LOSS', sea_hunter:'LOSS', landing_craft:'NONE', submarine:'DRAW', mine:'DRAW' },
  mine:              { plane:'NONE', coastal_artillery:'NONE', battleship:'DRAW', cruiser:'DRAW', destroyer:'DRAW', patrol_ship:'DRAW', sea_hunter:'DRAW', landing_craft:'LOSS', submarine:'DRAW', mine:'NONE' },
};

const DECK_IDS = [
  'sea_hunter', 'sea_hunter', 'patrol_ship', 'destroyer', 'cruiser',
  'coastal_artillery', 'submarine', 'submarine', 'landing_craft', 'landing_craft',
  'mine', 'mine',
];

const CARD_ORDER = Object.keys(CARDS);

function getResult(attackerId, defenderId) {
  // Sea Hunter passive: wins ties
  let result = (IMPACT[attackerId] || {})[defenderId] || 'NONE';
  if (result === 'DRAW' && attackerId === 'sea_hunter') result = 'WIN';
  return result;
}

// ── islands.js ──
// Islands — definitions, SVG generators, and game mechanics
// Mechanic: island deck, capture, activate ability (1/turn, reset each round)
//
// ISLAND GARRISON RULING (owner, 2026-08-14 -- see
// ~/.voicy/games_session/SEAHUNTER_QA_FINDINGS.md): capturing an island
// GARRISONS it with a unit (the unit stays "on" the island, see
// island.garrison below) rather than sacrificing it, and only the round's
// WINNER gets to capture (previously this repo let either player capture
// any neutral island on any turn during ongoing combat, with no tie to who
// actually won that round -- see game.js's checkRoundEnd / app.js's
// beginIslandCapturePhase). Score is DERIVED from currently-held
// (garrisoned) islands every round-end (see recomputeScore), never an
// incremental round-win counter -- an island can later drain (its garrison
// pulled by Recall, nothing left to refill it at round-end -- see
// retallyGarrisons) and take its point back with it.
//
// This repo's own island roster (Fortress Rock / Palm Cove / Volcanic Peak
// / Fog Bank / Coral Reef) and its "3 simultaneous neutral islands" board
// structure are kept as-is -- they're this build's own flavor, not part of
// the cardboard garrison model being reconciled here (the cardboard rules
// only specify ONE contested island per round; this repo predates that
// convention and uses a different, self-consistent island-deck shape).
// What's been aligned to the cardboard/canon (www/games/sea-hunter-cards)
// model is the RULES layer: capture gated on round-win + eligible unit,
// garrison-not-sacrifice, derived scoring, round-end retally.
const ISLANDS = [
  {
    id: 'fortress_rock',
    name: 'Fortress Rock',
    ability: 'Garrison: send a Reserve card here to protect it',
    abilityType: 'garrison',
    desc: 'Hide a card from combat. Retrieve it with Recall.',
    color: '#4a5568',
  },
  {
    id: 'palm_cove',
    name: 'Palm Cove',
    ability: 'Recall: return garrison card to your Reserve',
    abilityType: 'recall',
    desc: 'Pull back your stationed card into play.',
    color: '#2d6a3f',
  },
  {
    id: 'volcanic_peak',
    name: 'Volcanic Peak',
    ability: 'Strike: destroy a random visible enemy Frontline card',
    abilityType: 'strike',
    desc: 'Eruption destroys one face-up enemy.',
    color: '#7b2d00',
  },
  {
    id: 'fog_bank',
    name: 'Fog Bank',
    ability: 'Veil: flip one of your face-up Frontline cards face-down',
    abilityType: 'veil',
    desc: 'Hide a card from the enemy\'s view.',
    color: '#2d3748',
  },
  {
    id: 'coral_reef',
    name: 'Coral Reef',
    ability: 'Scout: reveal one face-down enemy card',
    abilityType: 'scout',
    desc: 'Intelligence on enemy position.',
    color: '#00838f',
  },
];

// SVG island art generator — unique look per island
function islandSVG(island, size = 'small') {
  const w = size === 'large' ? 90 : 32;
  const h = size === 'large' ? 70 : 24;
  const s = size === 'large' ? 2.5 : 1;

  const defs = {
    fortress_rock: `
      <ellipse cx="${w/2}" cy="${h*0.8}" rx="${w*0.42}" ry="${h*0.18}" fill="#2a3240"/>
      <rect x="${w*0.3}" y="${h*0.3}" width="${w*0.4}" height="${h*0.5}" rx="3" fill="#3a4a5c"/>
      <rect x="${w*0.38}" y="${h*0.18}" width="${w*0.1}" height="${h*0.15}" fill="#3a4a5c"/>
      <rect x="${w*0.52}" y="${h*0.18}" width="${w*0.1}" height="${h*0.15}" fill="#3a4a5c"/>
      <rect x="${w*0.42}" y="${h*0.42}" width="${w*0.16}" height="${h*0.2}" fill="#1a2030"/>
    `,
    palm_cove: `
      <ellipse cx="${w/2}" cy="${h*0.82}" rx="${w*0.44}" ry="${h*0.16}" fill="#1a3a2a"/>
      <ellipse cx="${w/2}" cy="${h*0.78}" rx="${w*0.32}" ry="${h*0.12}" fill="#1e5a30"/>
      <line x1="${w/2}" y1="${h*0.76}" x2="${w*0.38}" y2="${h*0.3}" stroke="#5d4037" stroke-width="${1.5*s}"/>
      <ellipse cx="${w*0.38}" cy="${h*0.28}" rx="${w*0.14}" ry="${h*0.12}" fill="#2d8a3f"/>
      <ellipse cx="${w*0.32}" cy="${h*0.32}" rx="${w*0.1}" ry="${h*0.08}" fill="#388e3c"/>
      <ellipse cx="${w*0.46}" cy="${h*0.26}" rx="${w*0.1}" ry="${h*0.08}" fill="#388e3c"/>
    `,
    volcanic_peak: `
      <ellipse cx="${w/2}" cy="${h*0.85}" rx="${w*0.44}" ry="${h*0.14}" fill="#3a1a0a"/>
      <polygon points="${w/2},${h*0.1} ${w*0.28},${h*0.82} ${w*0.72},${h*0.82}" fill="#7b2d00"/>
      <polygon points="${w/2},${h*0.1} ${w*0.38},${h*0.4} ${w*0.62},${h*0.4}" fill="#a33a00"/>
      <ellipse cx="${w/2}" cy="${h*0.12}" rx="${w*0.08}" ry="${h*0.06}" fill="#ff6d00" opacity="0.8"/>
    `,
    fog_bank: `
      <ellipse cx="${w/2}" cy="${h*0.8}" rx="${w*0.4}" ry="${h*0.14}" fill="#1a2030"/>
      <ellipse cx="${w*0.35}" cy="${h*0.55}" rx="${w*0.22}" ry="${h*0.18}" fill="rgba(180,200,220,0.2)"/>
      <ellipse cx="${w*0.55}" cy="${h*0.48}" rx="${w*0.26}" ry="${h*0.2}" fill="rgba(180,200,220,0.15)"/>
      <ellipse cx="${w*0.45}" cy="${h*0.6}" rx="${w*0.3}" ry="${h*0.16}" fill="rgba(180,200,220,0.12)"/>
    `,
    coral_reef: `
      <ellipse cx="${w/2}" cy="${h*0.82}" rx="${w*0.44}" ry="${h*0.15}" fill="#003840"/>
      <ellipse cx="${w/2}" cy="${h*0.78}" rx="${w*0.3}" ry="${h*0.1}" fill="#004d5c"/>
      <circle cx="${w*0.38}" cy="${h*0.6}" r="${w*0.07}" fill="#00838f" opacity="0.8"/>
      <circle cx="${w*0.52}" cy="${h*0.55}" r="${w*0.09}" fill="#0097a7" opacity="0.8"/>
      <circle cx="${w*0.45}" cy="${h*0.65}" r="${w*0.06}" fill="#00acc1" opacity="0.9"/>
      <line x1="${w*0.38}" y1="${h*0.68}" x2="${w*0.38}" y2="${h*0.78}" stroke="#006064" stroke-width="${s}"/>
      <line x1="${w*0.52}" y1="${h*0.64}" x2="${w*0.52}" y2="${h*0.78}" stroke="#006064" stroke-width="${s}"/>
    `,
  };

  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" fill="none">
    ${defs[island.id] || defs.palm_cove}
  </svg>`;
}

// Game state for islands
function createIslandState() {
  const shuffled = [...ISLANDS].sort(() => Math.random() - 0.5);
  return {
    neutral: shuffled.slice(0, 3).map(isl => ({ ...isl, garrison: null, activated: false })),
    p1: [],   // captured by player
    p2: [],   // captured by AI
  };
}

// Reset activations at round start
function resetIslandActivations(islandState) {
  [...islandState.neutral, ...islandState.p1, ...islandState.p2]
    .forEach(isl => { isl.activated = false; });
}

// Which unit types can capture/garrison an island -- ships and the one air
// unit. Matches the canon web build's CAPTURE_ELIGIBLE list exactly (see
// www/games/sea-hunter-cards/game.js, verified there against the
// authoritative Godot source) -- Landing Craft, Coastal Artillery, and Mine
// (the 0-strength/defensive units) cannot capture or garrison an island.
const CAPTURE_ELIGIBLE = ['battleship', 'cruiser', 'destroyer', 'patrol_ship', 'sea_hunter', 'plane', 'submarine'];

// Does `player` have ANY unit on the field eligible to capture an island
// with? Used to auto-skip the island-capture opportunity when the round's
// winner has nothing that qualifies (Mine/Landing Craft/Coastal Artillery
// survivors only) -- mirrors the canon web build's hasEligibleCapturer().
function hasEligibleCapturer(state, player) {
  const front = player === 1 ? state.p1Front : state.p2Front;
  const reserve = player === 1 ? state.p1Reserve : state.p2Reserve;
  return [...front, ...reserve].some(c => c && CAPTURE_ELIGIBLE.includes(c.def.id));
}

// Apply island ability
function activateIsland(islandState, island, state, player, targetIslandId) {
  if (island.activated) return { ok: false, msg: 'Already used this round' };

  const myFront = player === 1 ? state.p1Front : state.p2Front;
  const myReserve = player === 1 ? state.p1Reserve : state.p2Reserve;
  const oppFront = player === 1 ? state.p2Front : state.p1Front;
  let msg = '';

  switch (island.abilityType) {
    case 'garrison': {
      // Send a reserve card to island
      const card = myReserve.find(Boolean);
      if (!card) return { ok: false, msg: 'No card in Reserve to station' };
      const idx = myReserve.indexOf(card);
      myReserve[idx] = null;
      island.garrison = card;
      msg = `${card.def.emoji} ${card.def.name} stationed on ${island.name}`;
      break;
    }
    case 'recall': {
      // F5 RULING (owner, 2026-08-14): Recall pulls a unit off ANY island
      // the player currently holds, not just this island's (Palm Cove's)
      // own garrison -- matches the canon web build's Maneuver power (see
      // www/games/sea-hunter-cards/game.js's usePower() maneuver branch).
      // targetIslandId picks which held island to un-garrison (see app.js's
      // beginRecallTargeting for the island-picker UI); falls back to the
      // first held island with a garrison if omitted, same fallback the
      // canon engine uses. Can target this very island (Palm Cove itself)
      // if it's the one still garrisoned.
      const held = player === 1 ? islandState.p1 : islandState.p2;
      let target = targetIslandId ? held.find(i => i.id === targetIslandId && i.garrison) : null;
      if (!target) target = held.find(i => i.garrison);
      if (!target) return { ok: false, msg: 'No garrisoned island to recall a unit from' };
      const empty = myReserve.findIndex(c => c === null);
      if (empty === -1) return { ok: false, msg: 'Reserve is full' };
      myReserve[empty] = target.garrison;
      msg = `${target.garrison.def.emoji} ${target.garrison.def.name} recalled from ${target.name}`;
      target.garrison = null;
      break;
    }
    case 'strike': {
      const targets = oppFront.filter(Boolean).filter(c => c.faceUp);
      if (!targets.length) return { ok: false, msg: 'No visible enemy targets' };
      const target = targets[Math.floor(Math.random() * targets.length)];
      const ti = oppFront.indexOf(target);
      oppFront[ti] = null;
      msg = `Volcanic Strike destroys ${target.def.emoji} ${target.def.name}!`;
      break;
    }
    case 'veil': {
      const visible = myFront.filter(Boolean).filter(c => c.faceUp);
      if (!visible.length) return { ok: false, msg: 'No face-up cards to veil' };
      visible[0].faceUp = false;
      msg = `${visible[0].def.emoji} ${visible[0].def.name} veiled in fog`;
      break;
    }
    case 'scout': {
      const hidden = [...(player === 1 ? state.p2Front : state.p1Front), ...(player === 1 ? state.p2Reserve : state.p1Reserve)]
        .find(c => c && !c.faceUp);
      if (!hidden) return { ok: false, msg: 'No hidden enemy cards' };
      hidden.faceUp = true;
      msg = `Scout reveals ${hidden.def.emoji} ${hidden.def.name}`;
      break;
    }
    default:
      return { ok: false, msg: 'Unknown ability' };
  }

  island.activated = true;
  return { ok: true, msg };
}

// Capture a neutral island: garrison it with a specific eligible unit from
// the round winner's Front/Reserve.
// ISLAND GARRISON RULING (owner, 2026-08-14): capturing is a GARRISON, not
// a sacrifice -- the unit leaves the field and sits as island.garrison (see
// retallyGarrisons below for what happens to it later); it is not
// discarded. Only callable during the ISLAND_CAPTURE opportunity right
// after winning a round's combat (see game.js's checkRoundEnd / app.js's
// beginIslandCapturePhase) -- previously this was reachable any turn during
// ongoing COMBAT with any random Reserve card (no round-win tie, no
// eligibility check), which didn't match the cardboard rule ("win that
// round's combat, THEN place a qualifying [ship/plane] unit... to
// capture").
function captureIsland(islandState, islandId, state, player, slot, zone) {
  const idx = islandState.neutral.findIndex(i => i.id === islandId);
  if (idx === -1) return { ok: false, msg: 'Island not neutral' };

  const front = player === 1 ? state.p1Front : state.p2Front;
  const reserve = player === 1 ? state.p1Reserve : state.p2Reserve;
  const zoneArr = zone === 'front' ? front : reserve;
  const card = zoneArr ? zoneArr[slot] : null;
  if (!card) return { ok: false, msg: 'No card in that slot' };
  if (!CAPTURE_ELIGIBLE.includes(card.def.id)) return { ok: false, msg: 'Only ships or planes can capture an island' };

  zoneArr[slot] = null;
  const island = { ...islandState.neutral[idx], garrison: card, activated: false };
  islandState.neutral.splice(idx, 1);
  if (player === 1) islandState.p1.push(island);
  else islandState.p2.push(island);

  return { ok: true, msg: `${island.name} captured! ${card.def.emoji} ${card.def.name} garrisoned.` };
}

// ISLAND RULING refinement 2 (owner, 2026-08-14): re-evaluate every island
// `player` currently holds, independent of who won/lost/drew this round. A
// still-garrisoned island is left untouched (the common case). An island
// with an EMPTY garrison slot either auto-refills from another qualifying
// Front/Reserve unit (island kept, no click needed) or drains -- returned
// to the neutral pool (recapturable later by either side), its point lost
// with it -- if the player has nothing left to place. Mirrors the canon web
// build's retallyGarrisons() in game.js. Returns a player-facing log string
// (may be empty).
function retallyGarrisons(islandState, state, player) {
  const held = player === 1 ? islandState.p1 : islandState.p2;
  const front = player === 1 ? state.p1Front : state.p2Front;
  const reserve = player === 1 ? state.p1Reserve : state.p2Reserve;
  const who = player === 1 ? 'Your' : "The AI's";
  let msg = '';

  for (let i = held.length - 1; i >= 0; i--) {
    const island = held[i];
    if (island.garrison) continue; // still garrisoned -- nothing to do

    let refilled = false;
    for (const list of [front, reserve]) {
      for (let s = 0; s < list.length; s++) {
        const c = list[s];
        if (c && CAPTURE_ELIGIBLE.includes(c.def.id)) {
          list[s] = null;
          island.garrison = c;
          refilled = true;
          break;
        }
      }
      if (refilled) break;
    }

    if (refilled) {
      msg += `${who} ${island.name} garrison is resupplied -- island held!\n`;
    } else {
      held.splice(i, 1);
      islandState.neutral.push({ ...island, garrison: null, activated: false });
      msg += `${who} ${island.name} garrison is empty -- the island drains!\n`;
    }
  }
  return msg;
}

// Score = number of islands each player currently HOLDS (garrisoned) -- see
// ISLAND GARRISON RULING. Always derived fresh from islandState.p1/p2
// (never an incremental round-win counter, unlike this file's original
// design) so capture, auto-refill, and drain can never drift out of sync
// with the displayed score. This roster has no Two-Island-style
// double-value island, so every held island is worth a flat 1 point.
function recomputeScore(state, islandState) {
  state.score[0] = islandState.p1.length;
  state.score[1] = islandState.p2.length;
}

// ── game.js ──
// Game state machine

// ISLAND_CAPTURE: paused between "a round just ended with a winner" and
// "the board wipes/redeals for the next round" -- see checkRoundEnd() /
// finishRound() below and app.js's beginIslandCapturePhase(). Mirrors the
// canon web build's PHASE.ISLAND_CAPTURE (www/games/sea-hunter-cards).
const PHASE = { PREP: 'PREP', COMBAT: 'COMBAT', ISLAND_CAPTURE: 'ISLAND_CAPTURE', ROUND_END: 'ROUND_END', GAME_OVER: 'GAME_OVER' };
const MAX_ROUNDS = 10; // fallback cap -- see POINTS_TO_WIN below, the real win condition
// WIN CONDITION -- ISLAND GARRISON RULING (owner, 2026-08-14): first to
// hold POINTS_TO_WIN islands wins immediately (state.score is derived from
// islandState.p1/p2.length -- see islands.js's recomputeScore(), called
// from app.js right before finishRound() checks this). MAX_ROUNDS above is
// only a fallback tiebreak in case neither side reaches it.
const POINTS_TO_WIN = 3;
const ZONE_SIZE = 4;

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

function createCard(cardId) {
  return { def: CARDS[cardId], faceUp: false, uid: Math.random().toString(36).slice(2, 8), shield: false };
}

function createGameState(difficulty = 2) {
  const p1Ids = shuffle(DECK_IDS);
  const p2Ids = shuffle(DECK_IDS);
  return {
    phase: PHASE.PREP, difficulty, round: 1,
    turnOwner: Math.random() > 0.5 ? 1 : 2,
    score: [0, 0],
    roundWinner: 0, // 0 none/draw, 1 player, 2 AI -- set by checkRoundEnd(), read by app.js's beginIslandCapturePhase()
    p1Hand: p1Ids.map(id => ({ ...createCard(id), faceUp: true })),
    p2Hand: p2Ids.map(id => createCard(id)),
    p1Front: new Array(ZONE_SIZE).fill(null),
    p1Reserve: new Array(ZONE_SIZE).fill(null),
    p2Front: new Array(ZONE_SIZE).fill(null),
    p2Reserve: new Array(ZONE_SIZE).fill(null),
    p1BonusDraw: 0, p2BonusDraw: 0,
    log: [],
  };
}

function autoPlace(state, player = 1) {
  const hand = player === 1 ? state.p1Hand : state.p2Hand;
  const front = player === 1 ? state.p1Front : state.p2Front;
  const reserve = player === 1 ? state.p1Reserve : state.p2Reserve;
  for (let i = 0; i < ZONE_SIZE; i++) {
    if (!front[i] && hand.length) { const c = hand.shift(); c.faceUp = player === 1; front[i] = c; }
  }
  for (let i = 0; i < ZONE_SIZE; i++) {
    if (!reserve[i] && hand.length) { const c = hand.shift(); c.faceUp = player === 1; reserve[i] = c; }
  }
}

function placeCard(state, handIdx, zone, slot) {
  if (state.phase !== PHASE.PREP) return { ok: false, msg: 'Not in prep phase' };
  if (handIdx < 0 || handIdx >= state.p1Hand.length) return { ok: false, msg: 'Invalid hand index' };
  const target = zone === 'front' ? state.p1Front : state.p1Reserve;
  if (slot < 0 || slot >= ZONE_SIZE) return { ok: false, msg: 'Invalid slot' };
  if (target[slot]) return { ok: false, msg: 'Slot occupied' };
  const card = state.p1Hand.splice(handIdx, 1)[0];
  card.faceUp = true;
  target[slot] = card;
  return { ok: true, msg: `${card.def.emoji} ${card.def.name} → ${zone} slot ${slot + 1}`, card };
}

function returnCard(state, zone, slot) {
  const target = zone === 'front' ? state.p1Front : state.p1Reserve;
  if (!target[slot]) return null;
  const card = target[slot];
  target[slot] = null;
  state.p1Hand.push(card);
  return card;
}

function lockIn(state) {
  const placed = state.p1Front.filter(Boolean).length + state.p1Reserve.filter(Boolean).length;
  if (placed < 4) return { ok: false, msg: 'Place at least 4 cards!' };
  autoPlace(state, 1);
  autoPlace(state, 2);

  // Scout passive: reveal one enemy face-down card
  const scout = state.p1Front.find(c => c && c.def.id === 'patrol_ship') ||
                state.p1Reserve.find(c => c && c.def.id === 'patrol_ship');
  if (scout) {
    const target = state.p2Front.find(c => c && !c.faceUp) || state.p2Reserve.find(c => c && !c.faceUp);
    if (target) { target.faceUp = true; state.log.push(`🔍 Scout reveals ${target.def.emoji} ${target.def.name}!`); }
  }

  state.phase = PHASE.COMBAT;
  state.log = state.log.filter(l => l.startsWith('🔍'));
  return { ok: true, msg: 'Battle begins!', scoutLog: state.log.slice() };
}

// Returns { result, msg, atkCard, defCard, sideEffects: [] }
function resolveAttack(state, atkCard, defCard, atkPlayer, defPlayer) {
  const result = getResult(atkCard.def.id, defCard.def.id);
  defCard.faceUp = true;

  const aName = `${atkCard.def.emoji} ${atkCard.def.name}`;
  const dName = `${defCard.def.emoji} ${defCard.def.name}`;
  let msg = '';
  const sideEffects = [];

  // Coastal Artillery shield passive
  if (defCard.shield) {
    defCard.shield = false;
    msg = `🛡️ ${dName} blocks the attack!`;
    state.log.push(msg);
    return { result: 'BLOCKED', msg, atkCard, defCard, sideEffects };
  }

  if (result === 'WIN') {
    msg = `${aName} destroys ${dName}!`;
    removeCard(state, defCard, defPlayer);
    if (atkCard.def.id === 'cruiser') sideEffects.push({ type: 'extra_attack', player: atkPlayer });
    if (atkCard.def.id === 'coastal_artillery') { atkCard.shield = true; sideEffects.push({ type: 'shield', card: atkCard }); }
    if (atkCard.def.id === 'battleship') {
      const oppFront = defPlayer === 2 ? state.p2Front : state.p1Front;
      const oppRes = defPlayer === 2 ? state.p2Reserve : state.p1Reserve;
      const defSlot = [...oppFront, ...oppRes].indexOf(defCard);
      const adjSlot = defSlot < ZONE_SIZE ? (defSlot + 1) % ZONE_SIZE : ((defSlot - ZONE_SIZE + 1) % ZONE_SIZE) + ZONE_SIZE;
      const adjTarget = adjSlot < ZONE_SIZE ? oppFront[adjSlot] : oppRes[adjSlot - ZONE_SIZE];
      if (adjTarget) { removeCard(state, adjTarget, defPlayer); sideEffects.push({ type: 'broadside', card: adjTarget }); }
    }
  } else if (result === 'LOSS') {
    msg = `${aName} sunk by ${dName}!`;
    removeCard(state, atkCard, atkPlayer);
    if (defCard.def.id === 'landing_craft') {
      if (defPlayer === 1) state.p1BonusDraw++; else state.p2BonusDraw++;
      sideEffects.push({ type: 'bonus_draw', player: defPlayer });
    }
  } else if (result === 'DRAW') {
    msg = `${aName} and ${dName} — mutual destruction!`;
    removeCard(state, atkCard, atkPlayer);
    removeCard(state, defCard, defPlayer);
    // Mine chain react
    if (atkCard.def.id === 'mine' || defCard.def.id === 'mine') {
      sideEffects.push({ type: 'chain_react' });
    }
  } else {
    msg = `No interaction: ${aName} vs ${dName}`;
  }

  state.log.push(msg);
  return { result, msg, atkCard, defCard, sideEffects };
}

function removeCard(state, card, player) {
  const front = player === 1 ? state.p1Front : state.p2Front;
  const reserve = player === 1 ? state.p1Reserve : state.p2Reserve;
  for (let i = 0; i < ZONE_SIZE; i++) {
    if (front[i] === card) { front[i] = null; return 'front'; }
  }
  for (let i = 0; i < ZONE_SIZE; i++) {
    if (reserve[i] === card) { reserve[i] = null; return 'reserve'; }
  }
  return null;
}

function playerAttack(state, atkSlot, defSlot) {
  if (state.phase !== PHASE.COMBAT) return { ok: false, msg: 'Not in combat!' };
  if (state.turnOwner !== 1) return { ok: false, msg: "Not your turn!" };

  const atk = state.p1Front[atkSlot];
  if (!atk) return { ok: false, msg: 'No card in that slot' };
  if (atk.def.id === 'mine') return { ok: false, msg: 'Mine cannot attack!' };

  const oppFrontAlive = state.p2Front.some(Boolean);
  // Destroyer torpedo: can bypass front
  const canBypass = atk.def.id === 'destroyer' || atk.def.id === 'plane';
  let dfn, defZone;
  if (oppFrontAlive && !canBypass) {
    dfn = state.p2Front[defSlot]; defZone = 'front';
  } else if (oppFrontAlive && canBypass) {
    // Try reserve slot first if specified beyond 3
    dfn = state.p2Front[defSlot] || state.p2Reserve[defSlot];
    defZone = state.p2Front[defSlot] ? 'front' : 'reserve';
  } else {
    dfn = state.p2Reserve[defSlot]; defZone = 'reserve';
  }
  if (!dfn) return { ok: false, msg: 'No enemy in that slot' };

  if (dfn.faceUp) {
    const r = getResult(atk.def.id, dfn.def.id);
    if (r === 'LOSS') return { ok: false, msg: `${atk.def.name} would sink! Pick another target.` };
    if (r === 'NONE') return { ok: false, msg: `${atk.def.name} can't interact with ${dfn.def.name}!` };
  }

  const res = resolveAttack(state, atk, dfn, 1, 2);
  // Extra attack (Cruiser) — don't switch turn
  const hasExtraAttack = res.sideEffects && res.sideEffects.some(e => e.type === 'extra_attack');
  if (!hasExtraAttack) state.turnOwner = 2;
  return { ok: true, atkSlot, defSlot, defZone, ...res };
}

function moveReserveToFront(state, reserveSlot, player = 1) {
  const reserve = player === 1 ? state.p1Reserve : state.p2Reserve;
  const front = player === 1 ? state.p1Front : state.p2Front;
  const card = reserve[reserveSlot];
  if (!card) return { ok: false, msg: 'No card there' };
  const emptySlot = front.findIndex(c => c === null);
  if (emptySlot === -1) return { ok: false, msg: 'Front is full' };
  reserve[reserveSlot] = null;
  front[emptySlot] = card;
  if (player === 1) state.turnOwner = 2;
  return { ok: true, msg: `${card.def.emoji} ${card.def.name} → front`, card, slot: emptySlot };
}

function checkRoundEnd(state) {
  const p1Alive = state.p1Front.some(Boolean) || state.p1Reserve.some(Boolean);
  const p2Alive = state.p2Front.some(Boolean) || state.p2Reserve.some(Boolean);
  if (p1Alive && p2Alive) return null;

  let msg;
  if (!p1Alive && !p2Alive) {
    state.roundWinner = 0;
    msg = 'Draw this round!';
  } else if (!p2Alive) {
    state.roundWinner = 1;
    msg = `You won round ${state.round}!`;
  } else {
    state.roundWinner = 2;
    msg = `AI won round ${state.round}.`;
  }

  // ISLAND GARRISON RULING (owner, 2026-08-14): capturing an island is
  // gated on winning THIS round's combat, not a free action on any turn
  // (see islands.js's captureIsland) -- so a round with an actual winner
  // pauses in ISLAND_CAPTURE instead of immediately wiping the board and
  // redealing. app.js's handleRoundEnd()/beginIslandCapturePhase() resumes
  // into finishRound() below once that capture opportunity resolves (or
  // auto-skips -- e.g. the winner has no eligible ship/plane survivor); a
  // draw has no capture opportunity at all (roundWinner === 0), so it goes
  // straight to finishRound().
  if (state.roundWinner !== 0) {
    state.phase = PHASE.ISLAND_CAPTURE;
    return { msg, gameOver: false, roundWinner: state.roundWinner, awaitingCapture: true };
  }

  return { msg, gameOver: false, roundWinner: 0, awaitingCapture: false };
}

// Finalizes a round: advances the round counter, checks the win condition
// (first to POINTS_TO_WIN islands, MAX_ROUNDS as a fallback cap) and either
// ends the game or wipes the board + redeals for the next PREP phase. Split
// out of checkRoundEnd() so app.js can run the island-capture step (and the
// retally/recomputeScore bookkeeping that follows it -- see islands.js) in
// between "who won this round" and "start the next one." Caller must have
// already resolved capture/retally/recomputeScore before calling this --
// it only reads state.score, never touches islands itself (keeps this
// file's pre-existing island-agnostic separation from islands.js).
function finishRound(state) {
  state.round++;
  if (state.round > MAX_ROUNDS || state.score[0] >= POINTS_TO_WIN || state.score[1] >= POINTS_TO_WIN) {
    state.phase = PHASE.GAME_OVER;
    return { gameOver: true };
  }

  state.phase = PHASE.PREP;
  state.p1Front = new Array(ZONE_SIZE).fill(null);
  state.p1Reserve = new Array(ZONE_SIZE).fill(null);
  state.p2Front = new Array(ZONE_SIZE).fill(null);
  state.p2Reserve = new Array(ZONE_SIZE).fill(null);
  state.turnOwner = Math.random() > 0.5 ? 1 : 2;

  const bonus1 = state.p1BonusDraw || 0;
  const bonus2 = state.p2BonusDraw || 0;
  state.p1BonusDraw = 0; state.p2BonusDraw = 0;

  const p1Ids = shuffle([...DECK_IDS, ...Array(bonus1).fill('landing_craft')]);
  const p2Ids = shuffle([...DECK_IDS, ...Array(bonus2).fill('landing_craft')]);
  state.p1Hand = p1Ids.map(id => ({ ...createCard(id), faceUp: true }));
  state.p2Hand = p2Ids.map(id => createCard(id));

  return { gameOver: false };
}

// ── ai.js ──
// AI opponent — mirrors src/games/sea_hunter/ai.py

function aiTurn(state) {
  if (state.turnOwner !== 2) return [];
  const actions = [];

  // 1. Try to fill empty front slots from reserve
  const frontEmpty = state.p2Front.findIndex(c => c === null);
  if (frontEmpty !== -1) {
    const ri = state.p2Reserve.findIndex(c => c !== null && c.def.id !== 'mine');
    const riFallback = state.p2Reserve.findIndex(c => c !== null);
    const useIdx = ri !== -1 ? ri : riFallback;
    if (useIdx !== -1) {
      const card = state.p2Reserve[useIdx];
      state.p2Reserve[useIdx] = null;
      state.p2Front[frontEmpty] = card;
      actions.push({ type: 'move', msg: `AI moves ${card.def.emoji} ${card.def.name} to front` });
      state.turnOwner = 1;
      return actions;
    }
  }

  // 2. Find attackers
  const attackers = [];
  state.p2Front.forEach((c, i) => { if (c && c.def.id !== 'mine') attackers.push([i, c]); });

  if (!attackers.length) {
    state.turnOwner = 1;
    actions.push({ type: 'pass', msg: 'AI passes — no attackers' });
    return actions;
  }

  // 3. Find targets
  const p1FrontAlive = state.p1Front.some(Boolean);
  const targets = [];
  if (p1FrontAlive) {
    state.p1Front.forEach((c, i) => { if (c) targets.push([i, c, 'front']); });
  } else {
    state.p1Reserve.forEach((c, i) => { if (c) targets.push([i, c, 'reserve']); });
  }

  if (!targets.length) {
    state.turnOwner = 1;
    actions.push({ type: 'pass', msg: 'AI passes — no targets' });
    return actions;
  }

  // 4. Score all possible attacks
  const candidates = [];
  for (const [ai, ac] of attackers) {
    for (const [ti, tc, tz] of targets) {
      const result = getResult(ac.def.id, tc.def.id);
      if (result === 'NONE') continue;
      let score = result === 'WIN' ? 10 : result === 'DRAW' ? 2 : -5;
      if (!tc.faceUp) score = 3;
      if (state.difficulty >= 2 && result === 'WIN' && tc.faceUp) score += tc.def.strength * 2;
      if (state.difficulty >= 3 && result === 'DRAW') score -= 3;
      candidates.push({ ai, ti, tz, score, result, atk: ac, dfn: tc });
    }
  }

  if (!candidates.length) {
    state.turnOwner = 1;
    actions.push({ type: 'pass', msg: 'AI passes — no valid attacks' });
    return actions;
  }

  let pick;
  if (state.difficulty === 1) {
    const safe = candidates.filter(c => c.score >= 0);
    pick = safe.length ? safe[Math.floor(Math.random() * safe.length)] : candidates[0];
  } else {
    candidates.sort((a, b) => b.score - a.score);
    pick = candidates[0];
  }

  const res = resolveAttack(state, pick.atk, pick.dfn, 2, 1);
  state.turnOwner = 1;
  actions.push({ type: 'attack', ...res, atkCard: pick.atk, defCard: pick.dfn, atkSlot: pick.ai, defSlot: pick.ti, defZone: pick.tz });

  return actions;
}

// ── ui.js ──
// UI rendering — DOM, card elements, animations

const $ = id => document.getElementById(id);

const DOM = {
  loading: $('loading-screen'), menu: $('main-menu'), game: $('game-screen'),
  roundInfo: $('round-info'), scoreInfo: $('score-info'), phaseLabel: $('phase-label'),
  statusText: $('status-text'),
  oppReserve: $('opp-reserve'), oppFront: $('opp-front'),
  playerFront: $('player-front'), playerReserve: $('player-reserve'),
  playerHand: $('player-hand'),
  btnAuto: $('btn-auto'), btnReady: $('btn-ready'), btnPause: $('btn-pause'),
  btnRules: $('btn-rules'), btnCloseRules: $('btn-close-rules'),
  rulesModal: $('rules-modal'), matrixTable: $('matrix-table'),
  goModal: $('game-over-modal'), goIcon: $('go-icon'), goTitle: $('go-title'),
  goScore: $('go-score'), goRounds: $('go-rounds'),
  btnPlayAgain: $('btn-play-again'), btnBackMenu: $('btn-back-menu'),
  combatLog: $('combat-log'), logEntries: $('log-entries'),
  impactOverlay: $('impact-overlay'),
};

function showScreen(name) {
  [DOM.loading, DOM.menu, DOM.game].forEach(s => s.classList.add('hidden'));
  if (name === 'loading') DOM.loading.classList.remove('hidden');
  if (name === 'menu') DOM.menu.classList.remove('hidden');
  if (name === 'game') DOM.game.classList.remove('hidden');
}

function setStatus(msg) { DOM.statusText.textContent = msg; }

function updateHUD(state) {
  DOM.roundInfo.textContent = `Round ${state.round}/10`;
  // Score = islands currently held (see islands.js's recomputeScore) --
  // first to POINTS_TO_WIN wins; MAX_ROUNDS is only a fallback tiebreak.
  DOM.scoreInfo.textContent = `${state.score[0]} : ${state.score[1]} (first to ${POINTS_TO_WIN})`;
  DOM.phaseLabel.textContent = state.phase === PHASE.PREP ? 'PREPARATION' : state.phase === PHASE.COMBAT ? 'COMBAT' : state.phase === PHASE.ISLAND_CAPTURE ? 'ISLAND CAPTURE' : state.phase;
  DOM.phaseLabel.style.color = state.phase === PHASE.COMBAT ? '#ff5252' : '#ffd54f';
}

function createCardEl(card, faceUp = true) {
  const el = document.createElement('div');
  el.className = 'card' + (faceUp ? '' : ' face-down') + (card.shield ? ' shielded' : '');
  el.dataset.uid = card.uid;
  const abilityHtml = card.def.ability
    ? `<div class="card-ability" title="${card.def.ability.desc}">${card.def.ability.name}</div>`
    : '';
  el.innerHTML = `
    <div class="card-inner">
      <div class="card-face">
        <span class="card-abbr">${card.def.abbr}</span>
        <span class="card-emoji">${card.def.emoji}</span>
        <span class="card-name">${card.def.name}</span>
        ${card.def.strength ? `<span class="card-str">STR ${card.def.strength}</span>` : ''}
        ${abilityHtml}
      </div>
      <div class="card-back"></div>
    </div>`;
  return el;
}

function renderZone(zoneEl, cards, faceUp, onClick) {
  const slots = zoneEl.querySelectorAll('.slot');
  slots.forEach((slot, i) => {
    slot.innerHTML = '';
    slot.classList.remove('highlight', 'target-highlight');
    const card = cards[i];
    if (card) {
      const el = createCardEl(card, faceUp || card.faceUp);
      if (onClick) el.addEventListener('click', () => onClick(i, card, slot));
      slot.appendChild(el);
    }
  });
}

function renderHand(hand, onClick) {
  DOM.playerHand.innerHTML = '';
  hand.forEach((card, i) => {
    const el = createCardEl(card, true);
    el.draggable = true;
    el.dataset.handIdx = i;
    if (onClick) el.addEventListener('click', () => onClick(i, card, el));
    el.addEventListener('dragstart', e => {
      e.dataTransfer.setData('text/plain', i.toString());
      el.classList.add('dragging');
    });
    el.addEventListener('dragend', () => el.classList.remove('dragging'));
    DOM.playerHand.appendChild(el);
  });
}

function highlightSlots(zoneId, highlight = true, cls = 'highlight') {
  const zone = $(zoneId);
  if (!zone) return;
  zone.querySelectorAll('.slot').forEach(s => {
    if (highlight) s.classList.add(cls);
    else s.classList.remove(cls, 'target-highlight', 'highlight');
  });
}

function clearAllHighlights() {
  document.querySelectorAll('.slot').forEach(s => s.classList.remove('highlight', 'target-highlight'));
  document.querySelectorAll('.card.selected').forEach(c => c.classList.remove('selected'));
}

function addLogEntry(msg, type = '') {
  DOM.combatLog.classList.remove('hidden');
  const entry = document.createElement('div');
  entry.className = 'log-entry' + (type ? ` log-${type}` : '');
  entry.textContent = msg;
  DOM.logEntries.prepend(entry); // newest first
}

// ── Animations ──────────────────────────────────────────────────

// Find a card's DOM slot element by its uid
function findCardEl(uid) {
  return document.querySelector(`.card[data-uid="${uid}"]`);
}

// Fly-to animation: animate attacker card toward target slot
async function animateAttack(atkCard, defCard, result) {
  const atkEl = findCardEl(atkCard.uid);
  const defEl = findCardEl(defCard.uid);
  if (!atkEl || !defEl) return;

  const atkRect = atkEl.getBoundingClientRect();
  const defRect = defEl.getBoundingClientRect();
  const dx = defRect.left + defRect.width / 2 - (atkRect.left + atkRect.width / 2);
  const dy = defRect.top + defRect.height / 2 - (atkRect.top + atkRect.height / 2);

  // Animate attacker lunging toward target (60% of distance)
  atkEl.style.transition = 'transform 0.25s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
  atkEl.style.transform = `translate(${dx * 0.6}px, ${dy * 0.6}px) scale(1.1)`;
  atkEl.style.zIndex = '100';

  await sleep(250);

  // Impact on target
  defEl.classList.add('impact');
  showImpactFlash(result, defRect);

  await sleep(180);

  // Snap back
  atkEl.style.transition = 'transform 0.2s ease';
  atkEl.style.transform = '';
  atkEl.style.zIndex = '';
  defEl.classList.remove('impact');

  await sleep(200);
}

function showImpactFlash(result, rect) {
  const flash = document.createElement('div');
  flash.className = `impact-flash impact-${result.toLowerCase()}`;
  const emoji = result === 'WIN' ? '💥' : result === 'LOSS' ? '🌊' : result === 'DRAW' ? '💫' : '🚫';
  flash.textContent = emoji;
  flash.style.cssText = `
    position:fixed; left:${rect.left + rect.width/2}px; top:${rect.top + rect.height/2}px;
    transform:translate(-50%,-50%) scale(0);
    font-size:2.5rem; z-index:200; pointer-events:none;
    animation: impact-pop 0.5s ease forwards;
  `;
  document.body.appendChild(flash);
  setTimeout(() => flash.remove(), 600);
}

// Destroy card with animation, then remove from DOM
function destroyCardAnimation(slotEl) {
  return new Promise(resolve => {
    const card = slotEl.querySelector('.card');
    if (!card) { resolve(); return; }
    card.classList.add('destroying');
    setTimeout(() => { card.remove(); resolve(); }, 600);
  });
}

// Shake animation for blocked/shield
function shakeCard(uid) {
  const el = findCardEl(uid);
  if (!el) return;
  el.classList.add('shake');
  setTimeout(() => el.classList.remove('shake'), 500);
}

// Shield glow on Coastal Artillery fortify
function showShieldEffect(uid) {
  const el = findCardEl(uid);
  if (!el) return;
  el.classList.add('shielded');
  const badge = document.createElement('div');
  badge.className = 'shield-badge';
  badge.textContent = '🛡️';
  el.appendChild(badge);
}

// Reveal flip animation
function flipCard(slotEl) {
  const card = slotEl.querySelector('.card');
  if (card) card.classList.remove('face-down');
}

function showGameOver(state) {
  const [p, a] = state.score;
  const win = p > a;
  DOM.goIcon.textContent = win ? '🏆' : p === a ? '🤝' : '⚓';
  DOM.goTitle.textContent = win ? 'Victory!' : p === a ? 'Draw!' : 'Retreat!';
  DOM.goScore.textContent = `${p} : ${a}`;
  DOM.goRounds.textContent = `in ${state.round - 1} rounds`;
  DOM.goModal.classList.remove('hidden');
}

function hideGameOver() { DOM.goModal.classList.add('hidden'); }

function renderRulesMatrix() {
  const ids = CARD_ORDER;
  let html = '<table><tr><th></th>';
  ids.forEach(id => { html += `<th title="${CARDS[id].name}">${CARDS[id].emoji}</th>`; });
  html += '</tr>';
  ids.forEach(aid => {
    html += `<tr><th title="${CARDS[aid].name}">${CARDS[aid].emoji}</th>`;
    ids.forEach(did => {
      const r = IMPACT[aid][did];
      const cls = r === 'WIN' ? 'win' : r === 'LOSS' ? 'loss' : r === 'DRAW' ? 'draw' : 'none';
      const sym = r === 'WIN' ? '✓' : r === 'LOSS' ? '✗' : r === 'DRAW' ? '=' : '·';
      html += `<td class="${cls}">${sym}</td>`;
    });
    html += '</tr>';
  });
  html += '</table>';
  DOM.matrixTable.innerHTML = html;
}

function renderAbilityList() {
  let html = '<div class="ability-list">';
  CARD_ORDER.forEach(id => {
    const c = CARDS[id];
    if (!c.ability) return;
    html += `<div class="ability-row"><span class="ability-emoji">${c.emoji}</span><div><strong>${c.ability.name}</strong><span>${c.ability.desc}</span></div></div>`;
  });
  html += '</div>';
  return html;
}

function setupDropZones(onDrop) {
  document.querySelectorAll('.player-section .slot').forEach(slot => {
    slot.addEventListener('dragover', e => { e.preventDefault(); slot.classList.add('dragover'); });
    slot.addEventListener('dragleave', () => slot.classList.remove('dragover'));
    slot.addEventListener('drop', e => {
      e.preventDefault();
      slot.classList.remove('dragover');
      const handIdx = parseInt(e.dataTransfer.getData('text/plain'));
      const zone = slot.dataset.zone.includes('front') ? 'front' : 'reserve';
      const slotIdx = parseInt(slot.dataset.slot);
      onDrop(handIdx, zone, slotIdx);
    });
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const UI = { DOM, showScreen, setStatus, updateHUD, createCardEl,
  renderZone, renderHand, highlightSlots, clearAllHighlights,
  addLogEntry, destroyCardAnimation, shakeCard, showShieldEffect, flipCard,
  showGameOver, hideGameOver, renderRulesMatrix, setupDropZones,
  animateAttack, sleep };

// ── app.js ──
// App entry point — wires everything together

let state = null;
let islandState = null;
let selectedAttacker = null;
let difficulty = 2;
let combatLocked = false;
let openIsland = null; // currently open in panel
let selectedCaptureUnit = null; // { slot, zone, card } -- picked during PHASE.ISLAND_CAPTURE, see selectCaptureUnit()
let recallTargeting = null; // the Recall (Palm Cove) island itself, while picking which held island to un-garrison -- see beginRecallTargeting()

// ── Boot ─────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  UI.renderRulesMatrix();

  const prog = document.getElementById('load-progress');
  const label = document.getElementById('load-label');
  const steps = ['Loading fleet...', 'Shuffling cards...', 'Deploying AI...', 'Ready!'];
  let pct = 0;
  const tick = setInterval(() => {
    pct += Math.random() * 25 + 5;
    if (pct >= 100) { pct = 100; clearInterval(tick); }
    if (prog) prog.style.width = pct + '%';
    if (label) label.textContent = steps[Math.min(Math.floor(pct / 30), steps.length - 1)];
    if (pct >= 100) setTimeout(() => UI.showScreen('menu'), 300);
  }, 200);

  document.getElementById('btn-single').addEventListener('click', startGame);
  document.querySelectorAll('.diff-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.diff-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      difficulty = parseInt(btn.dataset.diff);
    });
  });

  UI.DOM.btnAuto.addEventListener('click', doAutoPlace);
  UI.DOM.btnReady.addEventListener('click', doLockIn);
  UI.DOM.btnRules.addEventListener('click', () => UI.DOM.rulesModal.classList.remove('hidden'));
  UI.DOM.btnCloseRules.addEventListener('click', () => UI.DOM.rulesModal.classList.add('hidden'));
  UI.DOM.btnPause.addEventListener('click', () => { state = null; combatLocked = false; UI.showScreen('menu'); });
  UI.DOM.btnPlayAgain.addEventListener('click', startGame);
  UI.DOM.btnBackMenu.addEventListener('click', () => { UI.hideGameOver(); UI.showScreen('menu'); });

  // Island panel close
  document.getElementById('island-panel-close').addEventListener('click', closeIslandPanel);
  document.getElementById('island-activate-btn').addEventListener('click', onIslandActivate);

  UI.setupDropZones((handIdx, zone, slot) => {
    if (!state || state.phase !== PHASE.PREP) return;
    const res = placeCard(state, handIdx, zone, slot);
    if (res.ok) { renderAll(); updateReadyButton(); }
    else UI.setStatus(res.msg);
  });
});

function startGame() {
  state = createGameState(difficulty);
  islandState = createIslandState();
  selectedAttacker = null;
  combatLocked = false;
  openIsland = null;
  selectedCaptureUnit = null;
  recallTargeting = null;
  UI.hideGameOver();
  UI.showScreen('game');
  UI.DOM.combatLog.classList.add('hidden');
  UI.DOM.logEntries.innerHTML = '';
  UI.DOM.btnAuto.style.display = '';
  UI.DOM.btnReady.style.display = '';
  renderAll();
  renderIslands();
  UI.setStatus('Drag cards to Frontline and Reserve, then press Ready!');
}

// ── Prep Phase ───────────────────────────────────────────────────
function doAutoPlace() {
  if (!state || state.phase !== PHASE.PREP) return;
  autoPlace(state, 1);
  renderAll();
  updateReadyButton();
  UI.setStatus('Cards placed! Press Ready to start combat.');
}

function doLockIn() {
  if (!state) return;
  const res = lockIn(state);
  if (!res.ok) { UI.setStatus(res.msg); return; }

  UI.DOM.btnAuto.style.display = 'none';
  UI.DOM.btnReady.style.display = 'none';

  if (res.scoutLog && res.scoutLog.length) {
    res.scoutLog.forEach(m => UI.addLogEntry(m, 'ability'));
  }

  UI.setStatus('Combat! Click your card, then click an enemy to attack.');
  renderAll();

  if (state.turnOwner === 2) setTimeout(() => doAiTurn(), 1000);
}

function updateReadyButton() {
  const placed = state.p1Front.filter(Boolean).length + state.p1Reserve.filter(Boolean).length;
  UI.DOM.btnReady.disabled = placed < 4;
}

// ── Island Panel ─────────────────────────────────────────────────
function openIslandPanel(island, owner) {
  openIsland = { island, owner };
  const panel = document.getElementById('island-panel');
  const canActivate = owner === 'p1' && !island.activated && state && state.phase === PHASE.COMBAT && state.turnOwner === 1 && !combatLocked;
  // ISLAND GARRISON RULING (owner, 2026-08-14): capture is only offered
  // during the round winner's ISLAND_CAPTURE opportunity (see game.js's
  // checkRoundEnd/finishRound + beginIslandCapturePhase below) -- it used
  // to be a free action any turn during ongoing combat, with no tie to
  // actually winning that round.
  const isCaptureable = owner === 'neutral' && state && state.phase === PHASE.ISLAND_CAPTURE && state.roundWinner === 1;

  document.getElementById('island-panel-svg').innerHTML = islandSVG(island, 'large');
  document.getElementById('island-panel-name').textContent = island.name;
  document.getElementById('island-panel-ability').textContent = island.ability;
  document.getElementById('island-panel-garrison').textContent = island.garrison
    ? `Garrison: ${island.garrison.def.emoji} ${island.garrison.def.name}`
    : (owner === 'neutral' ? 'Neutral — capture to use' : owner === 'p2' ? 'Enemy island' : 'No garrison');

  const btn = document.getElementById('island-activate-btn');
  if (isCaptureable) {
    btn.textContent = 'Capture Island';
    // Requires a ship/plane already picked from Front/Reserve (see
    // selectCaptureUnit) -- capturing a specific neutral island, with a
    // specific unit, is now a deliberate two-step pick instead of always
    // auto-grabbing "any Reserve card."
    btn.disabled = !selectedCaptureUnit;
  } else {
    btn.textContent = island.activated ? 'Used this round' : 'Activate';
    btn.disabled = !canActivate;
  }

  panel.classList.remove('hidden');
}

function closeIslandPanel() {
  document.getElementById('island-panel').classList.add('hidden');
  openIsland = null;
}

function onIslandActivate() {
  if (!openIsland || !state) return;
  const { island, owner } = openIsland;

  if (owner === 'neutral') {
    if (state.phase !== PHASE.ISLAND_CAPTURE || state.roundWinner !== 1) return;
    if (!selectedCaptureUnit) { UI.setStatus('Pick a ship or plane from your Front/Reserve first.'); return; }
    const result = captureIsland(islandState, island.id, state, 1, selectedCaptureUnit.slot, selectedCaptureUnit.zone);
    if (!result.ok) { UI.setStatus(result.msg); return; }
    selectedCaptureUnit = null;
    UI.clearAllHighlights();
    UI.addLogEntry(result.msg, 'ability');
    UI.setStatus(result.msg);
    closeIslandPanel();
    finishRoundFlow();
    return;
  }

  if (owner !== 'p1') return;

  // Recall (Palm Cove) targets a unit garrisoned on ANY held island, not
  // just this one's own -- see islands.js's F5 RULING comment. Needs a
  // target pick first when more than one held island could supply it (or
  // even just to confirm which one) -- see beginRecallTargeting below,
  // which mirrors the canon web build's Maneuver island-picker.
  if (island.abilityType === 'recall' && !island.activated) {
    beginRecallTargeting(island);
    return;
  }

  const result = activateIsland(islandState, island, state, 1);
  if (!result.ok) { UI.setStatus(result.msg); return; }

  UI.addLogEntry(result.msg, 'ability');
  UI.setStatus(result.msg);
  closeIslandPanel();
  renderAll();
  renderIslands();

  // Using island ability ends the turn
  if (!combatLocked) {
    state.turnOwner = 2;
    setTimeout(() => doAiTurn(), 800);
  }
}

// Recall (Palm Cove) targeting -- see onIslandActivate's recall branch.
// Highlights the player's held+garrisoned islands (in #player-island-slots,
// via renderIslands()'s recallTargeting branch) as pickable targets;
// clicking one resolves Recall against it. Same shape as the canon web
// build's Maneuver island-picker (www/games/sea-hunter-cards/app.js).
function beginRecallTargeting(recallIsland) {
  const eligible = islandState.p1.filter(i => i.garrison);
  if (!eligible.length) { UI.setStatus('Recall: no garrisoned island to pull a unit from.'); return; }
  recallTargeting = recallIsland;
  closeIslandPanel();
  UI.setStatus(eligible.length > 1
    ? 'Recall: pick which of your held islands to un-garrison.'
    : 'Recall: confirm the held island to un-garrison.');
  renderIslands();
}

function resolveRecallTarget(targetIsland) {
  const recallIsland = recallTargeting;
  recallTargeting = null;
  const result = activateIsland(islandState, recallIsland, state, 1, targetIsland.id);
  if (!result.ok) { UI.setStatus(result.msg); renderIslands(); return; }
  UI.addLogEntry(result.msg, 'ability');
  UI.setStatus(result.msg);
  renderAll();
  renderIslands();
  if (!combatLocked) {
    state.turnOwner = 2;
    setTimeout(() => doAiTurn(), 800);
  }
}

// ── Island Rendering ─────────────────────────────────────────────
function renderIslands() {
  if (!islandState) return;

  const renderSlots = (containerId, islands, owner) => {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = '';
    islands.forEach(isl => {
      const card = document.createElement('div');
      card.className = `island-card ${owner === 'neutral' ? 'neutral-island' : owner === 'p1' ? 'captured-player' : 'captured-opp'}`;
      if (isl.activated) card.classList.add('used');
      card.innerHTML = islandSVG(isl, 'small') + `<div class="island-card-name">${isl.name}</div>`;
      if (isl.garrison) {
        const dot = document.createElement('div');
        dot.className = 'island-garrison-dot';
        dot.title = `Garrison: ${isl.garrison.def.name}`;
        card.appendChild(dot);
      }
      // Recall targeting (see beginRecallTargeting): while active, clicking
      // an eligible (held + garrisoned) player island picks it as the
      // un-garrison target instead of opening its normal panel; everything
      // else goes inert for the duration of the pick.
      if (recallTargeting && owner === 'p1') {
        if (isl.garrison) {
          card.classList.add('target-highlight');
          card.addEventListener('click', () => resolveRecallTarget(isl));
        } else {
          card.style.opacity = '0.4';
        }
      } else {
        card.addEventListener('click', () => {
          if (openIsland && openIsland.island === isl) { closeIslandPanel(); return; }
          openIslandPanel(isl, owner);
        });
      }
      el.appendChild(card);
    });
    if (!islands.length) el.innerHTML = '<div style="opacity:0.3;font-size:0.6rem;padding:4px">–</div>';
  };

  renderSlots('opp-island-slots', islandState.p2, 'p2');
  renderSlots('neutral-island-slots', islandState.neutral, 'neutral');
  renderSlots('player-island-slots', islandState.p1, 'p1');
}

// ── Combat Phase ─────────────────────────────────────────────────
// Picks the unit to garrison a neutral island with (see selectCaptureUnit
// below) -- reachable from either zone's click handler while the round
// winner's ISLAND_CAPTURE opportunity is open.
function onPlayerCardClick(slot, card, el) {
  if (!state) return;
  if (state.phase === PHASE.ISLAND_CAPTURE) { selectCaptureUnit(slot, 'front', card, el); return; }
  if (state.phase !== PHASE.COMBAT || state.turnOwner !== 1 || combatLocked) return;
  if (card.def.id === 'mine') { UI.setStatus('Mine cannot attack — passive defense only!'); return; }

  UI.clearAllHighlights();
  selectedAttacker = { slot, card };
  el.querySelector('.card')?.classList.add('selected');

  const oppFrontAlive = state.p2Front.some(Boolean);
  const canBypass = card.def.id === 'destroyer' || card.def.id === 'plane';

  if (oppFrontAlive && !canBypass) {
    UI.highlightSlots('opp-front', true, 'target-highlight');
    UI.setStatus(`${card.def.emoji} ${card.def.name} selected — click enemy frontline to attack!`);
  } else if (oppFrontAlive && canBypass) {
    UI.highlightSlots('opp-front', true, 'target-highlight');
    UI.highlightSlots('opp-reserve', true, 'target-highlight');
    UI.setStatus(`${card.def.emoji} ${card.def.name} [${card.def.ability.name}] — can bypass frontline!`);
  } else {
    UI.highlightSlots('opp-reserve', true, 'target-highlight');
    UI.setStatus(`${card.def.emoji} ${card.def.name} selected — attack enemy reserve!`);
  }
}

function onPlayerReserveClick(slot, card, el) {
  if (!state) return;
  if (state.phase === PHASE.ISLAND_CAPTURE) { selectCaptureUnit(slot, 'reserve', card, el); return; }
  if (state.phase !== PHASE.COMBAT || state.turnOwner !== 1 || combatLocked) return;
  if (!state.p1Front.includes(null)) { UI.setStatus('Front is full!'); return; }

  const res = moveReserveToFront(state, slot, 1);
  if (!res.ok) { UI.setStatus(res.msg); return; }
  UI.addLogEntry(`${card.def.emoji} ${card.def.name} moved to front`, 'move');
  UI.setStatus(res.msg);
  renderAll();

  const end = checkRoundEnd(state);
  if (end) { handleRoundEnd(end); return; }
  if (state.turnOwner === 2) setTimeout(() => doAiTurn(), 800);
}

// Selects (or deselects) a Front/Reserve card as the unit to garrison a
// neutral island with during the round winner's ISLAND_CAPTURE opportunity
// -- see onPlayerCardClick/onPlayerReserveClick above and onIslandActivate's
// 'neutral' branch, which reads selectedCaptureUnit once a neutral island's
// Capture button is clicked.
function selectCaptureUnit(slot, zone, card, el) {
  if (!state || state.roundWinner !== 1) return;
  if (!CAPTURE_ELIGIBLE.includes(card.def.id)) {
    UI.setStatus(`${card.def.emoji} ${card.def.name} cannot capture an island — only ships or planes can.`);
    return;
  }
  UI.clearAllHighlights();
  if (selectedCaptureUnit && selectedCaptureUnit.slot === slot && selectedCaptureUnit.zone === zone) {
    selectedCaptureUnit = null;
    UI.setStatus('Unit deselected.');
    if (openIsland) openIslandPanel(openIsland.island, openIsland.owner); // refresh the Capture button's disabled state
    return;
  }
  selectedCaptureUnit = { slot, zone, card };
  el?.querySelector('.card')?.classList.add('selected');
  UI.setStatus(`${card.def.emoji} ${card.def.name} selected — pick a neutral island to capture it with.`);
  if (openIsland) openIslandPanel(openIsland.island, openIsland.owner); // refresh the Capture button's disabled state
}

async function onOppCardClick(slot, card, slotEl) {
  if (!state || !selectedAttacker || state.turnOwner !== 1 || combatLocked) return;

  combatLocked = true;
  const res = playerAttack(state, selectedAttacker.slot, slot);
  selectedAttacker = null;
  UI.clearAllHighlights();

  if (!res.ok) {
    UI.setStatus(res.msg);
    combatLocked = false;
    return;
  }

  UI.setStatus(`${res.atkCard.def.emoji} attacks ${res.defCard.def.emoji}...`);
  await UI.animateAttack(res.atkCard, res.defCard, res.result);

  UI.addLogEntry(res.msg, res.result === 'WIN' ? 'win' : res.result === 'LOSS' ? 'loss' : 'draw');
  UI.setStatus(res.msg);

  if (res.sideEffects) {
    for (const fx of res.sideEffects) {
      if (fx.type === 'shield') { UI.addLogEntry(`${res.atkCard.def.emoji} fortified!`, 'ability'); UI.showShieldEffect(res.atkCard.uid); }
      if (fx.type === 'broadside') UI.addLogEntry(`Broadside destroys ${fx.card.def.emoji} ${fx.card.def.name}!`, 'ability');
      if (fx.type === 'bonus_draw') UI.addLogEntry('Landing Craft: bonus card next round!', 'ability');
    }
  }

  await UI.sleep(400);
  renderAll();
  await UI.sleep(200);

  const end = checkRoundEnd(state);
  if (end) { combatLocked = false; handleRoundEnd(end); return; }

  const hasExtraAttack = res.sideEffects && res.sideEffects.some(e => e.type === 'extra_attack');
  if (hasExtraAttack) {
    UI.addLogEntry('Cruiser Pursuit: attack again!', 'ability');
    UI.setStatus('Pursuit! Pick another target to attack again.');
    combatLocked = false;
    return;
  }

  combatLocked = false;
  if (state.turnOwner === 2) {
    UI.setStatus('AI is planning...');
    await UI.sleep(900);
    doAiTurn();
  } else {
    UI.setStatus('Your turn! Click a card to attack, or activate an island.');
  }
}

async function doAiTurn() {
  if (!state || state.turnOwner !== 2 || state.phase !== PHASE.COMBAT || combatLocked) return;
  combatLocked = true;

  UI.setStatus('AI is planning...');
  await UI.sleep(700);

  // AI occasionally uses its captured islands
  if (islandState.p2.length && Math.random() > 0.6) {
    const unusedIsl = islandState.p2.find(i => !i.activated);
    if (unusedIsl) {
      const res = activateIsland(islandState, unusedIsl, state, 2);
      if (res.ok) {
        UI.addLogEntry(`AI: ${res.msg}`, 'ability');
        UI.setStatus(res.msg);
        renderIslands();
        await UI.sleep(600);
        // After island ability, AI's turn ends — go to player
        combatLocked = false;
        state.turnOwner = 1;
        UI.setStatus('Your turn!');
        return;
      }
    }
  }

  const actions = aiTurn(state);

  for (const a of actions) {
    if (a.type === 'attack') {
      UI.setStatus(`AI: ${a.atkCard?.def?.emoji} attacks ${a.defCard?.def?.emoji}...`);
      if (a.atkCard && a.defCard) await UI.animateAttack(a.atkCard, a.defCard, a.result);
    }
    UI.addLogEntry(a.msg, a.type === 'attack' ? (a.result === 'WIN' ? 'loss' : 'win') : 'move');
    UI.setStatus(a.msg);
    await UI.sleep(300);
  }

  renderAll();

  const end = checkRoundEnd(state);
  if (end) { combatLocked = false; handleRoundEnd(end); return; }

  combatLocked = false;
  if (state.turnOwner === 1) UI.setStatus('Your turn! Click a card or activate an island.');
}

// ISLAND GARRISON RULING (owner, 2026-08-14): a round with an actual winner
// (not a draw) now pauses for an island-capture opportunity (state.phase
// is already PHASE.ISLAND_CAPTURE -- see game.js's checkRoundEnd) instead
// of finishing immediately -- see beginIslandCapturePhase/finishRoundFlow
// below. A draw has no capture opportunity and finishes right away.
function handleRoundEnd(end) {
  UI.addLogEntry(end.msg, 'round');

  if (end.awaitingCapture) {
    beginIslandCapturePhase(end.roundWinner);
    return;
  }

  finishRoundFlow();
}

// Entered right after a (non-draw) round is won -- the winner gets one
// chance to garrison a neutral island with an eligible Front/Reserve
// survivor before the round actually finishes (board wipe + redeal). AI
// resolves this automatically; the player picks a unit (selectCaptureUnit)
// then a neutral island (onIslandActivate's 'neutral' branch, via the
// existing island-panel click flow) -- see islands.js's captureIsland.
function beginIslandCapturePhase(roundWinner) {
  renderAll();
  renderIslands();

  if (roundWinner === 2) {
    aiCaptureIsland();
    return;
  }

  if (!hasEligibleCapturer(state, 1)) {
    UI.setStatus('You win the round, but nothing left to garrison an island with — it stays uncaptured.');
    finishRoundFlow();
    return;
  }
  selectedCaptureUnit = null;
  UI.setStatus('You win the round! Pick a ship or plane, then click a neutral island to capture it.');
}

// Auto-resolves the AI's island-capture opportunity (no UI on that side):
// first eligible Front-then-Reserve unit, first available neutral island --
// mirrors the canon web build's executeIslandCapture() winner===2 branch.
function aiCaptureIsland() {
  if (!hasEligibleCapturer(state, 2) || !islandState.neutral.length) { finishRoundFlow(); return; }

  let slot = -1, zone = null;
  for (const [list, z] of [[state.p2Front, 'front'], [state.p2Reserve, 'reserve']]) {
    const i = list.findIndex(c => c && CAPTURE_ELIGIBLE.includes(c.def.id));
    if (i !== -1) { slot = i; zone = z; break; }
  }
  if (slot === -1) { finishRoundFlow(); return; }

  const res = captureIsland(islandState, islandState.neutral[0].id, state, 2, slot, zone);
  if (res.ok) UI.addLogEntry(`AI: ${res.msg}`, 'ability');
  finishRoundFlow();
}

// Finalizes a round once its island-capture opportunity has resolved (or
// been skipped/auto-skipped, or there was none -- a draw): re-tallies both
// players' held-island garrisons (independent of who won/lost/drew this
// particular round -- see islands.js's retallyGarrisons/ISLAND RULING
// refinement 2), recomputes score from islands held, then hands off to
// game.js's finishRound() for the board wipe/redeal/game-over check.
function finishRoundFlow() {
  const retallyMsg = retallyGarrisons(islandState, state, 1) + retallyGarrisons(islandState, state, 2);
  retallyMsg.split('\n').filter(Boolean).forEach(line => UI.addLogEntry(line, 'ability'));
  recomputeScore(state, islandState);
  // Reset island activations for next round -- unchanged pre-existing
  // behavior (powers are reusable every round in this build, unlike the
  // canon web build's one-time-ever powers; kept as this repo's own
  // pre-existing design, not part of the garrison-model reconciliation).
  if (islandState) resetIslandActivations(islandState);
  renderIslands();

  const fin = finishRound(state);
  if (fin.gameOver) { setTimeout(() => UI.showGameOver(state), 800); return; }

  UI.setStatus('Place cards for next round!');
  UI.DOM.btnAuto.style.display = '';
  UI.DOM.btnReady.style.display = '';
  UI.DOM.btnReady.disabled = true;
  renderAll();
}

// ── Rendering ─────────────────────────────────────────────────────
function renderAll() {
  if (!state) return;
  UI.updateHUD(state);

  UI.renderZone(UI.DOM.oppReserve, state.p2Reserve, false, null);
  UI.renderZone(UI.DOM.oppFront, state.p2Front, false,
    state.phase === PHASE.COMBAT ? onOppCardClick : null);

  UI.renderZone(UI.DOM.playerFront, state.p1Front, true,
    state.phase === PHASE.COMBAT || state.phase === PHASE.ISLAND_CAPTURE ? onPlayerCardClick :
    state.phase === PHASE.PREP ? onPrepCardClick : null);
  UI.renderZone(UI.DOM.playerReserve, state.p1Reserve, true,
    state.phase === PHASE.COMBAT || state.phase === PHASE.ISLAND_CAPTURE ? onPlayerReserveClick :
    state.phase === PHASE.PREP ? onPrepCardClick : null);

  UI.renderHand(state.p1Hand, state.phase === PHASE.PREP ? onHandCardClick : null);
}

function onHandCardClick(idx, card) {
  UI.setStatus(`${card.def.emoji} ${card.def.name} — drag to a slot`);
}

function onPrepCardClick(slot, card) {
  if (!state || state.phase !== PHASE.PREP) return;
  const zone = state.p1Front.includes(card) ? 'front' : 'reserve';
  const returned = returnCard(state, zone, slot);
  if (returned) {
    renderAll();
    updateReadyButton();
    UI.setStatus(`${card.def.emoji} ${card.def.name} returned to hand`);
  }
}
})();
