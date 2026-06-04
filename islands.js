// Islands — definitions, SVG generators, and game mechanics
// Mechanic: island deck, capture, activate ability (1/turn, reset each round)

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

// Apply island ability
export function activateIsland(islandState, island, state, player) {
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
export function captureIsland(islandState, islandId, state, player) {
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
