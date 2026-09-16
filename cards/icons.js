// Inline nautical icon set -- presentation only, no game data/logic here.
//
// Replaces emoji glyphs everywhere in the UI (project rule: no emoji in
// code/UI). Monoline SVG, viewBox 0 0 24 24, uses currentColor so CSS
// `color` drives the tint per call site. Card *type* icons are deliberately
// a small shared set (plane / vessel / submarine / mine) rather than ten
// bespoke ship illustrations -- card identity comes from the accent-color
// frame + abbreviation + strength badge (see style.css's
// `.card[data-card-id="..."]` rules), so the icon budget here goes to the
// things that actually need to be told apart at a glance: islands,
// artifacts, and chrome (menu/HUD/modal glyphs).

const RAW = {
  // ── Card-type icons (shared across the 10 card ids -- see CARD_TYPE_ICON) ──
  plane: '<path d="M3 12L20 4l-6 17-3-7-8-2z" stroke="currentColor" fill="none" stroke-width="1.4" stroke-linejoin="round"/>',
  vessel: '<path d="M4 15h16l-2.5 5h-11L4 15z" stroke="currentColor" fill="none" stroke-width="1.4" stroke-linejoin="round"/><path d="M7 15V8h10v7" stroke="currentColor" fill="none" stroke-width="1.4"/><path d="M12 8V3" stroke="currentColor" stroke-width="1.4"/>',
  submarine: '<ellipse cx="11" cy="14" rx="8" ry="4" stroke="currentColor" fill="none" stroke-width="1.4"/><path d="M11 10V5M9 5h4" stroke="currentColor" stroke-width="1.4"/><circle cx="7" cy="14" r="1" fill="currentColor"/>',
  mine: '<circle cx="12" cy="13" r="5" stroke="currentColor" fill="none" stroke-width="1.5"/><path d="M12 3v3M12 20v2M2 13h3M19 13h3M5 6l2 2M17 18l2 2M19 6l-2 2M7 18l-2 2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',

  // ── Islands ──
  radar: '<circle cx="12" cy="12" r="8" stroke="currentColor" fill="none" stroke-width="1.4"/><path d="M12 12L12 5A7 7 0 0 1 19 12z" fill="currentColor" opacity="0.35"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/>',
  camouflage: '<path d="M5 9c2-3 6-3 8-1s5 1 6 3-2 5-5 4-4 2-7 0-4-4-2-6z" fill="currentColor" opacity="0.4"/><path d="M9 15c1-2 4-2 5-4" stroke="currentColor" stroke-width="1.3" fill="none"/>',
  teleportation: '<circle cx="12" cy="12" r="7" stroke="currentColor" fill="none" stroke-width="1.5"/><path d="M12 5a7 7 0 0 1 4.9 11.9" stroke="currentColor" fill="none" stroke-width="1.5" stroke-linecap="round"/><circle cx="12" cy="12" r="2" fill="currentColor"/>',
  maneuver: '<path d="M5 15h14l-2 4H7l-2-4z" stroke="currentColor" fill="none" stroke-width="1.4" stroke-linejoin="round"/><path d="M8 15V9h8v6" stroke="currentColor" fill="none" stroke-width="1.3"/><path d="M12 9V4" stroke="currentColor" stroke-width="1.3"/><path d="M15 5l3 2-3 2" stroke="currentColor" fill="none" stroke-width="1.2" stroke-linejoin="round"/>',
  scouting: '<path d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6-10-6-10-6z" stroke="currentColor" fill="none" stroke-width="1.4" stroke-linejoin="round"/><circle cx="12" cy="12" r="3" stroke="currentColor" fill="none" stroke-width="1.4"/>',
  rapid_support: '<path d="M13 2L4 14h6l-1 8 9-12h-6l1-8z" fill="currentColor"/>',
  secret_move: '<path d="M3 7h5l4 10h6M3 17h5l1.5-3.75M14 7h6M17 4l3 3-3 3M17 14l3 3-3 3" stroke="currentColor" fill="none" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>',
  sabotage: '<path d="M6 18L17 7l2 2L8 20l-3 1z" stroke="currentColor" fill="none" stroke-width="1.4" stroke-linejoin="round"/><path d="M14 6l4 4" stroke="currentColor" stroke-width="1.4"/>',
  two_island: '<path d="M2 16c1.5-2.5 3.5-3 6-3s3.5 1.5 5 1 3-2 5-1 4 2 4 2" stroke="currentColor" fill="none" stroke-width="1.4" stroke-linecap="round"/><path d="M6 13l1.5-4 1.5 3M15 12l1.5-3 1.5 2.5" stroke="currentColor" fill="none" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>',

  // ── Artifacts ──
  spyglass: '<path d="M4 12l14-4 2 6-14 4z" stroke="currentColor" fill="none" stroke-width="1.4" stroke-linejoin="round"/><circle cx="5.5" cy="12.7" r="1.4" fill="currentColor"/>',
  spare_parts: '<circle cx="12" cy="12" r="3" stroke="currentColor" fill="none" stroke-width="1.4"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>',
  smoke_bomb: '<circle cx="12" cy="13" r="5" stroke="currentColor" fill="none" stroke-width="1.4"/><path d="M9 4c1 1 0 2-1 3M14 3c1 1.5-1 2.5-1 4" stroke="currentColor" fill="none" stroke-width="1.3" stroke-linecap="round"/>',
  kraken_bait: '<path d="M6 20c-2-4 0-7 2-9M10 20c-2-5 1-9 3-11M14 20c-1-6 2-10 5-11" stroke="currentColor" fill="none" stroke-width="1.4" stroke-linecap="round"/>',
  lucky_compass: '<circle cx="12" cy="12" r="8" stroke="currentColor" fill="none" stroke-width="1.4"/><path d="M15 9l-2 6-4-2z" fill="currentColor"/>',

  // ── Chrome ──
  wave: '<path d="M2 15c2-2 4-2 6 0s4 2 6 0 4-2 6 0" stroke="currentColor" fill="none" stroke-width="1.7" stroke-linecap="round"/><path d="M2 19c2-2 4-2 6 0s4 2 6 0 4-2 6 0" stroke="currentColor" fill="none" stroke-width="1.7" stroke-linecap="round" opacity="0.5"/>',
  book: '<path d="M4 5c2-1 5-1 8 1 3-2 6-2 8-1v13c-2-1-5-1-8 1-3-2-6-2-8-1V5z" stroke="currentColor" fill="none" stroke-width="1.5" stroke-linejoin="round"/><path d="M12 6v13" stroke="currentColor" stroke-width="1.3"/>',
  pause: '<rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor"/><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor"/>',
  close: '<path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  trophy: '<path d="M7 4h10v3a5 5 0 0 1-5 5 5 5 0 0 1-5-5V4z" stroke="currentColor" fill="none" stroke-width="1.5"/><path d="M7 5H4a3 3 0 0 0 3 4M17 5h3a3 3 0 0 1-3 4" stroke="currentColor" fill="none" stroke-width="1.5"/><path d="M12 12v3M9 20h6M10 17h4v3h-4z" stroke="currentColor" fill="none" stroke-width="1.5" stroke-linejoin="round"/>',
  skull: '<path d="M12 3a7 7 0 0 0-7 7c0 3 1.5 4.5 2 6h10c.5-1.5 2-3 2-6a7 7 0 0 0-7-7z" stroke="currentColor" fill="none" stroke-width="1.5" stroke-linejoin="round"/><circle cx="9.5" cy="10.5" r="1.3" fill="currentColor"/><circle cx="14.5" cy="10.5" r="1.3" fill="currentColor"/><path d="M9 16v2M12 16v2.5M15 16v2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
  scales: '<path d="M12 3v18M6 7l-4 5h8l-4-5zM18 7l-4 5h8l-4-5z" stroke="currentColor" fill="none" stroke-width="1.4" stroke-linejoin="round"/><path d="M4 17c0 1.5 1.5 2 2.5 2S9 18.5 9 17M15 17c0 1.5 1.5 2 2.5 2s2.5-.5 2.5-2" stroke="currentColor" fill="none" stroke-width="1.4"/>',
  lock: '<rect x="5" y="10" width="14" height="10" rx="2" stroke="currentColor" fill="none" stroke-width="1.5"/><path d="M8 10V7a4 4 0 0 1 8 0v3" stroke="currentColor" fill="none" stroke-width="1.5"/>',
  island: '<path d="M3 17c2-3 4-4 9-4s7 1 9 4" stroke="currentColor" fill="none" stroke-width="1.5" stroke-linecap="round"/><path d="M8 13l2-6 2 4 2-5 2 7" stroke="currentColor" fill="none" stroke-width="1.3" stroke-linejoin="round" stroke-linecap="round"/>',
  check: '<path d="M4 13l5 5L20 6" stroke="currentColor" fill="none" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>',
  cross: '<path d="M6 6l12 12M18 6L6 18" stroke="currentColor" fill="none" stroke-width="2.4" stroke-linecap="round"/>',
};

// Card ids -> shared type icon (see comment above).
export const CARD_TYPE_ICON = {
  plane: 'plane',
  coastal_artillery: 'vessel',
  battleship: 'vessel',
  cruiser: 'vessel',
  destroyer: 'vessel',
  patrol_ship: 'vessel',
  sea_hunter: 'vessel',
  landing_craft: 'vessel',
  submarine: 'submarine',
  mine: 'mine',
};

export function icon(name, opts = {}) {
  const body = RAW[name];
  if (!body) return '';
  const size = opts.size || 20;
  const cls = opts.className ? ` class="${opts.className}"` : '';
  return `<svg${cls} width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${body}</svg>`;
}

export function cardTypeIcon(cardId, opts = {}) {
  return icon(CARD_TYPE_ICON[cardId] || 'vessel', opts);
}
