// App entry point — wires everything together
import { createGameState, autoPlace, placeCard, lockIn, playerAttack, moveReserveToFront, checkRoundEnd, returnCard, PHASE, ZONE_SIZE } from './game.js';
import { aiTurn } from './ai.js';
import * as UI from './ui.js';
import { createIslandState, resetIslandActivations, activateIsland, captureIsland, islandSVG, ISLANDS } from './islands.js';

let state = null;
let islandState = null;
let selectedAttacker = null;
let difficulty = 2;
let combatLocked = false;
let openIsland = null; // currently open in panel

// ── Boot ─────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  UI.renderRulesMatrix();

  const prog = document.getElementById('load-progress');
  const label = document.getElementById('load-label');
  const steps = ['Loading fleet...', 'Shuffling cards...', 'Deploying AI...', 'Ready!'];
  let pct = 0;
  const tick = setInterval(() => {
    pct += Math.random() * 25 + 5;
    if (pct >= 100) { pct = 100; clearInterval(tick); }
    if (prog) prog.style.width = pct + '%';
    if (label) label.textContent = steps[Math.min(Math.floor(pct / 30), steps.length - 1)];
    if (pct >= 100) setTimeout(() => UI.showScreen('menu'), 300);
  }, 200);

  document.getElementById('btn-single').addEventListener('click', startGame);
  document.querySelectorAll('.diff-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.diff-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      difficulty = parseInt(btn.dataset.diff);
    });
  });

  UI.DOM.btnAuto.addEventListener('click', doAutoPlace);
  UI.DOM.btnReady.addEventListener('click', doLockIn);
  UI.DOM.btnRules.addEventListener('click', () => UI.DOM.rulesModal.classList.remove('hidden'));
  UI.DOM.btnCloseRules.addEventListener('click', () => UI.DOM.rulesModal.classList.add('hidden'));
  UI.DOM.btnPause.addEventListener('click', () => { state = null; combatLocked = false; UI.showScreen('menu'); });
  UI.DOM.btnPlayAgain.addEventListener('click', startGame);
  UI.DOM.btnBackMenu.addEventListener('click', () => { UI.hideGameOver(); UI.showScreen('menu'); });

  // Island panel close
  document.getElementById('island-panel-close').addEventListener('click', closeIslandPanel);
  document.getElementById('island-activate-btn').addEventListener('click', onIslandActivate);

  UI.setupDropZones((handIdx, zone, slot) => {
    if (!state || state.phase !== PHASE.PREP) return;
    const res = placeCard(state, handIdx, zone, slot);
    if (res.ok) { renderAll(); updateReadyButton(); }
    else UI.setStatus(res.msg);
  });
});

function startGame() {
  state = createGameState(difficulty);
  islandState = createIslandState();
  selectedAttacker = null;
  combatLocked = false;
  openIsland = null;
  UI.hideGameOver();
  UI.showScreen('game');
  UI.DOM.combatLog.classList.add('hidden');
  UI.DOM.logEntries.innerHTML = '';
  UI.DOM.btnAuto.style.display = '';
  UI.DOM.btnReady.style.display = '';
  renderAll();
  renderIslands();
  UI.setStatus('Drag cards to Frontline and Reserve, then press Ready!');
}

// ── Prep Phase ───────────────────────────────────────────────────
function doAutoPlace() {
  if (!state || state.phase !== PHASE.PREP) return;
  autoPlace(state, 1);
  renderAll();
  updateReadyButton();
  UI.setStatus('Cards placed! Press Ready to start combat.');
}

function doLockIn() {
  if (!state) return;
  const res = lockIn(state);
  if (!res.ok) { UI.setStatus(res.msg); return; }

  UI.DOM.btnAuto.style.display = 'none';
  UI.DOM.btnReady.style.display = 'none';

  if (res.scoutLog && res.scoutLog.length) {
    res.scoutLog.forEach(m => UI.addLogEntry(m, 'ability'));
  }

  UI.setStatus('Combat! Click your card, then click an enemy to attack.');
  renderAll();

  if (state.turnOwner === 2) setTimeout(() => doAiTurn(), 1000);
}

function updateReadyButton() {
  const placed = state.p1Front.filter(Boolean).length + state.p1Reserve.filter(Boolean).length;
  UI.DOM.btnReady.disabled = placed < 4;
}

// ── Island Panel ─────────────────────────────────────────────────
function openIslandPanel(island, owner) {
  openIsland = { island, owner };
  const panel = document.getElementById('island-panel');
  const canActivate = owner === 'p1' && !island.activated && state && state.phase === PHASE.COMBAT && state.turnOwner === 1 && !combatLocked;
  const isCaptureable = owner === 'neutral' && state && state.phase === PHASE.COMBAT && state.turnOwner === 1 && !combatLocked;

  document.getElementById('island-panel-svg').innerHTML = islandSVG(island, 'large');
  document.getElementById('island-panel-name').textContent = island.name;
  document.getElementById('island-panel-ability').textContent = island.ability;
  document.getElementById('island-panel-garrison').textContent = island.garrison
    ? `Garrison: ${island.garrison.def.emoji} ${island.garrison.def.name}`
    : (owner === 'neutral' ? 'Neutral — capture to use' : owner === 'p2' ? 'Enemy island' : 'No garrison');

  const btn = document.getElementById('island-activate-btn');
  if (isCaptureable) {
    btn.textContent = 'Capture Island';
    btn.disabled = !state.p1Reserve.some(Boolean);
  } else {
    btn.textContent = island.activated ? 'Used this round' : 'Activate';
    btn.disabled = !canActivate;
  }

  panel.classList.remove('hidden');
}

function closeIslandPanel() {
  document.getElementById('island-panel').classList.add('hidden');
  openIsland = null;
}

function onIslandActivate() {
  if (!openIsland || !state) return;
  const { island, owner } = openIsland;

  let result;
  if (owner === 'neutral') {
    result = captureIsland(islandState, island.id, state, 1);
  } else if (owner === 'p1') {
    result = activateIsland(islandState, island, state, 1);
  } else {
    return;
  }

  if (!result.ok) { UI.setStatus(result.msg); return; }

  UI.addLogEntry(result.msg, 'ability');
  UI.setStatus(result.msg);
  closeIslandPanel();
  renderAll();
  renderIslands();

  // Using island ability ends the turn
  if (owner === 'p1' && !combatLocked) {
    state.turnOwner = 2;
    setTimeout(() => doAiTurn(), 800);
  }
}

// ── Island Rendering ─────────────────────────────────────────────
function renderIslands() {
  if (!islandState) return;

  const renderSlots = (containerId, islands, owner) => {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = '';
    islands.forEach(isl => {
      const card = document.createElement('div');
      card.className = `island-card ${owner === 'neutral' ? 'neutral-island' : owner === 'p1' ? 'captured-player' : 'captured-opp'}`;
      if (isl.activated) card.classList.add('used');
      card.innerHTML = islandSVG(isl, 'small') + `<div class="island-card-name">${isl.name}</div>`;
      if (isl.garrison) {
        const dot = document.createElement('div');
        dot.className = 'island-garrison-dot';
        dot.title = `Garrison: ${isl.garrison.def.name}`;
        card.appendChild(dot);
      }
      card.addEventListener('click', () => {
        if (openIsland && openIsland.island === isl) { closeIslandPanel(); return; }
        openIslandPanel(isl, owner);
      });
      el.appendChild(card);
    });
    if (!islands.length) el.innerHTML = '<div style="opacity:0.3;font-size:0.6rem;padding:4px">–</div>';
  };

  renderSlots('opp-island-slots', islandState.p2, 'p2');
  renderSlots('neutral-island-slots', islandState.neutral, 'neutral');
  renderSlots('player-island-slots', islandState.p1, 'p1');
}

// ── Combat Phase ─────────────────────────────────────────────────
function onPlayerCardClick(slot, card, el) {
  if (!state || state.phase !== PHASE.COMBAT || state.turnOwner !== 1 || combatLocked) return;
  if (card.def.id === 'mine') { UI.setStatus('Mine cannot attack — passive defense only!'); return; }

  UI.clearAllHighlights();
  selectedAttacker = { slot, card };
  el.querySelector('.card')?.classList.add('selected');

  const oppFrontAlive = state.p2Front.some(Boolean);
  const canBypass = card.def.id === 'destroyer' || card.def.id === 'plane';

  if (oppFrontAlive && !canBypass) {
    UI.highlightSlots('opp-front', true, 'target-highlight');
    UI.setStatus(`${card.def.emoji} ${card.def.name} selected — click enemy frontline to attack!`);
  } else if (oppFrontAlive && canBypass) {
    UI.highlightSlots('opp-front', true, 'target-highlight');
    UI.highlightSlots('opp-reserve', true, 'target-highlight');
    UI.setStatus(`${card.def.emoji} ${card.def.name} [${card.def.ability.name}] — can bypass frontline!`);
  } else {
    UI.highlightSlots('opp-reserve', true, 'target-highlight');
    UI.setStatus(`${card.def.emoji} ${card.def.name} selected — attack enemy reserve!`);
  }
}

function onPlayerReserveClick(slot, card) {
  if (!state || state.phase !== PHASE.COMBAT || state.turnOwner !== 1 || combatLocked) return;
  if (!state.p1Front.includes(null)) { UI.setStatus('Front is full!'); return; }

  const res = moveReserveToFront(state, slot, 1);
  if (!res.ok) { UI.setStatus(res.msg); return; }
  UI.addLogEntry(`${card.def.emoji} ${card.def.name} moved to front`, 'move');
  UI.setStatus(res.msg);
  renderAll();

  const end = checkRoundEnd(state);
  if (end) { handleRoundEnd(end); return; }
  if (state.turnOwner === 2) setTimeout(() => doAiTurn(), 800);
}

async function onOppCardClick(slot, card, slotEl) {
  if (!state || !selectedAttacker || state.turnOwner !== 1 || combatLocked) return;

  combatLocked = true;
  const res = playerAttack(state, selectedAttacker.slot, slot);
  selectedAttacker = null;
  UI.clearAllHighlights();

  if (!res.ok) {
    UI.setStatus(res.msg);
    combatLocked = false;
    return;
  }

  UI.setStatus(`${res.atkCard.def.emoji} attacks ${res.defCard.def.emoji}...`);
  await UI.animateAttack(res.atkCard, res.defCard, res.result);

  UI.addLogEntry(res.msg, res.result === 'WIN' ? 'win' : res.result === 'LOSS' ? 'loss' : 'draw');
  UI.setStatus(res.msg);

  if (res.sideEffects) {
    for (const fx of res.sideEffects) {
      if (fx.type === 'shield') { UI.addLogEntry(`${res.atkCard.def.emoji} fortified!`, 'ability'); UI.showShieldEffect(res.atkCard.uid); }
      if (fx.type === 'broadside') UI.addLogEntry(`Broadside destroys ${fx.card.def.emoji} ${fx.card.def.name}!`, 'ability');
      if (fx.type === 'bonus_draw') UI.addLogEntry('Landing Craft: bonus card next round!', 'ability');
    }
  }

  await UI.sleep(400);
  renderAll();
  await UI.sleep(200);

  const end = checkRoundEnd(state);
  if (end) { combatLocked = false; handleRoundEnd(end); return; }

  const hasExtraAttack = res.sideEffects && res.sideEffects.some(e => e.type === 'extra_attack');
  if (hasExtraAttack) {
    UI.addLogEntry('Cruiser Pursuit: attack again!', 'ability');
    UI.setStatus('Pursuit! Pick another target to attack again.');
    combatLocked = false;
    return;
  }

  combatLocked = false;
  if (state.turnOwner === 2) {
    UI.setStatus('AI is planning...');
    await UI.sleep(900);
    doAiTurn();
  } else {
    UI.setStatus('Your turn! Click a card to attack, or activate an island.');
  }
}

async function doAiTurn() {
  if (!state || state.turnOwner !== 2 || state.phase !== PHASE.COMBAT || combatLocked) return;
  combatLocked = true;

  UI.setStatus('AI is planning...');
  await UI.sleep(700);

  // AI occasionally uses its captured islands
  if (islandState.p2.length && Math.random() > 0.6) {
    const unusedIsl = islandState.p2.find(i => !i.activated);
    if (unusedIsl) {
      const res = activateIsland(islandState, unusedIsl, state, 2);
      if (res.ok) {
        UI.addLogEntry(`AI: ${res.msg}`, 'ability');
        UI.setStatus(res.msg);
        renderIslands();
        await UI.sleep(600);
        // After island ability, AI's turn ends — go to player
        combatLocked = false;
        state.turnOwner = 1;
        UI.setStatus('Your turn!');
        return;
      }
    }
  }

  const actions = aiTurn(state);

  for (const a of actions) {
    if (a.type === 'attack') {
      UI.setStatus(`AI: ${a.atkCard?.def?.emoji} attacks ${a.defCard?.def?.emoji}...`);
      if (a.atkCard && a.defCard) await UI.animateAttack(a.atkCard, a.defCard, a.result);
    }
    UI.addLogEntry(a.msg, a.type === 'attack' ? (a.result === 'WIN' ? 'loss' : 'win') : 'move');
    UI.setStatus(a.msg);
    await UI.sleep(300);
  }

  renderAll();

  const end = checkRoundEnd(state);
  if (end) { combatLocked = false; handleRoundEnd(end); return; }

  combatLocked = false;
  if (state.turnOwner === 1) UI.setStatus('Your turn! Click a card or activate an island.');
}

function handleRoundEnd(end) {
  UI.addLogEntry(end.msg, 'round');
  // Reset island activations for next round
  if (islandState) resetIslandActivations(islandState);
  renderIslands();

  if (end.gameOver) { setTimeout(() => UI.showGameOver(state), 800); return; }
  UI.setStatus(end.msg + ' — Place cards for next round!');
  UI.DOM.btnAuto.style.display = '';
  UI.DOM.btnReady.style.display = '';
  UI.DOM.btnReady.disabled = true;
  renderAll();
}

// ── Rendering ─────────────────────────────────────────────────────
function renderAll() {
  if (!state) return;
  UI.updateHUD(state);

  UI.renderZone(UI.DOM.oppReserve, state.p2Reserve, false, null);
  UI.renderZone(UI.DOM.oppFront, state.p2Front, false,
    state.phase === PHASE.COMBAT ? onOppCardClick : null);

  UI.renderZone(UI.DOM.playerFront, state.p1Front, true,
    state.phase === PHASE.COMBAT ? onPlayerCardClick :
    state.phase === PHASE.PREP ? onPrepCardClick : null);
  UI.renderZone(UI.DOM.playerReserve, state.p1Reserve, true,
    state.phase === PHASE.COMBAT ? onPlayerReserveClick :
    state.phase === PHASE.PREP ? onPrepCardClick : null);

  UI.renderHand(state.p1Hand, state.phase === PHASE.PREP ? onHandCardClick : null);
}

function onHandCardClick(idx, card) {
  UI.setStatus(`${card.def.emoji} ${card.def.name} — drag to a slot`);
}

function onPrepCardClick(slot, card) {
  if (!state || state.phase !== PHASE.PREP) return;
  const zone = state.p1Front.includes(card) ? 'front' : 'reserve';
  const returned = returnCard(state, zone, slot);
  if (returned) {
    renderAll();
    updateReadyButton();
    UI.setStatus(`${card.def.emoji} ${card.def.name} returned to hand`);
  }
}
