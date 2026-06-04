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

// Apply island ability
function activateIsland(islandState, island, state, player) {
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
      if (!island.garrison) return { ok: false, msg: 'No garrison to recall' };
      const empty = myReserve.findIndex(c => c === null);
      if (empty === -1) return { ok: false, msg: 'Reserve is full' };
      myReserve[empty] = island.garrison;
      msg = `${island.garrison.def.emoji} ${island.garrison.def.name} recalled from ${island.name}`;
      island.garrison = null;
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

// Capture a neutral island: send a card from reserve there
function captureIsland(islandState, islandId, state, player) {
  const idx = islandState.neutral.findIndex(i => i.id === islandId);
  if (idx === -1) return { ok: false, msg: 'Island not neutral' };

  const myReserve = player === 1 ? state.p1Reserve : state.p2Reserve;
  const card = myReserve.find(Boolean);
  if (!card) return { ok: false, msg: 'Need a Reserve card to capture island' };

  const ci = myReserve.indexOf(card);
  myReserve[ci] = null;
  const island = { ...islandState.neutral[idx], garrison: card, activated: false };
  islandState.neutral.splice(idx, 1);
  if (player === 1) islandState.p1.push(island);
  else islandState.p2.push(island);

  return { ok: true, msg: `${island.name} captured! ${card.def.emoji} ${card.def.name} garrisoned.` };
}

// ── game.js ──
// Game state machine

const PHASE = { PREP: 'PREP', COMBAT: 'COMBAT', ROUND_END: 'ROUND_END', GAME_OVER: 'GAME_OVER' };
const MAX_ROUNDS = 10;
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
  if (!p1Alive && !p2Alive) { msg = 'Draw this round!'; }
  else if (!p2Alive) { state.score[0]++; msg = `You won round ${state.round}!`; }
  else { state.score[1]++; msg = `AI won round ${state.round}.`; }

  state.round++;
  if (state.round > MAX_ROUNDS) {
    state.phase = PHASE.GAME_OVER;
    return { msg, gameOver: true };
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

  return { msg, gameOver: false };
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
  DOM.scoreInfo.textContent = `${state.score[0]} : ${state.score[1]}`;
  DOM.phaseLabel.textContent = state.phase === PHASE.PREP ? 'PREPARATION' : state.phase === PHASE.COMBAT ? 'COMBAT' : state.phase;
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
  const isCaptureable = owner === 'neutral' && state && state.phase === PHASE.COMBAT && state.turnOwner === 1 && !combatLocked;

  document.getElementById('island-panel-svg').innerHTML = islandSVG(island, 'large');
  document.getElementById('island-panel-name').textContent = island.name;
  document.getElementById('island-panel-ability').textContent = island.ability;
  document.getElementById('island-panel-garrison').textContent = island.garrison
    ? `Garrison: ${island.garrison.def.emoji} ${island.garrison.def.name}`
    : (owner === 'neutral' ? 'Neutral — capture to use' : owner === 'p2' ? 'Enemy island' : 'No garrison');

  const btn = document.getElementById('island-activate-btn');
  if (isCaptureable) {
    btn.textContent = 'Capture Island';
    btn.disabled = !state.p1Reserve.some(Boolean);
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

  let result;
  if (owner === 'neutral') {
    result = captureIsland(islandState, island.id, state, 1);
  } else if (owner === 'p1') {
    result = activateIsland(islandState, island, state, 1);
  } else {
    return;
  }

  if (!result.ok) { UI.setStatus(result.msg); return; }

  UI.addLogEntry(result.msg, 'ability');
  UI.setStatus(result.msg);
  closeIslandPanel();
  renderAll();
  renderIslands();

  // Using island ability ends the turn
  if (owner === 'p1' && !combatLocked) {
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
      card.addEventListener('click', () => {
        if (openIsland && openIsland.island === isl) { closeIslandPanel(); return; }
        openIslandPanel(isl, owner);
      });
      el.appendChild(card);
    });
    if (!islands.length) el.innerHTML = '<div style="opacity:0.3;font-size:0.6rem;padding:4px">–</div>';
  };

  renderSlots('opp-island-slots', islandState.p2, 'p2');
  renderSlots('neutral-island-slots', islandState.neutral, 'neutral');
  renderSlots('player-island-slots', islandState.p1, 'p1');
}

// ── Combat Phase ─────────────────────────────────────────────────
function onPlayerCardClick(slot, card, el) {
  if (!state || state.phase !== PHASE.COMBAT || state.turnOwner !== 1 || combatLocked) return;
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

function onPlayerReserveClick(slot, card) {
  if (!state || state.phase !== PHASE.COMBAT || state.turnOwner !== 1 || combatLocked) return;
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

function handleRoundEnd(end) {
  UI.addLogEntry(end.msg, 'round');
  // Reset island activations for next round
  if (islandState) resetIslandActivations(islandState);
  renderIslands();

  if (end.gameOver) { setTimeout(() => UI.showGameOver(state), 800); return; }
  UI.setStatus(end.msg + ' — Place cards for next round!');
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
    state.phase === PHASE.COMBAT ? onPlayerCardClick :
    state.phase === PHASE.PREP ? onPrepCardClick : null);
  UI.renderZone(UI.DOM.playerReserve, state.p1Reserve, true,
    state.phase === PHASE.COMBAT ? onPlayerReserveClick :
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