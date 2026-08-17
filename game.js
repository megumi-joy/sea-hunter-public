// Game state machine
import { CARDS, DECK_IDS, getResult } from './cards.js';

// ISLAND_CAPTURE: paused between "a round just ended with a winner" and
// "the board wipes/redeals for the next round" -- see checkRoundEnd() /
// finishRound() below and app.js's beginIslandCapturePhase(). Mirrors the
// canon web build's PHASE.ISLAND_CAPTURE (www/games/sea-hunter-cards).
export const PHASE = { PREP: 'PREP', COMBAT: 'COMBAT', ISLAND_CAPTURE: 'ISLAND_CAPTURE', ROUND_END: 'ROUND_END', GAME_OVER: 'GAME_OVER' };
export const MAX_ROUNDS = 10; // fallback cap -- see POINTS_TO_WIN below, the real win condition
// WIN CONDITION -- ISLAND GARRISON RULING (owner, 2026-08-14): first to
// hold POINTS_TO_WIN islands wins immediately (state.score is derived from
// islandState.p1/p2.length -- see islands.js's recomputeScore(), called
// from app.js right before finishRound() checks this). MAX_ROUNDS above is
// only a fallback tiebreak in case neither side reaches it.
export const POINTS_TO_WIN = 3;
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
export function finishRound(state) {
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
