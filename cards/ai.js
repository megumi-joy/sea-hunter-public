// AI opponent for Sea Hunter.
//
// Line-by-line port of src/games/sea_hunter/ai.py: same function names, same
// constants, same tie-break order. tests/tools/ai_parity.py diffs the shared
// constants between the two files, so keep the names below in sync.
//
// Design rules shared with the Python side:
//
//   * The policy is a PURE function of PUBLIC information. chooseAction()
//     never reads the id of a face-down enemy card; unknown targets are
//     scored against a prior built from the public remaining pool.
//
//   * No RNG anywhere in the policy. Ties break lexicographically on
//     (-score, attackerSlot, targetSlot, zoneRank) -- the only tie-break
//     scheme reproducible identically in both languages.
//
// ALL THREE historic divergences from ai.py are now CLOSED (2026-09-16):
//
//   1. Sabotage/Camouflage expiry. game.js now owns expiry entirely
//      (expireTurnEffects in nextTurn, expireOpponentTurnEffects at the start
//      of every P1 action, and the hand/discard clear in
//      executeIslandCapture). Every path out of an AI turn passes through one
//      of those three, so this file only SNAPSHOTS the flags (chooseAction
//      needs the sets to filter attackers/targets) and no longer clears them.
//
//   2. Island powers. usePower() takes a `player` argument now, so
//      choosePower() is wired into aiTurn() below and the seat-2 AI really
//      uses its island powers -- as the Python bot already does.
//      Radar and scouting need a FACE-DOWN opponent card. Since 2026-09-16
//      placement no longer reveals P1's cards (faceUp means "revealed to the
//      opponent" for both seats -- see game.js's makeCard), so all of them
//      are reachable for seat 2.
//
//   3. Island capture. game.js exposes setCaptureChooser(), and this file
//      registers chooseCapture() with it at import scope below, so the AI
//      garrisons with its own pick (cheapest eligible, Reserve first) instead
//      of the engine's first-eligible scan.
//
//   aiDeploy() IS wired: app.js calls it before lockIn().
import { CARDS, DECK_IDS, getResult } from './cards.js';
import { resolveAttack, checkRoundEnd, usePower, setCaptureChooser } from './game.js';

const FRONT_SIZE = 4;
const RESERVE_SIZE = 4;

// ---- Shared policy constants (mirrored verbatim in ai.py) ----
export const SCORE_WIN = 3.0;
export const SCORE_DRAW = 0.2;
export const SCORE_LOSS = -3.0;
export const SCORE_NONE = -0.15;

export const REVEAL_BONUS = 0.35;
export const STRENGTH_WEIGHT = 0.12;
export const EXPOSURE_PENALTY = 0.10;
export const ELIGIBLE_LOSS_PENALTY = 1.2;
export const PROMOTE_SCORE = 0.05;
export const POWER_MIN_GAIN = 0.8;

export const ZONE_RANK = { front: 0, reserve: 1 };

// Powers are applied in aiTurn() below, BEFORE the attack decision, not from
// inside chooseAction(). chooseAction() stays a pure decision function over
// attacks/promotions, and there is exactly one power path -- keeping the old
// ['power', ...] branch alive as well would let the AI fire two powers in one
// turn (usePower() itself ends the turn).
const AI_USES_POWERS = false;

const DEFAULT_CAPTURE_ELIGIBLE = [
  'battleship', 'cruiser', 'destroyer', 'patrol_ship', 'sea_hunter', 'plane', 'submarine',
];

function isCaptureEligible(islandId, cardId) {
  return DEFAULT_CAPTURE_ELIGIBLE.includes(cardId);
}

// ---- Public information ----
// Ids the opponent's face-down cards could still be, from PUBLIC info only.
export function unknownPool(state, opp) {
  const pool = DECK_IDS.slice();
  const remove = (cid) => {
    const i = pool.indexOf(cid);
    if (i !== -1) pool.splice(i, 1);
  };
  const front = opp === 1 ? state.p1Front : state.p2Front;
  const reserve = opp === 1 ? state.p1Reserve : state.p2Reserve;
  const discard = opp === 1 ? state.p1Discard : state.p2Discard;
  const garrison = opp === 1 ? state.p1IslandGarrison : state.p2IslandGarrison;

  for (const c of [...front, ...reserve]) {
    if (c && c.faceUp) remove(c.def.id);
  }
  for (const c of discard || []) remove(c.def.id);
  for (const k of Object.keys(garrison || {})) {
    const c = garrison[k];
    if (c) remove(c.def.id);
  }
  return pool;
}

// Expected outcome score of attacking a face-down card, and the probability
// the attacker dies, averaged over the public pool.
export function expectedVsUnknown(attackerId, pool) {
  if (!pool.length) return [(SCORE_WIN + SCORE_LOSS) / 2.0, 0.5];
  let total = 0.0;
  let deaths = 0.0;
  for (const cid of pool) {
    const res = getResult(attackerId, cid);
    if (res === 'WIN') total += SCORE_WIN + STRENGTH_WEIGHT * CARDS[cid].strength;
    else if (res === 'DRAW') { total += SCORE_DRAW; deaths += 1.0; }
    else if (res === 'LOSS') { total += SCORE_LOSS; deaths += 1.0; }
    else total += SCORE_NONE;
  }
  const n = pool.length;
  return [total / n, deaths / n];
}

function eligibleCount(state, player) {
  const front = player === 1 ? state.p1Front : state.p2Front;
  const reserve = player === 1 ? state.p1Reserve : state.p2Reserve;
  return [...front, ...reserve]
    .filter((c) => c && isCaptureEligible(state.activeIsland, c.def.id)).length;
}

function futureValue(cardId) {
  let v = CARDS[cardId].strength * STRENGTH_WEIGHT;
  if (isCaptureEligible(null, cardId)) v += 0.5;
  return v;
}

// ---- Attack scoring ----
export function scoreAttack(state, player, atk, target, pool, eligibleNow) {
  let score;
  let death;
  if (target.faceUp) {
    const res = getResult(atk.def.id, target.def.id);
    if (res === 'WIN') {
      score = SCORE_WIN + STRENGTH_WEIGHT * CARDS[target.def.id].strength;
      death = 0.0;
    } else if (res === 'DRAW') { score = SCORE_DRAW; death = 1.0; }
    else if (res === 'LOSS') { score = SCORE_LOSS; death = 1.0; }
    else { score = SCORE_NONE; death = 0.0; }
  } else {
    [score, death] = expectedVsUnknown(atk.def.id, pool);
    score += REVEAL_BONUS;
    if (!atk.faceUp) score -= EXPOSURE_PENALTY * CARDS[atk.def.id].strength;
  }

  if (death > 0.0 && isCaptureEligible(state.activeIsland, atk.def.id)) {
    if (eligibleNow <= 1) score -= ELIGIBLE_LOSS_PENALTY * death;
  }
  return score;
}

// Every attack the engine would accept, as [atkSlot, targetSlot, zone, atk, target].
export function legalAttacks(state, player, sabotaged, camouflaged) {
  const opp = player === 1 ? 2 : 1;
  const ownFront = player === 1 ? state.p1Front : state.p2Front;
  const oppFront = opp === 1 ? state.p1Front : state.p2Front;
  const oppReserve = opp === 1 ? state.p1Reserve : state.p2Reserve;
  const frontAlive = oppFront.some(Boolean);
  const row = frontAlive ? oppFront : oppReserve;
  const zone = frontAlive ? 'front' : 'reserve';

  const out = [];
  for (let ai = 0; ai < ownFront.length; ai++) {
    const ac = ownFront[ai];
    if (!ac || ac.def.id === 'mine' || (sabotaged && sabotaged.has(ac))) continue;
    for (let ti = 0; ti < row.length; ti++) {
      const tc = row[ti];
      if (!tc || (camouflaged && camouflaged.has(tc))) continue;
      // Mirror the engine's legality rule exactly (game.js playerAttack):
      // a FACE-UP target may only be attacked on WIN or DRAW.
      if (tc.faceUp) {
        const res = getResult(ac.def.id, tc.def.id);
        if (res === 'LOSS' || res === 'NONE') continue;
      }
      out.push([ai, ti, zone, ac, tc]);
    }
  }
  return out;
}

// ---- Powers ----
// Wired: aiTurn() calls this at the start of the AI turn and applies the
// result through game.js's usePower(state, id, args, 2).
export function choosePower(state, player) {
  const opp = player === 1 ? 2 : 1;
  const held = player === 1 ? state.p1Islands : state.p2Islands;
  const used = player === 1 ? state.p1PowersUsed : state.p2PowersUsed;
  const avail = (held || []).filter((i) => !(used || []).includes(i) && i !== 'two_island');
  if (!avail.length) return null;

  const ownFront = player === 1 ? state.p1Front : state.p2Front;
  const ownReserve = player === 1 ? state.p1Reserve : state.p2Reserve;
  const oppFront = opp === 1 ? state.p1Front : state.p2Front;
  const oppReserve = opp === 1 ? state.p1Reserve : state.p2Reserve;
  const hand = player === 1 ? state.p1Hand : state.p2Hand;

  // Sabotage: freeze the opponent's strongest face-up front attacker.
  if (avail.includes('sabotage')) {
    let best = null;
    let bi = null;
    for (let i = 0; i < oppFront.length; i++) {
      const c = oppFront[i];
      if (c && c.faceUp && !c.sabotaged && c.def.id !== 'mine') {
        if (best === null || CARDS[c.def.id].strength > CARDS[best.def.id].strength) {
          best = c; bi = i;
        }
      }
    }
    if (best !== null && CARDS[best.def.id].strength * STRENGTH_WEIGHT * 4 >= POWER_MIN_GAIN) {
      return ['sabotage', { zone: 'front', slot: bi }];
    }
  }

  // Camouflage: shield our most valuable revealed front card under threat.
  if (avail.includes('camouflage')) {
    let threatened = null;
    let ti = null;
    for (let i = 0; i < ownFront.length; i++) {
      const c = ownFront[i];
      if (!c || !c.faceUp || c.camouflaged) continue;
      const doomed = oppFront.some((t) => t && t.faceUp && getResult(t.def.id, c.def.id) === 'WIN');
      if (doomed) {
        if (threatened === null || futureValue(c.def.id) > futureValue(threatened.def.id)) {
          threatened = c; ti = i;
        }
      }
    }
    if (threatened !== null && futureValue(threatened.def.id) >= POWER_MIN_GAIN) {
      return ['camouflage', { zone: 'front', slot: ti }];
    }
  }

  // Rapid Support: bring a capture-eligible unit from hand into Reserve when
  // we have none on the field.
  if (avail.includes('rapid_support') && eligibleCount(state, player) === 0) {
    let bestIdx = null;
    let bestVal = -1.0;
    for (let i = 0; i < (hand || []).length; i++) {
      const c = hand[i];
      if (isCaptureEligible(state.activeIsland, c.def.id)) {
        const v = futureValue(c.def.id);
        if (v > bestVal) { bestIdx = i; bestVal = v; }
      }
    }
    if (bestIdx !== null && ownReserve.some((c) => c === null)) {
      return ['rapid_support', { hand_idx: bestIdx }];
    }
  }

  // Scouting: reveal two enemy Reserve cards -- only when Reserve is what we
  // are about to have to attack into.
  if (avail.includes('scouting') && !oppFront.some(Boolean)) {
    const hidden = [];
    for (let i = 0; i < oppReserve.length; i++) {
      if (oppReserve[i] && !oppReserve[i].faceUp) hidden.push(i);
    }
    if (hidden.length >= 2) return ['scouting', { slot1: hidden[0], slot2: hidden[1] }];
  }

  // Radar: reveal one enemy FRONT card, but only when attacking blind.
  if (avail.includes('radar')) {
    const hidden = [];
    for (let i = 0; i < oppFront.length; i++) {
      if (oppFront[i] && !oppFront[i].faceUp) hidden.push(i);
    }
    const knownWin = oppFront.some((c) => c && c.faceUp
      && ownFront.some((a) => a && a.def.id !== 'mine' && getResult(a.def.id, c.def.id) === 'WIN'));
    if (hidden.length && !knownWin) return ['radar', { slot: hidden[0] }];
  }

  // Maneuver: DANGEROUS. It pops a garrison unit into hand, and
  // retallyGarrisons then DROPS the island (losing a point) unless another
  // eligible unit is on the field. Only fire when a refill is guaranteed.
  // Maneuver is never worth firing -- see the matching comment in ai.py.
  // It spends a full turn to move a unit that round-end would return to
  // hand anyway, and risks draining the island for a point.

  return null;
}

// ---- Decision ----
// Pure decision function. Returns one of:
//   ['attack', atkSlot, defSlot] | ['promote', reserveSlot]
//   ['power', islandId, args]    | ['skip']
// Never reads a face-down enemy card's identity.
export function chooseAction(state, player, sabotaged, camouflaged) {
  const opp = player === 1 ? 2 : 1;
  const pool = unknownPool(state, opp);
  const eligibleNow = eligibleCount(state, player);
  const attacks = legalAttacks(state, player, sabotaged, camouflaged);

  const scored = [];
  for (const [ai, ti, zone, ac, tc] of attacks) {
    const s = scoreAttack(state, player, ac, tc, pool, eligibleNow);
    // Deterministic lexicographic tie-break -- no RNG, identical to ai.py.
    scored.push([-s, ai, ti, ZONE_RANK[zone], s]);
  }
  scored.sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]) || (a[2] - b[2]) || (a[3] - b[3]));

  const best = scored.length ? scored[0] : null;
  const bestScore = best ? best[4] : null;

  // AI_USES_POWERS is deliberately false: powers are applied in aiTurn()
  // (see the constant's comment), not here. Kept for ai.py parity only.
  if (AI_USES_POWERS) {
    const power = choosePower(state, player);
    if (power !== null && (best === null || bestScore < POWER_MIN_GAIN)) {
      return ['power', power[0], power[1]];
    }
  }

  const promote = choosePromotionSlot(state, player, sabotaged);
  if (best === null) {
    if (promote !== null) return ['promote', promote];
    return ['skip'];
  }

  if (promote !== null && bestScore < PROMOTE_SCORE) return ['promote', promote];

  // NEVER skip while a legal attack exists: canAct() counts any face-down
  // target as actionable, so skipping on negative expectation would stall
  // the round forever (the deadlock detector never fires).
  return ['attack', best[1], best[2]];
}

export function choosePromotionSlot(state, player, sabotaged) {
  const ownFront = player === 1 ? state.p1Front : state.p2Front;
  const ownReserve = player === 1 ? state.p1Reserve : state.p2Reserve;
  if (!ownReserve.some((c, i) => c && ownFront[i] === null)) return null;
  const opp = player === 1 ? 2 : 1;
  const oppFront = opp === 1 ? state.p1Front : state.p2Front;
  const visible = oppFront.filter((c) => c && c.faceUp);

  let bestI = null;
  let bestV = null;
  for (let i = 0; i < ownReserve.length; i++) {
    const c = ownReserve[i];
    if (!c || (sabotaged && sabotaged.has(c))) continue;
    // Vertical promotion only: the front slot ahead must be free.
    if (ownFront[i] !== null) continue;
    let v = 0.0;
    // A Mine on the Front cannot attack; only promote one as a last resort.
    if (c.def.id === 'mine') v -= 5.0;
    for (const t of visible) {
      const res = getResult(c.def.id, t.def.id);
      if (res === 'WIN') v += SCORE_WIN;
      else if (res === 'LOSS') v -= 1.0;
    }
    v += futureValue(c.def.id) * 0.25;
    if (bestV === null || v > bestV) { bestI = i; bestV = v; }
  }
  return bestI;
}

// Pick the garrison unit for the won island: keep the best front, spend the
// unit with the least future value. Returns [slot, zone].
// Registered with game.js at the bottom of this file (setCaptureChooser), so
// executeIslandCapture() uses this instead of its first-eligible scan.
export function chooseCapture(state, player) {
  const island = state.activeIsland;
  const zones = [
    ['reserve', player === 1 ? state.p1Reserve : state.p2Reserve],
    ['front', player === 1 ? state.p1Front : state.p2Front],
  ];
  let best = null;
  for (const [zoneName, zone] of zones) {
    for (let i = 0; i < zone.length; i++) {
      const c = zone[i];
      if (!c || !isCaptureEligible(island, c.def.id)) continue;
      const key = [futureValue(c.def.id), ZONE_RANK[zoneName], i];
      if (best === null || key[0] < best[0][0]
        || (key[0] === best[0][0] && key[1] < best[0][1])
        || (key[0] === best[0][0] && key[1] === best[0][1] && key[2] < best[0][2])) {
        best = [key, i, zoneName];
      }
    }
  }
  if (best === null) return null;
  return [best[1], best[2]];
}

// ---- Deployment ----
// Front gets the strongest attackers; Reserve keeps the cheap
// CAPTURE-ELIGIBLE units so a round win converts into an island point.
// NOTE: landing_craft is NOT capture-eligible, so it is not a reserve-keeper.
export function chooseDeployment(state, player) {
  const hand = player === 1 ? state.p1Hand : state.p2Hand;
  const deckSet = [...new Set(DECK_IDS)];

  function frontValue(c) {
    if (c.def.id === 'mine') return 2.0;
    const wins = deckSet.filter((o) => getResult(c.def.id, o) === 'WIN').length;
    const losses = deckSet.filter((o) => getResult(o, c.def.id) === 'WIN').length;
    return wins * 1.0 - losses * 0.5 + CARDS[c.def.id].strength * 0.1;
  }

  const idx = hand.map((_, i) => i);
  idx.sort((a, b) => (frontValue(hand[b]) - frontValue(hand[a])) || (a - b));

  const eligible = idx.filter((i) => isCaptureEligible(state.activeIsland, hand[i].def.id));
  eligible.sort((a, b) => (futureValue(hand[a].def.id) - futureValue(hand[b].def.id)) || (a - b));
  const keepers = eligible.slice(0, 2);

  const frontIdx = [];
  const reserveIdx = [];
  for (const i of idx) {
    if (keepers.includes(i) && reserveIdx.length < RESERVE_SIZE) reserveIdx.push(i);
    else if (frontIdx.length < FRONT_SIZE) frontIdx.push(i);
    else if (reserveIdx.length < RESERVE_SIZE) reserveIdx.push(i);
  }
  return [frontIdx, reserveIdx];
}

// Place this player's cards for the PREP phase, mirroring ai.py's ai_deploy.
export function aiDeploy(state, player) {
  const [frontIdx, reserveIdx] = chooseDeployment(state, player);
  const hand = player === 1 ? state.p1Hand : state.p2Hand;
  const front = player === 1 ? state.p1Front : state.p2Front;
  const reserve = player === 1 ? state.p1Reserve : state.p2Reserve;
  const frontCards = frontIdx.map((i) => hand[i]);
  const reserveCards = reserveIdx.map((i) => hand[i]);

  const take = (card) => {
    const i = hand.indexOf(card);
    if (i !== -1) hand.splice(i, 1);
  };
  frontCards.slice(0, FRONT_SIZE).forEach((card, slot) => {
    take(card);
    card.slot = slot;
    card.faceUp = false;
    front[slot] = card;
  });
  reserveCards.slice(0, RESERVE_SIZE).forEach((card, slot) => {
    take(card);
    card.slot = slot;
    card.faceUp = false;
    reserve[slot] = card;
  });
}

// ---- Application ----
// Return shape: { msg, atkCard?, defCard?, atkSurvived?, defSurvived? }.
// app.js's doAiTurn() uses atkCard/defCard to play the lunge+impact animation.
export async function aiTurn(state) {
  if (!state || state.turnOwner !== 2) return { msg: '' };

  // Snapshot the one-turn marks this AI turn must respect. NO LONGER CLEARED
  // here: game.js owns expiry on every path out of this turn -- an attack or
  // promotion hands control to P1, whose next action calls
  // expireOpponentTurnEffects(); a power calls usePower(), whose nextTurn()
  // runs expireTurnEffects(state, 2); and if the action ends the round,
  // executeIslandCapture() clears both flags on every hand/discard card.
  // The snapshot itself stays -- chooseAction() needs the sets.
  const sabotaged = new Set();
  for (const c of [...state.p2Front, ...state.p2Reserve]) {
    if (c && c.sabotaged) sabotaged.add(c);
  }

  const camouflaged = new Set();
  for (const c of [...state.p1Front, ...state.p1Reserve]) {
    if (c && c.camouflaged) camouflaged.add(c);
  }

  // Island powers first: usePower() ends the AI's turn by itself (its own
  // nextTurn()), so this is a complete turn -- return rather than falling
  // through to the attack decision, which would act with turnOwner already
  // handed back to P1.
  const power = choosePower(state, 2);
  if (power !== null) {
    const res = usePower(state, power[0], power[1], 2);
    if (res && res.ok) {
      const powerMsg = `AI: ${res.msg}`;
      state.lastAction = powerMsg;
      const powerEnd = checkRoundEnd(state);
      return { msg: powerEnd ? `${powerMsg}\n${powerEnd}` : powerMsg };
    }
    // A refused power (bad args, already used) must not cost the AI its
    // turn -- fall through to the normal attack/promote/skip decision.
  }

  const decision = chooseAction(state, 2, sabotaged, camouflaged);
  const kind = decision[0];

  if (kind === 'promote') {
    const ri = decision[1];
    const card = state.p2Reserve[ri];
    const empty = ri; // straight ahead, chosen free by choosePromotionSlot
    state.p2Reserve[ri] = null;
    card.slot = empty;
    state.p2Front[empty] = card;
    state.turnOwner = 1;
    const msg = 'AI moves a card from reserve to front';
    state.combatLog.push(msg);
    state.lastAction = msg;
    const end = checkRoundEnd(state);
    return { msg: end ? `${msg}\n${end}` : msg };
  }

  if (kind === 'skip') {
    // No passing (owner ruling 2026-09-16): with no legal move the AI
    // yields the round. checkRoundEnd sees turnOwner === 2 and awards it.
    const end = checkRoundEnd(state);
    if (end) return { msg: end };
    state.turnOwner = 1;
    return { msg: '' };
  }

  const [, aiSlot, targetSlot] = decision;
  const atk = state.p2Front[aiSlot];
  const dfn = state.p1Front.some(Boolean) ? state.p1Front[targetSlot] : state.p1Reserve[targetSlot];

  const { msg } = resolveAttack(state, atk, dfn, 2, 1);
  const fullMsg = `AI: ${msg}`;
  state.turnOwner = 1;
  state.lastAction = fullMsg;

  const end = checkRoundEnd(state);
  const atkSurvived = state.p2Front.includes(atk) || state.p2Reserve.includes(atk);
  const defSurvived = state.p1Front.includes(dfn) || state.p1Reserve.includes(dfn);
  return { msg: end ? `${fullMsg}\n${end}` : fullMsg, atkCard: atk, defCard: dfn, atkSurvived, defSurvived };
}

// Close divergence (3): let the rules engine apply this file's chooseCapture()
// when it garrisons an island for the AI. Registered once at import scope, so
// it survives createGameState() (which would wipe a per-state hook).
setCaptureChooser(chooseCapture);
