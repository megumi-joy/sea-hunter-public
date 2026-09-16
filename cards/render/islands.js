// MTG-Arena-style island renderer -- phase P4 "Islands and results".
//
// Owns every island visual: the landscape card on the centre band, the
// captured-island chips in the player/opponent strips, the enlarged card a
// tap opens, and the capture ceremony that flies the card from the band into
// the winner's row.
//
// ui.js keeps owning game state and the click semantics; its renderIslands()
// is now a one-line forward into render() below, with the same three
// arguments and the same contract:
//
//   * every root keeps `.card.island-card` plus `.mine` / `.used`, and the
//     maneuver targeting pass keeps `.target-highlight` -- style.css:548-554
//     and app.js's handleIslandClick() both key off those.
//   * `maneuverTargetIds` (a non-null array) switches the player's row from
//     "tap to use a power" to "tap to pick which held island to un-garrison":
//     every listed id becomes a highlighted target, everything else goes
//     inert. See the long note above ui.js's renderIslands().
//   * the power button on an enlarged card calls the SAME handleIslandClick
//     closure the row taps call, with the same usability predicate, so there
//     is exactly one path into a power.
//
// Nothing here renders def.emoji any more -- the art is island_art.js.

import { getIslandDef } from '../islands.js';
import { islandArt } from './island_art.js';
import { shortName } from './cards.js';
import * as Screens from './screens.js';
// P5 "Sound and haptics".
import * as Audio from './audio.js';

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function artSvg(islandId) {
  return `<svg class="ic-svg" viewBox="0 0 120 60" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">${islandArt(islandId)}</svg>`;
}

// ---- Illustrated art (P11) -------------------------------------------
// Same arrangement as the unit cards (see render/cards.js's ART_FILES note):
// a painted render/art/<id>.svg loaded through an <img> over the inline
// island_art.js SVG, which stays as the placeholder and as the whole art
// when the "Card art" setting is off.
//
// Only the nine islands in ISLANDS have a file. The four LEGACY_ISLANDS can
// still arrive off the wire and keep the inline art alone, rather than
// firing a 404 per chip.
const ART_FILES = new Set([
  'radar', 'camouflage', 'teleportation', 'maneuver', 'scouting',
  'rapid_support', 'secret_move', 'sabotage', 'two_island',
]);

function artImg(islandId) {
  if (!ART_FILES.has(islandId)) return '';
  const href = new URL('./art/' + islandId + '.svg', import.meta.url).href;
  return `<img class="ic-img" src="${href}" alt="" aria-hidden="true"`
    + ` loading="lazy" decoding="async" draggable="false">`;
}

// Two-Island is the one island with no active power (islands.js), so it is
// never a power target -- only ever a maneuver (un-garrison) target.
const PASSIVE = 'two_island';

// Would a tap on this island fire its power right now? Mirrors ui.js's old
// per-branch wiring exactly, in one predicate, so the row chip and the
// enlarged card's button can never disagree about it.
export function powerUsable(state, islandId) {
  if (!state || islandId === PASSIVE) return false;
  if (state.phase !== 'COMBAT' || state.turnOwner !== 1) return false;
  return !((state.p1PowersUsed || []).includes(islandId));
}

// The garrison unit's strength, for the chip badge. Locally the garrison map
// holds a live card ({ def, faceUp, ... } -- game.js); the multiplayer server
// ships its own shape through multiplayer.js's adaptState, which does not
// re-wrap it, so accept a bare { strength } too and show nothing if neither
// is there rather than printing "undefined" on the chip.
function garrisonStrength(state, islandId, mine) {
  const map = (mine ? state.p1IslandGarrison : state.p2IslandGarrison) || {};
  const g = map[islandId];
  if (!g) return null;
  const s = g.def ? g.def.strength : g.strength;
  return (s === 0 || s) ? s : null;
}

// ---- markup ---------------------------------------------------------

// The landscape 2:1 card. `variant` is 'active' (centre band), 'chip' (a
// captured-island row) or 'big' (the enlarged overlay). The card is the art
// and nothing else -- the one-line power text is a sibling node
// (openIslandDetail below), because .ic-card is overflow:hidden on a fixed
// 2:1 aspect ratio and anything placed inside it is clipped away.
function cardHtml(def, variant, opts = {}) {
  const badge = opts.strength == null ? ''
    : `<span class="ic-garrison" title="Garrison strength">${esc(opts.strength)}</span>`;
  // The used state is a desaturation plus a check mark -- see islands.css.
  const used = opts.used
    ? '<span class="ic-used" aria-label="Power spent">' +
      '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">' +
      '<path d="M3 8.5l3.2 3.2L13 5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>' +
      '</svg></span>'
    : '';
  // P9 fix 3: the short display name from render/cards.js. "Teleportation"
  // and "Radar Station" both ellipsized in the 116px centre-band card and in
  // the 52px captured chip; the full name stays on the element's title and in
  // the detail panel, which is where it is actually read.
  const name = variant === 'chip' ? ''
    : `<div class="ic-band"><span class="ic-name">${esc(shortName(def) || def.abbr)}</span></div>`;
  return `<div class="ic-inner">
  <div class="ic-art">${artSvg(def.id)}${artImg(def.id)}</div>
  ${badge}${used}${name}
</div>`;
}

// Builds one island element. Exported so the ceremony can clone a card
// without going through a full render.
export function buildIslandEl(def, variant, opts = {}) {
  const el = document.createElement('div');
  el.className = 'card island-card ic-card ic-' + variant
    + (opts.mine ? ' mine' : '') + (opts.used ? ' used' : '');
  el.dataset.islandId = def.id;
  const descPart = def.desc ? ` -- ${def.desc}` : '';
  el.title = def.name + descPart + (opts.used ? ' (power spent)' : '');
  el.innerHTML = cardHtml(def, variant, opts);
  return el;
}

// ---- the enlarged card overlay --------------------------------------
//
// Tapping the centre-band card or any captured chip opens this. It is
// mounted inside `.stage` on purpose: the stage is `overflow: hidden`, so a
// popover appended to <body> would be the one element allowed to escape the
// phone-shaped frame on desktop.

function stageEl() {
  return document.querySelector('#game-screen .stage') || document.body;
}

export function closeIslandDetail() {
  const open = document.getElementById('island-detail');
  if (open) open.remove();
}

// Owner 2026-09-16: "tap the number to see the card" stays, made clearer.
// A captured chip (the one with the garrison number) and the contested band
// card answer the press itself with a short 1.06 scale, 120 ms, before the
// enlarged card opens -- so the tap visibly registers on the small target.
// Web Animations with `composite: 'add'`, so it stacks on any transform the
// element already has instead of replacing it.
function pressPulse(el) {
  if (!el || typeof el.animate !== 'function') return;
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  el.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.06)' }, { transform: 'scale(1)' }],
    { duration: 120, easing: 'ease-out', composite: 'add' });
}

function wirePress(el) {
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== undefined && e.button > 0) return;
    pressPulse(el);
  });
}

// A double tap on a chip is the same request as a single tap -- see the
// card -- so the second tap, which lands on the scrim the first one just
// opened, must not close it again.
const DOUBLE_TAP_GUARD_MS = 350;

export function openIslandDetail(state, islandId, handleIslandClick) {
  const def = getIslandDef(islandId);
  if (!def) return;
  closeIslandDetail();
  const openedAt = Date.now();
  const wrap = document.createElement('div');
  wrap.id = 'island-detail';
  wrap.className = 'island-detail';
  const used = (state.p1PowersUsed || []).includes(islandId);
  const mine = (state.p1Islands || []).includes(islandId);
  const card = buildIslandEl(def, 'big', {
    mine,
    used: mine && used,
    strength: mine ? garrisonStrength(state, islandId, true) : null,
  });
  const panel = document.createElement('div');
  panel.className = 'island-detail-panel';
  panel.appendChild(card);
  if (def.desc) {
    const desc = document.createElement('p');
    desc.className = 'ic-desc';
    desc.textContent = def.desc;
    panel.appendChild(desc);
  }

  const actions = document.createElement('div');
  actions.className = 'island-detail-actions';
  if (mine && handleIslandClick && powerUsable(state, islandId)) {
    const btn = document.createElement('button');
    btn.className = 'btn-primary ic-use';
    btn.textContent = 'Use power';
    // Same entry point as a row tap -- app.js's handleIslandClick owns all
    // the per-power targeting, so this button adds no second code path.
    btn.addEventListener('click', () => { closeIslandDetail(); handleIslandClick(islandId); });
    actions.appendChild(btn);
  } else if (mine && used) {
    const note = document.createElement('span');
    note.className = 'ic-note';
    note.textContent = 'Power already spent.';
    actions.appendChild(note);
  } else if (islandId === PASSIVE) {
    const note = document.createElement('span');
    note.className = 'ic-note';
    note.textContent = 'Passive -- worth 2 points while held.';
    actions.appendChild(note);
  }
  const close = document.createElement('button');
  close.className = 'btn-secondary ic-close';
  close.textContent = 'Close';
  close.addEventListener('click', closeIslandDetail);
  actions.appendChild(close);
  panel.appendChild(actions);
  wrap.appendChild(panel);
  // Tapping the scrim (but not the panel) closes.
  wrap.addEventListener('click', (e) => {
    if (e.target === wrap && Date.now() - openedAt > DOUBLE_TAP_GUARD_MS) closeIslandDetail();
  });
  stageEl().appendChild(wrap);
}

// ---- the capture ceremony -------------------------------------------
//
// Fires once per captured island, from render() below, when the round-over
// diff says the active island just moved into somebody's row. The card is
// cloned (never the live node -- the rows rebuild on every render), pinned
// at the rect the centre band occupied a moment ago, and flown to the chip
// that has just landed. First keyframe is already visible, per fx.js's
// note: a headless capture with a frozen animation clock still sees it.

const REDUCED = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function flyCapture(def, fromRect, toEl, onDone) {
  const done = typeof onDone === 'function' ? onDone : () => {};
  if (!def || !fromRect || !toEl || !toEl.isConnected) { done(); return; }
  // The ceremony is the only place an island is ever seen changing hands, so
  // it is the only place the cue belongs -- and it plays for either side's
  // capture, because it is the round's headline either way.
  Audio.cue('island_capture');
  const to = toEl.getBoundingClientRect();
  if (!to.width || !fromRect.width) { done(); return; }
  const ghost = buildIslandEl(def, 'active', {});
  ghost.classList.add('ic-ghost');
  ghost.style.left = fromRect.left + 'px';
  ghost.style.top = fromRect.top + 'px';
  ghost.style.width = fromRect.width + 'px';
  ghost.style.height = fromRect.height + 'px';
  document.body.appendChild(ghost);
  toEl.classList.add('ic-landing');

  const dx = (to.left + to.width / 2) - (fromRect.left + fromRect.width / 2);
  const dy = (to.top + to.height / 2) - (fromRect.top + fromRect.height / 2);
  const scale = Math.max(0.2, to.width / fromRect.width);
  const ms = REDUCED() ? 140 : 620;
  const frames = REDUCED()
    ? [{ opacity: 1 }, { opacity: 0 }]
    : [
      { transform: 'translate(0px, 0px) scale(1)', opacity: 1, filter: 'brightness(1.6)' },
      { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - 18}px) scale(${(1 + scale) / 2})`, opacity: 1, filter: 'brightness(1.2)', offset: 0.55 },
      { transform: `translate(${dx}px, ${dy}px) scale(${scale})`, opacity: 0.1, filter: 'brightness(1)' },
    ];
  let anim = null;
  try { anim = ghost.animate(frames, { duration: ms, easing: 'cubic-bezier(0.3, 0.9, 0.3, 1)', fill: 'forwards' }); } catch (e) { /* no WAAPI */ }
  // setTimeout, not anim.finished: under a headless capture the animation
  // clock does not advance but timers do, so this is the one clock that
  // always releases the ghost (same reasoning as fx.js's after()).
  const finish = () => {
    if (anim) { try { anim.cancel(); } catch (e) { /* already done */ } }
    ghost.remove();
    toEl.classList.remove('ic-landing');
    toEl.classList.add('ic-landed');
    setTimeout(() => toEl.classList.remove('ic-landed'), 600);
    done();
  };
  setTimeout(finish, ms);
}

// ---- the render pass ------------------------------------------------

function wireChip(el, state, islandId, handleIslandClick, maneuverTargetIds, mine) {
  const isUsed = mine && (state.p1PowersUsed || []).includes(islandId);
  wirePress(el);
  if (!mine) {
    // Opponent chips are informational: tapping still enlarges the card (so
    // the player can read a power that is about to be used on them), but
    // never offers a button -- openIslandDetail's `mine` check sees to that.
    el.addEventListener('click', () => openIslandDetail(state, islandId, null));
    return;
  }
  if (maneuverTargetIds) {
    if (maneuverTargetIds.includes(islandId)) {
      el.classList.add('target-highlight');
      el.addEventListener('click', () => handleIslandClick(islandId));
    } else {
      el.classList.add('ic-inert');
    }
    return;
  }
  // Normal wiring: a tap opens the enlarged card, and the power is fired
  // from its button. Keeps one tap target per chip whatever the phase --
  // the chips are 2:1 and small, and a tap that silently does nothing
  // (wrong phase, spent power) was the worst part of the old row.
  el.addEventListener('click', () => openIslandDetail(state, islandId, handleIslandClick));
  if (powerUsable(state, islandId)) el.classList.add('ic-ready');
  else if (isUsed) el.classList.add('ic-inert');
}

export function render(state, handleIslandClick, maneuverTargetIds = null) {
  if (!state) return;

  // Snapshot the previous pass BEFORE any DOM is touched: the centre band
  // still shows the island that was contested, and screens.js needs its
  // rect to fly it. Skipped during a maneuver re-render, which is a partial
  // repaint of one row inside a turn, not a new board state.
  const prev = maneuverTargetIds ? null : Screens.takeSnapshot(state);
  const bandCard = document.getElementById('active-island-card');
  const fromRect = (prev && bandCard && !bandCard.closest('.hidden'))
    ? bandCard.getBoundingClientRect() : null;

  const deckContainer = document.getElementById('island-deck-container');
  const deckCount = document.getElementById('island-deck-count');
  if (state.islandDeck && state.islandDeck.length > 0) {
    if (deckContainer) deckContainer.classList.remove('hidden');
    if (deckCount) deckCount.textContent = state.islandDeck.length;
  } else {
    if (deckContainer) deckContainer.classList.add('hidden');
  }

  // ---- centre band: the contested island, as a landscape card ----
  const activeIslandContainer = document.getElementById('active-island-container');
  if (state.activeIsland) {
    if (activeIslandContainer) activeIslandContainer.classList.remove('hidden');
    const def = getIslandDef(state.activeIsland);
    if (def && bandCard) {
      bandCard.className = 'card island-card ic-card ic-active active';
      bandCard.dataset.islandId = def.id;
      bandCard.title = def.name + (def.desc ? ` -- ${def.desc}` : '');
      bandCard.innerHTML = cardHtml(def, 'active', {});
      if (!bandCard.dataset.wired) {
        bandCard.dataset.wired = '1';
        wirePress(bandCard);
        // The contested island is nobody's yet, so this is read-only: it
        // expands to show the one-line power text and nothing else.
        bandCard.addEventListener('click', () => {
          openIslandDetail(stateOf(bandCard), bandCard.dataset.islandId, null);
        });
      }
    }
  } else {
    if (activeIslandContainer) activeIslandContainer.classList.add('hidden');
  }
  // The band card is wired once and persists across renders, so the click
  // closure must read the CURRENT state rather than the one captured when it
  // was wired. render() stashes it on the element each pass.
  if (bandCard) bandCard._state = state;

  // ---- captured rows ----
  const rows = [
    { id: 'player-islands', ids: state.p1Islands || [], mine: true },
    { id: 'opp-islands', ids: state.p2Islands || [], mine: false },
  ];
  let landedEl = null;
  rows.forEach(({ id, ids, mine }) => {
    const container = document.getElementById(id);
    if (!container) return;
    container.innerHTML = '';
    ids.forEach((islandId) => {
      const def = getIslandDef(islandId);
      if (!def) return;
      const used = mine
        ? (state.p1PowersUsed || []).includes(islandId)
        : (state.p2PowersUsed || []).includes(islandId);
      const el = buildIslandEl(def, 'chip', {
        mine,
        used,
        strength: garrisonStrength(state, islandId, mine),
      });
      wireChip(el, state, islandId, handleIslandClick, mine ? maneuverTargetIds : null, mine);
      container.appendChild(el);
      if (prev && prev.activeIsland === islandId && !prev.held.includes(islandId)) landedEl = el;
    });
  });

  // An island the player no longer holds cannot have an enlarged card open
  // over the board (it would offer a power for an island that just drained).
  const openDetail = document.getElementById('island-detail');
  if (openDetail) {
    const openId = openDetail.querySelector('.ic-card') && openDetail.querySelector('.ic-card').dataset.islandId;
    const stillThere = openId === state.activeIsland
      || (state.p1Islands || []).includes(openId) || (state.p2Islands || []).includes(openId);
    if (!stillThere) closeIslandDetail();
  }

  if (prev) Screens.roundObserved(state, prev, { fromRect, landedEl });
}

// Reads the state render() stashed on the band card (see the note there).
function stateOf(el) { return el && el._state; }
