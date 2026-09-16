// Artifacts -- collectible, usable items layered on top of the base game.
//
// Design: each artifact is a portable, single-use echo of something an
// island power already does (see islands.js), so the mechanic stays coherent
// with the existing rules instead of inventing a parallel system. Artifacts
// live in `state.p1Artifacts` / `state.p2Artifacts` (arrays of artifact ids,
// duplicates allowed) and are consumed on use.
//
// Acquisition: every successful island capture has a chance to also drop one
// random artifact for the capturing player (see grantArtifactOnCapture(),
// called from game.js's executeIslandCapture -- additive, wrapped so a bug
// here can never break island capture itself). The drop chance and pool are
// intentionally simple constants so they're easy to retune later.

export const ARTIFACT_DROP_CHANCE = 0.5; // tunable: odds an island capture also drops an artifact

export const ARTIFACTS = {
  spyglass: {
    id: 'spyglass', name: 'Spyglass', emoji: '🔭',
    desc: 'Reveal one face-down enemy card, any time on your turn.',
    needsTarget: 'enemy-card',
  },
  spare_parts: {
    id: 'spare_parts', name: 'Spare Parts', emoji: '🔧',
    desc: 'Return your most recently destroyed card from the graveyard to hand.',
    needsTarget: null,
  },
  smoke_bomb: {
    id: 'smoke_bomb', name: 'Smoke Bomb', emoji: '💨',
    desc: 'Shield: negates the next attack made against you.',
    needsTarget: null,
  },
  kraken_bait: {
    id: 'kraken_bait', name: 'Kraken Bait', emoji: '🐙',
    desc: "Force the opponent to skip their next turn.",
    needsTarget: null,
  },
  lucky_compass: {
    id: 'lucky_compass', name: 'Lucky Compass', emoji: '🧭',
    desc: 'Your next attack this turn always destroys its target.',
    needsTarget: null,
  },
};

export const ARTIFACT_IDS = Object.keys(ARTIFACTS);

function rand(n) { return Math.floor(Math.random() * n); }

// Called from game.js after a successful island capture. `player` is 1 or 2.
// Never throws -- worst case it silently grants nothing.
export function grantArtifactOnCapture(state, player) {
  try {
    if (!state || (player !== 1 && player !== 2)) return null;
    if (Math.random() > ARTIFACT_DROP_CHANCE) return null;
    const id = ARTIFACT_IDS[rand(ARTIFACT_IDS.length)];
    const bag = player === 1 ? (state.p1Artifacts ||= []) : (state.p2Artifacts ||= []);
    bag.push(id);
    return id;
  } catch (e) {
    return null;
  }
}

// Apply an artifact's effect. Mirrors the shape of usePower() in game.js:
// returns { ok, msg }. Consumes one instance of the artifact from the
// player's bag on success. `player` is always 1 here -- the AI does not use
// artifacts (kept simple; AI artifact use is a natural follow-up, not core
// to this pass).
export function useArtifact(state, artifactId, args = {}) {
  if (!state) return { ok: false, msg: 'No active game' };
  // Artifacts are layered on top of the base rules, so they must obey the same
  // phase/turn gate every island power obeys (game.js's usePower): combat
  // phase, on your own turn. Without this an artifact was usable during PREP,
  // during ISLAND_CAPTURE, on the opponent's turn, and even after GAME_OVER --
  // e.g. Spyglass could read the enemy fleet in PREP before combat began, and
  // Lucky Compass could be armed out of turn. This is the only place artifacts
  // broke the rules; smoke_bomb's shield and lucky_compass's forced WIN are
  // deliberate, documented effects that resolve through the normal attack path.
  // 'COMBAT' is compared as a literal rather than importing PHASE from game.js:
  // game.js already imports this module, and a back-import would make that pair
  // circular for no benefit (PHASE.COMBAT is the string 'COMBAT').
  if (state.phase !== 'COMBAT') return { ok: false, msg: 'Artifacts can only be used during combat!' };
  if (state.turnOwner !== 1) return { ok: false, msg: 'Not your turn!' };
  const bag = state.p1Artifacts || [];
  const idx = bag.indexOf(artifactId);
  if (idx === -1) return { ok: false, msg: "You don't have that artifact" };
  const def = ARTIFACTS[artifactId];
  if (!def) return { ok: false, msg: 'Unknown artifact' };

  let msg = '';
  if (artifactId === 'spyglass') {
    const slot = args.slot ?? 0;
    const zone = args.zone === 'reserve' ? state.p2Reserve : state.p2Front;
    const target = zone[slot];
    if (!target) return { ok: false, msg: 'No target for Spyglass' };
    target.faceUp = true;
    msg = `Spyglass reveals: ${target.def.name}!`;
  } else if (artifactId === 'spare_parts') {
    if (!state.p1Discard.length) return { ok: false, msg: 'Graveyard is empty' };
    const c = state.p1Discard.pop();
    state.p1Hand.push(c);
    msg = `Spare Parts: ${c.def.emoji} ${c.def.name} returns to hand!`;
  } else if (artifactId === 'smoke_bomb') {
    state.p1Shielded = true;
    msg = 'Smoke Bomb: the next attack made against you will be negated!';
  } else if (artifactId === 'kraken_bait') {
    state.skipTurnP2 = true;
    msg = "Kraken Bait: the opponent's next turn will be skipped!";
  } else if (artifactId === 'lucky_compass') {
    state.p1LuckyAttack = true;
    msg = 'Lucky Compass: your next attack is guaranteed to destroy its target!';
  } else {
    return { ok: false, msg: 'Artifact has no effect' };
  }

  bag.splice(idx, 1);
  state.combatLog.push(msg);
  state.lastAction = msg;
  return { ok: true, msg };
}
