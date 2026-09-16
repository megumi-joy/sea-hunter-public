// Per-island card art -- flat hypercasual SVG illustrations, one per island id
// in islands.js (ISLANDS plus the multiplayer-only LEGACY_ISLANDS, which can
// still arrive off the wire -- see that file's LEGACY_ISLANDS note).
//
// Constraints these were authored under (the same ones render/art.js states,
// for the same reasons -- keep them if you add or replace art):
//   * No <defs>, no id= and no url(#...) references. One island's art string
//     can be on screen three times at once (centre band card, captured chip,
//     enlarged card), so any id would collide and every reference would
//     resolve to the first copy.
//   * Flat fills only, 3 to 6 colours, chunky shapes, no text, no emoji.
//   * viewBox 0 0 120 60 -- 2:1 landscape, matching the island card's aspect.
//     Drawn with preserveAspectRatio slice, so the motif stays in the middle
//     band and nothing load-bearing touches the edges.
//   * Under 3 KB each -- islandArtBytes() below reports the live size.

const SKY = '#7fd4f5';
const SEA = '#1c6fa8';
const SEA_DEEP = '#0f4870';
const FOAM = '#bfe9ff';
const SAND = '#e8d59a';
const SAND_HI = '#f4e7bd';
const ROCK = '#8a99a8';
const PALM = '#3f9a5a';
const PALM_HI = '#57c076';
const METAL = '#2a3a4d';
const METAL_HI = '#41586f';
const DECK = '#e9eef4';
const WOOD = '#a9803f';
const WARN = '#f2b544';
const RED = '#e2564a';
const VIOLET = '#8d7bd6';
const NIGHT = '#233047';

// Shared backdrop: sky band, sea band, a foam line between them.
const BG =
  `<rect width="120" height="60" fill="${SKY}"/>` +
  `<path d="M0 34h120v26H0z" fill="${SEA}"/>` +
  `<path d="M0 34c8 0 8 3 16 3s8-3 16-3 8 3 16 3 8-3 16-3 8 3 16 3 8-3 16-3 8 3 16 3v-3H0z" fill="${FOAM}"/>`;

// The island body -- a sand dome sitting on the waterline, drawn at an x
// offset so each piece of art can push it left or right of its motif.
function isle(cx, w = 46, h = 17, fill = SAND) {
  const half = w / 2;
  return `<path d="M${cx - half} 46c0-${h} ${half * 0.55} -${h} ${half} -${h}s${half} 0 ${half} ${h}z" fill="${fill}"/>` +
    `<path d="M${cx - half + 5} 46c0-${h - 5} ${half * 0.5} -${h - 5} ${half - 5} -${h - 5}z" fill="${SAND_HI}"/>`;
}

function palm(x, y) {
  return `<rect x="${x - 1.5}" y="${y}" width="3" height="11" fill="${WOOD}"/>` +
    `<path d="M${x} ${y}c-9-1-13 3-13 6 4-4 9-4 13-2z" fill="${PALM}"/>` +
    `<path d="M${x} ${y}c9-1 13 3 13 6-4-4-9-4-13-2z" fill="${PALM_HI}"/>` +
    `<path d="M${x} ${y}c-2-8 2-11 5-12-3 4-3 8-2 12z" fill="${PALM}"/>`;
}

// Motifs. Each sits on top of BG + isle and says what the power does at a
// glance: a dish sweeping, a hull under tow, a hidden shape, and so on.
export const ISLAND_ART = {
  // Radar Station -- a dish on a mast with two sweep arcs.
  radar: BG + isle(78) + palm(96, 27) +
    `<rect x="32" y="22" width="6" height="24" fill="${METAL}"/>` +
    `<path d="M35 24c-11 0-19 8-19 17h9c0-5 4-9 10-9z" fill="${ROCK}"/>` +
    `<circle cx="35" cy="22" r="4" fill="${WARN}"/>` +
    `<path d="M41 16c7 2 12 8 13 15h-5c-1-5-4-9-9-11z" fill="${FOAM}"/>` +
    `<path d="M43 8c12 2 20 11 21 23h-5c-1-9-8-16-17-18z" fill="${FOAM}"/>`,

  // Camouflage -- the island painted in disruptive patches, a ship fading
  // out behind them.
  camouflage: BG + isle(60, 56, 19) +
    `<path d="M40 40h16v6H40z" fill="${PALM}"/>` +
    `<path d="M58 34h14v8H58z" fill="${NIGHT}"/>` +
    `<path d="M46 32h9v7h-9z" fill="${NIGHT}"/>` +
    `<path d="M62 44h18v3H62z" fill="${PALM_HI}"/>` +
    `<path d="M74 28h10v7H74z" fill="${PALM}"/>` +
    `<path d="M88 40h20l-4 8H92z" fill="${METAL}" opacity="0.45"/>` +
    `<rect x="94" y="33" width="9" height="7" fill="${METAL}" opacity="0.3"/>`,

  // Teleportation -- a spiral gate between two island stubs.
  teleportation: BG + isle(22, 34, 14) + isle(100, 34, 14) +
    `<circle cx="60" cy="30" r="19" fill="${VIOLET}"/>` +
    `<circle cx="60" cy="30" r="13" fill="${NIGHT}"/>` +
    `<circle cx="60" cy="30" r="7" fill="${VIOLET}"/>` +
    `<circle cx="60" cy="30" r="3" fill="${FOAM}"/>` +
    `<path d="M60 8l4 7h-8z" fill="${FOAM}"/>` +
    `<path d="M60 52l-4-7h8z" fill="${FOAM}"/>`,

  // Maneuver -- a hull pulling away from the island, bow pointed out.
  maneuver: BG + isle(30, 40, 16) + palm(30, 26) +
    `<path d="M62 38h44l-6 10H68z" fill="${METAL}"/>` +
    `<rect x="76" y="29" width="16" height="9" fill="${METAL_HI}"/>` +
    `<rect x="82" y="22" width="4" height="7" fill="${DECK}"/>` +
    `<path d="M44 40h18v3H44z" fill="${SAND_HI}"/>` +
    `<path d="M104 30l10 6-10 6z" fill="${WARN}"/>`,

  // Scouting -- a lookout tower throwing a wide cone of sight.
  scouting: BG + isle(40, 44, 17) +
    `<path d="M36 44l4-26h8l4 26z" fill="${METAL}"/>` +
    `<rect x="33" y="14" width="18" height="6" fill="${ROCK}"/>` +
    `<circle cx="42" cy="17" r="3" fill="${WARN}"/>` +
    `<path d="M54 15l50 8-50 12z" fill="${FOAM}" opacity="0.65"/>` +
    `<path d="M62 28h10v3H62z" fill="${SEA_DEEP}"/>` +
    `<path d="M82 24h12v3H82z" fill="${SEA_DEEP}"/>`,

  // Rapid Support -- a supply hull under a bolt, arriving fast.
  rapid_support: BG + isle(26, 34, 14) +
    `<path d="M74 20l-16 20h12l-6 16 20-22H72z" fill="${WARN}"/>` +
    `<path d="M50 40h54l-7 10H56z" fill="${METAL}"/>` +
    `<rect x="62" y="32" width="12" height="8" fill="${METAL_HI}"/>` +
    `<path d="M104 42l12 3-12 3z" fill="${FOAM}"/>`,

  // Secret Move -- three reserve crates with crossing arrows above them.
  secret_move: BG + isle(60, 60, 18) +
    `<rect x="36" y="34" width="14" height="12" fill="${METAL}"/>` +
    `<rect x="53" y="34" width="14" height="12" fill="${ROCK}"/>` +
    `<rect x="70" y="34" width="14" height="12" fill="${METAL}"/>` +
    `<path d="M40 28h34l-5-5h9l8 7-8 7h-9l5-5H40z" fill="${WARN}"/>` +
    `<path d="M80 18H46l5-5h-9l-8 7 8 7h9l-5-5h34z" fill="${FOAM}"/>`,

  // Sabotage -- a blade struck through a hull plate.
  sabotage: BG + isle(28, 34, 14) +
    `<path d="M56 34h44l-6 12H62z" fill="${METAL}"/>` +
    `<path d="M92 8l8 6-34 32-10 3 3-10z" fill="${ROCK}"/>` +
    `<path d="M92 8l8 6-5 5-8-6z" fill="${WARN}"/>` +
    `<path d="M62 42l8-8 5 4-8 8z" fill="${RED}"/>` +
    `<path d="M74 22l5 3-5 3-2-3z" fill="${RED}"/>`,

  // Two-Island -- two domes under one flag, for the two points it pays.
  two_island: BG + isle(34, 42, 18) + isle(88, 42, 18) + palm(34, 24) + palm(88, 24) +
    `<rect x="58" y="18" width="3" height="26" fill="${METAL}"/>` +
    `<path d="M61 18h16l-4 6 4 6H61z" fill="${WARN}"/>` +
    `<path d="M44 46h32v4H44z" fill="${SEA_DEEP}" opacity="0.4"/>`,

  // ---- multiplayer-only legacy ids (islands.js LEGACY_ISLANDS) ----
  logistics: BG + isle(60, 56, 18) +
    `<rect x="40" y="30" width="18" height="16" fill="${WOOD}"/>` +
    `<rect x="62" y="34" width="18" height="12" fill="${METAL}"/>` +
    `<path d="M40 30h18v4H40z" fill="${WARN}"/>` +
    `<path d="M84 26h22l-4 8H84z" fill="${ROCK}"/>`,

  fog: BG + isle(60, 50, 16, '#b9c6d3') +
    `<path d="M14 26h40v6H14z" fill="${FOAM}" opacity="0.85"/>` +
    `<path d="M34 36h58v6H34z" fill="${FOAM}" opacity="0.8"/>` +
    `<path d="M22 44h52v5H22z" fill="${FOAM}" opacity="0.7"/>` +
    `<path d="M62 18h38v6H62z" fill="${FOAM}" opacity="0.6"/>`,

  recovery: BG + isle(60, 50, 18) +
    `<rect x="52" y="22" width="16" height="24" fill="${DECK}"/>` +
    `<rect x="44" y="30" width="32" height="8" fill="${DECK}"/>` +
    `<rect x="55" y="25" width="10" height="18" fill="${RED}"/>` +
    `<rect x="47" y="31" width="26" height="6" fill="${RED}"/>`,

  spy: BG + isle(60, 50, 18) +
    `<circle cx="60" cy="26" r="11" fill="${NIGHT}"/>` +
    `<path d="M44 30h32v5H44z" fill="${METAL}"/>` +
    `<circle cx="55" cy="25" r="3" fill="${FOAM}"/>` +
    `<circle cx="65" cy="25" r="3" fill="${FOAM}"/>` +
    `<path d="M40 44h40v3H40z" fill="${SAND_HI}"/>`,
};

// A plain island, for any id that reaches the renderer without art (a
// server-side island set this client does not know yet -- the exact failure
// LEGACY_ISLANDS exists to prevent, one level further out).
export const ISLAND_ART_FALLBACK = BG + isle(60, 52, 19) + palm(60, 25);

export function islandArt(islandId) {
  return ISLAND_ART[islandId] || ISLAND_ART_FALLBACK;
}

// Byte size of one island's art string, for the 3 KB budget above.
export function islandArtBytes(islandId) {
  return new TextEncoder().encode(islandArt(islandId)).length;
}
