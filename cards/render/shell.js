// Shell screens (phase P7) -- markup helpers for everything OUTSIDE the
// match: the menu, campaign chart, online join, settings, rules, trading
// post, leaderboard and profile.
//
// Same split as the rest of render/: this module only builds strings and
// elements. ui.js keeps the state, the event wiring and the exported
// function names app.js calls, so nothing here changes an element id or a
// handler name -- app.js is untouched by P7.
//
// Constraints (the P7 pass exists to enforce them):
//   * No emoji anywhere. Every glyph is inline monoline SVG from icons.js
//     or a small avatar set defined below, or plain text.
//   * No <defs>, no id=, no url(#...) -- the same markup is inlined many
//     times per screen (twelve avatar discs, twenty island nodes), so ids
//     would collide exactly the way render/art.js's header warns about.
//   * Colours come from the P0 tokens in style.css's :root
//     (--sea-gradient / --surface / --ink / --accent-warm / --radius /
//     --shadow-soft); render/shell.css is the only stylesheet involved.

import { icon } from '../icons.js';
import { islandArt, ISLAND_ART } from './island_art.js';

// ---- Title logo ------------------------------------------------------
// The wave from icons.js redrawn at title scale: three crests instead of
// two, filled rather than hairline, so it holds up next to a 40px title
// where the 24px chrome icon would vanish. Deliberately its own art and
// not `icon('wave')` scaled up -- a 1.7px stroke blown up 3x reads as a
// thin scratch.
export function waveLogo(size = 64, className = 'shell-logo') {
  return `<svg class="${className}" width="${size}" height="${size}" viewBox="0 0 64 64" aria-hidden="true" focusable="false">`
    + '<path d="M4 40c6-7 12-7 18 0s12 7 18 0 12-7 18 0v8c-6-7-12-7-18 0s-12 7-18 0-12-7-18 0z" fill="#bfe9ff"/>'
    + '<path d="M4 50c6-7 12-7 18 0s12 7 18 0 12-7 18 0v8H4z" fill="#1b6ca8"/>'
    + '<path d="M40 12c8 0 14 6 14 14 0 5-3 9-7 11-2-6-8-9-14-8 1-9 3-14 7-17z" fill="#3d93c7"/>'
    + '<circle cx="45" cy="22" r="3" fill="#f4efe6"/>'
    + '</svg>';
}

// ---- Avatars ---------------------------------------------------------
// profile.js's AVATARS table still carries an `emoji` field (it is the
// persisted identity, and rewriting it would invalidate every stored
// profile and every leaderboard row already on the server). P7 therefore
// maps avatar id -> inline SVG here and never renders that field.
// Anything unmapped falls back to the first letter of the id, which is
// still an honest, emoji-free disc.
const AVATAR_ICON = {
  anchor: '<path d="M12 6v14M8 10h8M9 15c0 3 1.5 4 3 4s3-1 3-4" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="4.5" r="2" stroke="currentColor" fill="none" stroke-width="2"/>',
  wheel: '<circle cx="12" cy="12" r="6" stroke="currentColor" fill="none" stroke-width="2"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5M5 5l3.5 3.5M15.5 15.5L19 19M19 5l-3.5 3.5M8.5 15.5L5 19" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  kraken: '<circle cx="12" cy="9" r="5" stroke="currentColor" fill="none" stroke-width="2"/><path d="M7 13c-1 4 0 6-2 8M10 14c-1 4-1 6-3 7M14 14c1 4 1 6 3 7M17 13c1 4 0 6 2 8" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round"/>',
  shark: '<path d="M12 3l3 8h-6z" fill="currentColor"/><path d="M2 16c4-4 8-5 12-5s6 2 8 5c-4 3-8 4-12 4s-6-2-8-4z" stroke="currentColor" fill="none" stroke-width="2" stroke-linejoin="round"/>',
  parrot: '<path d="M14 4a6 6 0 0 1 0 12c-3 3-6 3-8 4 2-4 2-8 2-11a5 5 0 0 1 6-5z" stroke="currentColor" fill="none" stroke-width="2" stroke-linejoin="round"/><path d="M18 8l3 2-3 2" stroke="currentColor" fill="none" stroke-width="2" stroke-linejoin="round"/>',
  skull: '<path d="M12 3a7 7 0 0 0-7 7c0 3 1.5 4.5 2 6h10c.5-1.5 2-3 2-6a7 7 0 0 0-7-7z" stroke="currentColor" fill="none" stroke-width="2" stroke-linejoin="round"/><circle cx="9.5" cy="10.5" r="1.4" fill="currentColor"/><circle cx="14.5" cy="10.5" r="1.4" fill="currentColor"/>',
  compass: '<circle cx="12" cy="12" r="8" stroke="currentColor" fill="none" stroke-width="2"/><path d="M15.5 8.5l-2.2 6.8-4.8-2.2z" fill="currentColor"/>',
  wave: '<path d="M2 11c2-2.5 4-2.5 6 0s4 2.5 6 0 4-2.5 6 0" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round"/><path d="M2 17c2-2.5 4-2.5 6 0s4 2.5 6 0 4-2.5 6 0" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round"/>',
  lighthouse: '<path d="M9 9h6l2 12H7z" stroke="currentColor" fill="none" stroke-width="2" stroke-linejoin="round"/><path d="M9 9V6h6v3" stroke="currentColor" fill="none" stroke-width="2"/><path d="M12 6V3M16 5l4-2M8 5L4 3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  gull: '<path d="M2 14c3 0 5-2 6-4 1 2 2 3 4 3s3-1 4-3c1 2 3 4 6 4" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  crown: '<path d="M4 18l-1-11 5 4 4-7 4 7 5-4-1 11z" stroke="currentColor" fill="none" stroke-width="2" stroke-linejoin="round"/>',
  cannon: '<path d="M3 16l12-6 3 5-12 6z" stroke="currentColor" fill="none" stroke-width="2" stroke-linejoin="round"/><path d="M18 8l3-3M20 12l3-1M15 5l1-3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
};

// `size` is the modifier class the old emoji discs already used ('small',
// 'big' or ''), kept so ui.js's call sites and shell.css agree.
export function avatarDisc(avatar, size = '') {
  if (!avatar) return '';
  const body = AVATAR_ICON[avatar.id];
  // P13: the illustrated avatar fills more of the disc than the line glyph
  // did -- it carries its own contact shadow, so it wants the room.
  const px = size === 'big' ? 52 : size === 'small' ? 20 : 26;
  const art = itemImg('avatar_' + avatar.id, px, 'avatar-art item-art');
  const inner = art || (body
    ? `<svg width="${px}" height="${px}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${body}</svg>`
    : `<span class="avatar-initial">${String(avatar.id || '?').charAt(0).toUpperCase()}</span>`);
  return `<span class="avatar-disc ${size}" style="background:${avatar.color}">${inner}</span>`;
}

// ---- Campaign chart --------------------------------------------------
// Mission ids are 1..N and carry no island id of their own (see
// voyage.js), so each node borrows a piece of island art by index. The
// cycle is stable for a given mission list, which is all the chart needs:
// node 3 always looks like node 3.
const ART_IDS = Object.keys(ISLAND_ART);

export function islandNodeHtml(level, { unlocked, cleared }) {
  const artId = ART_IDS[(level.id - 1) % ART_IDS.length];
  // preserveAspectRatio slice, so the 2:1 art fills the round node with no
  // letterboxing; shell.css clips it with border-radius rather than a
  // clipPath, which would need an id (see the header note).
  const art = `<svg class="island-art" viewBox="0 0 120 60" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">${islandArt(artId)}</svg>`;
  const badge = cleared
    ? `<span class="island-badge cleared">${icon('check', { size: 14 })}</span>`
    : unlocked ? '' : `<span class="island-badge locked">${icon('lock', { size: 14 })}</span>`;
  return `<span class="island-shape">${art}<span class="island-num">${level.id}</span>${badge}</span>`;
}

// The name and blurb of the island you are about to sail to. P6's chart put
// them in absolutely-positioned labels hanging off the node, which clipped
// against the left and top edges of the chart for any node near a corner
// (see tour_412x915_02_campaign.png). A fixed caption strip under the chart
// cannot clip, whatever the node coordinates are.
export function mapCaptionHtml(level, { cleared } = {}) {
  if (!level) return '';
  return `<span class="cap-title">${level.id}. ${escapeHtml(level.name)}</span>`
    + `<span class="cap-note">${cleared ? 'Cleared' : escapeHtml(level.blurb || '')}</span>`;
}

// ---- Settings --------------------------------------------------------
// The checkbox stays a real <input type="checkbox" data-setting-key> --
// ui.js's renderSettings binds its change listener to exactly that
// selector, and app.js routes the key onward. shell.css hides the native
// box and paints the sibling .switch instead, so the row is a chunky
// toggle without any new event plumbing.
export function toggleRowHtml({ key, label, desc, checked }) {
  return `
    <label class="settings-row">
      <input type="checkbox" data-setting-key="${key}" ${checked ? 'checked' : ''}>
      <span class="switch" aria-hidden="true"><span class="knob"></span></span>
      <span class="settings-text"><strong>${label}</strong><span>${desc}</span></span>
    </label>`;
}

// ---- Item art (P9 fix 4, P13 fix 4) --------------------------------------
// P9 replaced the shop's monoline glyphs with flat filled drawings
// inlined here. P13 replaces those in turn with illustrated SVGs in the
// card art's style -- one key light from the top-left, a dark base with the
// mid tone offset over it, a highlight on the lit edge and a contact shadow
// -- generated by tools/gen_sea_hunter_items.py into render/art/items/.
// They are separate files loaded through <img> for the same reason the card
// art is (render/cards.js): each is its own document, so the offset mid
// tone can <use> its base path by id without ids colliding across the page.
// Every item, rank and avatar the three screens show has a file; anything
// else falls back to the icons.js glyph.
const ITEM_IDS = new Set([
  'spyglass', 'spare_parts', 'smoke_bomb', 'kraken_bait', 'lucky_compass',
  'coin_gold', 'coin_crystal', 'rank_1', 'rank_2', 'rank_3',
  'avatar_anchor', 'avatar_wheel', 'avatar_kraken', 'avatar_shark', 'avatar_parrot',
  'avatar_skull', 'avatar_compass', 'avatar_wave', 'avatar_lighthouse', 'avatar_gull',
  'avatar_crown', 'avatar_cannon',
]);

// import.meta.url, not a relative string: a relative src resolves against
// the PAGE, and this module is imported from pages at different depths.
function itemUrl(id) {
  return new URL(`./art/items/${id}.svg`, import.meta.url).href;
}

export function itemImg(id, size, className = 'item-art') {
  if (!ITEM_IDS.has(id)) return '';
  return `<img class="${className}" src="${itemUrl(id)}" width="${size}" height="${size}"`
    + ' alt="" draggable="false" decoding="async">';
}

export function artifactArt(id, size = 40) {
  return itemImg(id, size, 'shop-art item-art') || icon(id, { size });
}

// ---- Trading post ----------------------------------------------------
export function coinRowHtml(balance) {
  return `<span class="coin coin-gold">${itemImg('coin_gold', 20)}${balance.gold} gold</span>`
    + `<span class="coin coin-crystal">${itemImg('coin_crystal', 20)}${balance.crystals} crystals</span>`;
}

export function shopCardHtml({ id, def, price }) {
  const isCrystal = price.crystals !== undefined;
  const priceText = isCrystal ? `${price.crystals} crystals` : `${price.gold} gold`;
  // The price is a chip, not a coloured word: it is the one number in the
  // row a player compares against their balance, and the two currencies
  // have to be told apart at a glance rather than read.
  return `
    <div class="shop-face">${artifactArt(id, 40)}</div>
    <div class="shop-body">
      <div class="version-title">${def.name}</div>
      <div class="version-desc">${def.desc}</div>
      <div class="shop-price ${isCrystal ? 'is-crystal' : 'is-gold'}">
        ${itemImg(isCrystal ? 'coin_crystal' : 'coin_gold', 16)}<span>${priceText}</span>
      </div>
    </div>`;
}

export function holdChipHtml(id, def, n) {
  return `<span class="hold-chip">${artifactArt(id, 18)}${escapeHtml(def ? def.name : id)}${n > 1 ? ` x${n}` : ''}</span>`;
}

// ---- Leaderboard -----------------------------------------------------
// A list of surface cards rather than a <table>: the table needed three
// fixed columns and clipped long nicknames on a 412px phone.
export function lbRowHtml(rank, name, score, avatar) {
  const medal = rank <= 3 ? ` rank-${rank}` : '';
  return `
    <div class="lb-row${medal}">
      <span class="lb-rank">${rank <= 3 ? itemImg('rank_' + rank, 22) : rank}</span>
      ${avatar ? avatarDisc(avatar, 'small') : ''}
      <span class="lb-name">${escapeHtml(String(name))}</span>
      <span class="lb-score">${score}</span>
    </div>`;
}

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s == null ? '' : s;
  return div.innerHTML;
}
