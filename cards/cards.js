// Card definitions -- mirrors src/games/sea_hunter/cards.py
//
// QA finding F2 (SEAHUNTER_QA_FINDINGS.md): the units used to carry invented
// `ability: {name, desc, trigger}` flavor text (Airstrike, Fortify, Broadside,
// Pursuit, Torpedo, Scout, Reinforcement, Stealth, Chain React, and Sea
// Hunter's "Precision") that is NOT in the canonical rules and was never
// functionally wired -- game.js/ai.js never read `.ability` or dispatched on
// `.trigger`. The canonical rule cards give every unit exactly a strength plus
// destroys/destroyed_by lists and nothing else, so no unit has any ability at
// all. All of it is removed so the UI stops promising abilities that do not
// exist. Sea Hunter in particular self-draws in a mirror match like every
// other unit; the old "Precision" tie-break (DRAW -> WIN) was a July web
// invention and is gone from getResult() below.

export const CARDS = {
  plane:              { id: 'plane',              name: 'Plane',             abbr: 'PL', strength: 1, emoji: '✈️' },
  coastal_artillery:  { id: 'coastal_artillery',  name: 'Coastal Artillery', abbr: 'CA', strength: 0, emoji: '🏰' },
  battleship:         { id: 'battleship',         name: 'Battleship',        abbr: 'BS', strength: 5, emoji: '🚢' },
  cruiser:            { id: 'cruiser',            name: 'Cruiser',           abbr: 'CR', strength: 4, emoji: '⛵' },
  destroyer:          { id: 'destroyer',          name: 'Destroyer',         abbr: 'DE', strength: 3, emoji: '🔱' },
  patrol_ship:        { id: 'patrol_ship',        name: 'Patrol Ship',       abbr: 'PS', strength: 2, emoji: '🚤' },
  sea_hunter:         { id: 'sea_hunter',         name: 'Sea Hunter',        abbr: 'SH', strength: 1, emoji: '🎯' },
  landing_craft:      { id: 'landing_craft',      name: 'Landing Craft',     abbr: 'LC', strength: 0, emoji: '🛥️' },
  submarine:          { id: 'submarine',          name: 'Submarine',         abbr: 'SB', strength: 0, emoji: '🤿' },
  mine:               { id: 'mine',               name: 'Mine',              abbr: 'MN', strength: 0, emoji: '💣' },
};

// Impact matrix: IMPACT[attacker][defender] -> 'WIN' | 'LOSS' | 'DRAW' | 'NONE'
// Originally ported from src/games/sea_hunter/cards.py (the committed Python
// backend). CROSS-VERIFIED against the authoritative Godot source of truth
// at /home/yip/Documents/GitHub/sea-hunter/resources/cards/*.tres (each
// card's `destroys` / `destroyed_by` string-id arrays) -- 92 of the 100
// cells already matched exactly. The 8 that didn't (all involving `plane`
// vs battleship/cruiser/coastal_artillery, and `landing_craft` vs `mine`)
// are corrected below to match the .tres data. Derivation rule used:
// attacker WINS if attacker.destroys includes defender; attacker LOSES if
// defender.destroys includes attacker; both apply -> DRAW; neither -> NONE.
export const IMPACT = {
  plane:             { plane:'DRAW', coastal_artillery:'LOSS', battleship:'WIN',  cruiser:'WIN',  destroyer:'WIN',  patrol_ship:'WIN',  sea_hunter:'WIN',  landing_craft:'NONE', submarine:'NONE', mine:'NONE' },
  coastal_artillery: { plane:'WIN',  coastal_artillery:'DRAW', battleship:'WIN',  cruiser:'WIN',  destroyer:'WIN',  patrol_ship:'WIN',  sea_hunter:'WIN',  landing_craft:'LOSS', submarine:'NONE', mine:'NONE' },
  battleship:        { plane:'LOSS', coastal_artillery:'LOSS', battleship:'DRAW', cruiser:'WIN',  destroyer:'WIN',  patrol_ship:'WIN',  sea_hunter:'WIN',  landing_craft:'WIN',  submarine:'LOSS', mine:'DRAW' },
  cruiser:           { plane:'LOSS', coastal_artillery:'LOSS', battleship:'LOSS', cruiser:'DRAW', destroyer:'WIN',  patrol_ship:'WIN',  sea_hunter:'WIN',  landing_craft:'WIN',  submarine:'LOSS', mine:'DRAW' },
  destroyer:         { plane:'LOSS', coastal_artillery:'LOSS', battleship:'LOSS', cruiser:'LOSS', destroyer:'DRAW', patrol_ship:'WIN',  sea_hunter:'WIN',  landing_craft:'WIN',  submarine:'WIN',  mine:'DRAW' },
  patrol_ship:       { plane:'LOSS', coastal_artillery:'LOSS', battleship:'LOSS', cruiser:'LOSS', destroyer:'LOSS', patrol_ship:'DRAW', sea_hunter:'WIN',  landing_craft:'WIN',  submarine:'WIN',  mine:'DRAW' },
  sea_hunter:        { plane:'LOSS', coastal_artillery:'LOSS', battleship:'LOSS', cruiser:'LOSS', destroyer:'LOSS', patrol_ship:'LOSS', sea_hunter:'DRAW', landing_craft:'WIN',  submarine:'WIN',  mine:'DRAW' },
  landing_craft:     { plane:'NONE', coastal_artillery:'WIN',  battleship:'LOSS', cruiser:'LOSS', destroyer:'LOSS', patrol_ship:'LOSS', sea_hunter:'LOSS', landing_craft:'DRAW', submarine:'NONE', mine:'LOSS' },
  submarine:         { plane:'NONE', coastal_artillery:'NONE', battleship:'WIN',  cruiser:'WIN',  destroyer:'LOSS', patrol_ship:'LOSS', sea_hunter:'LOSS', landing_craft:'NONE', submarine:'DRAW', mine:'DRAW' },
  mine:              { plane:'NONE', coastal_artillery:'NONE', battleship:'DRAW', cruiser:'DRAW', destroyer:'DRAW', patrol_ship:'DRAW', sea_hunter:'DRAW', landing_craft:'WIN',  submarine:'DRAW', mine:'NONE' },
};

// Deck composition: one copy each of every canonical unit (10 total -- see
// resources/cards/*.tres), plus the pre-existing extra copies of sea_hunter,
// submarine, landing_craft and mine that were already here. Previously
// `battleship` and `plane` were entirely missing (bug: they could never be
// dealt/played despite being fully defined above, in IMPACT and in
// DEFAULT_CAPTURE_ELIGIBLE) -- fixed here by adding one copy of each. This
// grows the deck from 12 to 14 cards; board capacity (FRONT_SIZE=4 +
// RESERVE_SIZE=4 = 8 slots in game.js) is unaffected since hand rendering is
// array-length-driven (ui.js renderHand/renderOppHand), not slot-count-fixed,
// and the deck was already larger than the 8 board slots before this change
// (extra hand cards cycle in across rounds -- see game.js's round-end
// hand-replenish logic). This is a minimal additive fix, not a rebalance of
// existing duplicate counts -- flagging for owner/lead to tune duplicate
// weights later if 14 feels off.
// 13 cards, exactly the HUMANS list printed on the cardboard contents card
// (Sea_Hunter_cards_tableofcontent_and_islas.png): one Naval Mine, not two.
export const DECK_IDS = [
  'sea_hunter', 'sea_hunter', 'patrol_ship', 'destroyer', 'cruiser',
  'coastal_artillery', 'submarine', 'submarine', 'landing_craft', 'landing_craft',
  'mine', 'battleship', 'plane',
];

export const CARD_ORDER = Object.keys(CARDS);

export function getResult(attackerId, defenderId) {
  return (IMPACT[attackerId] || {})[defenderId] || 'NONE';
}
