// UI rendering — DOM, card elements, animations
import { CARDS, CARD_ORDER, IMPACT } from './cards.js';
import { ZONE_SIZE, PHASE, POINTS_TO_WIN } from './game.js';

const $ = id => document.getElementById(id);

export const DOM = {
  loading: $('loading-screen'), menu: $('main-menu'), game: $('game-screen'),
  roundInfo: $('round-info'), scoreInfo: $('score-info'), phaseLabel: $('phase-label'),
  statusText: $('status-text'),
  oppReserve: $('opp-reserve'), oppFront: $('opp-front'),
  playerFront: $('player-front'), playerReserve: $('player-reserve'),
  playerHand: $('player-hand'),
  btnAuto: $('btn-auto'), btnReady: $('btn-ready'), btnPause: $('btn-pause'),
  btnRules: $('btn-rules'), btnCloseRules: $('btn-close-rules'),
  rulesModal: $('rules-modal'), matrixTable: $('matrix-table'),
  goModal: $('game-over-modal'), goIcon: $('go-icon'), goTitle: $('go-title'),
  goScore: $('go-score'), goRounds: $('go-rounds'),
  btnPlayAgain: $('btn-play-again'), btnBackMenu: $('btn-back-menu'),
  combatLog: $('combat-log'), logEntries: $('log-entries'),
  impactOverlay: $('impact-overlay'),
};

export function showScreen(name) {
  [DOM.loading, DOM.menu, DOM.game].forEach(s => s.classList.add('hidden'));
  if (name === 'loading') DOM.loading.classList.remove('hidden');
  if (name === 'menu') DOM.menu.classList.remove('hidden');
  if (name === 'game') DOM.game.classList.remove('hidden');
}

export function setStatus(msg) { DOM.statusText.textContent = msg; }

export function updateHUD(state) {
  DOM.roundInfo.textContent = `Round ${state.round}/10`;
  // Score = islands currently held (see islands.js's recomputeScore) --
  // first to POINTS_TO_WIN wins; MAX_ROUNDS is only a fallback tiebreak.
  DOM.scoreInfo.textContent = `${state.score[0]} : ${state.score[1]} (first to ${POINTS_TO_WIN})`;
  DOM.phaseLabel.textContent = state.phase === PHASE.PREP ? 'PREPARATION' : state.phase === PHASE.COMBAT ? 'COMBAT' : state.phase === PHASE.ISLAND_CAPTURE ? 'ISLAND CAPTURE' : state.phase;
  DOM.phaseLabel.style.color = state.phase === PHASE.COMBAT ? '#ff5252' : '#ffd54f';
}

export function createCardEl(card, faceUp = true) {
  const el = document.createElement('div');
  el.className = 'card' + (faceUp ? '' : ' face-down') + (card.shield ? ' shielded' : '');
  el.dataset.uid = card.uid;
  const abilityHtml = card.def.ability
    ? `<div class="card-ability" title="${card.def.ability.desc}">${card.def.ability.name}</div>`
    : '';
  el.innerHTML = `
    <div class="card-inner">
      <div class="card-face">
        <span class="card-abbr">${card.def.abbr}</span>
        <span class="card-emoji">${card.def.emoji}</span>
        <span class="card-name">${card.def.name}</span>
        ${card.def.strength ? `<span class="card-str">STR ${card.def.strength}</span>` : ''}
        ${abilityHtml}
      </div>
      <div class="card-back"></div>
    </div>`;
  return el;
}

export function renderZone(zoneEl, cards, faceUp, onClick) {
  const slots = zoneEl.querySelectorAll('.slot');
  slots.forEach((slot, i) => {
    slot.innerHTML = '';
    slot.classList.remove('highlight', 'target-highlight');
    const card = cards[i];
    if (card) {
      const el = createCardEl(card, faceUp || card.faceUp);
      if (onClick) el.addEventListener('click', () => onClick(i, card, slot));
      slot.appendChild(el);
    }
  });
}

export function renderHand(hand, onClick) {
  DOM.playerHand.innerHTML = '';
  hand.forEach((card, i) => {
    const el = createCardEl(card, true);
    el.draggable = true;
    el.dataset.handIdx = i;
    if (onClick) el.addEventListener('click', () => onClick(i, card, el));
    el.addEventListener('dragstart', e => {
      e.dataTransfer.setData('text/plain', i.toString());
      el.classList.add('dragging');
    });
    el.addEventListener('dragend', () => el.classList.remove('dragging'));
    DOM.playerHand.appendChild(el);
  });
}

export function highlightSlots(zoneId, highlight = true, cls = 'highlight') {
  const zone = $(zoneId);
  if (!zone) return;
  zone.querySelectorAll('.slot').forEach(s => {
    if (highlight) s.classList.add(cls);
    else s.classList.remove(cls, 'target-highlight', 'highlight');
  });
}

export function clearAllHighlights() {
  document.querySelectorAll('.slot').forEach(s => s.classList.remove('highlight', 'target-highlight'));
  document.querySelectorAll('.card.selected').forEach(c => c.classList.remove('selected'));
}

export function addLogEntry(msg, type = '') {
  DOM.combatLog.classList.remove('hidden');
  const entry = document.createElement('div');
  entry.className = 'log-entry' + (type ? ` log-${type}` : '');
  entry.textContent = msg;
  DOM.logEntries.prepend(entry); // newest first
}

// ── Animations ──────────────────────────────────────────────────

// Find a card's DOM slot element by its uid
function findCardEl(uid) {
  return document.querySelector(`.card[data-uid="${uid}"]`);
}

// Fly-to animation: animate attacker card toward target slot
export async function animateAttack(atkCard, defCard, result) {
  const atkEl = findCardEl(atkCard.uid);
  const defEl = findCardEl(defCard.uid);
  if (!atkEl || !defEl) return;

  const atkRect = atkEl.getBoundingClientRect();
  const defRect = defEl.getBoundingClientRect();
  const dx = defRect.left + defRect.width / 2 - (atkRect.left + atkRect.width / 2);
  const dy = defRect.top + defRect.height / 2 - (atkRect.top + atkRect.height / 2);

  // Animate attacker lunging toward target (60% of distance)
  atkEl.style.transition = 'transform 0.25s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
  atkEl.style.transform = `translate(${dx * 0.6}px, ${dy * 0.6}px) scale(1.1)`;
  atkEl.style.zIndex = '100';

  await sleep(250);

  // Impact on target
  defEl.classList.add('impact');
  showImpactFlash(result, defRect);

  await sleep(180);

  // Snap back
  atkEl.style.transition = 'transform 0.2s ease';
  atkEl.style.transform = '';
  atkEl.style.zIndex = '';
  defEl.classList.remove('impact');

  await sleep(200);
}

function showImpactFlash(result, rect) {
  const flash = document.createElement('div');
  flash.className = `impact-flash impact-${result.toLowerCase()}`;
  const emoji = result === 'WIN' ? '💥' : result === 'LOSS' ? '🌊' : result === 'DRAW' ? '💫' : '🚫';
  flash.textContent = emoji;
  flash.style.cssText = `
    position:fixed; left:${rect.left + rect.width/2}px; top:${rect.top + rect.height/2}px;
    transform:translate(-50%,-50%) scale(0);
    font-size:2.5rem; z-index:200; pointer-events:none;
    animation: impact-pop 0.5s ease forwards;
  `;
  document.body.appendChild(flash);
  setTimeout(() => flash.remove(), 600);
}

// Destroy card with animation, then remove from DOM
export function destroyCardAnimation(slotEl) {
  return new Promise(resolve => {
    const card = slotEl.querySelector('.card');
    if (!card) { resolve(); return; }
    card.classList.add('destroying');
    setTimeout(() => { card.remove(); resolve(); }, 600);
  });
}

// Shake animation for blocked/shield
export function shakeCard(uid) {
  const el = findCardEl(uid);
  if (!el) return;
  el.classList.add('shake');
  setTimeout(() => el.classList.remove('shake'), 500);
}

// Shield glow on Coastal Artillery fortify
export function showShieldEffect(uid) {
  const el = findCardEl(uid);
  if (!el) return;
  el.classList.add('shielded');
  const badge = document.createElement('div');
  badge.className = 'shield-badge';
  badge.textContent = '🛡️';
  el.appendChild(badge);
}

// Reveal flip animation
export function flipCard(slotEl) {
  const card = slotEl.querySelector('.card');
  if (card) card.classList.remove('face-down');
}

export function showGameOver(state) {
  const [p, a] = state.score;
  const win = p > a;
  DOM.goIcon.textContent = win ? '🏆' : p === a ? '🤝' : '⚓';
  DOM.goTitle.textContent = win ? 'Victory!' : p === a ? 'Draw!' : 'Retreat!';
  DOM.goScore.textContent = `${p} : ${a}`;
  DOM.goRounds.textContent = `in ${state.round - 1} rounds`;
  DOM.goModal.classList.remove('hidden');
}

export function hideGameOver() { DOM.goModal.classList.add('hidden'); }

export function renderRulesMatrix() {
  const ids = CARD_ORDER;
  let html = '<table><tr><th></th>';
  ids.forEach(id => { html += `<th title="${CARDS[id].name}">${CARDS[id].emoji}</th>`; });
  html += '</tr>';
  ids.forEach(aid => {
    html += `<tr><th title="${CARDS[aid].name}">${CARDS[aid].emoji}</th>`;
    ids.forEach(did => {
      const r = IMPACT[aid][did];
      const cls = r === 'WIN' ? 'win' : r === 'LOSS' ? 'loss' : r === 'DRAW' ? 'draw' : 'none';
      const sym = r === 'WIN' ? '✓' : r === 'LOSS' ? '✗' : r === 'DRAW' ? '=' : '·';
      html += `<td class="${cls}">${sym}</td>`;
    });
    html += '</tr>';
  });
  html += '</table>';
  DOM.matrixTable.innerHTML = html;
}

export function renderAbilityList() {
  let html = '<div class="ability-list">';
  CARD_ORDER.forEach(id => {
    const c = CARDS[id];
    if (!c.ability) return;
    html += `<div class="ability-row"><span class="ability-emoji">${c.emoji}</span><div><strong>${c.ability.name}</strong><span>${c.ability.desc}</span></div></div>`;
  });
  html += '</div>';
  return html;
}

export function setupDropZones(onDrop) {
  document.querySelectorAll('.player-section .slot').forEach(slot => {
    slot.addEventListener('dragover', e => { e.preventDefault(); slot.classList.add('dragover'); });
    slot.addEventListener('dragleave', () => slot.classList.remove('dragover'));
    slot.addEventListener('drop', e => {
      e.preventDefault();
      slot.classList.remove('dragover');
      const handIdx = parseInt(e.dataTransfer.getData('text/plain'));
      const zone = slot.dataset.zone.includes('front') ? 'front' : 'reserve';
      const slotIdx = parseInt(slot.dataset.slot);
      onDrop(handIdx, zone, slotIdx);
    });
  });
}

export function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
