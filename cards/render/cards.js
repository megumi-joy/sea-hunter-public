// MTG-Arena-style unit card renderer -- markup only, no game logic.
//
// Phase P1 "Cards". Everything visual about a *unit* card lives here and in
// cards.css; ui.js keeps owning game state, animations and event wiring and
// only calls into decorate()/faceHtml()/backHtml().
//
// Why a separate module rather than editing ui.js/style.css in place: the
// scene/layout pass runs in parallel on another branch and owns index.html
// and style.css, so the card visuals are kept in files that branch never
// touches.
//
// Contract with ui.js (do not break these without checking ui.js):
//   * The root element keeps its `.card` class, `data-uid` and `data-card-id`
//     -- the FLIP fly animation (recordRectsBeforeWipe/flyNewlyEnteredCards),
//     the hand fan (applyHandHover) and findCardEl() all key off them.
//   * Face-down roots keep `.face-down`.
//   * flipCard() copies only innerHTML from a freshly built face-up element
//     onto the live one, so nothing that distinguishes face-up from face-down
//     may live on the root beyond `.face-down`, and every root class we add
//     must be derivable from the card def alone (decorate() does both faces).
//   * We add `.unit-card`, a `.role-*` class and (P10) a `.tier-*` class.
//     Every rule in cards.css is
//     scoped to `.card.unit-card` so island/artifact cards (`.card.island-card`,
//     `.card.artifact-card`, index.html's #active-island) keep style.css's
//     looks untouched.

import { ART, ART_BACK } from './art.js';

// ---- Illustrated art (P11) -------------------------------------------
// render/art/<id>.svg is a painted illustration per unit -- gradients, a
// blurred contact shadow, three water planes. It CANNOT be inlined the way
// art.js's art is (see that file's header: one art string is inlined once
// per dealt card, so <defs>+id would collide), so it is loaded through an
// <img>, which makes each file its own document and its ids private.
//
// The inline art.js SVG stays underneath as the placeholder: it is already
// in the markup, costs no request, and paints the right silhouette in the
// right colours while the file arrives. The <img> simply covers it once
// decoded -- no load handler, no layout shift, and a failed request leaves
// the placeholder showing rather than a broken-image box.
//
// import.meta.url rather than a relative string: this module is imported
// from index.html (../) and from render/gallery.html (./), and a literal
// './art/x.svg' would resolve against the *document*, not this file.
const ART_EXT = '.svg';
export function artUrl(id) {
  return new URL('./art/' + id + ART_EXT, import.meta.url).href;
}

// Which subjects actually have an illustrated file. Anything not listed
// (the legacy island powers, anything added later) keeps the inline SVG
// alone rather than requesting a 404 per card.
export const ART_FILES = new Set([
  'sea_hunter', 'patrol_ship', 'destroyer', 'cruiser', 'battleship',
  'coastal_artillery', 'submarine', 'landing_craft', 'mine', 'plane',
]);

function artImg(id) {
  if (!ART_FILES.has(id)) return '';
  // loading="lazy" keeps the 14 dealt cards from all requesting at once on
  // a slow link; decoding="async" keeps a decode off the animation frame
  // that flips a card.
  return `<img class="uc-img" src="${artUrl(id)}" alt="" aria-hidden="true"`
    + ` loading="lazy" decoding="async" draggable="false">`;
}

// Role drives the frame colour. Grouped the way the impact matrix actually
// behaves rather than by hull type: the two "you cannot see me coming" units
// (mine, submarine) share a frame, shore batteries get their own, air its own.
export const ROLE = {
  sea_hunter: 'ship',
  patrol_ship: 'ship',
  destroyer: 'ship',
  cruiser: 'ship',
  battleship: 'ship',
  landing_craft: 'ship',
  plane: 'air',
  coastal_artillery: 'shore',
  submarine: 'depth',
  mine: 'depth',
};

export function roleOf(cardId) {
  return ROLE[cardId] || 'ship';
}

// ---- Icon language (P11) ---------------------------------------------
// The review's second complaint after flat art was that a card's stats are
// typography, not iconography -- an MTGA card tells you what it is before
// you read a word. Two marks do that here:
//
//   * the strength badge is an anchor-shield: the shield silhouette is the
//     clip-path in cards.css, the anchor is a watermark inside it, and the
//     digit sits over both.
//   * a role glyph sits immediately before the name. ROLE above collapses
//     mine and submarine into one frame tint ('depth') because they share
//     an impact profile, but a player must still tell a mine from a sub at
//     a glance, so the glyph splits them back out.
//
// Both are inline SVG with NO id/url(#...) -- they are inlined once per
// dealt card, exactly like art.js's art, so the same rule applies.
export function glyphOf(cardId) {
  if (cardId === 'mine') return 'mine';
  if (cardId === 'submarine') return 'sub';
  const r = roleOf(cardId);
  return r === 'depth' ? 'sub' : r;
}

const GLYPH = {
  // Ship: hull plus a mast. Reads at 7px because it is one closed shape.
  ship: '<path d="M2 9h12l-2 4H4z" fill="currentColor"/>'
    + '<path d="M7.4 9V3h1.2v6z" fill="currentColor"/>'
    + '<path d="M9 3.4l4 1.6-4 1.6z" fill="currentColor"/>',
  // Air: a swept delta, nose up.
  air: '<path d="M8 1l1.6 7L15 10v1.6l-5.4-1.4-.4 3 1.8 1.4V15H7l-2 .4v-.4l1.8-1.4-.4-3L1 11.6V10l5.4-2z" fill="currentColor"/>',
  // Shore: a headland with a barrel over it.
  shore: '<path d="M1 14h14l-4-6H5z" fill="currentColor"/>'
    + '<path d="M5 8h6v-3H5z" fill="currentColor"/>'
    + '<path d="M9 4.6h6v1.6H9z" fill="currentColor"/>',
  // Sub: a hull below a waterline, with a conning tower.
  sub: '<path d="M0 3.4c3 0 3 1.4 6 1.4s3-1.4 6-1.4 3 1.4 4 1.4V2.6H0z" fill="currentColor" opacity="0.7"/>'
    + '<ellipse cx="8" cy="11" rx="7" ry="3" fill="currentColor"/>'
    + '<path d="M7 8h3V6H7z" fill="currentColor"/>',
  // Mine: a sphere with horns.
  mine: '<circle cx="8" cy="9" r="4.6" fill="currentColor"/>'
    + '<path d="M8 4.4V1M2.6 9H0M13.4 9H16M4.4 5.4L2.6 3.6M11.6 5.4l1.8-1.8M4.4 12.6l-1.8 1.8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
};

export function glyphHtml(cardId) {
  const key = glyphOf(cardId);
  return `<svg class="uc-glyph uc-glyph-${key}" viewBox="0 0 16 16" aria-hidden="true" focusable="false">${GLYPH[key] || GLYPH.ship}</svg>`;
}

// The anchor watermark inside the strength shield. Deliberately low
// contrast: it is the badge's texture, not a thing to read.
const BADGE_ANCHOR =
  '<svg class="uc-badge-mark" viewBox="0 0 16 16" aria-hidden="true" focusable="false">'
  + '<g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">'
  + '<circle cx="8" cy="3.4" r="1.6"/><path d="M8 5v8M5 7.4h6"/>'
  + '<path d="M3.6 9.6c0 3 2 4.6 4.4 4.6s4.4-1.6 4.4-4.6"/></g></svg>';

// ---- Short display names (P9) ---------------------------------------
// cards.js and islands.js are the game's data tables and are read-only to
// this pass, so the display-only abbreviations live here. They exist because
// "Coastal Artillery" cannot be set at a legible size inside an 84px-wide
// nameplate without either ellipsizing or dropping below the 8px floor -- at
// 412px the P8 build printed "Coastal Arti", "Sea Hunt" and "Landing C".
//
// Rule for picking one: keep the word a player would say out loud. Never an
// initialism (cards.js already has `abbr` for that, and "CA" tells a new
// player nothing).
export const NAME_SHORT = {
  // Units
  sea_hunter: 'Sea Hunter',
  patrol_ship: 'Patrol',
  destroyer: 'Destroyer',
  cruiser: 'Cruiser',
  battleship: 'Battleship',
  coastal_artillery: 'Artillery',
  submarine: 'Sub',
  landing_craft: 'Landing',
  mine: 'Mine',
  plane: 'Plane',
  // Islands
  radar: 'Radar',
  maneuver: 'Maneuver',
  camouflage: 'Camo',
  two_island: 'Two-Island',
  rapid_support: 'Support',
  teleportation: 'Teleport',
  scouting: 'Scouting',
  secret_move: 'Secret',
  sabotage: 'Sabotage',
};

// Falls back to the full name, so an id with no entry (the four artifact-ish
// island powers, anything added later) still renders rather than blanking.
export function shortName(def) {
  if (!def) return '';
  return NAME_SHORT[def.id] || def.name || '';
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function artSvg(body) {
  return `<svg class="uc-svg" viewBox="0 0 60 45" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">${body}</svg>`;
}

// ---- Strength tiers (P10) -------------------------------------------
// A second, orthogonal read on the frame: role says WHAT a card is, tier
// says how heavy it hits. cards.js's strengths run 0..5, so three bands --
// 0-1 plain, 2-3 a silver inner line, 4-5 a gold inner line plus corner
// ornaments. Rarity framing, in the MTG sense, driven by the only number a
// unit card actually has.
//
// The class lands on the ROOT (so it survives flipCard()'s innerHTML-only
// swap and is derivable from the def alone, per the contract above), but
// every rule in cards.css hangs it off `.uc-inner:not(.uc-inner-back)` --
// a face-down card must not leak how strong it is, exactly as it must not
// leak its role.
export function tierOf(def) {
  const s = def && typeof def.strength === 'number' ? def.strength : 0;
  if (s >= 4) return 'gold';
  if (s >= 2) return 'silver';
  return 'plain';
}

// Root-element decoration. Called for BOTH faces with the same def so that
// flipCard()'s innerHTML-only swap lands on an already-correctly-framed root.
export function decorate(el, def) {
  el.classList.add('unit-card', 'role-' + roleOf(def && def.id),
    'tier-' + tierOf(def));
}

// Face-up inner markup: recessed art window on top, shield strength badge
// over it, and the nameplate bar with an optional ability line at the bottom.
//
// P9 also emitted a `.uc-spine` here -- the short name set vertically, for
// the ~22px strip a 14-card hand left each card. P10 removed it: the hand
// now caps its fan so every laid-out card has room for a horizontal name
// (see render/input.js), and nothing in this build sets type on its side.
//
// Two name spans, not one: the short name is what fits the nameplate, and
// the full name is swapped in by cards.css when the card is focused (hovered,
// pressed or dragged), which is the moment a player is actually reading it.
// Both are in the markup because flipCard() only ever copies innerHTML -- no
// JS may run between building the face and showing it.
export function faceHtml(def) {
  // P11: the keyword is a pill rather than a coloured line of text. At fan
  // size a bare word competes with the name for the same read; a filled
  // capsule is a different SHAPE, so the eye sorts the two without work.
  const ability = def.ability
    ? `<span class="uc-ability">${esc(def.ability.name)}</span>`
    : '';
  const short = shortName(def);
  return `<div class="uc-inner">
  <div class="uc-art">${artSvg(ART[def.id] || '')}${artImg(def.id)}</div>
  <div class="uc-badge">${BADGE_ANCHOR}<span>${esc(def.strength)}</span></div>
  <div class="uc-band"><span class="uc-nameline">${glyphHtml(def.id)}<span class="uc-name">${esc(short)}</span><span class="uc-name-full">${esc(def.name)}</span></span>${ability}</div>
</div>`;
}

export function backHtml() {
  return `<div class="uc-inner uc-inner-back">
  <div class="uc-art">${artSvg(ART_BACK)}</div>
</div>`;
}

export function titleFor(def) {
  if (!def) return '';
  return def.ability
    ? `${def.name} -- ${def.ability.name}: ${def.ability.desc}`
    : def.name;
}

// Standalone builder for call sites that are not ui.js's createCardEl (the
// reference-modal "big card" rows, the gallery). Returns a detached element.
export function buildCardEl(def, faceUp = true, extraClass = '') {
  const el = document.createElement('div');
  el.className = 'card' + (extraClass ? ' ' + extraClass : '');
  decorate(el, def);
  if (faceUp) {
    el.innerHTML = faceHtml(def);
    el.title = titleFor(def);
  } else {
    el.classList.add('face-down');
    el.innerHTML = backHtml();
  }
  return el;
}

// Small square art thumbnail -- used for the rules-matrix row/column headers,
// where a full card would never fit.
export function thumbHtml(def) {
  // Deliberately NOT the P11 illustration. These are ~20px in the rules
  // matrix, and at that size a painted illustration with a sky ramp, three
  // water planes and a blurred shadow is a blue smear -- the flat art.js
  // icon is the legible one. It also keeps the role-colour rim visible:
  // that rim is an inset box-shadow, which paints below child content, so
  // an <img> here would cover it (see tour_412x915_10_rules.png).
  return `<span class="uc-thumb role-${roleOf(def.id)}" title="${esc(def.name)}">${artSvg(ART[def.id] || '')}</span>`;
}
