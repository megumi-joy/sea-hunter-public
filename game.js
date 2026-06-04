// Game state machine
import { CARDS, DECK_IDS, getResult } from './cards.js';

export const PHASE = { PREP: 'PREP', COMBAT: 'COMBAT', ROUND_END: 'ROUND_END', GAME_OVER: 'GAME_OVER' };
export const MAX_ROUNDS = 10;
export const ZONE_SIZE = 4;

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

export function createCard(cardId) {
  return { def: CARDS[cardId], faceUp: false, uid: Math.random().toString(36).slice(2, 8), shield: false };
}

export function createGameState(difficulty = 2) {
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

export function autoPlace(state, player = 1) {
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

export function placeCard(state, handIdx, zone, slot) {
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

export function returnCard(state, zone, slot) {
  const target = zone === 'front' ? state.p1Front : state.p1Reserve;
  if (!target[slot]) return null;
  const card = target[slot];
  target[slot] = null;
  state.p1Hand.push(card);
  return card;
}

export function lockIn(state) {
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
export function resolveAttack(state, atkCard, defCard, atkPlayer, defPlayer) {
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

export function removeCard(state, card, player) {
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

export function playerAttack(state, atkSlot, defSlot) {
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

export function moveReserveToFront(state, reserveSlot, player = 1) {
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

export function checkRoundEnd(state) {
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
