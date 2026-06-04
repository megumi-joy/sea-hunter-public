// App entry point — wires everything together
import { createGameState, autoPlace, placeCard, lockIn, playerAttack, moveReserveToFront, checkRoundEnd, returnCard, PHASE, ZONE_SIZE } from './game.js';
import { aiTurn } from './ai.js';
import * as UI from './ui.js';

let state = null;
let selectedAttacker = null;
let difficulty = 2;
let combatLocked = false; // prevent double-clicks during animation

// ── Boot ─────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  UI.renderRulesMatrix();

  // Loading progress animation
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

  // Menu
  document.getElementById('btn-single').addEventListener('click', startGame);
  document.querySelectorAll('.diff-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.diff-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      difficulty = parseInt(btn.dataset.diff);
    });
  });

  // Game buttons
  UI.DOM.btnAuto.addEventListener('click', doAutoPlace);
  UI.DOM.btnReady.addEventListener('click', doLockIn);
  UI.DOM.btnRules.addEventListener('click', () => UI.DOM.rulesModal.classList.remove('hidden'));
  UI.DOM.btnCloseRules.addEventListener('click', () => UI.DOM.rulesModal.classList.add('hidden'));
  UI.DOM.btnPause.addEventListener('click', () => { state = null; combatLocked = false; UI.showScreen('menu'); });
  UI.DOM.btnPlayAgain.addEventListener('click', startGame);
  UI.DOM.btnBackMenu.addEventListener('click', () => { UI.hideGameOver(); UI.showScreen('menu'); });

  // Drop zones
  UI.setupDropZones((handIdx, zone, slot) => {
    if (!state || state.phase !== PHASE.PREP) return;
    const res = placeCard(state, handIdx, zone, slot);
    if (res.ok) { renderAll(); updateReadyButton(); }
    else UI.setStatus(res.msg);
  });
});

function startGame() {
  state = createGameState(difficulty);
  selectedAttacker = null;
  combatLocked = false;
  UI.hideGameOver();
  UI.showScreen('game');
  UI.DOM.combatLog.classList.add('hidden');
  UI.DOM.logEntries.innerHTML = '';
  UI.DOM.btnAuto.style.display = '';
  UI.DOM.btnReady.style.display = '';
  renderAll();
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

  // Show scout log
  if (res.scoutLog && res.scoutLog.length) {
    res.scoutLog.forEach(m => UI.addLogEntry(m, 'ability'));
  }

  UI.setStatus('⚔️ Combat! Click your card, then click an enemy to attack.');
  renderAll();

  if (state.turnOwner === 2) {
    setTimeout(() => doAiTurn(), 1000);
  }
}

function updateReadyButton() {
  const placed = state.p1Front.filter(Boolean).length + state.p1Reserve.filter(Boolean).length;
  UI.DOM.btnReady.disabled = placed < 4;
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
  UI.addLogEntry(`🔄 ${card.def.emoji} ${card.def.name} → front`, 'move');
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

  // ── Animate attack ──
  UI.setStatus(`${res.atkCard.def.emoji} attacks ${res.defCard.def.emoji}...`);
  await UI.animateAttack(res.atkCard, res.defCard, res.result);

  // Show result
  UI.addLogEntry(res.msg, res.result === 'WIN' ? 'win' : res.result === 'LOSS' ? 'loss' : 'draw');
  UI.setStatus(res.msg);

  // Handle side effects
  if (res.sideEffects) {
    for (const fx of res.sideEffects) {
      if (fx.type === 'shield') {
        UI.addLogEntry(`🛡️ ${res.atkCard.def.emoji} ${res.atkCard.def.name} fortified!`, 'ability');
        UI.showShieldEffect(res.atkCard.uid);
      }
      if (fx.type === 'broadside') {
        UI.addLogEntry(`⚡ Broadside destroys ${fx.card.def.emoji} ${fx.card.def.name}!`, 'ability');
      }
      if (fx.type === 'bonus_draw') {
        UI.addLogEntry(`🃏 Landing Craft: bonus card next round!`, 'ability');
      }
    }
  }

  await UI.sleep(400);
  renderAll();
  await UI.sleep(200);

  const end = checkRoundEnd(state);
  if (end) { combatLocked = false; handleRoundEnd(end); return; }

  // Cruiser extra attack
  const hasExtraAttack = res.sideEffects && res.sideEffects.some(e => e.type === 'extra_attack');
  if (hasExtraAttack) {
    UI.addLogEntry(`⚡ Cruiser Pursuit: attack again!`, 'ability');
    UI.setStatus('⚡ Pursuit! Pick another target to attack again.');
    combatLocked = false;
    return;
  }

  combatLocked = false;
  if (state.turnOwner === 2) {
    UI.setStatus('🌊 AI is planning...');
    await UI.sleep(900);
    doAiTurn();
  } else {
    UI.setStatus('Your turn! Click a card to attack.');
  }
}

async function doAiTurn() {
  if (!state || state.turnOwner !== 2 || state.phase !== PHASE.COMBAT || combatLocked) return;
  combatLocked = true;

  UI.setStatus('🌊 AI is planning...');
  await UI.sleep(700);

  const actions = aiTurn(state);

  for (const a of actions) {
    if (a.type === 'attack') {
      UI.setStatus(`🌊 AI: ${a.atkCard?.def?.emoji} attacks ${a.defCard?.def?.emoji}...`);
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
  if (state.turnOwner === 1) {
    UI.setStatus('Your turn! Click a card to attack.');
  }
}

function handleRoundEnd(end) {
  UI.addLogEntry(end.msg, 'round');
  if (end.gameOver) {
    setTimeout(() => UI.showGameOver(state), 800);
    return;
  }
  UI.setStatus(end.msg + ' — Place cards for next round!');
  UI.DOM.btnAuto.style.display = '';
  UI.DOM.btnReady.style.display = '';
  UI.DOM.btnReady.disabled = true;
  renderAll();
}

// ── Rendering ────────────────────────────────────────────────────
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
  UI.setStatus(`${card.def.emoji} ${card.def.name} — drag to a slot, or click a slot to place`);
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
