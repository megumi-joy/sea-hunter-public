// Card definitions — mirrors src/games/sea_hunter/cards.py
// ability: { name, desc, trigger } — trigger: 'on_win'|'on_death'|'passive'|'on_attack'
export const CARDS = {
  plane:              { id: 'plane',              name: 'Plane',             abbr: 'PL', strength: 1, emoji: '✈️',  ability: { name: 'Airstrike',    desc: 'Ignores Reserve wall — can target Reserve directly', trigger: 'passive' } },
  coastal_artillery:  { id: 'coastal_artillery',  name: 'Coastal Artillery', abbr: 'CA', strength: 0, emoji: '🏰',  ability: { name: 'Fortify',      desc: 'On win: next attack against you misses', trigger: 'on_win' } },
  battleship:         { id: 'battleship',         name: 'Battleship',        abbr: 'BS', strength: 5, emoji: '🚢',  ability: { name: 'Broadside',    desc: 'On attack: also hits adjacent enemy slot', trigger: 'on_attack' } },
  cruiser:            { id: 'cruiser',            name: 'Cruiser',           abbr: 'CR', strength: 4, emoji: '⛵',  ability: { name: 'Pursuit',      desc: 'On win: attack again immediately', trigger: 'on_win' } },
  destroyer:          { id: 'destroyer',          name: 'Destroyer',         abbr: 'DE', strength: 3, emoji: '🔱',  ability: { name: 'Torpedo',      desc: 'Can attack Reserve even if Front is alive', trigger: 'passive' } },
  patrol_ship:        { id: 'patrol_ship',        name: 'Patrol Ship',       abbr: 'PS', strength: 2, emoji: '🚤',  ability: { name: 'Scout',        desc: 'Reveals one face-down enemy card before combat', trigger: 'passive' } },
  sea_hunter:         { id: 'sea_hunter',         name: 'Sea Hunter',        abbr: 'SH', strength: 1, emoji: '🎯',  ability: { name: 'Precision',    desc: 'Never triggers DRAW — wins ties instead', trigger: 'passive' } },
  landing_craft:      { id: 'landing_craft',      name: 'Landing Craft',     abbr: 'LC', strength: 0, emoji: '🛥️', ability: { name: 'Reinforcement',desc: 'On death: draw one extra card next round', trigger: 'on_death' } },
  submarine:          { id: 'submarine',          name: 'Submarine',         abbr: 'SB', strength: 0, emoji: '🤿',  ability: { name: 'Stealth',      desc: 'Stays face-down until it attacks', trigger: 'passive' } },
  mine:               { id: 'mine',               name: 'Mine',              abbr: 'MN', strength: 0, emoji: '💣',  ability: { name: 'Chain React',  desc: 'On death: destroys adjacent enemy card too', trigger: 'on_death' } },
};

export const IMPACT = {
  plane:             { plane:'DRAW', coastal_artillery:'WIN', battleship:'LOSS', cruiser:'LOSS', destroyer:'WIN', patrol_ship:'WIN', sea_hunter:'WIN', landing_craft:'NONE', submarine:'NONE', mine:'NONE' },
  coastal_artillery: { plane:'LOSS', coastal_artillery:'DRAW', battleship:'WIN', cruiser:'WIN', destroyer:'WIN', patrol_ship:'WIN', sea_hunter:'WIN', landing_craft:'LOSS', submarine:'NONE', mine:'NONE' },
  battleship:        { plane:'WIN', coastal_artillery:'LOSS', battleship:'DRAW', cruiser:'WIN', destroyer:'WIN', patrol_ship:'WIN', sea_hunter:'WIN', landing_craft:'WIN', submarine:'LOSS', mine:'DRAW' },
  cruiser:           { plane:'WIN', coastal_artillery:'LOSS', battleship:'LOSS', cruiser:'DRAW', destroyer:'WIN', patrol_ship:'WIN', sea_hunter:'WIN', landing_craft:'WIN', submarine:'LOSS', mine:'DRAW' },
  destroyer:         { plane:'LOSS', coastal_artillery:'LOSS', battleship:'LOSS', cruiser:'LOSS', destroyer:'DRAW', patrol_ship:'WIN', sea_hunter:'WIN', landing_craft:'WIN', submarine:'WIN', mine:'DRAW' },
  patrol_ship:       { plane:'LOSS', coastal_artillery:'LOSS', battleship:'LOSS', cruiser:'LOSS', destroyer:'LOSS', patrol_ship:'DRAW', sea_hunter:'WIN', landing_craft:'WIN', submarine:'WIN', mine:'DRAW' },
  sea_hunter:        { plane:'LOSS', coastal_artillery:'LOSS', battleship:'LOSS', cruiser:'LOSS', destroyer:'LOSS', patrol_ship:'LOSS', sea_hunter:'DRAW', landing_craft:'WIN', submarine:'WIN', mine:'DRAW' },
  landing_craft:     { plane:'NONE', coastal_artillery:'WIN', battleship:'LOSS', cruiser:'LOSS', destroyer:'LOSS', patrol_ship:'LOSS', sea_hunter:'LOSS', landing_craft:'DRAW', submarine:'NONE', mine:'WIN' },
  submarine:         { plane:'NONE', coastal_artillery:'NONE', battleship:'WIN', cruiser:'WIN', destroyer:'LOSS', patrol_ship:'LOSS', sea_hunter:'LOSS', landing_craft:'NONE', submarine:'DRAW', mine:'DRAW' },
  mine:              { plane:'NONE', coastal_artillery:'NONE', battleship:'DRAW', cruiser:'DRAW', destroyer:'DRAW', patrol_ship:'DRAW', sea_hunter:'DRAW', landing_craft:'LOSS', submarine:'DRAW', mine:'NONE' },
};

export const DECK_IDS = [
  'sea_hunter', 'sea_hunter', 'patrol_ship', 'destroyer', 'cruiser',
  'coastal_artillery', 'submarine', 'submarine', 'landing_craft', 'landing_craft',
  'mine', 'mine',
];

export const CARD_ORDER = Object.keys(CARDS);

export function getResult(attackerId, defenderId) {
  // Sea Hunter passive: wins ties
  let result = (IMPACT[attackerId] || {})[defenderId] || 'NONE';
  if (result === 'DRAW' && attackerId === 'sea_hunter') result = 'WIN';
  return result;
}
