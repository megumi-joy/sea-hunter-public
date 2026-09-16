// Shared mutable game store -- a single plain object referenced by every module.
// RECONSTRUCTED: the original store.js content was not recoverable from the
// Antigravity session log (it was written via write_to_file, whose args are not
// captured in the export). This shape is inferred from every `store.*` usage
// visible across the recovered app.js / game.js / ui.js fragments.
export const store = {
  state: null,          // current GameState, set by createGameState()
  combatLocked: false,  // true while an attack animation is resolving
  activeIslandPower: null, // { id, args } while the player is targeting an island power
  activeArtifact: null,    // artifact id while the player is targeting an artifact (e.g. Spyglass)
  mode: 'single',        // 'single' | 'multiplayer'
  matchLoadout: [],  // artifact ids loaded from the shop hold into the current match (economy.js)
  voyage: null,      // the campaign voyage chart being sailed, if any (voyage.js)
};
