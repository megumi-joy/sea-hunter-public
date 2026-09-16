// Per-unit card art -- flat hypercasual SVG illustrations, one per canonical
// unit id in cards.js's CARDS table.
//
// Constraints these were authored under (keep them if you add/replace art):
//   * No <defs>, no id= and no url(#...) references. The same art string is
//     inlined once per card element, so ids would collide across the 14 dealt
//     cards and browsers would resolve every reference to the first copy.
//   * Flat fills only, chunky shapes, no text, no emoji. Depth is built from
//     STACKED translucent flats (see the P10 note below), never a gradient.
//   * viewBox 0 0 60 45 (4:3 landscape -- the art window is the top ~60% of a
//     3:4 card), preserveAspectRatio slice so it always fills the window with
//     no letterboxing at any --slot-w.
//   * Under 4 KB each (see render/gallery.html, which prints live byte sizes).
//
// P9 "Art-director pass": the SKY is no longer painted here. A flat sky rect
// cannot carry the horizon gradient and the sun glow the surface art needs,
// and an SVG gradient would need <defs>+id, which the rule above forbids. So
// cards.css paints sky-glow + sea fallback as the art window's background and
// the surface backdrops below start AT the horizon, leaving everything above
// it transparent. The two are never seam-visible: the SVG sea is opaque and
// drawn downwards from its own horizon, so any mismatch only shows slightly
// more of the CSS sky.
//
// P10 "Depth": the P9 art was correct but flat -- a hull sitting ON a blue
// field rather than IN water. Four things were added, and each one is a
// helper below rather than hand-drawn per unit so the ten illustrations stay
// one family:
//
//   * painted water -- three horizontal bands (far / mid / near) with a
//     translucent blend band straddling each seam. Two opaque flats meeting
//     print a hard line; a half-opacity copy of the NEARER tone laid across
//     the seam reads as a soft gradient at 90px wide, and costs no <defs>.
//   * a wake -- a pale band at the waterline a little wider than the hull,
//     plus two streaks trailing off the stern. Drawn BEFORE the hull, so
//     only the water either side of the hull shows it.
//   * a contact shadow -- one dark translucent ellipse at the waterline
//     (under the fuselage, for the plane, offset down onto the sea). This is
//     the single biggest depth cue: without it a hull floats above the water
//     instead of displacing it.
//   * a specular edge -- a short bright segment on the hull's lit top face,
//     inboard of the full-width RIM line, so the deck reads as turned metal
//     catching the same sun the art window's glow implies.
//
// The horizon stays at y=26. cards.css's --uc-horizon (58%) is derived from
// it, so moving it would open a seam between the CSS sky and the SVG sea.
//
// Colours are literal hex rather than CSS vars: these are illustrations, not
// chrome, and they must stay legible on top of the role-tinted frame that
// cards.css paints behind them.

const SKY = '#7fd4f5';
const SEA = '#1c6fa8';
const SEA_DEEP = '#0f4870';
// Depth pair: the far band sits just under the horizon and is lighter and
// hazier than the foreground swell, which is what makes a 90px-wide card
// read as distance rather than as one flat blue field.
const SEA_FAR = '#4a9bd0';
const SEA_NEAR = '#14568a';
const FOAM = '#bfe9ff';
const HULL = '#2a3a4d';
const HULL_HI = '#41586f';
// Rim light along the top edge of every hull -- one shared tone so the six
// vessels read as lit by the same sun the art window's glow implies.
const RIM = '#8fb4d2';
// The specular itself is brighter and shorter than the rim: a rim line says
// "there is an edge here", a specular says "that edge is metal".
const SPEC = '#e8f6ff';
// Shadow ink. A blue-black rather than pure black -- a neutral shadow on
// saturated water reads as a smudge, not as displaced sea.
const SHADE = '#062a44';
const DECK = '#e9eef4';
const WARN = '#f2b544';
const RED = '#e2564a';
const SAND = '#e8d59a';
const ROCK = '#8a99a8';

// Shared backdrops -- sea horizon (surface units) and underwater (sub/mine).
//
// Band order is far to near, each opaque flat followed by the translucent
// blend that softens the seam below it, then the horizon haze and the foam
// line on top of the lot.
const BG_SEA =
  `<path d="M0 26h60v7H0z" fill="${SEA_FAR}"/>` +
  `<path d="M0 30h60v3.4H0z" fill="${SEA}" opacity="0.45"/>` +
  `<path d="M0 33h60v12H0z" fill="${SEA}"/>` +
  `<path d="M0 36h60v3.6H0z" fill="${SEA_NEAR}" opacity="0.4"/>` +
  `<path d="M0 39c7-2 11 2 18 1s12-3 19-1 15 1 23-1v7H0z" fill="${SEA_NEAR}"/>` +
  // Sky glow spilling onto the water right at the horizon -- the sea is
  // never darker than the sky it reflects.
  `<path d="M0 26h60v1.5H0z" fill="${FOAM}" opacity="0.5"/>` +
  `<path d="M0 26c6 0 6 2.6 12 2.6S24 26 30 26s6 2.6 12 2.6S54 26 60 26v-1.7H0z" fill="${FOAM}"/>`;

const BG_DEEP =
  `<rect width="60" height="45" fill="${SEA}"/>` +
  `<path d="M0 12h60v8H0z" fill="#2a80b8"/>` +
  `<path d="M0 17h60v4H0z" fill="${SEA_DEEP}" opacity="0.45"/>` +
  `<path d="M0 18h60v27H0z" fill="${SEA_DEEP}"/>` +
  // Two light shafts down from the surface -- the underwater equivalent of
  // the horizon glow above, and the only thing that says "up is that way".
  `<path d="M14 0l7 0-10 26-5 0z" fill="${FOAM}" opacity="0.12"/>` +
  `<path d="M40 0l5 0-5 22-4 0z" fill="${FOAM}" opacity="0.1"/>` +
  `<path d="M0 39c8 0 10 6 18 6s10-6 18-6 10 6 18 6 10-6 6-6z" fill="#0a3253"/>`;

// Contact shadow on the water. Drawn after the wake and before the hull, so
// the hull's own bottom edge sits on top of it.
function shade(cx, cy, rx, ry, op) {
  return `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry || 2.2}" ` +
    `fill="${SHADE}" opacity="${op || 0.42}"/>`;
}

// The lighter water a hull drags: a pale band at the waterline, slightly
// wider than the hull, plus two streaks off the stern. Every vessel here
// points RIGHT, so the streaks trail to the left.
function wake(x, w, y) {
  return `<path d="M${(x - 5).toFixed(1)} ${y}h${(w + 10).toFixed(1)}v3.4h-${(w + 10).toFixed(1)}z" fill="${SEA_FAR}" opacity="0.6"/>` +
    `<path d="M${(x - 3).toFixed(1)} ${(y + 0.5).toFixed(1)}h${(w + 6).toFixed(1)}v1.3h-${(w + 6).toFixed(1)}z" fill="${FOAM}" opacity="0.55"/>` +
    `<path d="M${(x - 4).toFixed(1)} ${(y - 1).toFixed(1)}h-7M${(x - 2).toFixed(1)} ${(y + 4.4).toFixed(1)}h-9" stroke="${FOAM}" stroke-width="1.1" opacity="0.45" stroke-linecap="round"/>`;
}

// Generic hull silhouette, parameterised by waterline/height so the six
// surface vessels read as one family at different scales. Four passes: the
// flat, the full-width rim light, the short specular inboard of it, and a
// soft shade line low on the flank so the hull turns away from the light.
function hull(x, w, top, fill) {
  return `<path d="M${x} ${top}h${w}l-${w * 0.16} 7H${x + w * 0.16}z" fill="${fill}"/>` +
    `<path d="M${x} ${top}h${w}v1.2H${x}z" fill="${RIM}"/>` +
    `<path d="M${(x + w * 0.2).toFixed(1)} ${(top + 1.2).toFixed(1)}h${(w * 0.46).toFixed(1)}v0.9h-${(w * 0.46).toFixed(1)}z" fill="${SPEC}" opacity="0.6"/>` +
    `<path d="M${(x + w * 0.15).toFixed(1)} ${(top + 4.6).toFixed(1)}h${(w * 0.7).toFixed(1)}" stroke="${SHADE}" stroke-width="1" opacity="0.3"/>`;
}

// A surface vessel's water package: wake, then shadow, then the hull. `top`
// is the hull's deck line, so the waterline is top+7.
function afloat(x, w, top, fill) {
  return wake(x, w, top + 4.6) +
    shade(x + w / 2, top + 6.6, w / 2 + 1, 2.1) +
    hull(x, w, top, fill);
}

export const ART = {
  // Fast little cutter with a bow wave -- reads as "small and quick".
  patrol_ship:
    BG_SEA +
    afloat(14, 34, 27, HULL) +
    `<path d="M22 27v-6h14v6z" fill="${DECK}"/>` +
    `<path d="M22 21h14v0.9H22z" fill="${SPEC}" opacity="0.7"/>` +
    `<path d="M27 21v-5h3v5z" fill="${HULL_HI}"/>` +
    `<path d="M36 22l8 2-8 2z" fill="${WARN}"/>` +
    `<path d="M8 32c4 0 4 3 8 3" stroke="${FOAM}" stroke-width="2" fill="none" stroke-linecap="round"/>`,

  // The title unit: a hunter cutter with a targeting reticle over the bow.
  sea_hunter:
    BG_SEA +
    afloat(12, 36, 27, HULL) +
    `<path d="M20 27v-7h16v7z" fill="${DECK}"/>` +
    `<path d="M20 20h16v0.9H20z" fill="${SPEC}" opacity="0.7"/>` +
    `<path d="M25 20v-6h4v6z" fill="${HULL_HI}"/>` +
    `<circle cx="44" cy="15" r="7" fill="none" stroke="${RED}" stroke-width="2.4"/>` +
    `<path d="M44 6v5M44 19v5M35 15h5M48 15h5" stroke="${RED}" stroke-width="2" stroke-linecap="round"/>` +
    `<circle cx="44" cy="15" r="2" fill="${RED}"/>`,

  // Destroyer: long low hull, twin gun turrets, radar mast.
  destroyer:
    BG_SEA +
    afloat(6, 48, 28, HULL) +
    `<path d="M14 28v-6h30v6z" fill="${DECK}"/>` +
    `<path d="M14 22h30v0.9H14z" fill="${SPEC}" opacity="0.7"/>` +
    `<path d="M24 22v-7h9v7z" fill="${HULL_HI}"/>` +
    `<path d="M28 15v-7h2v7z" fill="${HULL_HI}"/>` +
    `<circle cx="17" cy="20" r="3" fill="${HULL_HI}"/><path d="M17 20l7-3v2z" fill="${HULL_HI}"/>` +
    `<circle cx="41" cy="20" r="3" fill="${HULL_HI}"/><path d="M41 20l-7-3v2z" fill="${HULL_HI}"/>`,

  // Cruiser: taller superstructure, angled funnel.
  cruiser:
    BG_SEA +
    afloat(5, 50, 29, HULL) +
    `<path d="M12 29v-8h36v8z" fill="${DECK}"/>` +
    `<path d="M12 21h36v0.9H12z" fill="${SPEC}" opacity="0.7"/>` +
    `<path d="M22 21v-9h13v9z" fill="${HULL_HI}"/>` +
    `<path d="M37 21v-6h5v6z" fill="${HULL}"/>` +
    `<path d="M26 12v-6h3v6z" fill="${HULL_HI}"/>` +
    `<circle cx="15" cy="24" r="3.4" fill="${HULL_HI}"/>` +
    `<path d="M44 24h7v3h-7z" fill="${WARN}"/>`,

  // Battleship: the heaviest silhouette -- triple turrets and a fat stack.
  battleship:
    BG_SEA +
    afloat(2, 56, 30, HULL) +
    `<path d="M8 30v-9h44v9z" fill="${DECK}"/>` +
    `<path d="M8 21h44v0.9H8z" fill="${SPEC}" opacity="0.7"/>` +
    `<path d="M22 21v-11h16v11z" fill="${HULL_HI}"/>` +
    `<path d="M27 10v-7h6v7z" fill="${HULL}"/>` +
    `<circle cx="13" cy="25" r="4" fill="${HULL_HI}"/><path d="M13 25l10-4v3z" fill="${HULL_HI}"/>` +
    `<circle cx="47" cy="25" r="4" fill="${HULL_HI}"/><path d="M47 25l-10-4v3z" fill="${HULL_HI}"/>` +
    `<path d="M29 3l0-3" stroke="${RED}" stroke-width="2"/>`,

  // Landing craft: blunt bow ramp down onto sand. Beached, so the wake is a
  // wash line along the sand rather than a stern trail.
  landing_craft:
    BG_SEA +
    `<path d="M0 34h26l-4 11H0z" fill="${SAND}"/>` +
    `<path d="M0 34h26l-1 2.6H0z" fill="${FOAM}" opacity="0.55"/>` +
    shade(36, 36.4, 17, 2.1) +
    `<path d="M22 28h34l-4 8H22z" fill="${HULL}"/>` +
    `<path d="M22 28h34v1.2H22z" fill="${RIM}"/>` +
    `<path d="M28 29.2h16v0.9H28z" fill="${SPEC}" opacity="0.6"/>` +
    `<path d="M30 28v-6h20v6z" fill="${DECK}"/>` +
    `<path d="M22 28l-12 9h12z" fill="${HULL_HI}"/>` +
    `<path d="M40 22v-5h5v5z" fill="${HULL_HI}"/>`,

  // Plane: top-down fighter over open water. The shadow is offset DOWN onto
  // the sea rather than sitting under the hull -- that gap is what says
  // "flying" instead of "floating".
  plane:
    `<path d="M0 26h60v19H0z" fill="${SEA_FAR}"/>` +
    `<path d="M0 30h60v3.4H0z" fill="${SEA}" opacity="0.45"/>` +
    `<path d="M0 33h60v12H0z" fill="${SEA}"/>` +
    `<path d="M0 26h60v1.5H0z" fill="${FOAM}" opacity="0.5"/>` +
    `<path d="M0 37c8 0 8 4 16 4s8-4 16-4 8 4 16 4 8-4 12-4v8H0z" fill="${SEA_NEAR}"/>` +
    shade(31, 39.5, 15, 2.6, 0.3) +
    shade(31, 39.5, 5, 1.6, 0.3) +
    `<path d="M30 6l5 20-5 6-5-6z" fill="${DECK}"/>` +
    `<path d="M4 24h52l-4 6H8z" fill="${HULL_HI}"/>` +
    `<path d="M4 24h52l-1 1.5H5z" fill="${SPEC}" opacity="0.6"/>` +
    `<path d="M22 32h16l-3 5H25z" fill="${HULL}"/>` +
    `<circle cx="30" cy="16" r="3" fill="${SKY}"/>` +
    `<path d="M28 14.5a3 3 0 0 1 4-1" stroke="${SPEC}" stroke-width="1.1" fill="none" stroke-linecap="round"/>`,

  // Coastal artillery: bunker on a rocky headland, barrel out to sea.
  coastal_artillery:
    BG_SEA +
    `<path d="M0 22h30l6 23H0z" fill="${ROCK}"/>` +
    `<path d="M0 22h30l1.4 5.4H0z" fill="${SPEC}" opacity="0.28"/>` +
    `<path d="M0 30h24l4 15H0z" fill="#6c7b8a"/>` +
    // Surf breaking against the foot of the headland.
    `<path d="M26 40c5 0 7-2 12-2" stroke="${FOAM}" stroke-width="1.8" fill="none" opacity="0.6" stroke-linecap="round"/>` +
    shade(15, 22.6, 11, 1.6, 0.3) +
    `<path d="M6 22h18v-8H6z" fill="${HULL}"/>` +
    `<path d="M6 14h18v1.1H6z" fill="${RIM}"/>` +
    `<path d="M9 14h12v-4H9z" fill="${HULL_HI}"/>` +
    `<path d="M22 13h24v5H22z" fill="${HULL_HI}"/>` +
    `<path d="M22 13h24v1H22z" fill="${SPEC}" opacity="0.55"/>` +
    `<circle cx="48" cy="15" r="4" fill="${WARN}"/>`,

  // Submarine: below the surface, conning tower and periscope, bubbles.
  submarine:
    BG_DEEP +
    shade(28, 34, 22, 3, 0.35) +
    `<ellipse cx="28" cy="27" rx="24" ry="8" fill="${HULL}"/>` +
    `<ellipse cx="22" cy="25" rx="16" ry="4" fill="${HULL_HI}"/>` +
    `<path d="M10 22.4c6-2.6 22-3.4 32-1.4" stroke="${SPEC}" stroke-width="1.3" fill="none" opacity="0.55" stroke-linecap="round"/>` +
    `<path d="M24 19h9v-6h-9z" fill="${HULL}"/>` +
    `<path d="M24 13h9v1.1h-9z" fill="${RIM}"/>` +
    `<path d="M28 13v-8h2v8z" fill="${HULL_HI}"/>` +
    `<path d="M30 5h5v2h-5z" fill="${WARN}"/>` +
    `<circle cx="14" cy="25" r="2" fill="${FOAM}"/><circle cx="8" cy="25" r="1.4" fill="${FOAM}"/>` +
    `<circle cx="50" cy="16" r="2.4" fill="${FOAM}" opacity="0.7"/>` +
    `<circle cx="54" cy="10" r="1.6" fill="${FOAM}" opacity="0.7"/>`,

  // Mine: moored contact mine with horns and a tether to the seabed.
  mine:
    BG_DEEP +
    shade(30, 40, 10, 2.4, 0.35) +
    `<path d="M30 30v13" stroke="#0a3253" stroke-width="2"/>` +
    `<circle cx="30" cy="22" r="12" fill="${HULL}"/>` +
    `<circle cx="25" cy="17" r="4" fill="${HULL_HI}"/>` +
    `<path d="M22 13.6a11 11 0 0 1 11-2.4" stroke="${SPEC}" stroke-width="1.4" fill="none" opacity="0.6" stroke-linecap="round"/>` +
    `<path d="M30 10V4M18 22h-6M42 22h6M21 13l-4-4M39 13l4-4M21 31l-4 4M39 31l4 4" stroke="${RED}" stroke-width="2.6" stroke-linecap="round"/>` +
    `<circle cx="30" cy="4" r="2.4" fill="${WARN}"/>` +
    `<circle cx="12" cy="22" r="2.4" fill="${WARN}"/>` +
    `<circle cx="48" cy="22" r="2.4" fill="${WARN}"/>`,
};

// Face-down back: dark navy, wave pattern, small anchor mark. One shared
// string (no per-card variation) -- drawn in the same art window as the art
// above so the frame geometry is identical face-up and face-down.
//
// P10: the anchor is EMBOSSED rather than drawn flat. Three passes on the
// same three paths -- a dark copy pushed down-right (the cut shadow), the
// mark itself, and a light copy pushed up-left (the lit lip). The offsets
// are 0.7 units, which at the smallest card is still a sub-pixel smear of
// tone rather than a visible double line, so it reads as pressed into the
// card stock rather than as a misregistered print.
function anchor(dx, dy, colour, width, op) {
  const t = dx || dy ? ` transform="translate(${dx} ${dy})"` : '';
  return `<g${t} stroke="${colour}" stroke-width="${width}" fill="none" ` +
    `stroke-linecap="round" opacity="${op}">` +
    `<circle cx="30" cy="16" r="2.6"/>` +
    `<path d="M30 19v11M24 25h12"/>` +
    `<path d="M22 24c0 6 4 9 8 9s8-3 8-9"/>` +
    `</g>`;
}

export const ART_BACK =
  `<rect width="60" height="45" fill="#0b1b2d"/>` +
  `<path d="M-2 10c5 0 5 3.5 10 3.5S13 10 18 10s5 3.5 10 3.5S33 10 38 10s5 3.5 10 3.5S53 10 58 10" stroke="#1b3a5c" stroke-width="2" fill="none"/>` +
  `<path d="M-2 36c5 0 5 3.5 10 3.5S13 36 18 36s5 3.5 10 3.5S33 36 38 36s5 3.5 10 3.5S53 36 58 36" stroke="#1b3a5c" stroke-width="2" fill="none"/>` +
  anchor(0.7, 0.7, '#04101c', 2.2, 0.75) +
  anchor(0, 0, '#2f668f', 2, 1) +
  anchor(-0.7, -0.7, '#8ec9f0', 1.2, 0.6);

export function artFor(cardId) {
  return ART[cardId] || BG_SEA;
}
