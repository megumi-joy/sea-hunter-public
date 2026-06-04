// AI opponent — mirrors src/games/sea_hunter/ai.py
import { IMPACT, getResult } from './cards.js';
import { ZONE_SIZE, moveReserveToFront, resolveAttack, removeCard } from './game.js';

export function aiTurn(state) {
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
