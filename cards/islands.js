// Island definitions and state management.
//
// ISLAND RULES (documented here so the in-game rules modal and this file never
// drift apart -- see UI.renderIslandsList() in ui.js, which renders this same
// data):
//
//  - Islands are drawn from a SEPARATE deck (`state.islandDeck`, shuffled from
//    Object.keys(ISLANDS)) -- one island is "active" (contested) per round.
//  - Players do not buy or place islands; they FIGHT for the active island by
//    winning that round's combat (clearing the opponent's Front + Reserve).
//    The round winner then CAPTURES the island by placing a qualifying unit
//    from their Frontline/Reserve onto it -- see isCaptureEligible() /
//    CAPTURE_ELIGIBLE_BY_ISLAND in game.js (currently the same eligible-unit
//    list for every island, verified against the authoritative Godot source
//    -- see that file's comment for the exact citation). If the round winner
//    has no qualifying unit left, the island goes uncaptured that round
//    ("exposed") -- see checkRoundEnd()'s hasEligibleCapturer() branch.
//  - ISLAND GARRISON RULING (owner, 2026-08-14): capturing is a GARRISON, not
//    a sacrifice -- the placed unit stays "on" the island (see game.js's
//    state.p1IslandGarrison/p2IslandGarrison) and holds it for as long as
//    that garrison slot stays filled. The Maneuver power (below) is the one
//    way to pull a unit back off an island it garrisons. At EVERY round-end
//    (regardless of who won, lost, or drew that round), every held island
//    with an empty garrison slot is re-tallied: if the owner has another
//    qualifying Front/Reserve unit, it auto-fills the garrison (island kept,
//    no click needed); if not, the island DRAINS -- removed from the held
//    list, its point lost with it. See game.js's retallyGarrisons().
//  - Capturing (or re-garrisoning at round-end) unlocks that island's power
//    (usable once, any time on their turn, for the rest of the match) -- see
//    usePower() / POINTS_TO_WIN in game.js. A captured island also has a
//    chance to yield an Artifact -- see artifacts.js.
//  - `two_island` is the one exception: it has no active power. It is
//    garrisoned exactly like any other island (and can equally drain), but
//    is worth 2 points instead of 1 while held; it is not clickable for a
//    power (see UI.renderIslands()'s two_island guard).
//  - WIN CONDITION / SCORING: score is the number of islands each player
//    currently HOLDS (garrisoned), Two-Island counting as 2 -- derived fresh
//    every round-end, not an incremental counter (see game.js's
//    recomputeScore()). First player to reach POINTS_TO_WIN (3, in a 1v1
//    match) wins immediately. Round count (MAX_ROUNDS = 10) is only a
//    fallback cap in case neither side reaches 3 (e.g. draws eating rounds)
//    -- whoever has the higher score at that point wins.
//
//  - ISLAND SET: this file previously mirrored the Godot prototype's
//    implemented power set (radar / camouflage / logistics / maneuver /
//    fog / rapid_support / recovery / spy / two_island -- verified against
//    that repo's resources/islands/*.tres and IslandPowerManager.gd). The
//    owner has since confirmed explicitly, having reviewed both, that the
//    prototype's code is a divergence from his intent: the physical rules
//    cards he hand-designed (the images this game is based on) are the
//    authoritative source, and code should follow them, not the other way
//    around. Per that decision, 4 of the 9 powers below now match the card
//    images instead of the prototype: Teleportation, Scouting, Secret
//    Move, and Sabotage replace Logistics, Fog, Recovery, and Spy. Radar,
//    Maneuver, Rapid Support, and Two-Island are unchanged (the card
//    images and the prototype already agreed on those 4).
//
//  - CAMOUFLAGE CORRECTION: this used to be documented (and coded, in
//    game.js's usePower) as "swap the board slots of two of your own
//    face-down cards" -- a divergence that was never actually reachable
//    through the UI: placeCard()/autoPlace() (game.js) stamp the player's
//    own cards faceUp=true the instant they're placed, so the precondition
//    "two of your own face-down cards" could never be satisfied and the
//    power was permanently unusable. Corrected to match the real
//    card-image rule: Camouflage lets you hide one of your own field cards
//    so the opponent cannot attack it on their next turn -- see game.js's
//    usePower() camouflage branch and ai.js's target filtering.
export const ISLANDS = {
  radar:         { id: 'radar',         name: 'Radar Station', abbr: 'RD', emoji: '🔎',
    desc: 'One-time: reveal one face-down enemy card before you attack.' },
  camouflage:    { id: 'camouflage',    name: 'Camouflage',    abbr: 'CM', emoji: '🎭',
    desc: "One-time: hide one of your own cards -- the opponent cannot attack it on their next turn." },
  teleportation: { id: 'teleportation', name: 'Teleportation', abbr: 'TP', emoji: '🌀',
    desc: 'One-time: swap one of your Front cards with the Reserve card directly behind it.' },
  maneuver:      { id: 'maneuver',      name: 'Maneuver',      abbr: 'MN', emoji: '🚢',
    // F5 RULING (owner, 2026-08-14): retrieves a unit from one of YOUR held
    // islands' garrison, not a field withdrawal -- see game.js's usePower().
    desc: "One-time: pull one of your own units off an island you hold, back to hand -- return it to the field before round-end or the island may drain." },
  scouting:      { id: 'scouting',      name: 'Scouting',      abbr: 'SC', emoji: '👁️',
    desc: "One-time: reveal two of the opponent's Reserve cards." },
  rapid_support: { id: 'rapid_support', name: 'Rapid Support', abbr: 'RS', emoji: '⚡',
    desc: 'One-time: deploy a card straight from hand to an empty Reserve slot.' },
  secret_move:   { id: 'secret_move',   name: 'Secret Move',   abbr: 'SM', emoji: '🔀',
    desc: 'One-time: rearrange all of your own Reserve cards into any order.' },
  sabotage:      { id: 'sabotage',      name: 'Sabotage',      abbr: 'SB', emoji: '🗡️',
    desc: "One-time: pick one enemy card -- it cannot act on the opponent's next turn." },
  two_island:    { id: 'two_island',    name: 'Two-Island',    abbr: 'TI', emoji: '🏝️',
    desc: 'Passive: worth 2 points total when captured (instead of 1) -- no active power.' },
};

// BUGFIX (multiplayer): src/games/sea_hunter/cards.py's ISLANDS (the deck the
// multiplayer server actually shuffles and deals from -- see multiplayer.py's
// GameState) still carries the OLD power set this file's own comment above
// documents as superseded for single-player: logistics, fog, recovery, spy.
// Before this fix, a multiplayer match that captured one of these had it
// vanish everywhere on the client -- ui.js's renderIslands() did
// `const def = ISLANDS[islandId]; if (!def) return;`, so the active-island
// card, the player's island row, and the opponent's island row all silently
// dropped it (no icon, no button, nothing to click). These four entries
// exist ONLY so the client can render/target them when the server deals
// them; they are not offered in local single-player (createGameState() below
// draws only from ISLANDS's keys, never from LEGACY_ISLANDS).
export const LEGACY_ISLANDS = {
  logistics: { id: 'logistics', name: 'Logistics', abbr: 'LG', emoji: '📦',
    desc: 'One-time: swap a hand card with a Reserve card (server-resolved).' },
  fog:       { id: 'fog',       name: 'Fog',        abbr: 'FG', emoji: '🌫️',
    desc: "One-time: the opponent skips their next turn." },
  recovery:  { id: 'recovery',  name: 'Recovery',   abbr: 'RC', emoji: '💊',
    desc: 'One-time: return your most recently discarded card to hand.' },
  spy:       { id: 'spy',       name: 'Spy',        abbr: 'SP', emoji: '🕵️',
    desc: "One-time: reveals the opponent's hand (server-resolved)." },
};

// Look up an island definition for display/targeting, checking the current
// (single-player) power set first and falling back to the multiplayer-only
// legacy set above. Use this instead of a bare `ISLANDS[id]` lookup anywhere
// an island id may have come off the wire (multiplayer.js's adaptState) --
// see ui.js's renderIslands() and app.js's handleIslandClick().
export function getIslandDef(islandId) {
  return ISLANDS[islandId] || LEGACY_ISLANDS[islandId] || null;
}

// SVG island art generator -- generic look since voicy uses emojis
export function islandSVG(island, size = 'small') {
  const w = size === 'large' ? 90 : 32;
  const h = size === 'large' ? 70 : 24;
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" fill="none">
    <ellipse cx="${w/2}" cy="${h*0.8}" rx="${w*0.4}" ry="${h*0.18}" fill="#2a3240"/>
    <text x="50%" y="55%" dominant-baseline="middle" text-anchor="middle" font-size="${size === 'large' ? '24' : '12'}">${island.emoji}</text>
  </svg>`;
}

export function resetIslandActivations(state) {
  if (!state) return;
  state.p1PowersUsed = [];
  state.p2PowersUsed = [];
}
