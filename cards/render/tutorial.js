// P14 "Tutorial and first match".
//
// Four surfaces, one module:
//   * the guided first match -- a scripted board against the real AI, with
//     spotlight steps that advance only when the player does the thing
//   * the "you are ready" card shown after it
//   * the six-page "How to play" primer (menu, pause menu, ?demo=howto)
//   * one-line hints during the first three real matches
//
// Nothing here decides a rule. Every move in the guided match goes through
// app.js's own handlers (a skipped step taps the same elements a player
// would), and the AI plays with ai.js unchanged: the board below is simply
// chosen so that ai.js's deterministic policy makes the same replies
// every time (traced through its scoring constants; see stageBoard).
//
// URL flags: ?tutorial=1 forces the guided match behind Play for this page
// load, ?tutorial=0 never offers it, ?demo=howto opens the primer.

import { CARDS } from '../cards.js';
import { ISLANDS } from '../islands.js';
import { loadSettings } from '../settings.js';
import { returnUnusedToHold } from '../economy.js';
import { ART_BACK, artFor } from './art.js';
import { abortGesture } from './input.js';
import { setPauseExtras } from './pause.js';
import * as Telemetry from './telemetry.js';

const DONE_KEY = 'seahunter.tutorial_done';
const HINT_KEY = 'seahunter.hint_matches';
// Any of these means someone has played here before P14 shipped.
const VETERAN_KEYS = ['seahunter_local_scores', 'seahunter_campaign_progress'];
const HINT_MATCHES = 3;
const HINT_MS = 5000;

let deps = null;
let forced = null; // true / false from ?tutorial=, null = decide by storage

function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* not persisted */ } }
const $ = (sel) => document.querySelector(sel);
function el(tag, cls, html) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html !== undefined) n.innerHTML = html;
  return n;
}
function track(event, data) { Telemetry.gameplay(event, data); }

// ---- the scripted board ------------------------------------------------
//
// Slots are counted from 1 here.
// Player: Patrol Ship (slot 1) and Destroyer (slot 3) on the frontline, a
// Sea Hunter in reserve, a Cruiser in hand, and Radar already held (so a
// one-time power can be taught inside one round). First to 2 islands. Every
// player card is face down: the AI knows only what has fought.
// Enemy: Patrol Ship, Destroyer and Landing Craft on the frontline (slots
// 1-3), a Sea Hunter (slot 1) and a Mine (slot 2) in reserve, all face down.
// The player moves first.
//
// What ai.js does with that, turn by turn (no randomness; every player card
// it may target is face down or a sure loss, so scoreAttack ranks attackers
// by expectedVsUnknown over the public pool and breaks the tie between equal
// hidden targets on the lowest slot):
//   1 you: Cruiser sinks their Patrol Ship (4 beats 2)
//   2 AI:  Destroyer (blind score 1.39) beats Landing Craft (-0.90); both
//          hidden targets score the same, so it hits slot 1: your Patrol Ship
//   3 you: Destroyer into their face-up Destroyer, both sink (draw)
//   4 AI:  its Landing Craft may not attack your face-up Cruiser (a loss), so
//          it promotes straight ahead: Sea Hunter (-0.85) over Mine (-5.0)
//   5 you: Cruiser sinks the still-hidden Sea Hunter
//   6 AI:  still no legal attack, promotes its last reserve card, the Mine
//   7 you: Radar reveals the Mine. That ends your turn, and the AI has no
//          legal attack (a Mine never attacks, the Landing Craft would lose)
//          and nothing left to promote: it yields the round
//   8 you: a ship garrisons the island: 2 - 0, match won
function card(id, slot, faceUp) { return { def: CARDS[id], faceUp, slot }; }

function stageBoard(st) {
  st.tutorial = true;
  st.turnOwner = 1;
  st.p1Hand = [card('cruiser', -1, false)];
  st.p1Front = [card('patrol_ship', 0, false), null, card('destroyer', 2, false), null];
  st.p1Reserve = [card('sea_hunter', 0, false), null, null, null];
  st.p2Hand = [];
  st.p2Front = [card('patrol_ship', 0, false), card('destroyer', 1, false), card('landing_craft', 2, false), null];
  st.p2Reserve = [card('sea_hunter', 0, false), card('mine', 1, false), null, null];
  st.activeIsland = 'scouting';
  st.islandDeck = st.islandDeck.filter((id) => id !== 'radar' && id !== 'scouting');
  st.p1Islands = ['radar'];
  st.p1IslandGarrison = { radar: card('battleship', -1, true) };
  st.score = [1, 0];
}

// ---- first-launch decision ---------------------------------------------

function isDone() {
  if (lsGet(DONE_KEY)) return true;
  return VETERAN_KEYS.some((k) => lsGet(k));
}

// Called by the Play button. Returns true when it took over.
export function interceptPlay() {
  if (forced === false) return false;
  if (forced !== true && isDone()) return false;
  startTutorial();
  return true;
}

// ---- guided steps --------------------------------------------------------

const STEP_NAMES = ['hand', 'play', 'attack', 'draw', 'promote', 'island', 'yield', 'win'];

const zoneArr = (st, id) => ({
  'player-front': st.p1Front, 'player-reserve': st.p1Reserve,
  'opp-front': st.p2Front, 'opp-reserve': st.p2Reserve,
})[id];
function slotOf(zoneId, i) { return i < 0 ? null : $(`#${zoneId} .slot[data-slot="${i}"]`); }
function find(st, zoneId, id) { return zoneArr(st, zoneId).findIndex((c) => c && c.def.id === id); }
function cardEl(zoneId, i) { const s = slotOf(zoneId, i); return s && (s.querySelector('.card') || s); }
function enemyHas(st, id) { return find(st, 'opp-front', id) >= 0 || find(st, 'opp-reserve', id) >= 0; }
const click = (node) => { if (node) { bypass = true; try { node.click(); } finally { bypass = false; } } };

// An attack by the player's `atk` unit on the enemy frontline `def` unit.
function attackStep(atk, def) {
  return {
    focus: (st) => [slotOf('player-front', find(st, 'player-front', atk)), slotOf('opp-front', find(st, 'opp-front', def))],
    point: (st) => [cardEl('player-front', find(st, 'player-front', atk)), slotOf('opp-front', find(st, 'opp-front', def))],
    auto: (st) => {
      click(cardEl('player-front', find(st, 'player-front', atk)));
      setTimeout(() => click(cardEl('opp-front', find(st, 'opp-front', def))), 60);
    },
  };
}

const STEPS = [
  { // 1 your hand and the frontline
    text: 'This is your hand. Drag the Cruiser to an empty slot on your frontline.',
    // The opening deal flies in for about two seconds; point once it has landed.
    ready: (st) => st.phase === 'PREP' && Date.now() - startedAt > 2600,
    done: (st) => find(st, 'player-front', 'cruiser') >= 0,
    focus: () => [$('#player-hand'), $('#player-front')],
    point: () => [$('#player-hand .card'), $('#player-front .slot.empty')],
    auto: () => {
      click($('#player-hand .card'));
      setTimeout(() => click($('#player-front .slot.empty')), 60);
    },
  },
  { // 2 playing a unit
    text: 'The enemy sees your cards only once they fight. Tap Ready. Each move ends your turn.',
    ready: (st) => st.phase === 'PREP' && find(st, 'player-front', 'cruiser') >= 0,
    done: (st) => st.phase !== 'PREP',
    focus: () => [$('#player-front'), $('#player-reserve'), $('#btn-ready')],
    point: () => [null, $('#btn-ready')],
    auto: () => click($('#btn-ready')),
  },
  { // 3 strength and the attack
    text: 'Higher strength wins. Drag your Cruiser (4) onto the marked enemy frontline card.',
    ready: (st) => idle(st) && find(st, 'opp-front', 'patrol_ship') >= 0 && find(st, 'player-front', 'cruiser') >= 0,
    done: (st) => !enemyHas(st, 'patrol_ship'),
    ...attackStep('cruiser', 'patrol_ship'),
  },
  { // 4 what a draw means
    text: 'Equal ships sink each other: a draw. Attack their face-up Destroyer with yours.',
    ready: (st) => idle(st) && find(st, 'player-front', 'destroyer') >= 0
      && st.p2Front.some((c) => c && c.def.id === 'destroyer' && c.faceUp),
    done: (st) => !enemyHas(st, 'destroyer'),
    ...attackStep('destroyer', 'destroyer'),
  },
  { // 5 a reserve card moves up, still hidden
    text: 'A reserve card moved straight up. It is still hidden: sink it with your Cruiser.',
    ready: (st) => idle(st) && find(st, 'opp-front', 'sea_hunter') >= 0 && find(st, 'player-front', 'cruiser') >= 0,
    done: (st) => !enemyHas(st, 'sea_hunter'),
    focus: (st) => [slotOf('opp-reserve', 0), ...attackStep('cruiser', 'sea_hunter').focus(st)],
    point: (st) => attackStep('cruiser', 'sea_hunter').point(st),
    auto: (st) => attackStep('cruiser', 'sea_hunter').auto(st),
  },
  { // 6 the island and its one-time power
    text: 'Tap your Radar island, then the card that just moved up. Powers work once per match.',
    ready: (st) => idle(st) && find(st, 'opp-front', 'mine') >= 0 && !st.p1PowersUsed.includes('radar'),
    done: (st) => st.p1PowersUsed.includes('radar'),
    focus: (st) => {
      const mine = slotOf('opp-front', find(st, 'opp-front', 'mine'));
      if (deps.store.activeIslandPower) return [mine];
      return [$('#island-detail .island-detail-panel'), $('#player-islands [data-island-id="radar"]') || $('#player-islands')];
    },
    point: (st) => {
      if (deps.store.activeIslandPower) return [null, slotOf('opp-front', find(st, 'opp-front', 'mine'))];
      return [null, $('#island-detail .ic-use') || $('#player-islands [data-island-id="radar"]')];
    },
    auto: () => {
      if (!deps.store.activeIslandPower) {
        if (!$('#island-detail')) click($('#player-islands [data-island-id="radar"]'));
        click($('#island-detail .ic-use'));
      }
      setTimeout(() => click(cardEl('opp-front', find(deps.store.state, 'opp-front', 'mine'))), 80);
    },
  },
  { // 7 the enemy yields, the island is taken
    text: 'No legal move left for them: they yield the round. Tap your Cruiser to hold the island.',
    ready: (st) => st.phase === 'ISLAND_CAPTURE' && !deps.store.combatLocked,
    done: (st) => st.phase === 'GAME_OVER' || st.roundNum > 1,
    focus: () => [$('#player-front'), $('#player-reserve'), $('#active-island-container')],
    point: (st) => [null, cardEl('player-front', find(st, 'player-front', 'cruiser'))],
    auto: (st) => click(cardEl('player-front', find(st, 'player-front', 'cruiser'))),
  },
  { // 8 winning
    text: 'Two islands held: you win. Real matches are first to 3 islands.',
    ready: (st) => st.phase === 'GAME_OVER' && !!$('#game-over-modal:not(.hidden)'),
    done: () => false,
    focus: () => [$('#game-over-modal .modal-inner')],
    // Lit, but not tappable: Play again / Menu wait until the ready card.
    allow: () => [],
    point: () => [null, $('#go-score')],
    auto: () => finishGuided(),
    button: 'Continue',
  },
];

// ---- runtime -------------------------------------------------------------

let active = false;
let stepIdx = 0;
let shownIdx = -1;
let timer = 0;
let idleSince = 0;
let startedAt = 0;
let starting = false;
let bypass = false;
let layer = null;
let holes = [];

function idle(st) {
  return st.phase === 'COMBAT' && st.turnOwner === 1 && !deps.store.combatLocked
    && !$('#round-end-screen');
}

function startTutorial() {
  starting = true;
  deps.startGame(2, { seed: 1407, pointsToWin: 2 });
  starting = false;
  const st = deps.store.state;
  // A forced replay by a player with a stocked hold: hand the loadout
  // straight back, this match never reaches the game-over payout path.
  if ((deps.store.matchLoadout || []).length) returnUnusedToHold(deps.store.matchLoadout, []);
  deps.store.matchLoadout = [];
  st.p1Artifacts = [];
  stageBoard(st);
  active = true;
  startedAt = Date.now();
  stepIdx = 0;
  shownIdx = -1;
  buildLayer();
  track('tutorial_started');
  deps.renderAll();
  clearInterval(timer);
  timer = setInterval(tick, 200);
  tick();
}

function stop() {
  active = false;
  clearInterval(timer);
  if (layer) layer.remove();
  layer = null;
  holes = [];
}

// `leave` is false when the match screen is already gone (the pause menu's
// Main menu got there first).
function exitTutorial(leave = true) {
  if (!active) return;
  track('tutorial_skipped', { step: stepIdx + 1, scope: 'all' });
  lsSet(DONE_KEY, '1');
  stop();
  if (leave) deps.leaveMatchForMenu();
}

function finishGuided() {
  if (!active) return;
  stop();
  lsSet(DONE_KEY, '1');
  track('tutorial_completed');
  const go = $('#game-over-modal');
  if (go) go.classList.add('hidden');
  showReadyCard();
}

// app.js's handleGameOver hands a tutorial match over here instead of
// recording it (no leaderboard entry, no payout for a scripted win).
export function matchOver(state) {
  if (!active) return;
  if (state.mpReason === 'surrendered' || state.score[0] <= state.score[1]) {
    exitTutorial();
    return;
  }
  tick();
}

// Called at the end of every renderAll().
export function observe(state) {
  if (active) tick();
  else if (state && !starting) hintsObserve(state);
}

function tick() {
  if (!active) return;
  const st = deps.store.state;
  const onGame = !$('#game-screen.hidden');
  if (!st || !st.tutorial || !onGame) { exitTutorial(onGame); return; }
  let step = STEPS[stepIdx];
  while (step && step.done(st)) {
    stepIdx += 1;
    step = STEPS[stepIdx];
  }
  if (!step) { finishGuided(); return; }

  let ready = step.ready(st);
  // A player turn that matches no step (say a skip landed mid-animation):
  // jump to the first later step that does fit rather than freezing.
  if (!ready && idle(st)) {
    idleSince = idleSince || Date.now();
    if (Date.now() - idleSince > 1500) {
      const j = STEPS.findIndex((s, i) => i > stepIdx && s.ready(st));
      if (j >= 0) { stepIdx = j; step = STEPS[j]; ready = true; }
    }
  } else {
    idleSince = 0;
  }
  if (ready && shownIdx !== stepIdx) {
    shownIdx = stepIdx;
    track('tutorial_step', { step: stepIdx + 1, name: STEP_NAMES[stepIdx] });
  }
  paint(st, step, ready);
}

function buildLayer() {
  if (layer) layer.remove();
  layer = el('div', 'tut-layer');
  layer.innerHTML = '<svg class="tut-dim" aria-hidden="true"><path fill-rule="evenodd"/></svg>'
    + '<div class="tut-ring"></div><div class="tut-dot"></div>'
    + '<div class="tut-caption" role="status"><div class="tut-meta"></div><p class="tut-text"></p>'
    + '<div class="tut-actions"><button type="button" class="tut-skip">Skip step</button></div></div>';
  document.body.appendChild(layer);
  layer.querySelector('.tut-skip').addEventListener('click', () => {
    const st = deps.store.state;
    const step = STEPS[stepIdx];
    if (!st || !step || !step.ready(st)) return;
    if (!step.button) track('tutorial_skipped', { step: stepIdx + 1, scope: 'step' });
    step.auto(st);
  });
}

function paint(st, step, ready) {
  if (!layer) return;
  const cap = layer.querySelector('.tut-caption');
  layer.classList.toggle('tut-waiting', !ready);
  if (!ready) { holes = []; setHoles([]); return; }
  const lit = step.focus(st).filter(Boolean);
  holes = step.allow ? step.allow(st) : lit;
  const rects = lit.map((n) => n.getBoundingClientRect()).filter((r) => r.width && r.height);
  setHoles(rects);

  layer.querySelector('.tut-meta').textContent = `Step ${stepIdx + 1} of ${STEPS.length}`;
  const text = typeof step.text === 'function' ? step.text(st) : step.text;
  const p = layer.querySelector('.tut-text');
  if (p.textContent !== text) p.textContent = text;
  const skip = layer.querySelector('.tut-skip');
  skip.textContent = step.button || 'Skip step';
  skip.classList.toggle('tut-go', !!step.button);

  // The caption sits on the half of the stage the focus is not on, clear of
  // the top bar so the pause button (the way out) is never covered.
  const vh = window.innerHeight;
  const stage = ($('#game-screen .stage') || document.body).getBoundingClientRect();
  const hud = $('#game-screen .hud');
  const mid = rects.length ? rects.reduce((a, r) => a + r.top + r.height / 2, 0) / rects.length : vh;
  const top = mid > stage.top + stage.height * 0.55;
  cap.style.top = top ? `${Math.round((hud ? hud.getBoundingClientRect().bottom : stage.top + 44) + 8)}px` : 'auto';
  cap.style.bottom = top ? 'auto' : `${Math.round(Math.max(0, vh - stage.bottom) + 12)}px`;

  const [from, to] = step.point(st);
  place(layer.querySelector('.tut-ring'), to);
  const dot = layer.querySelector('.tut-dot');
  if (from && to) {
    const a = from.getBoundingClientRect();
    const b = to.getBoundingClientRect();
    dot.style.display = 'block';
    dot.style.left = (a.left + a.width / 2) + 'px';
    dot.style.top = (a.top + a.height / 2) + 'px';
    dot.style.setProperty('--dx', (b.left + b.width / 2 - a.left - a.width / 2) + 'px');
    dot.style.setProperty('--dy', (b.top + b.height / 2 - a.top - a.height / 2) + 'px');
  } else {
    dot.style.display = 'none';
  }
}

function place(node, target) {
  const r = target && target.getBoundingClientRect();
  if (!r || !r.width) { node.style.display = 'none'; return; }
  node.style.display = 'block';
  node.style.left = (r.left + r.width / 2) + 'px';
  node.style.top = (r.top + r.height / 2) + 'px';
}

// One even-odd path: the whole screen, minus a rounded rect per hole.
function setHoles(rects) {
  const path = layer.querySelector('.tut-dim path');
  let d = `M0 0H${window.innerWidth}V${window.innerHeight}H0Z`;
  for (const q of rects) {
    const x = Math.round(q.left - 5);
    const y = Math.round(q.top - 5);
    const w = Math.round(q.width + 10);
    const h = Math.round(q.height + 10);
    d += `M${x + 10} ${y}H${x + w - 10}A10 10 0 0 1 ${x + w} ${y + 10}V${y + h - 10}`
      + `A10 10 0 0 1 ${x + w - 10} ${y + h}H${x + 10}A10 10 0 0 1 ${x} ${y + h - 10}`
      + `V${y + 10}A10 10 0 0 1 ${x + 10} ${y}Z`;
  }
  if (path.getAttribute('d') !== d) path.setAttribute('d', d);
}

// Taps on the board outside the spotlight never reach the game. Capture
// phase on window, so it runs before input.js and hero.js see the press.
const GUARDED = '#game-screen, #game-over-modal';
const ALWAYS = '#btn-pause, .tut-caption, .hero-view';

function allowed(target) {
  if (bypass || !active) return true;
  if (!target || !target.closest || !target.closest(GUARDED)) return true;
  if (target.closest(ALWAYS)) return true;
  return holes.some((h) => h.contains(target));
}

function guard(e) {
  if (allowed(e.target)) return;
  e.stopPropagation();
  e.preventDefault();
}

function guardUp(e) {
  // A drag released outside the spotlight springs back instead of landing.
  if (!allowed(document.elementFromPoint(e.clientX, e.clientY))) abortGesture();
}

// ---- the "you are ready" card ------------------------------------------

const READY_RULES = [
  ['cruiser', 'A card can attack on every one of your turns. There is no limit per round.'],
  ['destroyer', 'An empty frontline loses the round. The reserve never fights, it only moves straight up.'],
  ['radar', 'Each island power works once per match. Pick the moment.'],
];

function showReadyCard() {
  const wrap = el('div', 'tut-sheet tut-ready');
  wrap.innerHTML = '<div class="tut-panel"><h2 class="tut-title">You are ready</h2>'
    + '<p class="tut-sub">The three rules new captains get wrong most:</p><ol class="tut-rules">'
    + READY_RULES.map(([art, txt]) => `<li>${artHtml(art, 'tut-rule-art')}<span>${txt}</span></li>`).join('')
    + '</ol><button type="button" class="btn-primary tut-wide">To the main menu</button></div>';
  document.body.appendChild(wrap);
  wrap.querySelector('button').addEventListener('click', () => {
    wrap.remove();
    deps.leaveMatchForMenu();
  });
}

// ---- art -----------------------------------------------------------------

function artHtml(id, cls) {
  const isIsland = !!ISLANDS[id];
  if (id === 'back') {
    return `<span class="${cls} tut-art"><svg viewBox="0 0 60 45">${ART_BACK}</svg></span>`;
  }
  if (loadSettings().cardArt !== false) {
    return `<span class="${cls} tut-art"><img src="./render/art/${id}.svg" alt="" draggable="false"></span>`;
  }
  return isIsland
    ? `<span class="${cls} tut-art tut-art-name">${ISLANDS[id].name}</span>`
    : `<span class="${cls} tut-art"><svg viewBox="0 0 60 45">${artFor(id)}</svg></span>`;
}

function mini(id, note) {
  const c = CARDS[id];
  const label = c ? c.name : (ISLANDS[id] ? ISLANDS[id].name : 'Hidden');
  const badge = c ? `<b class="tut-str">${c.strength}</b>` : '';
  return `<figure class="tut-mini${id === 'back' ? ' tut-mini-back' : ''}">${artHtml(id, 'tut-mini-art')}${badge}`
    + `<figcaption>${note || label}</figcaption></figure>`;
}

// ---- the How to play primer ----------------------------------------------

const VS = '<span class="tut-vs">vs</span>';
const PAGES = [
  ['Win islands', 'Each round an island is at stake. Win the round to hold it. The first fleet to hold 3 islands wins the match.',
    mini('scouting') + mini('radar') + mini('two_island')],
  ['Set your fleet', 'Drag at least 4 cards to your frontline and reserve, then tap Ready. Empty slots fill from your hand.',
    mini('battleship') + mini('cruiser') + mini('patrol_ship')],
  ['Attack', 'On your turn, drag a frontline card onto an enemy card. Among ships, higher strength wins. A card may attack every turn.',
    mini('cruiser') + VS + mini('destroyer', 'Sunk')],
  ['Draws and odd ones', 'Same against same: both sink, no tie-break. Planes beat every ship, Submarines sink big ships, Mines never attack.',
    mini('destroyer') + VS + mini('destroyer') + mini('plane') + mini('submarine') + mini('mine')],
  ['Hidden cards', 'Enemy cards start face down. A card that fights turns face up for the rest of the round. You cannot attack a face-up card you would lose to.',
    mini('back') + mini('sea_hunter', 'Revealed')],
  ['Rounds and powers', 'Empty the enemy frontline to win the round; the reserve never fights, it only moves straight ahead into a free slot. Then place a ship or plane on the island. Its power works once per match. The round winner opens the next round; a coin toss decides only round 1 and after a draw. There is no passing: with no legal attack you yield the round.',
    mini('sea_hunter') + '<span class="tut-vs">holds</span>' + mini('radar')],
];

let howto = null;

export function openHowTo(from) {
  if (howto) return;
  track('howto_opened', { from: from || 'menu' });
  howto = el('div', 'tut-sheet tut-howto');
  howto.innerHTML = '<div class="tut-panel"><button type="button" class="tut-close" aria-label="Close">'
    + '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button>'
    + '<div class="tut-viewport"><div class="tut-track">'
    + PAGES.map(([title, text, art], i) => `<section class="tut-page"><div class="tut-page-art">${art}</div>`
      + `<h2 class="tut-title">${i + 1}. ${title}</h2><p class="tut-page-text">${text}</p></section>`).join('')
    + '</div></div><div class="tut-nav"><button type="button" class="btn-secondary tut-prev">Back</button>'
    + `<div class="tut-dots">${PAGES.map(() => '<i></i>').join('')}</div>`
    + '<button type="button" class="btn-primary tut-next">Next</button></div></div>';
  document.body.appendChild(howto);
  const trackEl = howto.querySelector('.tut-track');
  let page = 0;
  const go = (n) => {
    page = Math.max(0, Math.min(PAGES.length - 1, n));
    trackEl.style.transform = `translateX(${-page * 100}%)`;
    howto.querySelectorAll('.tut-dots i').forEach((d, i) => d.classList.toggle('on', i === page));
    howto.querySelector('.tut-prev').disabled = page === 0;
    howto.querySelector('.tut-next').textContent = page === PAGES.length - 1 ? 'Done' : 'Next';
  };
  howto.querySelector('.tut-prev').addEventListener('click', () => go(page - 1));
  howto.querySelector('.tut-next').addEventListener('click', () => (page === PAGES.length - 1 ? closeHowTo() : go(page + 1)));
  howto.querySelector('.tut-close').addEventListener('click', closeHowTo);
  howto.addEventListener('click', (e) => { if (e.target === howto) closeHowTo(); });
  let x0 = null;
  const vp = howto.querySelector('.tut-viewport');
  vp.addEventListener('pointerdown', (e) => { x0 = e.clientX; });
  vp.addEventListener('pointerup', (e) => {
    if (x0 === null) return;
    const dx = e.clientX - x0;
    x0 = null;
    if (Math.abs(dx) > 40) go(page + (dx < 0 ? 1 : -1));
  });
  howto.tabIndex = -1;
  howto.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') go(page + 1);
    else if (e.key === 'ArrowLeft') go(page - 1);
    else if (e.key === 'Escape') closeHowTo();
  });
  go(0);
  howto.focus();
  return go;
}

function closeHowTo() {
  if (howto) howto.remove();
  howto = null;
}

// ---- contextual hints (first three real matches) --------------------------

let hintState = null;
let hintSeen = null;
let hintEl = null;
let hintTimer = 0;

function hintsOn() {
  return loadSettings().hints !== false && (parseInt(lsGet(HINT_KEY), 10) || 0) <= HINT_MATCHES;
}

function hintsObserve(st) {
  if (st.tutorial || $('#game-screen.hidden')) return;
  // A local match is one state object; an online one gets a fresh object
  // per server frame (multiplayer.js's adaptState), so there a new match is
  // a round counter going back or a finished match starting over.
  const prev = hintState;
  hintState = st;
  const fresh = !prev || (st.multiplayer
    ? !prev.multiplayer || st.roundNum < hintSeen.round || (prev.phase === 'GAME_OVER' && st.phase !== 'GAME_OVER')
    : st !== prev);
  if (fresh) {
    // Count each match once; hints show while the count is 1..3.
    hintSeen = { round: st.roundNum, attack: false, power: false, roundEnd: false };
    lsSet(HINT_KEY, String((parseInt(lsGet(HINT_KEY), 10) || 0) + 1));
    return;
  }
  if (!hintsOn()) return;
  const myTurn = st.phase === 'COMBAT' && st.turnOwner === 1;
  if (myTurn && !hintSeen.attack) {
    hintSeen.attack = true;
    showHint('Your turn: drag a front card onto an enemy card to attack.');
  } else if (myTurn && !hintSeen.power
    && (st.p1Islands || []).some((id) => id !== 'two_island' && !(st.p1PowersUsed || []).includes(id))) {
    hintSeen.power = true;
    showHint('Tap your island to use its power. It works once per match.');
  } else if (st.roundNum > hintSeen.round && !hintSeen.roundEnd) {
    hintSeen.roundEnd = true;
    showHint('Round over. The winner opens the next round.');
  }
  hintSeen.round = Math.max(hintSeen.round, st.roundNum);
}

export function showHint(text) {
  if (hintEl) hintEl.remove();
  clearTimeout(hintTimer);
  hintEl = el('div', 'tut-hint');
  hintEl.setAttribute('role', 'status');
  hintEl.textContent = text;
  // Just under the match's top bar, so the pause button stays reachable.
  const hud = $('#game-screen:not(.hidden) .hud');
  if (hud) hintEl.style.top = `${Math.round(hud.getBoundingClientRect().bottom + 6)}px`;
  hintEl.addEventListener('click', () => { if (hintEl) hintEl.remove(); hintEl = null; });
  document.body.appendChild(hintEl);
  hintTimer = setTimeout(() => { if (hintEl) hintEl.remove(); hintEl = null; }, HINT_MS);
}

// ---- wiring ----------------------------------------------------------------

// `d` = { store, startGame, renderAll, leaveMatchForMenu }; `params` is the
// page's URLSearchParams. Returns true when a ?demo= page was handled here.
export function init(d, params) {
  deps = d;
  const flag = params.get('tutorial');
  forced = flag === '1' ? true : flag === '0' ? false : null;

  const css = document.createElement('link');
  css.rel = 'stylesheet';
  css.href = new URL('./tutorial.css', import.meta.url).href;
  document.head.appendChild(css);

  ['pointerdown', 'click'].forEach((t) => window.addEventListener(t, guard, true));
  window.addEventListener('pointerup', guardUp, true);
  window.addEventListener('resize', () => { if (active) tick(); });

  const hub = $('#main-menu .menu-hub-link');
  if (hub) {
    const b = el('button', 'btn-secondary menu-hub-link tut-menu-howto', 'How to play');
    b.type = 'button';
    b.id = 'btn-howto';
    b.addEventListener('click', () => openHowTo('menu'));
    hub.parentNode.insertBefore(b, hub);
  }

  setPauseExtras(() => [
    { id: 'btn-pause-howto', label: 'How to play', onClick: () => openHowTo('pause') },
    ...(active ? [{ id: 'btn-pause-exit-tutorial', label: 'Exit tutorial', onClick: () => exitTutorial() }] : []),
  ]);

  if (params.get('demo') === 'howto') {
    const go = openHowTo('demo');
    const page = parseInt(params.get('page'), 10);
    if (page > 1) go(page - 1);
    return true;
  }
  return false;
}
