import { store } from './store.js';
import { ISLANDS, getIslandDef } from './islands.js';
import { PHASE, createGameState, usePower, placeCard, lockIn, autoPlace, moveReserveToFront, checkRoundEnd, playerCaptureIsland, returnCard, moveCard, playerAttack } from './game.js';
import * as UI from './ui.js';
import { aiTurn, aiDeploy } from './ai.js';
import { mpActive, mpUsePower, mpConnect, mpDisconnect, mpSetHandlers,
         mpAttack, mpMove, mpPlace, mpReady, mpAutoPlace, mpCaptureIsland, mpAddBot,
         mpRematch } from './multiplayer.js';
import { ARTIFACTS, useArtifact } from './artifacts.js';
import { ARTIFACT_IDS } from './artifacts.js';
import { getBalance, getHold, priceOf, canAfford, buyArtifact,
         loadHoldIntoMatch, returnUnusedToHold, awardMatchRewards } from './economy.js';
import { MISSION_COUNT, NODE_INFO, missionMeta, generateChart, move as voyageMove,
         resolveBattle as voyageResolveBattle, isStranded, nodeById,
         saveVoyage, loadVoyage, loadVoyageProgress, recordVoyageResult } from './voyage.js';
import { recordGameResult, fetchRemoteLeaderboard, getLocalScores } from './leaderboard.js';
import { initTelegram } from './telegram.js';
import { loadSettings, setSetting } from './settings.js';
import { loadProfile, updateProfile, AVATARS, avatarOf, handleOf } from './profile.js';
// P2 "Input": all pointer interaction (drag placement, hand fan, targeting
// arc, legality highlighting) lives in render/input.js. It owns no rules --
// it drives the very handlers below through the deps object passed to
// Input.init() in initEvents(), and reads legality off the highlight classes
// ui.js already writes.
import * as Input from './render/input.js';
// P4 "Islands and results": the enlarged island card and the round-end
// screen are reachable from the ?demo= debug pass below, which is the only
// thing in app.js that needs them directly -- the game itself goes through
// UI.renderIslands() / UI.showGameOver() as before.
import { openIslandDetail, buildIslandEl } from './render/islands.js';
// P13 "Hero card moments": press-and-hold inspect, plus ?demo=hero.
import * as Hero from './render/hero.js';
import { demoRoundEnd } from './render/screens.js';
// P5 "Sound and haptics": every cue is fired from render/fx.js, input.js,
// islands.js and screens.js -- app.js only owns the two Settings toggles and
// the ?demo=audio debug page.
import * as Audio from './render/audio.js';
// P6 "QA tour": ?tour=1 drives every screen in order for a screenshot pass
// (tools/webtour.ps1). Imported unconditionally and inert without the flag,
// but its seeded-Math.random patch is installed at module evaluation time,
// which is still long before DOMContentLoaded below -- no module in this
// graph calls Math.random while it is being evaluated, only later from a
// deal, an AI pick or a generated profile.
import * as Tour from './render/tour.js';
// P8 "Pause, feedback, telemetry". Three self-contained modules: the pause
// overlay behind #btn-pause (which had no handler at all until now), the
// feedback form, and consented anonymous telemetry. app.js owns every rule
// as usual -- it hands pause.js the actions and calls Telemetry.track() at
// the few points that matter.
import * as Pause from './render/pause.js';
import { openFeedback } from './render/feedback.js';
import * as Telemetry from './render/telemetry.js';
// P14: guided first match, How to play primer, first-match hints.
import * as Tutorial from './render/tutorial.js';
// P15 "Progression and retention": results ladder, level, daily goals,
// streak, the campaign card on the menu and the Fleet screen.
import * as Progress from './render/progress.js';

// App entry point -- wires everything together

let selectedAttackerSlot = null; // transient UI state: which p1Front slot is chosen to attack

function executeIslandPower(islandId, args) {
  if (typeof mpActive !== 'undefined' && mpActive) {
    // The server addresses a power by its index in the captured-island list,
    // not by island id -- resolve it here so the local UI can keep using ids.
    const idx = (store.state.p1Islands || []).findIndex((i) => (i && i.id ? i.id : i) === islandId);
    mpUsePower(idx < 0 ? 0 : idx, args);
  } else {
    const res = usePower(store.state, islandId, args);
    if (res.ok) {
      UI.setStatus(res.msg);
      UI.addLogEntry(res.msg.split('\n')[0]);
      renderAll();
      if (islandId === 'camouflage') {
        // Camouflage just hid one of the player's own cards from the
        // opponent's next attack (see game.js's usePower) -- flash the
        // same shield glow used for the Smoke Bomb block below, as
        // immediate feedback that the protection is live. Looked up
        // fresh off state (rather than trusting a stale ref) using the
        // same args usePower() itself just resolved against; read after
        // renderAll() so it lands on the freshly rendered element (the
        // zones fully rebuild their DOM every render -- see ui.js).
        const zoneArr = args.zone === 'reserve' ? store.state.p1Reserve : store.state.p1Front;
        const card = zoneArr[args.slot ?? 0];
        if (card) UI.showShieldEffect(card.uid);
      }
      // usePower() runs checkRoundEnd() like every other action, so the
      // power may have ended the round or the match: afterAction() handles
      // GAME_OVER and only hands the turn to the AI while combat goes on.
      afterAction();
    } else {
      UI.setStatus(res.msg);
    }
  }
  store.activeIslandPower = null;
  UI.clearAllHighlights();
  // Maneuver's targeting step (see handleIslandClick's 'maneuver' branch)
  // re-renders #player-islands with a custom targeting wiring instead of
  // the normal one -- on a successful resolution renderAll() above already
  // rebuilt it back to normal, but on a REJECTED attempt (res.ok false)
  // renderAll() never ran, so the targeting wiring would otherwise be left
  // stuck. Unconditionally rebuilding it here in normal mode is a harmless
  // no-op redraw for every other power (none of them touch #player-islands
  // wiring) and the only thing that reliably un-sticks Maneuver's.
  UI.renderIslands(store.state, handleIslandClick);
}

// BUGFIX: Rapid Support (an active COMBAT-phase island power) needs the
// player to click a hand card to pick which one deploys to Reserve, but
// hand cards are otherwise only clickable during PHASE.PREP (see
// renderAll() below) -- so the power activated on island capture but a
// player could never actually complete it. onHandCardClick already knows
// how to handle rapid_support targeting (it checks store.activeIslandPower
// before its PREP branch), it just never got attached as a DOM listener
// outside PREP. This re-renders the hand with that listener attached/
// detached to match whether rapid_support targeting is currently live --
// called from renderAll() (so a normal PREP<->COMBAT phase change gets it
// right) *and* directly from handleIslandClick() below (so a power
// activating -- or a different power being picked instead, mid-targeting
// -- takes effect immediately, without waiting on some unrelated action to
// trigger the next full renderAll()).
function syncHandClickability() {
  if (!store.state) return;
  const rapidSupportTargeting = store.state.phase === PHASE.COMBAT &&
    store.activeIslandPower && store.activeIslandPower.id === 'rapid_support';
  UI.renderHand(store.state.p1Hand,
    store.state.phase === PHASE.PREP || rapidSupportTargeting ? onHandCardClick : null);
}

export function handleIslandClick(islandId) {
  if (store.state.turnOwner !== 1 || store.state.phase !== 'COMBAT' || store.combatLocked) return;

  // Maneuver targeting is already in progress (see the 'maneuver' branch
  // below, which enters this mode instead of resolving immediately): every
  // subsequent click on a player-islands card means "un-garrison THIS
  // island," not "start using this island's power." Route it there first,
  // before the generic per-island dispatch below can overwrite
  // store.activeIslandPower with a fresh { id: islandId } for whatever was
  // just clicked. Eligibility is recomputed fresh off state (not a cached
  // list from when targeting started) so it can never go stale between the
  // highlight and the click, and is byte-for-byte the same predicate
  // usePower()'s own maneuver fallback uses (state.p1Islands filtered to
  // ones with a garrison) -- see game.js.
  if (store.activeIslandPower && store.activeIslandPower.id === 'maneuver') {
    const eligible = store.state.p1Islands.filter((id) => store.state.p1IslandGarrison[id]);
    if (!eligible.includes(islandId)) return;
    executeIslandPower('maneuver', { islandId });
    return;
  }

  const def = getIslandDef(islandId);
  if (!def) return;
  // two_island is passive and never reaches here (UI.renderIslands() never
  // attaches a click handler for it -- see its guard there).

  // BUGFIX (multiplayer): logistics/fog/recovery/spy only ever reach this
  // client via a multiplayer server capture (see islands.js's
  // LEGACY_ISLANDS comment -- the local single-player deck never deals
  // them). None of the per-power targeting UI below knows those ids.
  // fog/recovery need no target at all (matches multiplayer.py's use_power:
  // both read no args), so fire them straight through to the server. spy
  // and logistics do need a target the client has no picker for yet
  // (spy reveals the opponent's hand -- nothing to click; logistics swaps a
  // hand card with a Reserve slot) -- tell the player plainly instead of
  // silently eating the click.
  if (islandId === 'fog' || islandId === 'recovery') {
    executeIslandPower(islandId, {});
    return;
  }
  if (islandId === 'logistics' || islandId === 'spy') {
    // P7: these prompts used to lead with the card/island `emoji` field.
    // setStatus writes textContent, so that glyph landed in the UI as a
    // literal emoji -- the name alone says the same thing.
    UI.setStatus(`${def.name}: not supported by this client yet.`);
    return;
  }

  store.activeIslandPower = { id: islandId, args: {} };
  UI.clearAllHighlights();
  if (islandId === 'radar') {
    UI.highlightSlots('opp-front', true, 'target-highlight');
    UI.setStatus('Radar: pick an enemy Front card to reveal.');
  } else if (islandId === 'camouflage') {
    UI.highlightSlots('player-front', true, 'target-highlight');
    UI.highlightSlots('player-reserve', true, 'target-highlight');
    UI.setStatus("Camouflage: pick one of your own cards to hide from the opponent's next turn.");
  } else if (islandId === 'rapid_support') {
    // No board slots to highlight -- the target is a hand card. Highlight
    // the hand row itself with the same target-highlight cue the board
    // zones use, since the hand doesn't share renderZone's per-slot markup
    // (see UI.highlightHand).
    UI.highlightHand(true);
    UI.setStatus('Rapid Support: pick a hand card to deploy to Reserve.');
  } else if (islandId === 'maneuver') {
    // Maneuver's target is one of the player's OWN held islands -- pull its
    // garrison unit back to hand -- not a Front/Reserve card (see game.js's
    // usePower() maneuver branch / F5 RULING). Front/Reserve slots are not
    // highlighted at all here; instead re-render #player-islands with the
    // held+garrisoned ones picked out as targets (see UI.renderIslands()'s
    // maneuverTargetIds param). The follow-up click re-enters this function
    // and is caught by the guard above, not by handleTargetClick.
    const eligible = store.state.p1Islands.filter((id) => store.state.p1IslandGarrison[id]);
    if (!eligible.length) {
      UI.setStatus('Maneuver: no garrisoned island to retrieve a unit from.');
      store.activeIslandPower = null;
      syncHandClickability();
      return;
    }
    UI.renderIslands(store.state, handleIslandClick, eligible);
    UI.setStatus(eligible.length > 1
      ? 'Maneuver: pick which of your held islands to un-garrison.'
      : 'Maneuver: confirm the held island to un-garrison.');
  } else if (islandId === 'teleportation') {
    UI.highlightSlots('player-front', true, 'target-highlight');
    UI.setStatus('Teleportation: pick a Front card to swap with the Reserve card behind it.');
  } else if (islandId === 'scouting') {
    UI.highlightSlots('opp-reserve', true, 'target-highlight');
    UI.setStatus("Scouting: pick two of the opponent's Reserve cards to reveal.");
  } else if (islandId === 'secret_move') {
    const occupied = store.state.p1Reserve.filter(Boolean).length;
    if (occupied < 2) {
      UI.setStatus('Secret Move needs at least 2 cards in your Reserve.');
      store.activeIslandPower = null;
      // Early exit -- still must re-sync (see syncHandClickability's
      // comment above) in case this bailed out of a live rapid_support
      // targeting state (activeIslandPower just got nulled above, so this
      // correctly detaches the hand listener again).
      syncHandClickability();
      return;
    }
    store.activeIslandPower.args.order = [];
    store.activeIslandPower.args.needed = occupied;
    UI.highlightSlots('player-reserve', true, 'target-highlight');
    UI.setStatus('Secret Move: click your Reserve cards in the new order you want them.');
  } else if (islandId === 'sabotage') {
    UI.highlightSlots('opp-front', true, 'target-highlight');
    UI.highlightSlots('opp-reserve', true, 'target-highlight');
    UI.setStatus("Sabotage: pick one enemy card -- it won't be able to act next turn.");
  }
  // Re-sync the hand's click listener now that activeIslandPower just
  // changed (see syncHandClickability's comment above) -- covers both
  // "just activated rapid_support" and "switched away from it to a
  // different power mid-targeting" in one place.
  syncHandClickability();
}

// ── Combat: attacker/defender selection ───────────────────────────
function onPlayerCardClick(slot, card) {
  disarmPromotion();
  if (!store.state || store.combatLocked) return;
  if (store.activeIslandPower) { handleTargetClick('player', 'front', slot, card); return; }
  if (store.state.phase === 'ISLAND_CAPTURE') {
    doCaptureIsland(slot, 'front');
    return;
  }
  if (store.state.turnOwner !== 1) return;
  if (card.def.id === 'mine') {
    UI.setStatus(`${card.def.name} cannot attack.`);
    return;
  }
  if (selectedAttackerSlot === slot) {
    selectedAttackerSlot = null;
    UI.clearAllHighlights();
    UI.setStatus('Attacker deselected.');
    return;
  }
  selectedAttackerSlot = slot;
  UI.clearAllHighlights();
  // Only the enemy frontline is ever a target; the reserve never fights.
  UI.highlightSlots('opp-front', true, 'target-highlight');
  UI.setStatus(`${card.def.name} selected -- pick a target.`);
}

// Drop an attacker selection without attacking. Tapping the attacker again
// already did this (see onPlayerCardClick above); P2's "tap empty space /
// release the arc on nothing to cancel" gesture needs it as its own entry
// point. Same three lines that branch does, nothing more.
function cancelAttack() {
  disarmPromotion();
  if (selectedAttackerSlot === null) return;
  selectedAttackerSlot = null;
  UI.clearAllHighlights();
  UI.setStatus('Attack cancelled.');
}

// zone: 'front' | 'reserve'. The opponent's Reserve is wired too (see
// renderAll() below) because Scouting, Sabotage and the Spyglass artifact
// can target it -- an attack never can.
function onOppCardClick(zone, slot, card) {
  if (!store.state || store.combatLocked) return;
  if (store.activeArtifact) { handleArtifactTargetClick(zone, slot, card); return; }
  if (store.activeIslandPower) { handleTargetClick('opp', zone, slot, card); return; }
  if (selectedAttackerSlot === null) return;
  // Attacks target the enemy frontline only (owner ruling 2026-09-16).
  if (zone !== 'front') return;
  doAttack(selectedAttackerSlot, slot);
}

function onPlayerReserveClick(slot, card) {
  if (!store.state || store.combatLocked) return;
  if (store.activeIslandPower) { handleTargetClick('player', 'reserve', slot, card); return; }
  if (store.state.phase === 'ISLAND_CAPTURE') {
    doCaptureIsland(slot, 'reserve');
    return;
  }
  if (store.state.turnOwner !== 1) return;
  // An armed attacker: render/input.js does not light the reserve as a
  // promotion then, so the tap only drops the attacker.
  if (selectedAttackerSlot !== null) { cancelAttack(); return; }
  // QA 2026-09-17 (Motorola g84): "the opponent makes four moves in a row".
  // It did not -- a single tap on a reserve card moved it up and SPENT THE
  // TURN, so a player tapping their reserve to look at it lost turn after
  // turn. Moving up is now two explicit steps: the first tap only picks the
  // card and lights the slot ahead; a tap on that slot moves it. Nothing is
  // spent until then, so a double tap (hero view) is harmless too.
  if (armedPromotion === slot) { disarmPromotion(); UI.setStatus(''); return; }
  if (store.state.p1Front[slot] !== null) {
    disarmPromotion();
    UI.setStatus('The front slot ahead of it is occupied.');
    return;
  }
  armedPromotion = slot;
  applyPromotionArm();
  UI.setStatus(`Tap the lit slot ahead to move ${card.def.name} up -- this uses your turn.`);
}

let armedPromotion = null;   // reserve slot picked for a move up, or null

function disarmPromotion() {
  armedPromotion = null;
  applyPromotionArm();
}
// Kept under its old name for render/hero.js and clearSelection.
function cancelPendingPromotion() { disarmPromotion(); }

// Re-applied after every render: the zone DOM is rebuilt wholesale.
function applyPromotionArm() {
  document.querySelectorAll('.promote-armed, .promote-target').forEach((el) => {
    el.classList.remove('promote-armed', 'promote-target');
  });
  const st = store.state;
  if (armedPromotion === null) return;
  const legal = st && st.phase === PHASE.COMBAT && st.turnOwner === 1 && !store.combatLocked
    && st.p1Reserve[armedPromotion] && st.p1Front[armedPromotion] === null;
  if (!legal) { armedPromotion = null; return; }
  const from = document.querySelector(`#player-reserve .slot[data-slot="${armedPromotion}"]`);
  const to = document.querySelector(`#player-front .slot[data-slot="${armedPromotion}"]`);
  if (from) from.classList.add('promote-armed');
  if (to) to.classList.add('promote-target');
}

// The lit slot is empty, and renderZone puts no click handler on empty slots.
document.addEventListener('click', (e) => {
  if (armedPromotion === null) return;
  const slotEl = e.target.closest && e.target.closest('#player-front .slot.promote-target');
  if (!slotEl) return;
  const slot = armedPromotion;
  armedPromotion = null;
  promoteReserve(slot);
});

function promoteReserve(slot) {
  // Re-checked: the board may have moved on in the 280 ms.
  if (!store.state || store.combatLocked || store.activeIslandPower) return;
  if (store.state.phase !== PHASE.COMBAT || store.state.turnOwner !== 1) return;
  if (selectedAttackerSlot !== null) return;
  if (mpActive) { mpMove(slot); return; }
  const res = moveReserveToFront(store.state, slot);
  UI.setStatus(res.msg);
  if (res.ok) {
    renderAll();
    if (store.state.turnOwner === 2) setTimeout(() => doAiTurn(), 1000);
  }
}

async function doAttack(atkSlot, defSlot) {
  // In a networked match the server is authoritative: send the intent and wait
  // for the frame it broadcasts back. Running the local engine here too would
  // fork the board and then get overwritten on the next update.
  if (mpActive) {
    mpAttack(atkSlot, defSlot);
    selectedAttackerSlot = null;
    UI.clearAllHighlights();
    UI.setStatus('Attack sent...');
    return;
  }
  const res = playerAttack(store.state, atkSlot, defSlot);
  selectedAttackerSlot = null;
  UI.clearAllHighlights();
  UI.setStatus(res.msg.split('\n')[0]);
  UI.addLogEntry(res.msg.split('\n')[0]);

  // Give the player's own attacks the same reveal + lunge/impact animation
  // AI attacks already get (see doAiTurn below). playerAttack() (game.js)
  // now surfaces atkCard/defCard/result the same way aiTurn() does, purely
  // so this presentation step can play -- it doesn't change what the
  // attack decided. Previously this was a synchronous mutate-then-render
  // with zero animation, so a WIN/DRAW target vanished off the board
  // before the player ever saw its face.
  if (res.ok && res.atkCard && res.defCard) {
    store.combatLocked = true;
    try {
      await UI.animateAttack(res.atkCard, res.defCard, res.result);
    } finally {
      store.combatLocked = false;
    }
  }

  renderAll();
  afterAction();
}

function doCaptureIsland(slot, zone) {
  if (mpActive) {
    // Only the round winner garrisons; the server would refuse the loser's
    // pick anyway, so do not send it.
    if (store.state.roundWinner !== 1) return;
    mpCaptureIsland(slot, zone);
    return;
  }
  const res = playerCaptureIsland(store.state, slot, zone);
  UI.setStatus(res.msg.split('\n').pop());
  if (res.ok) {
    renderAll();
    afterAction();
  }
}

function afterAction() {
  if (store.state.phase === PHASE.GAME_OVER) {
    handleGameOver(store.state);
    return;
  }
  // No local AI in a network match -- the opponent is a remote player (or the
  // server's own bot), and its moves arrive as game_update frames.
  if (mpActive) return;
  if (store.state.turnOwner === 2 && store.state.phase === PHASE.COMBAT) {
    setTimeout(() => doAiTurn(), 900);
  }
}

// Records the finished match (local + best-effort remote leaderboard, and
// campaign level progress if this was a campaign game) on top of the
// existing UI.showGameOver() modal -- additive, never blocks the modal.
function handleGameOver(state) {
  UI.showGameOver(state);
  if (state.tutorial) { Tutorial.matchOver(state); return; }
  // A network forfeit ends 0:0 or behind on islands; the server's winner
  // (relative, set by multiplayer.js) decides, not the score.
  const won = state.mpWinner ? state.mpWinner === 1 : state.score[0] > state.score[1];
  Telemetry.gameplay('match_end', {
    // A surrender disconnects before it gets here (see surrenderMatch), so it
    // hands the mode over rather than letting matchMode() re-derive it.
    mode: matchSurrenderedMode || matchMode(state),
    result: won ? 'win' : (state.mpWinner ? 'loss' : state.score[0] === state.score[1] ? 'draw' : 'loss'),
    rounds: Math.max(0, (state.roundNum || 1) - 1),
    duration_sec: matchStartedAt ? Math.round((Date.now() - matchStartedAt) / 1000) : 0,
  });
  matchStartedAt = 0;
  matchSurrenderedMode = '';
  const result = { score: state.score[0], rounds: state.roundNum - 1, won, campaignLevelId: state.campaignLevelId };
  recordGameResult(result);

  // Payout. "First clear" -- taking a voyage's objective for the first time
  // -- is read against the OLD voyage progress (endVoyage below records the
  // clear), so its crystal can only ever be counted once per voyage.
  const atNode = state.voyageMissionId && store.voyage ? nodeById(store.voyage, store.voyage.shipAt) : null;
  const paid = awardMatchRewards({
    won,
    points: state.score[0],
    oppPoints: state.score[1],
    islandsHeld: (state.p1Islands || []).length,
    firstCampaignClear: !!(won && atNode && atNode.kind === 'goal'
      && !loadVoyageProgress().cleared[state.voyageMissionId]),
  });
  // Unspent purchases go back in the hold; in-match drops do not (economy.js).
  returnUnusedToHold(store.matchLoadout || [], state.p1Artifacts || []);
  store.matchLoadout = [];
  UI.renderBalanceBadge(paid.balance);
  const rewardEl = UI.DOM.goReward;
  if (rewardEl) {
    rewardEl.classList.remove('hidden');
    rewardEl.textContent = paid.crystals
      ? `Earned ${paid.gold} gold and ${paid.crystals} crystal${paid.crystals > 1 ? 's' : ''}.`
      : `Earned ${paid.gold} gold.`;
  }
  Progress.matchEnded(state, { won, paid });

  // A battle that a voyage node started reports back to the chart: the node
  // is cleared or the crossing loses time, and the voyage may end right here.
  if (state.voyageMissionId && store.voyage) {
    const outcome = voyageResolveBattle(store.voyage, won);
    saveVoyage(store.voyage);
    if (outcome.done) {
      endVoyage(outcome.won, outcome.won ? 'Objective taken -- voyage complete.' : 'The crossing failed.');
    } else {
      openVoyageScreen(won ? 'Lane cleared.' : 'Beaten off -- the crossing cost time.');
    }
    return;
  }

  const note = UI.DOM.goCampaignNote;
  if (note) note.classList.add('hidden');
}

// ── Island-power targeting (multi-click flows) ─────────────────────
function handleTargetClick(side, zone, idx, card) {
  const power = store.activeIslandPower;
  if (!power) return;

  // Radar is front-line only (game.js / game.py ignore zone): a Reserve tap
  // used to reveal the Front card at the same index instead.
  if (power.id === 'radar' && side === 'opp' && zone === 'front') {
    if (!card) return;
    executeIslandPower('radar', { slot: idx, zone });
  } else if (power.id === 'camouflage' && side === 'player') {
    executeIslandPower('camouflage', { slot: idx, zone });
  } else if (power.id === 'teleportation' && side === 'player' && zone === 'front') {
    executeIslandPower('teleportation', { slot: idx });
  } else if (power.id === 'scouting' && side === 'opp' && zone === 'reserve') {
    if (!card) return;
    if (power.args.slot1 === undefined) {
      power.args.slot1 = idx;
      UI.setStatus("Scouting: pick the opponent's second Reserve card.");
    } else if (idx !== power.args.slot1) {
      power.args.slot2 = idx;
      executeIslandPower('scouting', power.args);
    }
  } else if (power.id === 'secret_move' && side === 'player' && zone === 'reserve') {
    if (!card || power.args.order.includes(idx)) return;
    power.args.order.push(idx);
    if (power.args.order.length >= power.args.needed) {
      executeIslandPower('secret_move', power.args);
    } else {
      UI.setStatus(`Secret Move: picked ${power.args.order.length}/${power.args.needed} -- pick the next.`);
    }
  } else if (power.id === 'sabotage' && side === 'opp') {
    if (!card) return;
    executeIslandPower('sabotage', { slot: idx, zone });
  }
}

// ── Artifact targeting/use ─────────────────────────────────────────
function onArtifactClick(artifactId) {
  if (!store.state || store.combatLocked) return;
  if (store.state.turnOwner !== 1 || store.state.phase !== PHASE.COMBAT) return;
  const def = ARTIFACTS[artifactId];
  if (!def) return;

  if (def.needsTarget === 'enemy-card') {
    store.activeArtifact = artifactId;
    UI.clearAllHighlights();
    UI.highlightSlots('opp-front', true, 'target-highlight');
    UI.highlightSlots('opp-reserve', true, 'target-highlight');
    UI.setStatus(`${def.name}: pick an enemy card to reveal.`);
  } else {
    executeArtifact(artifactId, {});
  }
}

function handleArtifactTargetClick(zone, idx) {
  const artifactId = store.activeArtifact;
  if (!artifactId) return;
  executeArtifact(artifactId, { slot: idx, zone });
}

function executeArtifact(artifactId, args) {
  const res = useArtifact(store.state, artifactId, args);
  UI.setStatus(res.msg);
  if (res.ok) renderAll();
  store.activeArtifact = null;
  UI.clearAllHighlights();
}

function onHandCardClick(idx, card) {
  if (!store.state || store.combatLocked) return;
  if (store.activeIslandPower) {
    const power = store.activeIslandPower;
    if (power.id === 'rapid_support') {
      executeIslandPower('rapid_support', { handIdx: idx });
      return;
    }
  }
  if (store.state.phase === PHASE.PREP) {
    // A placed card is picked up: tapping the hand puts it back there.
    if (boardPick) { returnPickedCard(); return; }
    pendingHandIdx = idx;
    pendingPlaceSent = null;
    UI.setStatus(`${card.def.name} -- click an empty slot to place.`);
    // Tap-to-place is the fallback for P2's drag placement and lights the
    // same legal slots -- but it changes no state, so nothing would
    // re-render and input.js would never notice. Tell it directly.
    Input.refresh();
    return;
  }
  UI.setStatus(`${card.def.name} -- drag to a slot, or click a slot to place`);
}

let pendingHandIdx = null;
// Online: a 'place' sent for pendingHandIdx and not yet confirmed by a frame
// ({ handLen, inFlight, timer }).
let pendingPlaceSent = null;
const PLACE_RETRY_MS = 1500;
// PREP: a placed card picked up by a tap ({ zone, slot }), waiting for a
// free slot to move to or for the hand to take it back. Owner 2026-09-16:
// tapping a placed card used to send it straight back to hand, which a
// press that ran long did without the player meaning it.
let boardPick = null;

function setBoardPick(pick) {
  boardPick = pick;
  if (pick) pendingHandIdx = null;
}

function clearPrepPick() {
  if (pendingHandIdx === null && !boardPick) return;
  pendingHandIdx = null;
  pendingPlaceSent = null;
  boardPick = null;
  Input.refresh();
}

function moveBoardCard(from, zone, slot) {
  if (!store.state || store.state.phase !== PHASE.PREP || mpActive) return false;
  const res = moveCard(store.state, from.zone, from.slot, zone, slot);
  boardPick = null;
  UI.setStatus(res.msg);
  if (res.ok) renderAll();
  else Input.refresh();
  return res.ok;
}

function returnBoardCard(from) {
  if (!store.state || store.state.phase !== PHASE.PREP || mpActive) return false;
  boardPick = null;
  const returned = returnCard(store.state, from.zone, from.slot);
  if (!returned) { Input.refresh(); return false; }
  renderAll();
  updateReadyButton();
  UI.setStatus(`${returned.def.name} returned to hand`);
  return true;
}

function returnPickedCard() {
  if (boardPick) returnBoardCard(boardPick);
}

function onPrepEmptySlotClick(zone, slot) {
  if (!store.state || store.state.phase !== PHASE.PREP) return;
  if (boardPick) { moveBoardCard(boardPick, zone, slot); return; }
  if (pendingHandIdx === null) return;
  if (mpActive) {
    // The pick is kept until a server frame shows the card placed (see the
    // update handler in startMultiplayer): a rate-limited or refused 'place'
    // would otherwise be lost with nothing on screen to say so.
    // One 'place' in flight at a time: a second tap before the frame could
    // otherwise place the NEXT card at the same hand index. An error frame
    // (rate limit, illegal slot) or PLACE_RETRY_MS frees the pick for a retry.
    if (pendingPlaceSent && pendingPlaceSent.inFlight) return;
    if (mpPlace(pendingHandIdx, zone, slot)) {
      const sent = { handLen: store.state.p1Hand.length, inFlight: true };
      sent.timer = setTimeout(() => { sent.inFlight = false; }, PLACE_RETRY_MS);
      pendingPlaceSent = sent;
      UI.setStatus('Placing...');
    }
    return;
  }
  const res = placeCard(store.state, pendingHandIdx, zone, slot);
  UI.setStatus(res.msg);
  pendingHandIdx = null;
  if (res.ok) { renderAll(); updateReadyButton(); }
  else Input.refresh(); // rejected placement re-renders nothing: clear the glow

}

function onPrepCardClick(slot, card) {
  if (!store.state || store.state.phase !== PHASE.PREP) return;
  // The wire protocol has no "unplace": placement is final in a network match.
  if (mpActive) { UI.setStatus('Placement is final in a network match.'); return; }
  const zone = store.state.p1Front.includes(card) ? 'front' : 'reserve';
  // Tap the picked card again to put it down where it is.
  if (boardPick && boardPick.zone === zone && boardPick.slot === slot) {
    clearPrepPick();
    UI.setStatus(`${card.def.name} stays in place.`);
    return;
  }
  setBoardPick({ zone, slot });
  UI.setStatus(`${card.def.name} -- tap a free slot to move it, or your hand to take it back.`);
  Input.refresh();
}

function updateReadyButton() {
  if (!UI.DOM.btnReady || !store.state) return;
  const placed = store.state.p1Front.filter(Boolean).length + store.state.p1Reserve.filter(Boolean).length;
  UI.DOM.btnReady.disabled = placed < 4;
}

export async function doAiTurn() {
  if (!store.state || store.state.turnOwner !== 2 || store.state.phase !== PHASE.COMBAT || store.combatLocked) return;
  store.combatLocked = true;

  // aiTurn() now surfaces which attacker/defender it actually used for a
  // real attack (see ai.js's return-shape comment) -- purely presentation
  // info, the pick itself is still 100% selectAttack()'s decision -- so
  // the AI's attacks get the same lunge+impact beat as the player's own
  // (UI.animateAttack) instead of just popping into their post-attack state.
  const shieldArmedBefore = store.state.p1Shielded;

  let result = { msg: '' };
  try {
    result = await aiTurn(store.state);
    if (result.atkCard && result.defCard) {
      // UI.animateAttack's existing (voicy-dev) signature takes a
      // WIN/LOSS/DRAW/NONE result string (see render/fx.js), not
      // the {atkSurvived, defSurvived} shape ai.js surfaces -- derive it
      // from the same two booleans resolveAttack() itself would have
      // produced: neither survives -> DRAW, only the defender is gone ->
      // WIN, only the attacker is gone -> LOSS, both still standing ->
      // NONE (Smoke Bomb block).
      const impactResult = !result.atkSurvived && !result.defSurvived ? 'DRAW'
        : !result.defSurvived ? 'WIN'
        : !result.atkSurvived ? 'LOSS'
        : 'NONE';
      await UI.animateAttack(result.atkCard, result.defCard, impactResult);
    }
  } finally {
    store.combatLocked = false;
  }

  if (result.msg) UI.addLogEntry(result.msg.split('\n')[0]);
  renderAll();

  // Smoke Bomb (artifact) negates the next attack made against the player
  // -- resolveAttack() (game.js) flips state.p1Shielded off the instant it
  // actually blocks one, so that true->false transition is a reliable
  // signal the block just fired (as opposed to the shield sitting
  // armed-but-never-triggered). Flash the same protective glow Camouflage
  // uses (see executeIslandPower above) on the card that got shielded,
  // read after renderAll() so it lands on the freshly rendered element.
  if (shieldArmedBefore && !store.state.p1Shielded && result.defCard) {
    UI.showShieldEffect(result.defCard.uid);
  }

  if (store.state.phase === PHASE.GAME_OVER) {
    handleGameOver(store.state);
  } else if (store.state.turnOwner === 2 && store.state.phase === PHASE.COMBAT) {
    setTimeout(() => doAiTurn(), 900);
  }
}

// ── Menu / lifecycle ─────────────────────────────────────────────
// `opts` -> { campaignLevelId } passed straight through to createGameState.
function startGame(difficulty = 2, opts = {}) {
  // Abandoning a live match from the menu never reached handleGameOver, so the
  // artifacts loadHoldIntoMatch() had already taken out of the hold were lost
  // for good. Return whatever is still unspent before the new match loads the
  // hold again.
  if (store.state && store.state.phase !== PHASE.GAME_OVER && (store.matchLoadout || []).length) {
    returnUnusedToHold(store.matchLoadout, store.state.p1Artifacts || []);
    store.matchLoadout = [];
  }
  // Drop the previous match's interaction baselines before the new board
  // exists. ui.js's hideGameOver() already does this for fx/screens/ocean;
  // input.js is reset from here instead because app.js, not ui.js, owns it.
  Input.resetMatchState();
  store.state = createGameState(difficulty, opts);
  // Artifacts bought at the Trading Post sail with the player: the hold is
  // emptied into this match here, and whatever goes unspent is returned at
  // GAME_OVER (see handleGameOver). Kept out of createGameState so the pure
  // engine stays independent of localStorage.
  store.matchLoadout = loadHoldIntoMatch();
  if (store.matchLoadout.length) {
    store.state.p1Artifacts = [...(store.state.p1Artifacts || []), ...store.matchLoadout];
  }
  UI.renderBalanceBadge(getBalance());
  // P8 telemetry. matchMode() reads the same fields the game-over path does,
  // so match_start and match_end always agree on what kind of match it was.
  matchStartedAt = Date.now();
  // A new match rewinds the round counter, so drop the previous match's
  // round baseline rather than letting trackRoundEnd diff across matches.
  lastTrackedRound = 0;
  Telemetry.gameplay('match_start', { mode: matchMode(store.state) });
  UI.showScreen('game');
  UI.hideGameOver();
  renderAll();
  updateReadyButton();
  if (store.state.turnOwner === 2) {
    // AI never moves during PREP; PREP always waits on the human to lock in.
  }
}

// ── Profile ─────────────────────────────────────────────────────────
let pendingAvatarId = null;

function refreshMenuProfile() {
  const p = loadProfile();
  UI.renderMenuProfile(p, avatarOf(p));
}

function openProfileScreen() {
  pendingAvatarId = loadProfile().avatarId;
  renderProfileForm();
  UI.showScreen('profile');
}

// Re-rendered on every avatar pick; the nick/tag inputs keep whatever the
// player has typed so picking an avatar does not wipe an unsaved name.
function renderProfileForm() {
  const typedNick = UI.DOM.profileNick ? UI.DOM.profileNick.value : null;
  const typedTag = UI.DOM.profileTag ? UI.DOM.profileTag.value : null;
  const view = { ...loadProfile(), avatarId: pendingAvatarId };
  UI.renderProfileScreen(view, AVATARS, avatarOf, (id) => {
    pendingAvatarId = id;
    renderProfileForm();
  });
  if (typedNick !== null && typedNick !== '' && UI.DOM.profileNick) UI.DOM.profileNick.value = typedNick;
  if (typedTag !== null && typedTag !== '' && UI.DOM.profileTag) UI.DOM.profileTag.value = typedTag;
}

function saveProfileFromForm() {
  const nick = UI.DOM.profileNick ? UI.DOM.profileNick.value : '';
  const tag = UI.DOM.profileTag ? UI.DOM.profileTag.value : '';
  const updated = updateProfile({ nick, tag, avatarId: pendingAvatarId });
  if (updated.nick !== String(nick).trim() && String(nick).trim().length < 2) {
    UI.setProfileError('Nickname: at least 2 characters.');
    return;
  }
  refreshMenuProfile();
  UI.showScreen('menu');
}

// ── Multiplayer ─────────────────────────────────────────────────────
// Room codes are what the server validates (^[A-Za-z0-9_-]{4,16}$), so the
// same string both players type is the whole matchmaking mechanism. A lone
// player waits; the server-side bot joins only through the opt-in
// "Play the server captain" button.
// Remembered across the error -> close pair the server sends on a refusal.
let lastMpError = '';

function startMultiplayer(room, name) {
  mpSetHandlers({
    update: (state, meta) => {
      const prevPhase = store.state && store.state.multiplayer ? store.state.phase : null;
      store.state = state;
      // A frame that shows our placement landed (the card left the hand)
      // settles the tap-to-place pick; until then it stays armed, so a
      // throttled 'place' can simply be tapped again (see onPrepEmptySlotClick).
      if (pendingHandIdx !== null && pendingPlaceSent
          && (state.phase !== PHASE.PREP || state.p1Hand.length < pendingPlaceSent.handLen)) {
        pendingHandIdx = null;
        pendingPlaceSent = null;
      }
      UI.showScreen('game');
      if (meta.kind === 'start') {
        // The server restarts a finished room when someone joins; drop the
        // previous match's game-over modal.
        UI.hideGameOver();
        UI.setStatus(`Match against ${meta.opponent || 'opponent'}`);
      }
      if (meta.log) String(meta.log).split('\n').filter(Boolean).forEach((l) => UI.addLogEntry(l));
      renderAll();
      updateReadyButton();
      if (state.phase === 'ISLAND_CAPTURE' && prevPhase !== 'ISLAND_CAPTURE') {
        UI.setStatus(state.roundWinner === 1 ? 'You won the round -- tap a ship to hold the island'
          : state.roundWinner === 2 ? 'The opponent won the round' : 'The round is a draw');
      }
      if (meta.kind === 'over') {
        // The server's own end reason (forfeit, disconnect, a normal points
        // win) only exists on this frame -- multiplayer.js passes it through
        // as meta.reason and adaptState does not put it on the state. Stash
        // it so the game-over screen can print it (render/screens.js's
        // skinGameOver). No extra network call: this is the same frame.
        store.state.mpReason = meta.reason || '';
        // Same payout/leaderboard path as a local match -- handleGameOver
        // owns showGameOver, rewards and the artifact hold.
        handleGameOver(store.state);
      }
    },
    event: (type, msg) => {
      if (type === 'error') {
        // The server tags the category (rate_limit / illegal_move /
        // not_your_turn). A throttled click is not a rule violation, and a
        // refused join must survive the close that follows it.
        const code = (msg && msg.code) || '';
        const text = (msg && msg.msg) || 'Server error';
        lastMpError = code === 'rate_limit' ? '' : text;
        // The 'place' this pick sent was refused: the pick stays, tap again.
        if (pendingPlaceSent) pendingPlaceSent.inFlight = false;
        UI.setStatus(code === 'rate_limit' ? 'Too fast -- try again in a second.'
          : code === 'not_your_turn' ? 'Not your turn yet.'
          : text);
      }
      if (type === 'room_state') {
        const players = (msg && msg.players) || [];
        const waiting = msg && msg.phase === 'waiting' && players.length === 1;
        UI.setStatus(waiting
          ? 'Waiting for an opponent -- share the room code, or take on the server captain.'
          : 'Opponent found.');
        // The bot is opt-in: while alone in a waiting room, offer the button
        // back on the join screen; hide it the moment a second seat fills.
        UI.setBotButtonVisible(waiting);
        if (waiting) UI.showScreen('multiplayer');
      }
      if (type === 'close') {
        // A rematch closes the socket on purpose and reopens it right after.
        if (msg && msg.intentional) return;
        // close(1008) is a refusal (room full), not a lost connection: keep
        // the server's own wording and send the player back to the join
        // screen, where they can pick another room code.
        const refused = msg && msg.code === 1008;
        // multiplayer.js only marks a REMATCH close as intentional, so every
        // other deliberate exit (Back, Surrender, Main menu) has to be
        // recognised here or it would be reported as a lost connection.
        const voluntary = leavingRoom;
        leavingRoom = false;
        if (!refused && !voluntary) Telemetry.gameplay('connection_lost', { mode: 'online' });
        UI.setStatus(refused ? (lastMpError || 'That room is full.') : 'Disconnected from the room.');
        UI.setBotButtonVisible(false);
        if (refused) UI.showScreen('multiplayer');
        lastMpError = '';
      }
    },
  });
  // Same per-match reset startGame() does; an online match never goes through
  // it, so the previous match's hand rects and known-card set would otherwise
  // survive into the first server frame.
  Input.resetMatchState();
  UI.showScreen('game');
  // P8 telemetry: an online match never goes through startGame() -- the board
  // arrives as server frames -- so the pair to handleGameOver's match_end is
  // raised here, with the same round baseline reset startGame does.
  lastTrackedRound = 0;
  matchStartedAt = Date.now();
  Telemetry.gameplay('match_start', { mode: 'online' });
  UI.setStatus(`Connecting to room ${room}...`);
  leavingRoom = false;
  mpConnect(room, name);
}

function openMultiplayerScreen() {
  if (UI.DOM.mpName && !UI.DOM.mpName.value) UI.DOM.mpName.value = handleOf();
  UI.renderMultiplayer((room, name) => {
    const clean = String(room || '').trim();
    if (!/^[A-Za-z0-9_-]{4,16}$/.test(clean)) {
      UI.setMultiplayerError('Room code: 4-16 letters, digits, - or _');
      return;
    }
    startMultiplayer(clean, String(name || '').trim() || handleOf());
  });
  UI.showScreen('multiplayer');
}

// ── Campaign ────────────────────────────────────────────────────────
function openCampaignScreen() {
  // The campaign is 20 voyages now; the chart on this screen picks WHICH
  // voyage, and each voyage has its own chart you sail inside (voyage.js).
  const progress = loadVoyageProgress();
  const missions = Array.from({ length: MISSION_COUNT }, (_, i) => {
    const meta = missionMeta(i + 1);
    return {
      id: meta.id,
      name: meta.name,
      blurb: `${meta.moves} moves, ${meta.columns} legs to the objective.`,
      map: missionDot(meta.id),
    };
  });
  UI.renderCampaignMap(missions, { unlockedLevel: progress.unlocked, results: toResults(progress) }, (id) => {
    startVoyage(id);
  });
  UI.showScreen('campaign');
}

function toResults(progress) {
  const out = {};
  Object.keys(progress.cleared || {}).forEach((id) => { out[id] = { won: true }; });
  return out;
}

// Twenty dots read badly in one row, so the campaign chart runs them as four
// sweeps down the map -- left to right, then back, like a sea route.
function missionDot(id) {
  const perRow = 5;
  const row = Math.floor((id - 1) / perRow);
  let col = (id - 1) % perRow;
  if (row % 2 === 1) col = perRow - 1 - col;
  return { x: 12 + col * 19, y: 16 + row * 23 };
}

// ── Voyage (movement inside one mission) ────────────────────────────
function startVoyage(missionId) {
  const existing = loadVoyage();
  store.voyage = (existing && existing.missionId === missionId && !existing.done)
    ? existing
    : generateChart(missionId);
  saveVoyage(store.voyage);
  openVoyageScreen('Choose a heading.');
}

function openVoyageScreen(msg) {
  const chart = store.voyage;
  if (!chart) { UI.showScreen('campaign'); return; }
  UI.renderVoyage(chart, NODE_INFO, onSailTo);
  UI.renderVoyageHud(chart);
  UI.renderVoyageLegend();
  UI.setVoyageLog(msg || '');
  UI.showScreen('voyage');
  if (isStranded(chart)) endVoyage(false, 'Out of moves -- the voyage ends here.');
}

function onSailTo(nodeId) {
  const chart = store.voyage;
  if (!chart) return;
  const res = voyageMove(chart, nodeId);
  saveVoyage(chart);
  if (!res.ok) { UI.setVoyageLog(res.msg); return; }
  if (res.battle) {
    // Hand off to the ordinary card battle. store.voyage stays put, and
    // handleGameOver routes back here instead of to the campaign screen.
    const node = nodeById(chart, chart.shipAt);
    startGame(chart.difficulty + (node.kind === 'goal' ? 1 : 0), { voyageMissionId: chart.missionId });
    return;
  }
  openVoyageScreen(res.msg);
}

function endVoyage(won, msg) {
  const chart = store.voyage;
  if (!chart) return;
  chart.done = true;
  chart.won = won;
  recordVoyageResult(chart.missionId, won);
  saveVoyage(null);
  store.voyage = null;
  UI.setVoyageLog(msg || '');
  openCampaignScreen();
}

// -- Trading Post (shop) ---------------------------------------------
// Reads the catalogue off economy.js's price table, so an artifact added to
// artifacts.js without a price simply doesn't go on sale (rather than
// showing up free).
function renderShopScreen() {
  const balance = getBalance();
  const items = ARTIFACT_IDS
    .filter((id) => priceOf(id))
    .map((id) => ({ id, def: ARTIFACTS[id], price: priceOf(id), affordable: canAfford(id) }));
  UI.renderShop({ balance, items, hold: getHold() }, (id) => {
    const res = buyArtifact(id);
    UI.setStatus(res.msg);
    renderShopScreen();               // repaint prices/affordability off the new balance
    UI.renderBalanceBadge(res.balance);
  });
}

function openShopScreen() {
  renderShopScreen();
  UI.showScreen('shop');
}
// ── Leaderboard ─────────────────────────────────────────────────────
function showLocalLeaderboard() {
  UI.renderLeaderboardList(getLocalScores());
}

async function showRemoteLeaderboard() {
  UI.renderLeaderboardList(null, 'Loading...');
  const remote = await fetchRemoteLeaderboard(10);
  if (remote === null) {
    // Backend unreachable or not yet deployed -- degrade to local scores
    // rather than showing a dead screen.
    showLocalLeaderboard();
    return;
  }
  UI.renderLeaderboardList(remote, 'No global scores yet -- be the first!');
}

function openLeaderboard() {
  if (UI.DOM.leaderboardModal) UI.DOM.leaderboardModal.classList.remove('hidden');
  showLocalLeaderboard();
}

// ── P8: pause, feedback context, telemetry helpers ──────────────────
let matchStartedAt = 0;
// Set immediately before a disconnect this client asked for, and cleared by
// the `close` handler that follows. Without it every voluntary exit from a
// room would be recorded as a connection_lost.
let leavingRoom = false;
// The match mode captured by a surrender before it drops the socket (see
// surrenderMatch); read once by handleGameOver and cleared there.
let matchSurrenderedMode = '';

function leaveRoom() {
  leavingRoom = true;
  mpDisconnect();
}

function matchMode(state) {
  if (mpActive) return 'online';
  if (state && state.voyageMissionId) return 'voyage';
  if (state && state.campaignLevelId) return 'campaign';
  return 'ai';
}

function inLiveMatch() {
  return !!store.state
    && store.state.phase !== PHASE.GAME_OVER
    && !UI.DOM.game.classList.contains('hidden');
}

// The context line on a feedback message: enough to know WHERE the player
// was when they wrote it, and nothing they typed.
function feedbackContext() {
  const st = store.state;
  const onGame = UI.DOM.game && !UI.DOM.game.classList.contains('hidden');
  return {
    screen: onGame ? 'match' : 'menu',
    mode: matchMode(st),
    round: onGame && st ? st.roundNum : null,
    score: onGame && st ? st.score : null,
  };
}

function openFeedbackForm() {
  openFeedback(feedbackContext());
}

// Surrender. There is no forfeit in game.js and no resign message on the
// wire, so the match is ended locally the way a lost one ends: mark the
// opponent the winner (the same `mpWinner` field a server forfeit sets, and
// the only field showGameOver/handleGameOver consult for the verdict) and go
// through the ordinary game-over path, so the leaderboard entry, the payout
// and the artifact hold are all settled exactly as they would be.
function surrenderMatch() {
  const st = store.state;
  if (!st || st.phase === PHASE.GAME_OVER) return;
  // The opponent's client is told by the server when this socket drops --
  // that is the existing leave path, the same one #btn-mp-back uses. Read the
  // mode BEFORE it, since mpDisconnect clears mpActive and matchMode() would
  // then call an online surrender an AI one.
  const mode = matchMode(st);
  if (mpActive) leaveRoom();
  matchSurrenderedMode = mode;
  st.mpWinner = 2;
  st.mpReason = 'surrendered';
  st.phase = PHASE.GAME_OVER;
  renderAll();
  handleGameOver(st);
}

// Abandon the match for the main menu. handleGameOver is the ONLY place
// artifacts bought at the Trading Post come back out of a match, so leaving
// early has to return them itself or they are silently lost (startGame has
// carried the same guard since the shop landed).
function leaveMatchForMenu() {
  const st = store.state;
  if (mpActive) leaveRoom();
  if (st && st.phase !== PHASE.GAME_OVER && (store.matchLoadout || []).length) {
    returnUnusedToHold(store.matchLoadout, st.p1Artifacts || []);
    store.matchLoadout = [];
  }
  if (st && st.voyageMissionId && store.voyage) saveVoyage(store.voyage);
  matchStartedAt = 0;
  UI.hideGameOver();
  UI.showScreen('menu');
  refreshMenuProfile();
}

// ── Settings ────────────────────────────────────────────────────────
// Currently one toggle (card art); renderSettings()/SETTINGS_TOGGLES in
// ui.js are structured so adding more later is just adding another entry
// there -- this handler doesn't need to change per-setting since it
// dispatches purely off the `key` the checkbox reports.
function openSettings() {
  // Sound and vibration are persisted by render/audio.js under their own
  // localStorage keys (it has to be able to read them during module init,
  // long before this modal exists), so they are merged in for rendering and
  // routed back out below rather than going through setSetting().
  const settings = { ...loadSettings(), sound: Audio.isSoundOn(), haptics: Audio.isHapticsOn() };
  UI.renderSettings(settings, (key, value) => {
    if (key === 'sound') { Audio.setSoundOn(value); return; }
    if (key === 'haptics') { Audio.setHapticsOn(value); return; }
    const updated = setSetting(key, value);
    if (key === 'cardArt') UI.applyCardArtSetting(updated.cardArt);
  }, {
    // P8: the Telemetry section and the feedback entry point. Rendered by
    // render/telemetry.js itself (it owns the modes, the storage keys and
    // the wording); ui.js only gives it the container.
    renderExtras: (host) => Telemetry.renderTelemetrySection(host),
    onFeedback: openFeedbackForm,
  });
  if (UI.DOM.settingsModal) UI.DOM.settingsModal.classList.remove('hidden');
}

function onReady() {
  if (!store.state) return;
  if (mpActive) { mpReady(); UI.setStatus('Waiting for the opponent...'); return; }
  // Let the AI deploy with its own policy first; lockIn()'s autoPlace(2)
  // would otherwise deal seat 2 in raw hand order. autoPlace no-ops once
  // the slots are full.
  aiDeploy(store.state, 2);
  const res = lockIn(store.state);
  if (!res.ok) { UI.setStatus(res.msg); return; }
  const lines = res.msg.split('\n').filter(Boolean);
  // lockIn() runs checkRoundEnd() like every action: the side to move may
  // have no legal attack, and the round is over before it began.
  if (lines.length > 1) lines.slice(1).forEach((l) => UI.addLogEntry(l));
  UI.setStatus(lines[lines.length - 1]);
  renderAll();
  if (store.state.phase === PHASE.COMBAT) {
    holdWhileBandSlides();
    if (store.state.turnOwner === 2) setTimeout(() => doAiTurn(), 900);
    return;
  }
  // ISLAND_CAPTURE waits for the player's garrison pick (the status says
  // so); a lost or drawn round is already resolved and back in PREP.
  updateReadyButton();
  afterAction();
}

// Lock-in moves the island band to the top: .opp-section slides down for
// 0.5 s (render/stage.css .band-top) while the AI's fleet flies into its
// slots (ui.js's .flying, staggered), and render/fx.js's attack flight reads
// live rects -- an attack in that window lands where the target WAS. Hold
// the board (the same combatLocked every input path checks) until the slide
// has ended (transitionend, or BAND_SLIDE_FALLBACK_MS) and no enemy card is
// still in the air, never longer than the AI's own 900 ms. No transition
// (prefers-reduced-motion, a landscape phone where the band does not move):
// no wait.
const BAND_SLIDE_FALLBACK_MS = 550;
const BOARD_SETTLE_MAX_MS = 900;
function holdWhileBandSlides() {
  const opp = document.querySelector('#game-screen .opp-section');
  if (!opp || store.combatLocked) return;
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const cs = getComputedStyle(opp);
  const props = cs.transitionProperty.split(',').map((p) => p.trim());
  const durs = cs.transitionDuration.split(',').map((d) => parseFloat(d) || 0);
  const i = props.findIndex((p) => p === 'transform' || p === 'all');
  if (i < 0 || !durs[i % durs.length]) return;
  store.combatLocked = true;
  let slid = false;
  let done = false;
  const flying = () => !!opp.querySelector('.card.flying');
  const release = () => {
    if (done) return;
    done = true;
    opp.removeEventListener('transitionend', onEnd);
    opp.removeEventListener('animationend', onEnd);
    clearTimeout(slideTimer);
    clearTimeout(capTimer);
    store.combatLocked = false;
    Input.refresh();
  };
  const settle = () => { if (slid && !flying()) release(); };
  const onEnd = (e) => {
    if (e.type === 'transitionend' && e.target === opp && e.propertyName === 'transform') slid = true;
    // ui.js drops .flying in its own animationend listener, which may run
    // after this one: look again on the next frame.
    requestAnimationFrame(settle);
  };
  opp.addEventListener('transitionend', onEnd);
  opp.addEventListener('animationend', onEnd);
  const slideTimer = setTimeout(() => { slid = true; settle(); }, BAND_SLIDE_FALLBACK_MS);
  const capTimer = setTimeout(release, BOARD_SETTLE_MAX_MS);
}

function onAutoPlace() {
  if (!store.state || store.state.phase !== PHASE.PREP) return;
  if (mpActive) { mpAutoPlace(); return; }
  autoPlace(store.state, 1);
  renderAll();
  updateReadyButton();
}

function initEvents() {
  // P2 "Input". Every callback here is an existing handler -- input.js
  // never decides legality, it only delivers gestures to these.
  Input.init({
    store,
    PHASE,
    getAttackerSlot: () => selectedAttackerSlot,
    selectAttacker: (slot) => {
      const card = store.state && store.state.p1Front[slot];
      if (card) onPlayerCardClick(slot, card);
    },
    attackTarget: (zone, slot) => {
      const card = store.state && (zone === 'reserve' ? store.state.p2Reserve : store.state.p2Front)[slot];
      if (card) onOppCardClick(zone, slot, card);
    },
    cancelAttack,
    getPending: () => pendingHandIdx,
    setPending: (idx) => { pendingHandIdx = idx; if (idx !== null) boardPick = null; },
    placeFromHand: (idx, zone, slot) => { boardPick = null; pendingHandIdx = idx; onPrepEmptySlotClick(zone, slot); },
    // PREP moves of an already placed card (drag, or tap then tap).
    canMoveBoard: () => !mpActive,
    getBoardPick: () => boardPick,
    setBoardPick,
    clearPrepPick,
    moveBoard: moveBoardCard,
    returnBoard: returnBoardCard,
  });
  // P13: hold a face-up card for 400 ms to see it at hero size. Hero owns
  // no rules either; it only needs to drop whatever gesture input.js had
  // started on the same press, and a way to build a big island card.
  Hero.init({
    store,
    abortGesture: Input.abortGesture,
    onSecondTap: cancelPendingPromotion,
    getPhase: () => (store.state ? store.state.phase : null),
    // A double tap opens the hero; whatever its first tap selected (a hand
    // card, a placed card, an attacker) is dropped.
    clearSelection: () => {
      const picked = pendingHandIdx !== null || !!boardPick;
      clearPrepPick();
      if (picked) UI.setStatus('');
      cancelAttack();
      cancelPendingPromotion();
    },
    buildIsland: (def) => buildIslandEl(def, 'big', {}),
  });

  UI.setupDropZones((handIdx, zone, slot) => {
    if (mpActive) { mpPlace(handIdx, zone, slot); return; }
    const res = placeCard(store.state, handIdx, zone, slot);
    UI.setStatus(res.msg);
    if (res.ok) { renderAll(); updateReadyButton(); }
  });

  document.querySelectorAll('#player-front .slot.empty, #player-reserve .slot.empty')
    .forEach(() => {}); // slots are re-rendered each frame; click delegation used instead

  document.body.addEventListener('click', (e) => {
    if (boardPick && store.state && store.state.phase === PHASE.PREP
        && e.target.closest('#player-hand') && !e.target.closest('.card')) {
      returnPickedCard();
      return;
    }
    const slotEl = e.target.closest('.slot.empty');
    if (!slotEl || (pendingHandIdx === null && !boardPick)) return;
    const zone = slotEl.dataset.zone;
    const slot = parseInt(slotEl.dataset.slot, 10);
    onPrepEmptySlotClick(zone, slot);
  });

  if (UI.DOM.btnProfile) UI.DOM.btnProfile.addEventListener('click', openProfileScreen);
  if (UI.DOM.btnProfileSave) UI.DOM.btnProfileSave.addEventListener('click', saveProfileFromForm);
  if (UI.DOM.btnProfileBack) UI.DOM.btnProfileBack.addEventListener('click', () => UI.showScreen('menu'));
  if (UI.DOM.btnMultiplayer) UI.DOM.btnMultiplayer.addEventListener('click', openMultiplayerScreen);
  if (UI.DOM.btnMpBot) UI.DOM.btnMpBot.addEventListener('click', () => {
    mpAddBot();
    UI.setBotButtonVisible(false);
    UI.showScreen('game');
  });
  if (UI.DOM.btnMpBack) UI.DOM.btnMpBack.addEventListener('click', () => { leaveRoom(); UI.showScreen('menu'); });
  if (UI.DOM.btnShop) UI.DOM.btnShop.addEventListener('click', openShopScreen);
  if (UI.DOM.btnShopBack) UI.DOM.btnShopBack.addEventListener('click', () => UI.showScreen('menu'));
  if (UI.DOM.btnGoShop) UI.DOM.btnGoShop.addEventListener('click', () => {
    UI.hideGameOver();
    openShopScreen();
  });
  if (UI.DOM.btnReady) UI.DOM.btnReady.addEventListener('click', onReady);
  if (UI.DOM.btnAuto) UI.DOM.btnAuto.addEventListener('click', onAutoPlace);
  if (UI.DOM.btnRules) UI.DOM.btnRules.addEventListener('click', () => {
    UI.renderRulesMatrix();
    if (UI.DOM.rulesModal) UI.DOM.rulesModal.classList.remove('hidden');
  });
  if (UI.DOM.btnCloseRules) UI.DOM.btnCloseRules.addEventListener('click', () => {
    if (UI.DOM.rulesModal) UI.DOM.rulesModal.classList.add('hidden');
  });

  // Readable reference view -- opens over the in-play board (works from
  // PREP/COMBAT/etc, doesn't require any particular phase), always
  // re-rendered fresh off current state so newly-revealed opponent cards
  // show up immediately, no stale cache.
  if (UI.DOM.btnReference) UI.DOM.btnReference.addEventListener('click', () => {
    UI.renderReferenceView(store.state);
    if (UI.DOM.referenceModal) UI.DOM.referenceModal.classList.remove('hidden');
  });
  if (UI.DOM.btnCloseReference) UI.DOM.btnCloseReference.addEventListener('click', () => {
    if (UI.DOM.referenceModal) UI.DOM.referenceModal.classList.add('hidden');
  });

  // Settings (currently: card-art toggle) -- reachable from the main menu.
  // openSettings() re-renders off the freshly-loaded persisted values every
  // time it opens, so it always reflects the actual current setting even
  // if it was changed in another tab/session.
  if (UI.DOM.btnSettings) UI.DOM.btnSettings.addEventListener('click', openSettings);
  if (UI.DOM.btnCloseSettings) UI.DOM.btnCloseSettings.addEventListener('click', () => {
    if (UI.DOM.settingsModal) UI.DOM.settingsModal.classList.add('hidden');
  });

  // P8: #btn-pause has been in the top bar since P0 with nothing behind it.
  // pause.js owns the overlay, Esc and the back-gesture history entry; every
  // action below is a handler app.js already had, or the two new ones above.
  Pause.initPause({
    inMatch: inLiveMatch,
    onSettings: openSettings,
    onFeedback: openFeedbackForm,
    onSurrender: surrenderMatch,
    onMainMenu: leaveMatchForMenu,
  });
  if (UI.DOM.btnPause) UI.DOM.btnPause.addEventListener('click', () => Pause.openPause());
  const btnGoFeedback = document.getElementById('btn-go-feedback');
  if (btnGoFeedback) btnGoFeedback.addEventListener('click', openFeedbackForm);

  if (UI.DOM.btnPlayAgain) UI.DOM.btnPlayAgain.addEventListener('click', () => {
    // In a network match "Play again" used to deal a LOCAL board while the
    // socket was still open, so the next server frame overwrote it. Retake
    // the seat in the same room instead (the server resets a finished room
    // on connect); the local/campaign path is untouched.
    if (mpActive) {
      UI.hideGameOver();
      UI.setStatus('Rematch -- rejoining the room...');
      lastTrackedRound = 0;
      matchStartedAt = Date.now();
      Telemetry.gameplay('match_start', { mode: 'online' });
      mpRematch();
      return;
    }
    startGame();
  });
  if (UI.DOM.btnBackMenu) UI.DOM.btnBackMenu.addEventListener('click', () => {
    UI.hideGameOver();
    UI.showScreen('menu');
  });

  const btnStart = document.getElementById('btn-start');
  if (btnStart) btnStart.addEventListener('click', () => Tutorial.interceptPlay() || startGame());

  if (UI.DOM.btnCampaign) UI.DOM.btnCampaign.addEventListener('click', openCampaignScreen);
  if (UI.DOM.btnCampaignBack) UI.DOM.btnCampaignBack.addEventListener('click', () => UI.showScreen('menu'));
  if (UI.DOM.btnVoyageBack) UI.DOM.btnVoyageBack.addEventListener('click', () => {
    // Leaving does not forfeit: the chart is saved and resumes where it stood.
    saveVoyage(store.voyage);
    openCampaignScreen();
  });

  if (UI.DOM.btnLeaderboard) UI.DOM.btnLeaderboard.addEventListener('click', openLeaderboard);
  if (UI.DOM.btnGoLeaderboard) UI.DOM.btnGoLeaderboard.addEventListener('click', openLeaderboard);
  if (UI.DOM.btnCloseLeaderboard) UI.DOM.btnCloseLeaderboard.addEventListener('click', () => {
    if (UI.DOM.leaderboardModal) UI.DOM.leaderboardModal.classList.add('hidden');
  });
  if (UI.DOM.lbTabLocal) UI.DOM.lbTabLocal.addEventListener('click', showLocalLeaderboard);
  if (UI.DOM.lbTabRemote) UI.DOM.lbTabRemote.addEventListener('click', showRemoteLeaderboard);

  // Combat log -- collapsible badge/drawer (fix for the mobile bug where
  // a permanently-open 300px panel covered the board controls). Tap the badge to
  // expand the bottom-sheet drawer; tap anywhere outside #combat-log
  // while expanded collapses it back down, so it's never left sitting
  // over tappable board cells.
  const combatLogEl = document.getElementById('combat-log');
  const combatLogToggle = document.getElementById('combat-log-toggle');
  if (combatLogToggle && combatLogEl) {
    combatLogToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      const expanded = combatLogEl.classList.toggle('expanded');
      combatLogToggle.setAttribute('aria-expanded', String(expanded));
    });
  }
  document.addEventListener('click', (e) => {
    if (!combatLogEl || !combatLogEl.classList.contains('expanded')) return;
    if (combatLogEl.contains(e.target)) return;
    combatLogEl.classList.remove('expanded');
    if (combatLogToggle) combatLogToggle.setAttribute('aria-expanded', 'false');
  });
}

document.addEventListener('DOMContentLoaded', () => {
  initTelegram();
  // P8 telemetry. Initialised before anything can track: it decides the mode
  // (stored, or ?telemetry=, or off under ?tour=1) and reports whether the
  // first-launch consent dialog is still owed. Nothing is recorded or sent
  // while the mode is unset or off, so the dialog being pending is not a
  // reason to hold the game up -- it opens over the menu below.
  const needConsent = Telemetry.init(new URLSearchParams(window.location.search));
  // Apply the persisted card-art setting immediately on load (before any
  // card is ever rendered), not just when the Settings modal is opened --
  // otherwise a returning player who turned art off would see it flash on
  // for the first render every time.
  UI.applyCardArtSetting(loadSettings().cardArt);
  UI.showScreen('menu');
  initEvents();
  refreshMenuProfile();
  Progress.init({ showScreen: UI.showScreen, startGame: () => startGame(), startVoyage });
  // `?autostart=1` drops straight into a vs-AI match instead of the menu.
  // Used by the layout screenshot pass (a headless browser can't click
  // "Play vs AI"), and handy for sharing a direct "just play" link.
  if (needConsent) Telemetry.openConsent();
  const params = new URLSearchParams(window.location.search);
  const menuDemo = Tutorial.init({ store, startGame, renderAll, leaveMatchForMenu }, params);
  // ?demo=audio is the one debug pass that is not about the board -- it
  // renders the cue table over the menu, so it must not start a match.
  // ?demo=howto (the primer) is the other.
  if (params.get('autostart') === '1' || (params.get('demo') && params.get('demo') !== 'audio' && !menuDemo)) startGame();
  // P6 "QA tour" (?tour=1). Deliberately NOT part of the autostart branch
  // above: the tour opens on the MENU and starts the match itself, several
  // steps in. Same deps hand-off Input.init() gets -- app.js keeps every
  // rule and handler, tour.js only decides what to touch and when.
  if (params.get('tour') === '1') {
    Tour.run({
      store,
      PHASE,
      UI,
      renderAll,
      startGame: () => startGame(),
      getAttackerSlot: () => selectedAttackerSlot,
      onPlayerCardClick,
      onPlayerReserveClick,
      onOppCardClick,
      handleGameOver,
      engine: { autoPlace, lockIn, checkRoundEnd },
      // P8 surfaces the tour now shoots: the pause overlay, the feedback
      // form and the consent dialog. Handed in like everything else -- the
      // tour drives app.js's own entry points, never a mock-up.
      p8: { Pause, Telemetry, openFeedback: openFeedbackForm },
    });
    return;
  }
  // Debug-only static renderings of the two transient P2 gesture states, so
  // the headless screenshot pass can capture them. Never reached without an
  // explicit ?demo= flag.
  const demo = params.get('demo');
  if (demo === 'drag') {
    setTimeout(() => { renderAll(); Input.demoDrag(); }, 700);
  } else if (demo === 'arc') {
    setTimeout(() => {
      autoPlace(store.state, 1);
      aiDeploy(store.state, 2);
      lockIn(store.state);
      store.state.turnOwner = 1;
      renderAll();
      // Select through the real tap handler, so the demo shot shows the
      // genuine selection + legal-target highlighting, not a mock-up.
      onPlayerCardClick(0, store.state.p1Front[0]);
      Input.demoArc();
    }, 700);
  } else if (demo === 'match') {
    setTimeout(() => { onAutoPlace(); onReady(); }, 700);
  } else if (demo === 'island') {
    // `&detail=0` leaves the enlarged card closed, so a shot can show the
    // centre-band card and both chip rows undimmed by its scrim.
    setTimeout(() => { demoIsland(params.get('detail') !== '0'); }, 700);
  } else if (demo === 'capture') {
    setTimeout(() => { demoCapture(); }, 700);
  } else if (demo === 'hero') {
    // P13: a settled COMBAT board with the hero view open over it -- the
    // same view a 400 ms hold opens. Stays up until tapped.
    setTimeout(() => { demoBoard(); Hero.demoHero(); }, 700);
  } else if (demo === 'roundend') {
    setTimeout(() => {
      demoBoard();
      demoRoundEnd(store.state, { round: 3, winner: 1, captured: 'radar', capturedBy: 1, score: [2, 1] });
    }, 700);
  } else if (demo === 'gameover') {
    setTimeout(() => {
      demoBoard();
      // `&verdict=loss` shoots the defeat scene instead of the victory one --
      // the cold wash, the sinking fleet and the "Defeat pay" ladder. Debug
      // only, like every other branch here; it changes nothing but the score
      // the demo hands the real game-over path.
      store.state.score = params.get('verdict') === 'loss' ? [1, 3] : [3, 1];
      store.state.roundNum = 6;
      store.state.winReason = 'points';
      store.state.phase = PHASE.GAME_OVER;
      // The real payout path, not a mock-up: the rewards line on the shot is
      // whatever economy.js actually pays for this result.
      handleGameOver(store.state);
    }, 700);
  } else if (demo === 'audio') {
    // Debug-only (?demo=audio): every cue rendered through an
    // OfflineAudioContext and listed with its measured duration. Chrome
    // headless cannot capture sound, so this list is the screenshot.
    Audio.demoAudio(document.body);
  } else if (demo === 'fx') {
    // P3 combat-juice debug pass: plays each effect once, 400 ms apart, so a
    // headless screenshot run can catch them. Note the deliberately short
    // 120 ms lead-in (the other demos wait 700 ms): a capture's virtual-time
    // budget is counted from page load, so the sequence has to start as soon
    // as the first render lands or every frame would be of an idle board.
    setTimeout(() => { demoFx(); }, 120);
  }
});

// Debug-only helper shared by the P4 demos: a real, fully placed board in
// COMBAT with the player on turn, with the deal animation settled (a headless
// capture's virtual clock advances timers but not CSS transitions, so cards
// left mid-entrance would float across the stage and hide what is being
// shot). Same settle() trick as demoFx below.
function demoBoard() {
  autoPlace(store.state, 1);
  aiDeploy(store.state, 2);
  lockIn(store.state);
  store.state.phase = PHASE.COMBAT;
  store.state.turnOwner = 1;
  renderAll();
  document.querySelectorAll('#game-screen .card').forEach((el) => {
    el.classList.remove('entering', 'flying');
    el.style.transition = 'none';
    el.style.animation = 'none';
    el.style.transform = '';
    el.style.opacity = '';
  });
}

// Debug-only (?demo=island): the three island surfaces at once -- the
// contested island on the centre band, captured chips in both strips (one
// with its power spent, one still usable), and the enlarged card open over
// the board with its power button.
function demoIsland(openDetail = true) {
  demoBoard();
  const st = store.state;
  st.activeIsland = 'scouting';
  st.p1Islands = ['radar', 'rapid_support', 'two_island'];
  st.p2Islands = ['sabotage'];
  // The garrison map holds live cards; borrow real ones off the board so the
  // strength badges show genuine values.
  const mine = st.p1Front.filter(Boolean);
  const theirs = st.p2Front.filter(Boolean);
  st.p1IslandGarrison = { radar: mine[0], rapid_support: mine[1] || mine[0], two_island: mine[2] || mine[0] };
  st.p2IslandGarrison = { sabotage: theirs[0] };
  st.p1PowersUsed = ['radar'];
  renderAll();
  // rapid_support is the unspent one, so the shot shows the power button.
  if (openDetail) openIslandDetail(st, 'rapid_support', handleIslandClick);
}

// Debug-only (?demo=capture): the REAL round-end path, end to end -- the
// opponent's board is wiped, the engine's own checkRoundEnd() resolves the
// round, the player garrisons the island through playerCaptureIsland(), and
// the capture ceremony plus the round-end screen come out of the render
// diff exactly as they do in a played match (render/screens.js). Nothing is
// mocked, which is the point: it is the only way to exercise the diff
// without playing a full round by hand.
function demoCapture() {
  demoBoard();
  const st = store.state;
  st.p2Front = st.p2Front.map(() => null);
  st.p2Reserve = st.p2Reserve.map(() => null);
  UI.setStatus(checkRoundEnd(st) || '');
  renderAll();
  // checkRoundEnd left the match in ISLAND_CAPTURE with the player to pick a
  // garrison -- go through the same click handler a tap would.
  setTimeout(() => {
    // Not every survivor is capture-eligible (Mine / Landing Craft /
    // Coastal Artillery are not -- game.js's isCaptureEligible), and the
    // engine owns that rule, so just walk the Front until one is accepted.
    for (let slot = 0; slot < store.state.p1Front.length; slot++) {
      if (store.state.phase !== 'ISLAND_CAPTURE') break;
      const card = store.state.p1Front[slot];
      if (card) onPlayerCardClick(slot, card);
    }
  }, 200);
}

// Debug-only (?demo=fx): fires each P3 effect once on a real, fully set-up
// board, 400 ms apart. Everything here goes through the same public entry
// points the game itself uses -- no effect is mocked up -- so a screenshot of
// this is a screenshot of the shipping animation.
async function demoFx() {
  autoPlace(store.state, 1);
  aiDeploy(store.state, 2);
  lockIn(store.state);
  store.state.turnOwner = 1;
  renderAll();
  // Every step below is a plain setTimeout offset, deliberately: under a
  // headless capture's --virtual-time-budget it is timers that get
  // virtualised, not performance.now() -- so a setTimeout schedule maps
  // straight onto the budget values a screenshot pass uses, while anything
  // keyed to performance.now() would be waiting on real wall-clock time the
  // capture never spends.
  const at = (ms, fn) => setTimeout(fn, ms);
  await new Promise((r) => at(60, r));
  // Settle the deal instantly. The FLIP entrance (ui.js) is a CSS transition
  // and animation, and a headless capture's virtual clock advances neither --
  // left alone, every card would sit frozen mid-flight across the board and
  // obscure the effects this demo exists to show. Has to run again after
  // every step that re-renders, because the deal stagger re-flings cards.
  // Debug path only.
  const settle = () => document.querySelectorAll('#game-screen .card').forEach((el) => {
    el.classList.remove('entering', 'flying');
    el.style.transition = 'none';
    el.style.animation = 'none';
    el.style.transform = '';
    el.style.opacity = '';
  });
  settle();
  const atk = store.state.p1Front.find(Boolean);
  const def = store.state.p2Front.find(Boolean);
  if (!atk || !def) return;
  // 1-4: lunge, flash, stage shake, callout, shards. WIN so the defender
  // actually breaks apart.
  UI.animateAttack(atk, def, 'WIN');
  // 5: a reveal flip on an untouched opponent card.
  at(400, () => {
    const other = store.state.p2Front.find((c) => c && c !== def);
    if (other) { other.faceUp = true; UI.flipCard(other); }
    settle();
  });
  // 6: turn banner + phase pulse, via the same edge-triggered path a real
  // handover uses.
  at(800, () => { store.state.turnOwner = 2; UI.updateHUD(store.state); settle(); });
  // 7: score ticker.
  at(1200, () => { store.state.score[0] += 1; UI.updateHUD(store.state); settle(); });
}

// ── Rendering ────────────────────────────────────────────────────
// P8 telemetry: round_end is not an event any module raises -- the round-end
// screen comes out of a render diff (render/screens.js's roundObserved). The
// same diff is available here, so the event is derived from it rather than
// by reaching into screens.js: roundNum going up is a finished round, and
// whichever score moved with it won it.
let lastTrackedRound = 0;
let lastTrackedScore = [0, 0];

function trackRoundEnd(state) {
  const round = state.roundNum || 1;
  if (round <= lastTrackedRound) {
    // A new match rewinds the counter; re-baseline instead of reporting.
    if (round < lastTrackedRound) { lastTrackedRound = round; lastTrackedScore = [...state.score]; }
    return;
  }
  if (lastTrackedRound) {
    const [p, a] = state.score;
    const winner = p > lastTrackedScore[0] ? 1 : a > lastTrackedScore[1] ? 2 : 0;
    Telemetry.gameplay('round_end', {
      round: lastTrackedRound,
      winner,
      reason: winner ? 'island_captured' : 'no_capture',
    });
  }
  lastTrackedRound = round;
  lastTrackedScore = [...state.score];
}

export function renderAll() {
  if (!store.state) return;
  // A picked-up placed card only lives while PREP does and its slot holds it.
  if (boardPick && (store.state.phase !== PHASE.PREP
      || !(boardPick.zone === 'front' ? store.state.p1Front : store.state.p1Reserve)[boardPick.slot])) {
    boardPick = null;
  }
  trackRoundEnd(store.state);
  Progress.observe(store.state);
  UI.updateHUD(store.state);

  // Flying-card FLIP animation (see ui.js): beginFlyBatch() resets the
  // per-pass "which cards actually moved" set, each UI.renderZone/
  // renderHand call below both records pre-wipe rects and (via
  // createCardEl's isNewPosition check) adds moved cards to that set, and
  // flyNewlyEnteredCards() at the end kicks off the translate animation
  // for all of them at once now that the whole board is in its final
  // resting layout.
  UI.beginFlyBatch();

  // BUGFIX: oppReserve previously always rendered with no click handler
  // (`null`), so a card sitting in Reserve could never be targeted at all
  // (Scouting, Sabotage, Spyglass...). Both zones share onOppCardClick,
  // which only ever lets an attack land on the Front.
  const oppClick = store.state.phase === PHASE.COMBAT
    ? (slot, card) => onOppCardClick('front', slot, card) : null;
  const oppReserveClick = store.state.phase === PHASE.COMBAT
    ? (slot, card) => onOppCardClick('reserve', slot, card) : null;
  UI.renderZone(UI.DOM.oppReserve, store.state.p2Reserve, false, oppReserveClick);
  UI.renderZone(UI.DOM.oppFront, store.state.p2Front, false, oppClick);
  // Opponent's hand -- face-down card backs, non-interactive (no click
  // handler passed, unlike every other renderZone/renderHand call here).
  // See ui.js's renderOppHand for how individual cards flip face-up.
  UI.renderOppHand(store.state.p2Hand);

  UI.renderZone(UI.DOM.playerFront, store.state.p1Front, true,
    store.state.phase === PHASE.COMBAT || store.state.phase === 'ISLAND_CAPTURE' ? onPlayerCardClick :
    store.state.phase === PHASE.PREP ? onPrepCardClick : null);
  UI.renderZone(UI.DOM.playerReserve, store.state.p1Reserve, true,
    store.state.phase === PHASE.COMBAT || store.state.phase === 'ISLAND_CAPTURE' ? onPlayerReserveClick :
    store.state.phase === PHASE.PREP ? onPrepCardClick : null);

  // See syncHandClickability() above -- keeps the hand's click listener in
  // sync with PREP placement / Rapid Support targeting on every full render
  // (handleIslandClick() also calls it directly for the immediate case).
  syncHandClickability();

  UI.renderIslands(store.state, handleIslandClick);
  UI.renderArtifacts(store.state, onArtifactClick);

  // Now that every zone is in its final DOM layout, fly every card that
  // actually changed position this pass from its old rect to its new one.
  UI.flyNewlyEnteredCards();

  // BUGFIX: updateReadyButton() used to only run from manual placement
  // handlers, so entering round 2+ (an automatic PREP transition, not a
  // click) left the Ready button's `disabled` state stuck from the previous
  // round. renderAll() runs after every state change, so recomputing it here
  // keeps it correct unconditionally.
  updateReadyButton();

  // P2: re-derive the interaction layer's own classes (legal targets,
  // selection, turn dim, hand fan) from the board that was just rebuilt.
  Input.refresh();
  applyPromotionArm();
  Tutorial.observe(store.state);
}
