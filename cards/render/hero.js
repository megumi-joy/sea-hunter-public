// Sea Hunter -- phase P13 "Hero card moments".
//
// One view, three moments: a card shown at hero size -- 60% of the stage
// width, centred, over a dim backdrop, with its full art, full name,
// strength and ability text -- so the illustration a player has only ever
// seen at 52px is, for a beat, the whole screen.
//
//   1. Inspect. Double-tap any face-up unit card -- on the board or in the
//      hand, in every phase -- or right-click it. Outside PREP a 400 ms
//      press and hold (or a long-press `contextmenu`) does the same, and
//      islands open by hold as well. In PREP a hold does nothing at all
//      (owner 2026-09-16: a long press there sent a placed card back to
//      hand by accident). The hero stays up until tapped. A face-down card
//      is never shown: pressing it must not reveal it.
//   2. Capture. render/screens.js shows the captured island here for a
//      beat before the P4 ceremony flies it to its row -- from the hero
//      card's rect, so the flight starts where the eye already is.
//   3. Victory. render/screens.js hands the risen P12 fleet to
//      playSequence(), which gives each card the hero treatment in turn.
//
// The timed moments (2, 3) are pointer-events: none -- they are a flourish
// over a live screen and must never eat the tap on "Continue". Inspect is
// the only one that takes input, and all it does with it is close.
//
// Rules owned here: none. The card is built by render/cards.js's
// buildCardEl from the same def the board renders from; the island element
// is built by the caller (render/islands.js's buildIslandEl), which keeps
// this module out of the islands <-> screens import cycle.
//
// Timers, not animation events, drive every duration -- the same reason
// render/fx.js gives: a headless capture advances timers but not the
// animation clock, and a hero left up forever would hide the next shot.

import { CARDS, CARD_ORDER, getResult } from '../cards.js';
import { getIslandDef } from '../islands.js';
import { buildCardEl } from './cards.js';

const HOLD_MS = 400;
const MOVE_TOLERANCE = 6;     // px; matches render/input.js's drag threshold
const DOUBLE_TAP_MS = 320;    // second tap must land within this of the first
const DOUBLE_TAP_PX = 28;
const WIDTH_FRACTION = 0.6;

let current = null;           // { el, media, timer, onDone }
let press = null;             // { timer, x, y, pid, found, key }
let lastTap = null;           // { key, t, x, y } -- the previous clean tap
let lastPointerType = '';
// Set when a hold opens the hero; the click the browser synthesizes when
// that same finger lifts is swallowed, then the flag clears on a timer
// after the pointerup (render/input.js's swallowClick uses the same order:
// pointerup, then click, then timers).
let swallowClick = false;
let deps = null;

function stageEl() {
  return document.querySelector('#game-screen .stage');
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// The hero's width in px. 60% of the stage, measured -- except where that
// would not fit the height (a landscape phone's stage is the whole 915px
// width but only 412px tall), where the card is capped so it and its text
// panel stay on screen.
function heroWidth(isIsland) {
  const st = stageEl();
  const r = st ? st.getBoundingClientRect() : null;
  const stageW = r && r.width ? r.width : Math.min(window.innerWidth, 480);
  const viewH = r && r.height ? Math.min(r.height, window.innerHeight) : window.innerHeight;
  let w = stageW * WIDTH_FRACTION;
  // unit card is 3:4, island card 2:1; leave ~38% of the height for the
  // text panel and margins.
  const maxByHeight = isIsland ? viewH * 0.62 * 2 : viewH * 0.62 * 0.75;
  if (w > maxByHeight) w = maxByHeight;
  return Math.round(w);
}

// Where the overlay lives. On the match stage it is a child of `.stage`
// (overflow: hidden, so it cannot escape the phone-shaped frame on
// desktop, exactly like render/islands.js's detail overlay). A caller that
// is not on the stage -- the victory scene is a fixed modal -- passes its
// own host.
function mount(host) {
  return host || stageEl() || document.body;
}

export function isOpen() { return !!current; }

// Every way a hero goes away -- its own timer, a tap, another hero opening
// over it, a scene teardown calling close() -- runs its onDone exactly once,
// with the card's rect read before the overlay is removed. A timed moment's
// caller is waiting on that callback (the capture ceremony holds its
// busy flag until the flight lands), so it must never be dropped.
export function close() {
  if (!current) return;
  const c = current;
  current = null;
  clearTimeout(c.timer);
  const rect = c.media.getBoundingClientRect();
  c.el.remove();
  if (typeof c.onDone === 'function') c.onDone(rect);
}

// `media` is the element to show big; `info` the text panel's content.
// opts: { host, duration, interactive, onDone(rect), cls }
function open(media, info, opts = {}) {
  close();
  const wrap = document.createElement('div');
  wrap.className = 'hero-view' + (opts.cls ? ' ' + opts.cls : '')
    + (opts.interactive ? ' hero-interactive' : '')
    + (opts.host && opts.host !== stageEl() ? ' hero-fixed' : '');
  wrap.setAttribute('role', opts.interactive ? 'dialog' : 'presentation');
  if (opts.interactive) wrap.setAttribute('aria-label', info.title || 'Card');

  const backdrop = document.createElement('div');
  backdrop.className = 'hero-backdrop';
  wrap.appendChild(backdrop);

  const frame = document.createElement('div');
  frame.className = 'hero-frame';
  media.classList.add('hero-media');
  frame.appendChild(media);

  const panel = document.createElement('div');
  panel.className = 'hero-panel';
  panel.innerHTML = `<div class="hero-title">${esc(info.title)}</div>`
    + (info.meta ? `<div class="hero-meta">${info.meta}</div>` : '')
    + (info.ability ? `<div class="hero-ability"><span class="hero-ability-name">${esc(info.ability)}</span>${info.desc ? ` ${esc(info.desc)}` : ''}</div>`
      : info.desc ? `<div class="hero-ability">${esc(info.desc)}</div>` : '')
    + (info.extra || '')
    + (opts.interactive ? '<div class="hero-hint">Tap to close</div>' : '');
  frame.appendChild(panel);
  wrap.appendChild(frame);

  if (opts.interactive) {
    wrap.addEventListener('click', (e) => { e.stopPropagation(); close(); });
  }

  mount(opts.host).appendChild(wrap);
  const entry = { el: wrap, media, timer: 0, onDone: opts.onDone || null };
  current = entry;
  if (opts.duration) {
    entry.timer = setTimeout(() => { if (current === entry) close(); }, opts.duration);
  }
  return wrap;
}

// Who this card sinks, who it trades with, and who sinks it -- the three
// icon rows of the cardboard card, as text. Owner 2026-09-16: pressing a
// card must say whom to fear and whom to scare. Read from the impact
// table, so the rows can never disagree with combat.
function matchupRows(def) {
  const rows = { WIN: [], DRAW: [], LOSS: [] };
  for (const id of CARD_ORDER) {
    const r = getResult(def.id, id);
    if (rows[r]) rows[r].push(CARDS[id].name);
  }
  const chips = (list) => list.length
    ? list.map((n) => `<span class="hero-chip">${esc(n)}</span>`).join('')
    : '<span class="hero-chip hero-chip-none">nobody</span>';
  return `<div class="hero-matchups">`
    + `<div class="hero-row hero-row-win"><span class="hero-row-label">Sinks</span>${chips(rows.WIN)}</div>`
    + `<div class="hero-row hero-row-draw"><span class="hero-row-label">Both sink</span>${chips(rows.DRAW)}</div>`
    + `<div class="hero-row hero-row-loss"><span class="hero-row-label">Sunk by</span>${chips(rows.LOSS)}</div>`
    + `</div>`;
}

function unitInfo(def) {
  return {
    title: def.name,
    meta: `<span class="hero-strength">Strength ${esc(def.strength)}</span>`,
    ability: '',
    desc: '',
    extra: matchupRows(def),
  };
}

// A unit card at hero size. `def` is a cards.js CARDS entry.
export function showCard(def, opts = {}) {
  if (!def) return null;
  const w = heroWidth(false);
  const card = buildCardEl(def, true, 'hero-card');
  card.style.setProperty('--slot-w', w + 'px');
  card.removeAttribute('title');
  return open(card, unitInfo(def), opts);
}

// An island at hero size. The caller supplies the element (see header).
export function showIsland(def, islandEl, opts = {}) {
  if (!def || !islandEl) return null;
  const w = heroWidth(true);
  islandEl.classList.add('hero-island');
  islandEl.style.width = w + 'px';
  islandEl.style.height = Math.round(w / 2) + 'px';
  islandEl.removeAttribute('title');
  // `opts.meta` overrides the caption line; the capture moment keeps the
  // default, an inspect passes '' (holding a chip is not a capture).
  const meta = opts.meta !== undefined ? opts.meta : '<span class="hero-capture">Island captured</span>';
  return open(islandEl, { title: def.name, meta, desc: def.desc || '' },
    { cls: 'hero-moment-capture', ...opts });
}

// The victory scene: each def in turn, `each` ms apiece, then `onDone`.
// `alive()` is polled between cards so a scene torn down mid-sequence (the
// player tapped Continue) stops it rather than raising heroes over the menu.
export function playSequence(defs, { host, each = 760, alive = () => true, onDone } = {}) {
  const list = (defs || []).filter(Boolean);
  let i = 0;
  const next = () => {
    if (i >= list.length || !alive()) { if (onDone) onDone(); return; }
    const def = list[i++];
    showCard(def, { host, duration: each, cls: 'hero-moment-victory', onDone: () => next() });
  };
  next();
}

// ---- inspect: press and hold ---------------------------------------------

function inspectableDef(target) {
  if (!target || !target.closest) return null;
  const unit = target.closest('.card.unit-card');
  if (unit) {
    if (unit.classList.contains('face-down') || !unit.querySelector('.uc-inner:not(.uc-inner-back)')) return null;
    const def = CARDS[unit.dataset.cardId];
    return def ? { kind: 'unit', def } : null;
  }
  const island = target.closest('.island-card[data-island-id]');
  if (island) {
    const def = getIslandDef(island.dataset.islandId);
    return def ? { kind: 'island', def } : null;
  }
  return null;
}

// Which card a tap landed on, stable across the re-render the first tap of
// a double tap may cause (ui.js rebuilds the zones, so element identity is
// not): the uid ui.js stamps on unit cards.
function tapKey(target) {
  const unit = target && target.closest ? target.closest('.card.unit-card[data-uid]') : null;
  return unit ? 'u' + unit.dataset.uid : null;
}

function inPrep() {
  return !!(deps && deps.getPhase && deps.getPhase() === 'PREP');
}

function inspect(found) {
  // Whatever gesture render/input.js had started on this press (a hand card
  // picked up, an attacker armed) is abandoned: the player was reading, not
  // playing. A double tap's FIRST tap has already run as a normal tap, so
  // what it selected is dropped too.
  if (deps && deps.abortGesture) deps.abortGesture();
  if (deps && deps.clearSelection) deps.clearSelection();
  // And the click the browser synthesizes when the finger lifts must neither
  // reach ui.js's tap handler as a placement or an attack nor land on the
  // hero it just opened and close it again.
  swallowClick = true;
  if (found.kind === 'unit') {
    showCard(found.def, { interactive: true, cls: 'hero-moment-inspect' });
  } else if (deps && deps.buildIsland) {
    showIsland(found.def, deps.buildIsland(found.def), { interactive: true, cls: 'hero-moment-inspect', meta: '' });
  }
}

function cancelPress() {
  if (!press) return;
  clearTimeout(press.timer);
  press = null;
}

function onDown(e) {
  lastPointerType = e.pointerType || '';
  if (e.button !== undefined && e.button > 0) return;
  if (current) return;
  const found = inspectableDef(e.target);
  if (!found) { lastTap = null; return; }
  cancelPress();
  press = {
    x: e.clientX, y: e.clientY, pid: e.pointerId, found, key: tapKey(e.target), moved: false,
    // No hold in PREP: there a press is placement, and a long one did
    // things the player never asked for.
    timer: inPrep() ? 0 : setTimeout(() => { press = null; lastTap = null; inspect(found); }, HOLD_MS),
  };
}

function onMove(e) {
  if (!press || (press.pid !== undefined && e.pointerId !== press.pid)) return;
  if (Math.hypot(e.clientX - press.x, e.clientY - press.y) >= MOVE_TOLERANCE) {
    clearTimeout(press.timer);
    press.moved = true;
  }
}

// A clean tap (no drag, released before any hold fired) on a unit card.
// Two of them on the same card inside DOUBLE_TAP_MS open the hero. The
// second tap's click is swallowed so it neither re-runs the tap handler
// nor lands on the hero and closes it.
function onUp(e) {
  if (!press || (press.pid !== undefined && e.pointerId !== press.pid)) return;
  const p = press;
  cancelPress();
  if (p.moved || !p.key || current) { lastTap = null; return; }
  const now = Date.now();
  if (lastTap && lastTap.key === p.key && now - lastTap.t <= DOUBLE_TAP_MS
      && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) <= DOUBLE_TAP_PX) {
    lastTap = null;
    // The first tap may have re-rendered the card; look it up again so a
    // card that has since gone face-down is still never shown.
    const el = document.querySelector(`#game-screen .card.unit-card[data-uid="${p.key.slice(1)}"]`);
    const found = el ? inspectableDef(el) : p.found;
    if (found) inspect(found);
    return;
  }
  lastTap = { key: p.key, t: now, x: e.clientX, y: e.clientY };
}

export function init(d) {
  deps = d || {};
  const host = document.getElementById('game-screen');
  if (!host) return;
  host.addEventListener('pointerdown', onDown, true);
  window.addEventListener('pointermove', onMove, { passive: true });
  const release = () => {
    if (swallowClick) setTimeout(() => { swallowClick = false; }, 0);
  };
  window.addEventListener('pointerup', (e) => { onUp(e); release(); });
  window.addEventListener('pointercancel', () => { cancelPress(); lastTap = null; release(); });
  // Android Chrome fires contextmenu on a long-press, desktop on a right
  // click; either way it is the same request. Swallowed only over a card
  // that can be inspected, so the page keeps its menu everywhere else.
  host.addEventListener('contextmenu', (e) => {
    const found = inspectableDef(e.target);
    if (!found) return;
    e.preventDefault();
    // A touch long-press in PREP is a hold like any other: it does nothing.
    // A right click (mouse) still opens the card in every phase.
    if (inPrep() && lastPointerType !== 'mouse') return;
    cancelPress();
    if (!current) inspect(found);
  });
  window.addEventListener('click', (e) => {
    if (!swallowClick) return;
    swallowClick = false;
    e.stopPropagation();
    e.preventDefault();
  }, true);
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && current && current.el.classList.contains('hero-interactive')) close();
  });
}

// ---- debug (?demo=hero) ----------------------------------------------------
// The heaviest-hitting card with an ability, so the shot exercises the gold
// frame, the strength line and the ability text at once.
export function demoHero() {
  const withAbility = Object.values(CARDS).filter((c) => c.ability)
    .sort((a, b) => (b.strength || 0) - (a.strength || 0));
  const def = withAbility[0] || CARDS.battleship || Object.values(CARDS)[0];
  showCard(def, { interactive: true, cls: 'hero-moment-inspect' });
}
