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
export const ISLANDS = [
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
export function islandSVG(island, size = 'small') {
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
export function createIslandState() {
  const shuffled = [...ISLANDS].sort(() => Math.random() - 0.5);
  return {
    neutral: shuffled.slice(0, 3).map(isl => ({ ...isl, garrison: null, activated: false })),
    p1: [],   // captured by player
    p2: [],   // captured by AI
  };
}

// Reset activations at round start
export function resetIslandActivations(islandState) {
  [...islandState.neutral, ...islandState.p1, ...islandState.p2]
    .forEach(isl => { isl.activated = false; });
}

// Which unit types can capture/garrison an island -- ships and the one air
// unit. Matches the canon web build's CAPTURE_ELIGIBLE list exactly (see
// www/games/sea-hunter-cards/game.js, verified there against the
// authoritative Godot source) -- Landing Craft, Coastal Artillery, and Mine
// (the 0-strength/defensive units) cannot capture or garrison an island.
export const CAPTURE_ELIGIBLE = ['battleship', 'cruiser', 'destroyer', 'patrol_ship', 'sea_hunter', 'plane', 'submarine'];

// Does `player` have ANY unit on the field eligible to capture an island
// with? Used to auto-skip the island-capture opportunity when the round's
// winner has nothing that qualifies (Mine/Landing Craft/Coastal Artillery
// survivors only) -- mirrors the canon web build's hasEligibleCapturer().
export function hasEligibleCapturer(state, player) {
  const front = player === 1 ? state.p1Front : state.p2Front;
  const reserve = player === 1 ? state.p1Reserve : state.p2Reserve;
  return [...front, ...reserve].some(c => c && CAPTURE_ELIGIBLE.includes(c.def.id));
}

// Apply island ability
export function activateIsland(islandState, island, state, player, targetIslandId) {
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
export function captureIsland(islandState, islandId, state, player, slot, zone) {
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
export function retallyGarrisons(islandState, state, player) {
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
export function recomputeScore(state, islandState) {
  state.score[0] = islandState.p1.length;
  state.score[1] = islandState.p2.length;
}
