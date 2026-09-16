// Sea Hunter game state machine.
// Ported from the committed backend at src/games/sea_hunter/game.py so the
// browser rules match the server rules exactly (phases, combat, islands).
import { CARDS, DECK_IDS, getResult } from './cards.js';
import { ISLANDS } from './islands.js';
import { grantArtifactOnCapture } from './artifacts.js';

export const PHASE = {
  PREP: 'PREP',
  COMBAT: 'COMBAT',
  ISLAND_CAPTURE: 'ISLAND_CAPTURE',
  GAME_OVER: 'GAME_OVER',
};

const FRONT_SIZE = 4;
const RESERVE_SIZE = 4;
const MAX_ROUNDS = 10; // fallback cap -- see DEFAULT_POINTS_TO_WIN below, the real win condition

// Which unit types can capture an island by placing themselves onto it (this
// moves the unit off the field to GARRISON the island -- see
// executeIslandCapture. Garrison, not sacrifice: the unit stays "on" the
// island in state.p1IslandGarrison/p2IslandGarrison and can later be pulled
// back off by the Maneuver power -- see retallyGarrisons() for what happens
// to the island then). VERIFIED against the authoritative Godot source
// (scripts/managers/RoundManager.gd:148's `eligible_ids`): it is the exact
// same list for every island there -- no per-island differentiation exists
// in the shipped/tested game. Kept as a per-island map (defaulting every
// island to that verified list) so a future per-island requirement can be
// added later without reshaping the capture code again -- see the PR notes
// for why this isn't populated with differentiated values.
const DEFAULT_CAPTURE_ELIGIBLE = ['battleship', 'cruiser', 'destroyer', 'patrol_ship', 'sea_hunter', 'plane', 'submarine'];
const CAPTURE_ELIGIBLE_BY_ISLAND = Object.fromEntries(
  Object.keys(ISLANDS).map((id) => [id, DEFAULT_CAPTURE_ELIGIBLE])
);
function isCaptureEligible(islandId, cardId) {
  const list = (islandId && CAPTURE_ELIGIBLE_BY_ISLAND[islandId]) || DEFAULT_CAPTURE_ELIGIBLE;
  return list.includes(cardId);
}

// WIN CONDITION -- Islands are a separate deck (state.islandDeck); players
// fight for the currently active island via combat, and the round's winner
// captures it (garrisons it with a qualifying unit, +1 point -- 2 for
// Two-Island -- plus that island's power -- see islands.js for the full
// rules writeup). Score is DERIVED from currently-held (garrisoned) islands
// every round-end (see recomputeScore/retallyGarrisons below), not an
// incremental counter -- an island can later drain (Maneuver pulls its
// garrison, nothing left to refill it at round-end) and take its point back
// with it. First to POINTS_TO_WIN captures wins the match immediately
// (checked in executeIslandCapture below). MAX_ROUNDS above is only a
// safety-valve tiebreak in case neither side reaches it. Exposed as a
// createGameState() option so campaign levels can retune it later without
// touching this file.
export const DEFAULT_POINTS_TO_WIN = 3;

function makeCard(id) {
  return { def: CARDS[id], faceUp: false, slot: -1 };
}

// P14: optional seeded randomness. A state created with opts.seed carries
// `rngSeed` and every shuffle and coin toss for that match comes off a
// mulberry32 stream instead of Math.random, so the guided first match
// (render/tutorial.js) deals the same way every time. No seed -> no
// `rngSeed` field -> Math.random, exactly as before.
function rand(src) {
  if (!src || typeof src.rngSeed !== 'number') return Math.random();
  let t = (src.rngSeed = (src.rngSeed + 0x6D2B79F5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function shuffle(arr, src) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand(src) * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function drawIsland(state) {
  state.activeIsland = state.islandDeck.length ? state.islandDeck.shift() : null;
}

export function createGameState(difficulty = 2, opts = {}) {
  const src = Number.isFinite(opts.seed) ? { rngSeed: opts.seed | 0 } : null;
  const state = {
    difficulty: Math.min(Math.max(difficulty, 1), 3),
    pointsToWin: opts.pointsToWin || DEFAULT_POINTS_TO_WIN,
    campaignLevelId: opts.campaignLevelId || null,
    phase: PHASE.PREP,
    roundNum: 1,
    turnOwner: rand(src) < 0.5 ? 1 : 2,
    score: [0, 0],
    p1Hand: shuffle(DECK_IDS, src).map(makeCard),
    p2Hand: shuffle(DECK_IDS, src).map(makeCard),
    p1Front: Array(FRONT_SIZE).fill(null),
    p1Reserve: Array(RESERVE_SIZE).fill(null),
    p2Front: Array(FRONT_SIZE).fill(null),
    p2Reserve: Array(RESERVE_SIZE).fill(null),
    p1Discard: [],
    p2Discard: [],
    islandDeck: shuffle(Object.keys(ISLANDS), src),
    activeIsland: null,
    p1Islands: [],
    p2Islands: [],
    // Garrison store: islandId -> the unit card currently holding that
    // island (see executeIslandCapture / retallyGarrisons / usePower's
    // maneuver branch). An island listed in p1Islands/p2Islands with NO
    // entry here is transiently un-garrisoned (only reachable mid-round via
    // Maneuver) -- resolved at the next round-end by retallyGarrisons.
    p1IslandGarrison: {},
    p2IslandGarrison: {},
    p1PowersUsed: [],
    p2PowersUsed: [],
    p1Artifacts: [],
    p2Artifacts: [],
    p1Shielded: false,
    p1LuckyAttack: false,
    skipTurnP1: false,
    skipTurnP2: false,
    roundWinner: 0,
    winReason: '',
    lastAction: '',
    combatLog: [],
  };
  if (src) state.rngSeed = src.rngSeed;
  drawIsland(state);
  return state;
}

// ---- Prep phase ----
export function autoPlace(state, player = 1) {
  const hand = player === 1 ? state.p1Hand : state.p2Hand;
  const front = player === 1 ? state.p1Front : state.p2Front;
  const reserve = player === 1 ? state.p1Reserve : state.p2Reserve;
  for (let i = 0; i < FRONT_SIZE; i++) {
    if (hand.length && front[i] === null) {
      const c = hand.shift();
      c.slot = i;
      c.faceUp = player === 1;
      front[i] = c;
    }
  }
  for (let i = 0; i < RESERVE_SIZE; i++) {
    if (hand.length && reserve[i] === null) {
      const c = hand.shift();
      c.slot = i;
      c.faceUp = player === 1;
      reserve[i] = c;
    }
  }
}

export function placeCard(state, handIdx, zone, slot) {
  if (state.phase !== PHASE.PREP) return { ok: false, msg: 'Placement only during the PREP phase!' };
  if (handIdx < 0 || handIdx >= state.p1Hand.length) return { ok: false, msg: `No card #${handIdx + 1} in hand` };
  const target = zone === 'front' ? state.p1Front : state.p1Reserve;
  if (slot < 0 || slot >= target.length) return { ok: false, msg: 'Invalid slot' };
  if (target[slot] !== null) return { ok: false, msg: `Slot ${slot + 1} is occupied` };
  const card = state.p1Hand.splice(handIdx, 1)[0];
  card.faceUp = true;
  card.slot = slot;
  target[slot] = card;
  return { ok: true, msg: `${card.def.emoji} ${card.def.name} -> ${zone} slot ${slot + 1}` };
}

// Inverse of placeCard: move a placed card back to hand during PREP (undo placement).
// Not present as a named method in game.py -- added here because the UI needs it
// and app.js's onPrepCardClick calls it.
export function returnCard(state, zone, slot) {
  if (state.phase !== PHASE.PREP) return null;
  const target = zone === 'front' ? state.p1Front : state.p1Reserve;
  if (slot < 0 || slot >= target.length) return null;
  const card = target[slot];
  if (!card) return null;
  target[slot] = null;
  state.p1Hand.push(card);
  return card;
}

export function lockIn(state) {
  if (state.phase !== PHASE.PREP) return { ok: false, msg: 'Not in the PREP phase' };
  const placed = state.p1Front.filter(Boolean).length + state.p1Reserve.filter(Boolean).length;
  if (placed < 4) return { ok: false, msg: 'Place at least 4 cards!' };

  for (let i = 0; i < FRONT_SIZE; i++) {
    if (state.p1Front[i] === null && state.p1Hand.length) {
      const c = state.p1Hand.shift();
      c.faceUp = true; c.slot = i;
      state.p1Front[i] = c;
    }
  }
  for (let i = 0; i < RESERVE_SIZE; i++) {
    if (state.p1Reserve[i] === null && state.p1Hand.length) {
      const c = state.p1Hand.shift();
      c.faceUp = true; c.slot = i;
      state.p1Reserve[i] = c;
    }
  }

  autoPlace(state, 2);

  state.phase = PHASE.COMBAT;
  state.combatLog = [];
  checkSkips(state);
  return { ok: true, msg: 'Combat begins!' };
}

function checkSkips(state) {
  if (state.turnOwner === 1 && state.skipTurnP1) {
    state.skipTurnP1 = false;
    state.turnOwner = 2;
    state.combatLog.push('Fog: player skips a turn!');
  } else if (state.turnOwner === 2 && state.skipTurnP2) {
    state.skipTurnP2 = false;
    state.turnOwner = 1;
    state.combatLog.push('Fog: AI skips a turn!');
  }
}

// One-turn island effects expire when the affected player's turn ends, exactly
// as the server referee does it (src/games/sea_hunter/game.py's _next_turn):
// Sabotage marks sit on the ending player's own units (it stopped them acting
// this turn), Camouflage marks sit on the opponent's units (it protected them
// from the ending player). Previously game.js only ever SET these flags in
// usePower() and never read or cleared them -- all enforcement and expiry lived
// in ai.js, so a flag set on a P1 unit (Sabotage from a P2 power) or a P2 unit
// (Camouflage the human set) was never honoured by playerAttack()/
// moveReserveToFront() at all. Clearing here is what makes the new guards in
// those two functions safe: without it a camouflaged card would stay
// permanently unattackable.
function expireTurnEffects(state, ending) {
  const own = ending === 1 ? [...state.p1Front, ...state.p1Reserve] : [...state.p2Front, ...state.p2Reserve];
  const opp = ending === 1 ? [...state.p2Front, ...state.p2Reserve] : [...state.p1Front, ...state.p1Reserve];
  for (const c of own) if (c) c.sabotaged = false;
  for (const c of opp) if (c) c.camouflaged = false;
}

function nextTurn(state) {
  expireTurnEffects(state, state.turnOwner);
  state.turnOwner = state.turnOwner === 1 ? 2 : 1;
  checkSkips(state);
}

// Expire the AI's outgoing marks at the START of a player action.
//
// nextTurn() is module-private, and ai.js ends the AI turn by assigning
// state.turnOwner = 1 directly rather than calling it, so expireTurnEffects()
// above only ever fires on the P1 -> P2 transition. Today ai.js happens to
// snapshot and clear both flags itself, but game.js must not depend on that:
// if ai.js ever stops (reasonably, now that game.js owns enforcement), a
// Camouflage the player set on their own card would never clear and that card
// would be permanently un-attackable by the AI -- the exact failure the
// enforcement guards would otherwise introduce. Calling this when control
// returns to P1 makes game.js self-sufficient, and it is idempotent, so
// ai.js's own clear is a harmless double-clear rather than a conflict.
function expireOpponentTurnEffects(state) {
  if (state.turnOwner === 1) expireTurnEffects(state, 2);
}

// ---- Combat phase ----
// `forceResult` lets the Lucky Compass artifact guarantee a 'WIN' outcome
// while reusing all the normal WIN-branch bookkeeping below.
export function resolveAttack(state, atkCard, defCard, atkPlayer, defPlayer, forceResult = null) {
  // Owner ruling 2026-09-14: a used card is face-up for the rest of the round
  // and nothing may turn it face-down again -- attacking reveals the attacker.
  atkCard.faceUp = true;
  // Smoke Bomb artifact: negates the next attack made against the player.
  if (defPlayer === 1 && state.p1Shielded) {
    state.p1Shielded = false;
    defCard.faceUp = true;
    const msg = `💨 Smoke Bomb blocks the attack -- ${defCard.def.emoji} ${defCard.def.name} is unharmed!`;
    state.combatLog.push(msg);
    return { result: 'NONE', msg };
  }

  const result = forceResult || getResult(atkCard.def.id, defCard.def.id);
  defCard.faceUp = true;

  const aName = `${atkCard.def.emoji} ${atkCard.def.name}`;
  const dName = `${defCard.def.emoji} ${defCard.def.name}`;
  let msg;

  if (result === 'WIN') {
    msg = `${aName} destroys ${dName}!`;
    removeCard(state, defCard, defPlayer);
  } else if (result === 'LOSS') {
    msg = `${aName} is destroyed by ${dName}!`;
    removeCard(state, atkCard, atkPlayer);
  } else if (result === 'DRAW') {
    msg = `${aName} and ${dName} destroy each other!`;
    removeCard(state, atkCard, atkPlayer);
    removeCard(state, defCard, defPlayer);
  } else {
    msg = `${aName} cannot damage ${dName}!`;
  }

  state.combatLog.push(msg);
  return { result, msg };
}

export function playerAttack(state, atkSlot, defSlot) {
  if (state.phase !== PHASE.COMBAT) return { ok: false, msg: 'Not in the combat phase!' };
  if (state.turnOwner !== 1) return { ok: false, msg: "It is the opponent's turn!" };
  expireOpponentTurnEffects(state);

  const atk = state.p1Front[atkSlot] || null;
  if (!atk) return { ok: false, msg: `No attacker in slot ${atkSlot + 1}` };
  if (atk.def.id === 'mine') return { ok: false, msg: 'Mines cannot attack!' };
  // Sabotage/Camouflage are enforced here now, not only in ai.js. game.js used
  // to set both flags in usePower() and never check them, so the AI's Sabotage
  // on a player unit and the player's own Camouflage on a P2 unit were both
  // purely cosmetic on this side of the board. Mirrors the server referee
  // (src/games/sea_hunter/game.py's attack(): the same two guards). Expiry is
  // handled by expireTurnEffects() in nextTurn() above.
  if (atk.sabotaged) return { ok: false, msg: 'This card is sabotaged and cannot act this turn!' };

  const oppFrontAlive = state.p2Front.some(Boolean);
  const dfn = oppFrontAlive ? (state.p2Front[defSlot] || null) : (state.p2Reserve[defSlot] || null);
  if (!dfn) return { ok: false, msg: 'No target!' };
  if (dfn.camouflaged) return { ok: false, msg: 'That card is camouflaged and cannot be attacked this turn!' };

  // Lucky Compass artifact overrides the impact matrix for this one attack.
  const forced = state.p1LuckyAttack ? 'WIN' : null;

  if (dfn.faceUp && !forced) {
    const res = getResult(atk.def.id, dfn.def.id);
    if (res === 'LOSS') return { ok: false, msg: 'That would be a suicide attack!' };
    if (res === 'NONE') return { ok: false, msg: 'That attack has no effect!' };
  }

  // Owner ruling 2026-09-14: no once-per-round limit -- a card may attack
  // any number of times in a round.
  const { msg, result } = resolveAttack(state, atk, dfn, 1, 2, forced);
  if (forced) state.p1LuckyAttack = false;
  state.lastAction = msg;
  nextTurn(state);

  const end = checkRoundEnd(state);
  // atkCard/defCard/result are surfaced the same way aiTurn() (ai.js)
  // already surfaces them for the AI's attacks -- app.js's doAttack() uses
  // these to play the same reveal+lunge+impact animation (UI.animateAttack)
  // the AI's attacks get, instead of the instant, unanimated state mutation
  // this used to be.
  return { ok: true, msg: end ? `${msg}\n${end}` : msg, atkCard: atk, defCard: dfn, result };
}

export function moveReserveToFront(state, reserveSlot) {
  if (state.phase !== PHASE.COMBAT) return { ok: false, msg: 'Not in the combat phase!' };
  if (state.turnOwner !== 1) return { ok: false, msg: 'Not your turn!' };
  expireOpponentTurnEffects(state);

  const card = state.p1Reserve[reserveSlot] || null;
  if (!card) return { ok: false, msg: 'No card in reserve!' };
  // Same Sabotage guard the server referee applies to a promote
  // (src/games/sea_hunter/game.py's move_to_front): a sabotaged unit cannot act
  // at all this turn, attacking or moving.
  if (card.sabotaged) return { ok: false, msg: 'This card is sabotaged and cannot act this turn!' };

  const empty = state.p1Front.findIndex((c) => c === null);
  if (empty === -1) return { ok: false, msg: 'Front is full!' };

  state.p1Reserve[reserveSlot] = null;
  card.slot = empty;
  state.p1Front[empty] = card;
  nextTurn(state);

  const msg = `${card.def.emoji} ${card.def.name} reserve -> front`;
  state.combatLog.push(msg);
  state.lastAction = msg;
  // BUGFIX: this used to skip checkRoundEnd entirely, so a round could never
  // end via a reserve-to-front move even when it left one side unable to act.
  const end = checkRoundEnd(state);
  return { ok: true, msg: end ? `${msg}\n${end}` : msg };
}

// Safety valve: lets the player pass when no card can legally attack (e.g. only
// a Mine remains on the front and reserve is empty). Not present in game.py --
// added here because a bare-HTML client has no other way to recover from that
// dead end (the Python CLI session would just keep rejecting attack commands).
// Owner ruling 2026-09-16: passing is not a move. Kept as the explicit
// "I cannot act" button path: it only succeeds when the player really has
// no legal attack, and then yields the round (checkRoundEnd does that).
export function skipTurn(state) {
  if (state.phase !== PHASE.COMBAT) return { ok: false, msg: 'Not in the combat phase!' };
  if (state.turnOwner !== 1) return { ok: false, msg: 'Not your turn!' };
  if (canAct(state, 1)) return { ok: false, msg: 'You still have a legal attack -- there is no passing.' };
  const end = checkRoundEnd(state);
  return { ok: true, msg: end || 'You yield the round.' };
}

function removeCard(state, card, player) {
  const front = player === 1 ? state.p1Front : state.p2Front;
  const reserve = player === 1 ? state.p1Reserve : state.p2Reserve;
  const discard = player === 1 ? state.p1Discard : state.p2Discard;

  // Clear the one-turn island flags on the way out: a destroyed card is
  // recycled into hand at round-end (see executeIslandCapture) and must not
  // carry a stale sabotaged/camouflaged mark back onto the board next round.
  // Mirrors game.py's _remove_card.
  card.sabotaged = false;
  card.camouflaged = false;
  let i = front.indexOf(card);
  if (i !== -1) { front[i] = null; discard.push(card); return; }
  i = reserve.indexOf(card);
  if (i !== -1) { reserve[i] = null; discard.push(card); return; }
}

// ---- Island powers ----
// SEAT-AWARE (2026-09-16). This used to hard-code seat 1 (`state.turnOwner !== 1`
// plus p1* zones throughout), so the browser AI on seat 2 physically could not
// invoke an island power even though ai.js's choosePower() was ported and the
// server referee (src/games/sea_hunter/game.py's use_power, which takes a
// `player` argument) allows both seats. `player` defaults to 1 so every existing
// UI call site (app.js's executeIslandPower) keeps working verbatim.
export function usePower(state, islandId, args = {}, player = 1) {
  const opp = player === 1 ? 2 : 1;
  const ownIslands = player === 1 ? state.p1Islands : state.p2Islands;
  const powersUsed = player === 1 ? state.p1PowersUsed : state.p2PowersUsed;
  const ownFront = player === 1 ? state.p1Front : state.p2Front;
  const ownReserve = player === 1 ? state.p1Reserve : state.p2Reserve;
  const ownHand = player === 1 ? state.p1Hand : state.p2Hand;
  const ownGarrison = player === 1 ? state.p1IslandGarrison : state.p2IslandGarrison;
  const oppFront = opp === 1 ? state.p1Front : state.p2Front;
  const oppReserve = opp === 1 ? state.p1Reserve : state.p2Reserve;

  if (state.phase !== PHASE.COMBAT) return { ok: false, msg: 'Not in the combat phase!' };
  if (state.turnOwner !== player) return { ok: false, msg: 'Not your turn!' };
  expireOpponentTurnEffects(state);
  if (!ownIslands.includes(islandId)) return { ok: false, msg: 'Island not found!' };
  if (powersUsed.includes(islandId)) return { ok: false, msg: 'That power was already used!' };
  // Two-Island is passive -- its bonus point resolves at capture time
  // (see executeIslandCapture). It has no active power to trigger.
  if (islandId === 'two_island') return { ok: false, msg: 'Two-Island already paid out its bonus at capture -- nothing to activate.' };

  const power = islandId;
  let msg = '';

  if (power === 'radar') {
    // Cardboard (IMG-toc): Radar reveals ONE opponent FRONT-line card only
    // ("передней линии соперника") -- never Reserve. Zone arg deliberately ignored.
    const slot = args.slot ?? 0;
    const target = oppFront[slot];
    if (!target) return { ok: false, msg: 'No front-line target for radar' };
    target.faceUp = true;
    msg = `Radar reveals: ${target.def.name}!`;
  } else if (power === 'camouflage') {
    // BUGFIX: this used to require "2 of your own face-down cards" to
    // swap -- an unreachable precondition, since placeCard()/autoPlace()
    // stamp the player's own cards faceUp=true the instant they're placed
    // (see those functions above), so the human player can never actually
    // hold a face-down card of their own. Corrected to match the real
    // card-image rule (see islands.js's CAMOUFLAGE CORRECTION note): pick
    // one of your own field cards and hide it -- the opponent cannot
    // attack it on their very next turn. Enforcement lives in
    // playerAttack() (P1 side) and ai.js's target filtering (P2 side); the
    // flag expires in expireTurnEffects().
    const slot = args.slot ?? 0;
    const zoneArr = args.zone === 'reserve' ? ownReserve : ownFront;
    const target = zoneArr[slot];
    if (!target) return { ok: false, msg: 'No card in that slot' };
    target.camouflaged = true;
    msg = `Camouflage: ${target.def.emoji} ${target.def.name} is hidden -- the opponent cannot attack it on their next turn!`;
  } else if (power === 'rapid_support') {
    // Card text: "Перемести 1 карту базы в любое свободное место 2 линии"
    // -- "2 линии" (line 2) is the same convention Scouting/Secret Move both
    // target, and that convention is Reserve, not Front (see IMG-toc: Radar
    // is the one power that explicitly targets "передней линии"/front line).
    // BUGFIX (F4, SEAHUNTER_QA_FINDINGS.md): this used to deploy to Front.
    // Bounds + reserve-full ordering mirror game.py's use_power; the
    // faceUp convention is the browser's own (`player === 1`, exactly as
    // autoPlace()/aiDeploy() stamp cards) rather than game.py's blanket
    // face_up = False, which would deploy the HUMAN's card face-down.
    const handIdx = args.handIdx ?? args.hand_idx ?? 0;
    if (!(handIdx >= 0 && handIdx < ownHand.length)) return { ok: false, msg: 'Hand error' };
    const empty = ownReserve.findIndex((c) => c === null);
    if (empty === -1) return { ok: false, msg: 'Reserve is full' };
    const c = ownHand.splice(handIdx, 1)[0];
    c.faceUp = player === 1;
    c.slot = empty;
    ownReserve[empty] = c;
    msg = 'Rapid support deployed to Reserve!';
  } else if (power === 'maneuver') {
    // F5 RULING (owner, 2026-08-14): "Take cards off ISLANDS, then return
    // them or lose them" -- Maneuver retrieves one of the player's OWN
    // garrison units off a held island back to hand. It is NOT a field
    // (Front/Reserve) withdrawal -- that was the old, wrong reading (see
    // SEAHUNTER_QA_FINDINGS.md's F5 for the prior ambiguity). args.islandId
    // picks which held island to un-garrison; an EXPLICIT pick with no
    // garrison is refused rather than silently redirected to a different
    // island (mirrors game.py's use_power). Only an omitted islandId falls
    // back to the first held island that has a garrison. app.js only ever
    // passes ids it already filtered to garrisoned ones, so the refusal is
    // unreachable from the UI.
    // After retrieval the island stays in the held list (still "held" for the
    // rest of this round) but its garrison slot is empty -- retallyGarrisons
    // (below, run at every round-end) either auto-refills it from another
    // qualifying Front/Reserve unit ("return them") or drains it if nothing
    // qualifies ("or lose them"). This does not change the score by itself.
    let targetIslandId = args.islandId ?? args.island_id;
    if (targetIslandId && !ownGarrison[targetIslandId]) {
      return { ok: false, msg: 'That island has no garrison to retrieve' };
    }
    if (!targetIslandId) {
      targetIslandId = ownIslands.find((id) => ownGarrison[id]);
    }
    const c = targetIslandId ? ownGarrison[targetIslandId] : null;
    if (!c) return { ok: false, msg: 'No garrisoned island to retrieve a unit from' };
    delete ownGarrison[targetIslandId];
    ownHand.push(c);
    const islandName = (ISLANDS[targetIslandId] && ISLANDS[targetIslandId].name) || targetIslandId;
    msg = `Maneuver: ${c.def.emoji} ${c.def.name} retrieved from ${islandName} -- return it to the field or the island drains at round-end!`;
  } else if (power === 'teleportation') {
    // Swap a Front card with the Reserve card directly behind it (same
    // slot index -- "directly behind" per the owner's card-image rules).
    const slot = args.slot ?? 0;
    const front = ownFront[slot];
    const reserve = ownReserve[slot];
    if (!front) return { ok: false, msg: 'No Front card in that slot' };
    ownFront[slot] = reserve;
    ownReserve[slot] = front;
    front.slot = slot;
    if (reserve) reserve.slot = slot;
    msg = reserve
      ? `Teleportation: ${front.def.emoji} ${front.def.name} swaps with ${reserve.def.emoji} ${reserve.def.name}!`
      : `Teleportation: ${front.def.emoji} ${front.def.name} falls back to Reserve!`;
  } else if (power === 'scouting') {
    // Reveal two of the opponent's Reserve cards.
    const s1 = args.slot1, s2 = args.slot2;
    const c1 = oppReserve[s1];
    const c2 = oppReserve[s2];
    if (!c1 || !c2 || s1 === s2) return { ok: false, msg: 'Pick 2 different enemy Reserve cards' };
    c1.faceUp = true;
    c2.faceUp = true;
    msg = `Scouting reveals: ${c1.def.name} and ${c2.def.name}!`;
  } else if (power === 'secret_move') {
    // Rearrange all of the player's own Reserve cards into any order.
    // `args.order` is the list of currently-occupied Reserve slot indices,
    // in the order the player wants those cards placed -- see app.js's
    // secret_move click flow. The same physical slots are reused (no slots
    // gained or lost), just re-populated in the chosen order. Duplicate
    // indices are rejected (they would duplicate a card into two slots) --
    // same guard as game.py's use_power.
    const order = args.order || [];
    if (order.length < 2) return { ok: false, msg: 'Secret Move needs at least 2 Reserve cards' };
    if (new Set(order).size !== order.length) return { ok: false, msg: 'Secret Move error' };
    const cardsInPickOrder = order.map((i) => ownReserve[i]);
    if (cardsInPickOrder.some((c) => !c)) return { ok: false, msg: 'Secret Move error' };
    const targetSlots = [...order].sort((a, b) => a - b);
    targetSlots.forEach((s, i) => {
      const c = cardsInPickOrder[i];
      c.slot = s;
      ownReserve[s] = c;
    });
    msg = 'Secret Move: your Reserve has been rearranged!';
  } else if (power === 'sabotage') {
    // Mark one enemy card so it can't act on the opponent's very next
    // turn -- read by playerAttack()/moveReserveToFront() (P1 side) and
    // ai.js's legalAttacks/choosePromotionSlot (P2 side).
    const slot = args.slot ?? 0;
    const zoneArr = args.zone === 'reserve' ? oppReserve : oppFront;
    const target = zoneArr[slot];
    if (!target) return { ok: false, msg: 'No target for Sabotage' };
    target.sabotaged = true;
    msg = `Sabotage: ${target.def.emoji} ${target.def.name} won't be able to act on the opponent's next turn!`;
  } else {
    // Previously an unrecognised island id fell through with msg = '' and
    // still got pushed into powersUsed, burning the power for nothing.
    // Same refusal as game.py's use_power.
    return { ok: false, msg: 'Unknown island power' };
  }

  powersUsed.push(islandId);
  state.combatLog.push(msg);
  state.lastAction = msg;
  nextTurn(state);
  return { ok: true, msg };
}

// True if `player` has any move left this combat phase: a non-Mine Front
// card with a legal target (no once-per-round limit, owner ruling
// 2026-09-14), or any Reserve card to promote to Front. Used
// to detect a mines-only / empty-reserve mutual deadlock (see checkRoundEnd).
function canAct(state, player) {
  const front = player === 1 ? state.p1Front : state.p2Front;
  const reserve = player === 1 ? state.p1Reserve : state.p2Reserve;
  const oppFront = player === 1 ? state.p2Front : state.p1Front;
  const oppReserve = player === 1 ? state.p2Reserve : state.p1Reserve;

  // BUGFIX (the actual deadlock, found via a 300-game direct-engine stress
  // simulation -- ~39% never reached GAME_OVER before this fix): having an
  // non-Mine Front card is NOT sufficient for "can act" -- that
  // card might have zero LEGAL targets. playerAttack() itself rejects any
  // attack on a face-up target unless the result is WIN or DRAW (see its
  // `dfn.faceUp` guard); once enough cards get revealed over a round (every
  // attacked card -- win, loss, or draw -- ends up faceUp=true), a player
  // can easily be left with cards that are technically "actionable" by the
  // old check yet have no attack playerAttack() will actually allow. That
  // mismatch meant checkRoundEnd()'s deadlock detector never fired (canAct
  // said "yes" on both sides) while every real attack attempt kept getting
  // rejected -- an invisible infinite skipTurn() loop. Mirror
  // playerAttack()'s real legality rule here instead of a rough proxy for
  // it: a card can act only if some target in the currently-valid attack
  // row is either face-down (blind attacks are always allowed) or a
  // face-up target this card would WIN or DRAW against.
  const oppFrontAlive = oppFront.some(Boolean);
  const targets = oppFrontAlive ? oppFront : oppReserve;
  const hasLegalAttack = front.some((c) => {
    if (!c || c.def.id === 'mine') return false;
    return targets.some((t) => {
      if (!t) return false;
      if (!t.faceUp) return true;
      const res = getResult(c.def.id, t.def.id);
      return res === 'WIN' || res === 'DRAW';
    });
  });

  // A non-empty Reserve only counts as a legal move if there's actually a
  // free Front slot to promote into -- moveReserveToFront() itself rejects
  // the move otherwise ("Front is full!").
  const hasFreeFrontSlot = front.some((c) => c === null);
  const hasReserve = hasFreeFrontSlot && reserve.some(Boolean);
  return hasLegalAttack || hasReserve;
}

// ---- AI capture chooser hook ----
// executeIslandCapture() below picks the AI's garrison unit itself (first
// eligible, Front before Reserve) and is reached only from inside
// checkRoundEnd(), so ai.js's ported chooseCapture() -- which spends the unit
// with the LEAST future value, Reserve first -- had no way to be applied. This
// hook is that way in: ai.js registers its chooseCapture at import scope via
// setCaptureChooser(), and a per-state override (state.captureChooser) takes
// precedence for tests/campaign variants. A chooser that returns null, or a
// pick that is empty/ineligible, silently falls back to the first-eligible
// scan -- a bad chooser must never cost the AI the capture (and the point).
// Signature: (state, player) -> [slot, zone] | null, matching ai.js's
// chooseCapture() and playerCaptureIsland()'s own (slot, zone) order.
let captureChooser = null;
export function setCaptureChooser(fn) {
  captureChooser = typeof fn === 'function' ? fn : null;
}
function pickCaptureSlot(state, player) {
  const chooser = (state && state.captureChooser) || captureChooser;
  if (!chooser) return null;
  let pick = null;
  try {
    pick = chooser(state, player);
  } catch (e) {
    return null;
  }
  if (!Array.isArray(pick) || pick.length < 2) return null;
  const [slot, zone] = pick;
  const list = zone === 'reserve'
    ? (player === 1 ? state.p1Reserve : state.p2Reserve)
    : (player === 1 ? state.p1Front : state.p2Front);
  const card = list[slot] || null;
  if (!card || !isCaptureEligible(state.activeIsland, card.def.id)) return null;
  return { list, slot, card };
}

// ---- Round / island-capture ----
export function checkRoundEnd(state) {
  const p1Alive = state.p1Front.some(Boolean) || state.p1Reserve.some(Boolean);
  const p2Alive = state.p2Front.some(Boolean) || state.p2Reserve.some(Boolean);
  // BUGFIX: both sides can still have cards (e.g. unattackable Mines) yet
  // have no legal move left for either player -- previously that round could
  // never end (only an actual kill ever called into this branch). Treat a
  // mutual deadlock the same as a mutual wipe: a draw round, no capture.
  // Owner ruling 2026-09-16: there is no passing. The player to move who
  // has no legal attack (only mines, or every target would sink them)
  // yields the round to the opponent. Checked for the player whose turn
  // it now is, after the previous action handed the turn over.
  const mover = state.turnOwner;
  const stuck = p1Alive && p2Alive && !canAct(state, mover);
  if (p1Alive && p2Alive && !stuck) return null;

  state.phase = PHASE.ISLAND_CAPTURE;

  let yieldMsg = '';
  let winner = !p1Alive && !p2Alive ? 0 : (!p2Alive ? 1 : (!p1Alive ? 2 : 0));
  if (stuck) {
    winner = mover === 1 ? 2 : 1;
    yieldMsg = mover === 1
      ? 'You have no legal attack -- you yield the round.\n'
      : 'The AI has no legal attack -- it yields the round.\n';
    state.combatLog.push(yieldMsg.trim());
  }

  if (winner === 0) {
    state.roundWinner = 0;
    return 'The round is a draw! No one captures the island.\n' + executeIslandCapture(state, 0, 0);
  } else if (winner === 1) {
    state.roundWinner = 1;
    // BUGFIX / rules edge case: if none of the winner's survivors can
    // legally capture (isCaptureEligible), auto-resolve the island-capture
    // phase instead of leaving the player stuck with no valid click. Score
    // is now derived from held (garrisoned) islands (see recomputeScore) --
    // winning the round with nothing to garrison the island with means no
    // point this round, since nothing gets held.
    if (!hasEligibleCapturer(state, 1)) {
      const msg = `${yieldMsg}You win round ${state.roundNum}!\nNo qualifying unit to hold the island -- it stays uncaptured.\n`;
      return msg + executeIslandCapture(state, 0, 0);
    }
    return `${yieldMsg}You win round ${state.roundNum}!\nPick a ship or plane to capture the island!`;
  } else {
    state.roundWinner = 2;
    const msg = `${yieldMsg}The AI wins round ${state.roundNum}!`;
    return msg + '\n' + executeIslandCapture(state, 2, 0);
  }
}

export function playerCaptureIsland(state, slot, zone) {
  if (state.phase !== PHASE.ISLAND_CAPTURE) return { ok: false, msg: 'Not in the island-capture phase' };
  if (state.roundWinner !== 1) return { ok: false, msg: "You didn't win the round!" };

  const target = zone === 'front' ? state.p1Front : state.p1Reserve;
  const card = target[slot] || null;
  if (!card) return { ok: false, msg: 'No card in that slot' };
  if (!isCaptureEligible(state.activeIsland, card.def.id)) return { ok: false, msg: 'Only ships or planes can capture the island' };

  const msg = executeIslandCapture(state, 1, slot, zone);
  return { ok: true, msg };
}

// Does the player have ANY unit on the field that could capture the active
// island? Used to detect the "no qualifying unit" edge case below -- without
// this check, a round winner whose only survivors are ineligible (Mine /
// Landing Craft / Coastal Artillery) could never satisfy playerCaptureIsland,
// permanently stuck in the ISLAND_CAPTURE phase with no valid click.
function hasEligibleCapturer(state, player) {
  const front = player === 1 ? state.p1Front : state.p2Front;
  const reserve = player === 1 ? state.p1Reserve : state.p2Reserve;
  return [...front, ...reserve].some((c) => c && isCaptureEligible(state.activeIsland, c.def.id));
}

// ISLAND RULING refinement 2 (owner, 2026-08-14): re-evaluate every island
// `player` currently holds. An island whose garrison slot is still filled is
// left completely untouched (the common case -- captured islands stay
// garrisoned by default; only the Maneuver power ever empties one). An
// island with an EMPTY garrison slot either gets auto-refilled from another
// qualifying Front/Reserve unit ("another suitable card -> it auto-places,
// island preserved") or drains -- removed from the held list, its point
// lost with it -- if the player has nothing left to place ("none -> the
// island drains"). Runs for both players at every round-end regardless of
// that round's winner/loser/draw (surrender, if ever added, would be no
// different -- it does not by itself drain an island; only an unrefillable
// empty garrison does). Returns a player-facing log string (may be empty).
function retallyGarrisons(state, player) {
  const islands = player === 1 ? state.p1Islands : state.p2Islands;
  const garrison = player === 1 ? state.p1IslandGarrison : state.p2IslandGarrison;
  const front = player === 1 ? state.p1Front : state.p2Front;
  const reserve = player === 1 ? state.p1Reserve : state.p2Reserve;
  const who = player === 1 ? 'Your' : "The AI's";
  let msg = '';

  for (let i = islands.length - 1; i >= 0; i--) {
    const islandId = islands[i];
    if (garrison[islandId]) continue; // still garrisoned -- nothing to do

    let refilled = false;
    for (const list of [front, reserve]) {
      for (let s = 0; s < list.length; s++) {
        const c = list[s];
        if (c && isCaptureEligible(islandId, c.def.id)) {
          list[s] = null;
          garrison[islandId] = c;
          refilled = true;
          break;
        }
      }
      if (refilled) break;
    }

    const name = (ISLANDS[islandId] && ISLANDS[islandId].name) || islandId;
    if (refilled) {
      msg += `${who} ${name} garrison is resupplied -- island held!\n`;
    } else {
      islands.splice(i, 1);
      delete garrison[islandId];
      msg += `${who} ${name} garrison is empty -- the island drains!\n`;
    }
  }
  return msg;
}

// Score = number of islands each player currently HOLDS (garrisoned),
// Two-Island weighted 2 -- see the ISLAND GARRISON RULING (owner,
// 2026-08-14): "points = number of islands currently held." Always derived
// fresh from p1Islands/p2Islands (never an incremental counter) so capture,
// auto-refill, and drain can never drift out of sync with the displayed
// score -- call after any mutation to either islands list.
function recomputeScore(state) {
  const scoreFor = (islands) => islands.reduce((sum, id) => sum + (id === 'two_island' ? 2 : 1), 0);
  state.score[0] = scoreFor(state.p1Islands);
  state.score[1] = scoreFor(state.p2Islands);
}

function executeIslandCapture(state, winner, slot, zone = 'front') {
  let msg = '';
  if (state.activeIsland && winner !== 0) {
    if (winner === 1) {
      const target = zone === 'front' ? state.p1Front : state.p1Reserve;
      const card = target[slot];
      if (card) {
        target[slot] = null; // leaves the field to GARRISON the island, not sacrificed
        state.p1IslandGarrison[state.activeIsland] = card;
        state.p1Islands.push(state.activeIsland);
        if (state.activeIsland === 'two_island') msg += 'Two-Island Power is worth 2 points total!\n';
        const dropped = grantArtifactOnCapture(state, 1);
        if (dropped) msg += `You also found an artifact: ${dropped}!\n`;
      }
    } else {
      let captured = false;
      // Let the AI's own chooseCapture() decide which unit to spend, if a
      // chooser is registered (see setCaptureChooser above); otherwise keep
      // the historic first-eligible scan below, unchanged.
      const chosen = pickCaptureSlot(state, 2);
      if (chosen) {
        chosen.list[chosen.slot] = null;
        state.p2IslandGarrison[state.activeIsland] = chosen.card;
        state.p2Islands.push(state.activeIsland);
        captured = true;
      }
      for (const list of captured ? [] : [state.p2Front, state.p2Reserve]) {
        for (let i = 0; i < list.length; i++) {
          const c = list[i];
          if (c && isCaptureEligible(state.activeIsland, c.def.id)) {
            list[i] = null;
            state.p2IslandGarrison[state.activeIsland] = c;
            state.p2Islands.push(state.activeIsland);
            captured = true;
            break;
          }
        }
        if (captured) break;
      }
      if (state.activeIsland === 'two_island' && captured) msg += 'Two-Island Power was worth 2 points to the AI!\n';
      if (captured) grantArtifactOnCapture(state, 2);
    }
  }

  // ISLAND GARRISON RULING (owner, 2026-08-14): re-tally EVERY held island
  // for BOTH players at EVERY round-end, independent of who won, lost, or
  // drew this particular round. Only islands left un-garrisoned by Maneuver
  // are actually affected (see retallyGarrisons) -- an island that's still
  // holding its original garrison is untouched here.
  msg += retallyGarrisons(state, 1);
  msg += retallyGarrisons(state, 2);
  recomputeScore(state);

  for (const c of [...state.p1Front, ...state.p1Reserve]) if (c) state.p1Hand.push(c);
  for (const c of [...state.p2Front, ...state.p2Reserve]) if (c) state.p2Hand.push(c);
  // One-turn island flags never survive into the next round (game.py does the
  // same clear when it recycles the field and discard back into hand).
  for (const c of [...state.p1Hand, ...state.p2Hand, ...state.p1Discard, ...state.p2Discard]) {
    if (c) { c.sabotaged = false; c.camouflaged = false; }
  }

  // BUGFIX: this used to only recycle the discard pile back into hand when
  // hand was FULLY empty. Since a captured card is the only unit meant to
  // be permanently removed from play, that condition was too strict: any
  // single leftover hand card (very common) permanently stranded the
  // entire discard pile out of circulation, round after round -- the pool
  // of usable cards could crater below the PREP phase's "place at least 4"
  // minimum after enough combat kills, permanently disabling Ready with no
  // recovery. Recycle every round instead, regardless of hand size.
  state.p1Hand = state.p1Hand.concat(state.p1Discard);
  state.p1Discard = [];
  state.p2Hand = state.p2Hand.concat(state.p2Discard);
  state.p2Discard = [];

  state.roundNum += 1;
  const pointsToWin = state.pointsToWin || DEFAULT_POINTS_TO_WIN;
  if (state.score[0] >= pointsToWin || state.score[1] >= pointsToWin) {
    state.winReason = 'points';
    return msg + gameOver(state);
  }
  if (state.roundNum > MAX_ROUNDS || (!state.p1Hand.length && !state.p2Hand.length)) {
    state.winReason = 'rounds';
    return msg + gameOver(state);
  }

  drawIsland(state);
  state.phase = PHASE.PREP;
  state.p1Front = Array(FRONT_SIZE).fill(null);
  state.p1Reserve = Array(RESERVE_SIZE).fill(null);
  state.p2Front = Array(FRONT_SIZE).fill(null);
  state.p2Reserve = Array(RESERVE_SIZE).fill(null);
  // Owner ruling 2026-09-16: the winner of the previous round opens the
  // next one; the coin is tossed only for round 1 and after a drawn round.
  state.turnOwner = state.roundWinner === 1 || state.roundWinner === 2
    ? state.roundWinner
    : (rand(state) < 0.5 ? 1 : 2);
  return msg + `Round ${state.roundNum} -- place your cards!`;
}

function gameOver(state) {
  state.phase = PHASE.GAME_OVER;
  const [p, a] = state.score;
  const reason = state.winReason === 'points' ? `first to ${state.pointsToWin || DEFAULT_POINTS_TO_WIN} islands` : `round limit`;
  if (p > a) return `\nVICTORY! ${p}:${a} (${reason}) after ${state.roundNum - 1} rounds!`;
  if (a > p) return `\nDefeat. ${p}:${a} (${reason})`;
  return `\nDraw! ${p}:${a}`;
}
