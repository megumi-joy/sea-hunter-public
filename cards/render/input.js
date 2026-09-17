// Sea Hunter -- phase P2 "Input".
//
// All pointer interaction for the match stage lives here: drag placement in
// PREP, the hand fan, the COMBAT targeting arc, legality highlighting and
// turn feedback. Reference is MTG Arena on mobile.
//
// Design rules this module sticks to:
//
//  * It owns NO game rules. Every legality question is answered by the
//    handlers app.js already has -- either by calling them (placement,
//    attack) or by reading the highlight classes they put on the DOM
//    (`.slot.target-highlight`, written by ui.js's highlightSlots from the
//    existing tap handlers). Adding a rule here would mean two sources of
//    truth the first time game.js changed.
//  * It never renders cards. ui.js rebuilds the zones and the hand from
//    scratch on every state change; this module reacts to that with a
//    MutationObserver and re-derives all of its own state from the DOM plus
//    a handful of reads off store.state.
//  * Tap-to-place and tap-to-attack keep working exactly as before: a press
//    that never passes the movement threshold is not intercepted at all, so
//    the native click reaches ui.js's own listener.
//
// app.js wires this up through init() -- see the deps block there.

// P5 "Sound and haptics". This module fires the six cues that answer a
// player's own input. Four of them (card_place, card_return, select,
// arc_start) are edge-triggered off refresh()/the arc rather than off the
// press that asked for them: refresh() runs after the board has actually
// changed, so a rejected placement, a deselect tap or a tap on a Mine stays
// silent, and a placement confirmed by the multiplayer server sounds exactly
// like a local one.
import * as Audio from './audio.js';

const MOVE_THRESHOLD = 6;      // px before a press becomes a drag
const FAN_MAX_ROT = 8;         // deg at the outermost card; see fanTransform()
const FAN_LIFT = 12;           // px the centre of the arc rises
const FOCUS_LIFT = 26;         // px a pressed/hovered hand card rises
const FOCUS_SCALE = 1.25;      // P9 fix 2: the read size, not a nudge
// P10 fix 2. Below this left-edge strip (px) a hand card cannot show its
// badge and the first word of its name side by side -- 52px is where
// "Battleship" at the nameplate's 8px floor stops fitting. P9 answered a
// too-narrow strip by rotating the name up a spine; P10 refuses to lay the
// card out at all below this width and puts it behind the "+N" chip instead,
// because rotated type is not type anyone reads.
const MIN_STRIP = 52;
// Hard ceiling on the visible fan, independent of how wide the row is: past
// about nine cards a fan stops being a hand you can take in at a glance and
// becomes a list, and a list wants scrolling, not spreading.
const FAN_CAP = 9;
// Room the "+N" chip needs at the left end of the row. Mirrors the
// `.hand-row.hand-capped` padding in input.css -- the same decision stated
// in the two languages, as with COLLAPSED_PEEK below.
const CHIP_ROOM = 34;
// The row's own resting horizontal padding, from input.css. Read as a
// constant rather than measured so the cap solve is stable while the
// `.hand-capped` class it decides is itself being toggled.
const ROW_PAD = 18;
// Between MIN_STRIP and a full card width the face is still worth showing,
// but only its LEFT part is visible -- and a nameplate centred in an 84px
// band has its last letters under the next card. Above this many px of
// visible strip the row stops overlapping at all and centring is correct
// again. (Seen at 6 cards on a 412px phone: a 57px strip printed
// "Artiller", "Cruise", "Sea Hunt".)
const OVERLAP_ABOVE = 4;
// What is left peeking above the stage's bottom edge once the hand collapses
// in COMBAT -- the badge and the top of the art, enough to read the row as
// cards rather than as a bar.
const COLLAPSED_PEEK = 44;

let deps = null;
let stageEl = null;
let overlayEl = null;
let arcGlow = null;
let arcLine = null;
let arcHead = null;

// Live gesture. `kind` is 'place' | 'move' | 'attack' ('move' drags a card
// the player already placed, during PREP); `moved` flips once the press
// passes MOVE_THRESHOLD and is what separates a drag from a tap.
let drag = null;
// Set for one task after a drag completes so the synthesized click that
// follows pointerup does not also run ui.js's tap handler.
let swallowClick = false;
// Last pointer position while the targeting arc is live (either mid
// drag-to-target, or after a tap selected an attacker).
let arcPoint = null;

let lastHandUids = [];
let lastHandRects = new Map();
let lastTurnOwner = null;
let lastAttackerSlot = null;  // P5: rising edge of the attacker selection
let observer = null;           // single MutationObserver over the six containers
let refreshQueued = false;

// -- opponent cards already seen this round (P9 fix 5) --------------
// A card the player has legitimately seen face-up -- a Spyglass reveal, an
// attack it survived -- and which is now face-down again. Remembering it is
// play skill the UI should support, not hide, so those backs get a "known"
// outline. Keyed on the card uid ui.js already stamps on every element, and
// cleared when the round number changes, because the board is redealt.
const knownUids = new Set();
let knownRound = null;

function markKnownCards(s) {
  const round = s && s.roundNum;
  if (round !== knownRound) { knownUids.clear(); knownRound = round; }
  document.querySelectorAll('#opp-front .card, #opp-reserve .card').forEach((el) => {
    const uid = Number(el.dataset.uid);
    if (!uid) return;
    if (!el.classList.contains('face-down')) {
      knownUids.add(uid);
      el.classList.remove('known');
    } else {
      el.classList.toggle('known', knownUids.has(uid));
    }
  });
}

// -- small helpers -------------------------------------------------
const state = () => (deps && deps.store ? deps.store.state : null);

function handCards() {
  const row = document.getElementById('player-hand');
  return row ? Array.from(row.children).filter((el) => el.classList.contains('card')) : [];
}

// One guard for every gesture. Anything that makes the board not the
// player's to touch right now -- an AI turn or an attack animation in
// flight (store.combatLocked, the same flag app.js sets around doAiTurn and
// UI.animateAttack), a finished match, a targeting mode owned by an island
// power or an artifact, or a spectating multiplayer session -- means this
// module must do nothing at all and leave the existing tap handlers alone.
function inert() {
  const s = state();
  if (!s || !deps) return true;
  if (deps.store.combatLocked) return true;
  if (deps.store.activeIslandPower || deps.store.activeArtifact) return true;
  if (s.phase === deps.PHASE.GAME_OVER) return true;
  // There is no spectator flag in multiplayer.js today; honour one if it
  // ever appears, from either place a session-wide mode would plausibly be
  // recorded, so a spectator can never drive the board from here.
  if (deps.store.spectating || document.body.classList.contains('spectating')) return true;
  return false;
}

function stage() {
  if (!stageEl || !stageEl.isConnected) stageEl = document.querySelector('#game-screen .stage');
  return stageEl;
}

function centreOf(el) {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

// -- hand fan ------------------------------------------------------
// Horizontal spacing is NOT decided here: ui.js's layoutHandRow() already
// solves the negative margin that makes 14 cards span the row exactly (and
// re-solves it on resize). This only adds the arc -- a small rotation plus
// a lift that is largest in the middle -- on top of that solved spacing, so
// the fit guarantee is untouched.
//
// The centre is raised rather than the edges lowered: the hand row sits on
// the bottom edge of a stage that clips its overflow, so anything pushed
// down is lost. Rotation is kept small for the same reason -- at 412px wide
// a 14-card fan spans nearly the whole row, and a big angle swings the
// outer cards' corners past the stage edge.
function fanTransform(cards, i, focusIdx) {
  const n = cards.length;
  if (n <= 1) return i === focusIdx ? `translateY(-${FOCUS_LIFT}px) scale(${FOCUS_SCALE})` : '';
  const half = (n - 1) / 2;
  const t = (i - half) / half;                 // -1 .. 1
  const spread = Math.min(1, (n - 1) / 8);     // small hands stay nearly flat
  const rot = t * FAN_MAX_ROT * spread;
  const lift = -FAN_LIFT * spread * (1 - t * t);

  if (i === focusIdx) {
    // The focused card drops its rotation and comes straight up, which is
    // what makes it legible above its neighbours.
    return `translateY(${(lift - FOCUS_LIFT).toFixed(1)}px) scale(${FOCUS_SCALE})`;
  }
  let push = 0;
  if (focusIdx >= 0) {
    // Shove the two sides apart as rigid blocks to reveal the focused card
    // -- the same approach ui.js used for its hover lift, sized to the
    // overlap the row is currently running at.
    const row = document.getElementById('player-hand');
    const overlap = row ? Number(row.dataset.overlap) || 0 : 0;
    // Sized to the overlap plus the room the focused card's own scale-up
    // needs: at FOCUS_SCALE 1.25 a 90px card grows 11px past each edge.
    push = Math.min(overlap + 14, 34) * (i < focusIdx ? -1 : 1);
  }
  return `translateX(${push}px) translateY(${lift.toFixed(1)}px) rotate(${rot.toFixed(2)}deg)`;
}

// -- the capped fan (P10 fix 2) ------------------------------------
// ui.js's layoutHandRow() solves the negative margin that makes ALL n cards
// span the row, and at 412px with 14 cards that step is ~22px -- a sliver
// that can show a badge and nothing else. The fix is not a better spacing
// solve (13 steps plus one whole card have to add up to the row width, so
// no solve exists); it is to lay out fewer cards.
//
// So: at most FAN_CAP cards are laid out, and only as many of those as can
// each keep MIN_STRIP px of visible left edge. The remainder -- always the
// OLDEST, at the left end, since the right end is where a freshly drawn
// card lands -- are taken out of flow and counted on a "+N" chip, which
// expands the row into a plain scrollable strip on tap.
//
// Taken out of flow with `position:absolute`, not `display:none`: ui.js's
// FLIP (recordRectsBeforeWipe / flyNewlyEnteredCards) reads a rect for
// every hand card, and a display:none card has none. Parked at the row's
// left edge, they also happen to be exactly where the chip is, so a stacked
// card that does get played flies out from under the chip.
function handCapacity(row, cards) {
  const n = cards.length;
  if (n < 2) return n;
  // The LAST card is never stacked, so it is the one guaranteed to have
  // been laid out and measured.
  const cardW = cards[n - 1].offsetWidth;
  if (!cardW || !row.clientWidth) return n;
  // clientWidth includes padding, so subtracting the resting padding and
  // the chip's room gives the same answer whether or not `.hand-capped` is
  // currently on -- which matters, because this is what decides that class.
  const room = row.clientWidth - ROW_PAD * 2 - CHIP_ROOM;
  // k cards need one full card plus (k - 1) strips.
  const byWidth = Math.floor((room - cardW) / MIN_STRIP) + 1;
  // Never below 2: a one-card fan behind a "+13" chip is worse than a tight
  // one, and on a viewport that narrow nothing else would fit either.
  return Math.max(2, Math.min(FAN_CAP, byWidth, n));
}

// Decides the stack, writes the chip's label, and returns the cards that are
// actually laid out. `.hand-expanded` (set by a tap on the chip) shows the
// lot and lets input.css scroll them.
function applyHandCap(row, cards) {
  const expanded = row.classList.contains('hand-expanded');
  const cap = expanded ? cards.length : handCapacity(row, cards);
  const stacked = Math.max(0, cards.length - cap);
  cards.forEach((el, i) => {
    const hide = i < stacked;
    if (el.classList.contains('hand-stacked') !== hide) {
      el.classList.toggle('hand-stacked', hide);
    }
  });
  if (row.classList.contains('hand-capped') !== (stacked > 0)) {
    row.classList.toggle('hand-capped', stacked > 0);
  }
  // A data attribute rather than a child node: ui.js owns #player-hand's
  // children and rewrites them on every deal, and input.js has a mutation
  // observer on the row, so a real chip element would be wiped and would
  // feed the observer back into another refresh. input.css draws it with
  // `content: attr(data-hand-overflow)` on the row's ::after.
  const label = stacked > 0 ? '+' + stacked : '';
  if ((row.dataset.handOverflow || '') !== label) {
    if (label) row.dataset.handOverflow = label;
    else delete row.dataset.handOverflow;
  }
  return cards.filter((el) => !el.classList.contains('hand-stacked'));
}

// Re-solve the overlap for the cards that ARE laid out. ui.js solved it for
// all n; with the stack out of flow that would leave the visible cards
// bunched against the left. Same formula as layoutHandRow(), over the
// visible subset and the row's current padding (which the `.hand-capped`
// toggle above has already changed, so getComputedStyle here reads the
// value that is actually in effect).
//
// `--uc-strip` is published for anything that wants to know how much of a
// card survives; `.hand-overlap` is what tells cards.css to set the
// nameplate from the left rather than centring it under its neighbour.
function publishStrip(row, visible) {
  const n = visible.length;
  if (!n) {
    row.classList.remove('hand-overlap');
    return;
  }
  const cardW = visible[n - 1].offsetWidth;
  if (!cardW) return;
  const cs = getComputedStyle(row);
  const gap = parseFloat(cs.columnGap || cs.gap) || 0;
  const avail = row.clientWidth
    - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
  let step = cardW + gap;
  let margin = 0;
  // Expanded: no overlap at all -- the row scrolls instead.
  if (!row.classList.contains('hand-expanded')
      && n > 1 && avail > 0 && n * cardW + (n - 1) * gap > avail) {
    step = (avail - cardW) / (n - 1);
    margin = step - cardW - gap;
  }
  row.style.setProperty('--hand-overlap', margin.toFixed(2) + 'px');
  row.dataset.overlap = Math.max(0, -margin).toFixed(2);
  row.style.setProperty('--uc-strip', step.toFixed(1) + 'px');
  const lapped = n > 1 && step < cardW - OVERLAP_ABOVE;
  if (row.classList.contains('hand-overlap') !== lapped) {
    row.classList.toggle('hand-overlap', lapped);
  }
}

function layoutFan(opts = {}) {
  const row = document.getElementById('player-hand');
  if (!row) return;
  const all = handCards();
  const cards = applyHandCap(row, all);
  publishStrip(row, cards);
  // The stacked cards keep no transform of their own -- input.css parks them
  // at the row's left edge, and a leftover fan rotation would show through
  // the chip during the transition back.
  all.forEach((el) => {
    if (el.classList.contains('hand-stacked')) el.style.transform = '';
  });
  // Conditional: a same-value classList write still queues a mutation
  // record, which would feed the observer back into another refresh.
  const wantFan = cards.length > 0 && !row.classList.contains('hand-expanded');
  if (row.classList.contains('input-fan') !== wantFan) row.classList.toggle('input-fan', wantFan);
  // Expanded: a plain scrollable strip of whole cards. No rotation, no arc
  // lift, and no focus lift either -- `overflow-x: auto` forces overflow-y
  // to auto as well, so anything lifted out of the row would simply be
  // clipped by it. Clearing the transform outright is also what keeps a
  // card's last fan rotation from being frozen onto it by the row's
  // transform-origin changing when `.input-fan` comes off.
  if (!wantFan) {
    cards.forEach((el) => {
      if (!el.classList.contains('dragging')) el.style.transform = '';
    });
    return;
  }
  const focusIdx = cards.findIndex((el) => el.classList.contains('hand-focus'));
  cards.forEach((el, i) => {
    if (el.classList.contains('dragging')) return;
    const tf = fanTransform(cards, i, focusIdx);
    if (opts.instant) {
      el.classList.add('no-anim');
      el.style.transform = tf;
      // Force the instant transform to land before transitions come back,
      // otherwise the next assignment animates from the old value.
      void el.offsetWidth;
      el.classList.remove('no-anim');
    } else {
      el.style.transform = tf;
    }
  });
}

// -- COMBAT hand collapse (P9 fix 2) -------------------------------
// In COMBAT the hand is reference material, not the thing being used, and
// at 412px it was eating 140px of a 915px screen. Collapsing is a transform
// on the row, NOT a change to --hand-h: on a 1512x794 desktop the HEIGHT
// clamp is what wins stage.css's slot-size min(), so freeing the band's
// height would resize every slot on the board at the PREP -> COMBAT
// boundary and make the FLIP animations jump.
let handExpanded = false;   // sticky for as long as COMBAT lasts
let lastPhase = null;

function applyHandCollapse(phase) {
  const row = document.getElementById('player-hand');
  if (!row) return;
  if (phase !== lastPhase) {
    handExpanded = false;
    chipExpanded = false;
    lastPhase = phase;
    // BUGFIX: `chipExpanded` was reset here but `.hand-expanded` -- the class
    // it decides -- was never taken off the row by anything, in this file or
    // any other. One tap on the "+N" chip therefore converted the hand into a
    // plain scrollable strip for the REST OF THE MATCH: layoutFan()'s
    // `wantFan` stays false while the class is on, so the fan, the focus lift
    // and the COMBAT collapse (input.css's `overflow-x: auto` fights the
    // row's translateY) were all dead from that tap onward, across every
    // later PREP re-deal. Cleared alongside the flag, conditionally, because
    // a same-value classList write queues a mutation record and would feed
    // the observer straight back into another refresh().
    if (row.classList.contains('hand-expanded')) {
      row.classList.remove('hand-expanded');
      row.style.removeProperty('--uc-strip');
    }
  }
  const combat = phase === 'COMBAT';
  const want = combat && !handExpanded && handCards().length > 0;
  if (row.classList.contains('hand-collapsed') !== want) {
    row.classList.toggle('hand-collapsed', want);
  }
  // Only meaningful while there is something to expand back to.
  row.classList.toggle('hand-collapsible', combat && handCards().length > 0);
}

// -- the "+N" chip (P10 fix 2) -------------------------------------
// Sticky for as long as the phase lasts, like handExpanded above: a player
// who opened the stack to look for a card is not done with it after one tap.
let chipExpanded = false;

// True when a pointer landed on the chip. The chip is the row's ::after, so
// there is no node to hit-test -- but its box is known exactly (it is pinned
// to the row's left padding by input.css), so hit-test the geometry.
function hitChip(row, ev) {
  if (!row.classList.contains('hand-capped')) return false;
  const r = row.getBoundingClientRect();
  return ev.clientX <= r.left + ROW_PAD + CHIP_ROOM;
}

// A tap anywhere on the collapsed strip brings the hand back up; a tap on the
// "+N" chip opens the stacked cards into a scrollable row. Capture phase so
// both win before ui.js's own card click handlers -- during COMBAT a hand
// card is not playable anyway, and the chip's box is padding, not a card, so
// nothing legitimate is swallowed.
function bindHandExpand() {
  const row = document.getElementById('player-hand');
  if (!row || row.dataset.p9Expand === '1') return;
  row.dataset.p9Expand = '1';
  row.addEventListener('pointerdown', (ev) => {
    if (row.classList.contains('hand-collapsed')) {
      ev.stopPropagation();
      ev.preventDefault();
      handExpanded = true;
      row.classList.remove('hand-collapsed');
      return;
    }
    if (!chipExpanded && hitChip(row, ev)) {
      ev.stopPropagation();
      ev.preventDefault();
      chipExpanded = true;
      row.classList.add('hand-expanded');
      layoutFan({ instant: true });
    }
  }, true);
}

// The cap is a function of the row's width, so a rotation or a window resize
// has to re-decide it. ui.js re-runs its own layoutHandRow() on resize and
// solves for ALL n cards, which would leave the visible subset bunched left
// until the next board change -- so re-run the cap solve right after it.
window.addEventListener('resize', () => layoutFan({ instant: true }));

function setHandFocus(el) {
  handCards().forEach((c) => c.classList.toggle('hand-focus', c === el));
  layoutFan();
}

// NOTE: no exit animation for a card LEAVING the hand -- ui.js's own FLIP
// already flies it from its hand rect into its new slot (its positionKey
// changes from `hand:<uid>` to the zone slot, so createCardEl marks it
// moved). A second fading clone here would show the card twice. What ui.js
// does NOT animate is the remaining cards closing the gap, which is what
// reflowHand below is for.

// FLIP the surviving cards from where they were before the hand changed to
// where the re-solved fan puts them now, so a removal re-flows smoothly.
function reflowHand(prevRects) {
  const cards = handCards();
  layoutFan({ instant: true });
  cards.forEach((el) => {
    const uid = Number(el.dataset.uid);
    const was = prevRects.get(uid);
    if (!was) return;
    const now = el.getBoundingClientRect();
    const dx = was.left - now.left;
    const dy = was.top - now.top;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
    const target = el.style.transform;
    el.classList.add('no-anim');
    el.style.transform = `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px) ${target}`;
    void el.offsetWidth;
    el.classList.remove('no-anim');
    el.style.transform = target;
  });
}

function snapshotHand() {
  const map = new Map();
  handCards().forEach((el) => {
    const uid = Number(el.dataset.uid);
    if (!Number.isFinite(uid)) return;
    map.set(uid, el.getBoundingClientRect());
  });
  return map;
}

// -- targeting arc -------------------------------------------------
function ensureOverlay() {
  const host = stage();
  if (!host) return null;
  if (overlayEl && overlayEl.isConnected && overlayEl.parentNode === host) return overlayEl;
  const ns = 'http://www.w3.org/2000/svg';
  overlayEl = document.createElementNS(ns, 'svg');
  overlayEl.setAttribute('class', 'input-overlay');
  arcGlow = document.createElementNS(ns, 'path');
  arcGlow.setAttribute('class', 'arc-glow');
  arcLine = document.createElementNS(ns, 'path');
  arcLine.setAttribute('class', 'arc-line');
  arcHead = document.createElementNS(ns, 'polygon');
  arcHead.setAttribute('class', 'arc-head');
  overlayEl.appendChild(arcGlow);
  overlayEl.appendChild(arcLine);
  overlayEl.appendChild(arcHead);
  overlayEl.style.display = 'none';
  host.appendChild(overlayEl);
  return overlayEl;
}

// Quadratic curve bowing away from the straight line, with a triangular
// head aligned to the curve's tangent at the tip -- MTG Arena's attack
// arrow. Coordinates come in as viewport px and are made stage-relative
// here, since the overlay spans the stage.
function drawArc(fromX, fromY, toX, toY) {
  if (!ensureOverlay()) return;
  const r = stage().getBoundingClientRect();
  const x0 = fromX - r.left, y0 = fromY - r.top;
  const x1 = toX - r.left, y1 = toY - r.top;
  const dx = x1 - x0, dy = y1 - y0;
  const dist = Math.hypot(dx, dy) || 1;
  // Bow perpendicular to the line, capped so a long arc does not loop.
  const bow = Math.min(70, dist * 0.32);
  const cx = (x0 + x1) / 2 + (dy / dist) * bow;
  const cy = (y0 + y1) / 2 - (dx / dist) * bow;
  // Tangent at the tip of a quadratic is the control-point -> end vector.
  const HEAD = 15;
  const tanX = x1 - cx, tanY = y1 - cy;
  const tanLen = Math.hypot(tanX, tanY) || 1;
  const ux = tanX / tanLen, uy = tanY / tanLen;
  // Stop the stroke short of the tip so the head is the pointed end.
  const ex = x1 - ux * HEAD * 0.8, ey = y1 - uy * HEAD * 0.8;
  const d = `M ${x0.toFixed(1)} ${y0.toFixed(1)} Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${ex.toFixed(1)} ${ey.toFixed(1)}`;
  arcGlow.setAttribute('d', d);
  arcLine.setAttribute('d', d);
  const px = -uy, py = ux; // perpendicular to the tangent
  arcHead.setAttribute('points', [
    `${x1.toFixed(1)},${y1.toFixed(1)}`,
    `${(x1 - ux * HEAD + px * HEAD * 0.55).toFixed(1)},${(y1 - uy * HEAD + py * HEAD * 0.55).toFixed(1)}`,
    `${(x1 - ux * HEAD - px * HEAD * 0.55).toFixed(1)},${(y1 - uy * HEAD - py * HEAD * 0.55).toFixed(1)}`,
  ].join(' '));
  overlayEl.style.display = '';
}

function hideArc() {
  if (overlayEl) overlayEl.style.display = 'none';
  arcPoint = null;
}

function attackerEl() {
  if (!deps) return null;
  const slot = deps.getAttackerSlot();
  if (slot === null || slot === undefined) return null;
  const zone = document.getElementById('player-front');
  if (!zone) return null;
  const slotEl = zone.querySelector(`.slot[data-slot="${slot}"]`);
  return slotEl ? slotEl.querySelector('.card') : null;
}

function updateArcTo(x, y) {
  const el = attackerEl();
  if (!el) { hideArc(); return; }
  const c = centreOf(el);
  // Only the frame the arc comes up on, not every pointer move that
  // redraws it.
  if (!overlayEl || overlayEl.style.display === 'none') Audio.cue('arc_start');
  arcPoint = { x, y };
  drawArc(c.x, c.y, x, y);
}

// -- refresh: derive every class this module owns from current truth --
function refresh() {
  if (!deps || !state()) return;
  try {
    const s = state();
    const combatish = s.phase === deps.PHASE.COMBAT || s.phase === 'ISLAND_CAPTURE';
    const myTurn = s.turnOwner === 1;
    const busy = inert();

    document.querySelectorAll('#game-screen .legal-target, #game-screen .illegal, #game-screen .illegal-dim')
      .forEach((el) => el.classList.remove('legal-target', 'illegal', 'illegal-dim'));

    // 1. Placement targets. PREP only, and only while a card is actually
    //    picked up -- by drag, or by the existing tap-to-place (app.js
    //    reports its pendingHandIdx through getPending()).
    //    A placed card picked up (tap, or a 'move' drag) lights the same free
    //    slots, marks itself, and marks the hand as the way back.
    const boardPick = s.phase === deps.PHASE.PREP && deps.getBoardPick ? deps.getBoardPick() : null;
    const moving = !!boardPick || !!(drag && drag.kind === 'move' && drag.moved);
    const picking = s.phase === deps.PHASE.PREP &&
      (deps.getPending() !== null || moving || (drag && drag.kind === 'place' && drag.moved));
    if (picking) {
      document.querySelectorAll('.player-section .slot.empty').forEach((el) => el.classList.add('legal-target'));
    }
    document.querySelectorAll('#game-screen .card.prep-pick').forEach((el) => {
      if (!boardPick || el !== boardCardEl(boardPick)) el.classList.remove('prep-pick');
    });
    if (boardPick) {
      const picked = boardCardEl(boardPick);
      if (picked && !picked.classList.contains('prep-pick')) picked.classList.add('prep-pick');
    }
    const handRow = document.getElementById('player-hand');
    if (handRow && handRow.classList.contains('return-target') !== moving) {
      handRow.classList.toggle('return-target', moving);
    }

    // 2. Attack / island-power targets. ui.js's highlightSlots() is what the
    //    existing tap handlers already call to mark what may be targeted --
    //    mirror exactly that set, never a recomputed one.
    const marked = Array.from(document.querySelectorAll('#game-screen .slot.target-highlight'));
    marked.forEach((el) => el.classList.add('legal-target'));
    document.querySelectorAll('#player-islands .island-card.target-highlight')
      .forEach((el) => el.classList.add('legal-target'));
    if (marked.length) {
      // Opponent cards that exist but are not in the legal row read as
      // explicitly out of reach rather than merely unlit.
      document.querySelectorAll('#opp-front .slot, #opp-reserve .slot').forEach((el) => {
        if (!el.classList.contains('target-highlight') && el.querySelector('.card')) el.classList.add('illegal');
      });
    }

    // 3. Reserve -> front promotion keeps its plain tap interaction (see
    //    app.js's onPlayerReserveClick) and only gains the highlight. The
    //    legality read matches moveReserveToFront()'s own preconditions:
    //    combat, your turn, a card in reserve, an empty front slot.
    const canPromote = s.phase === deps.PHASE.COMBAT && myTurn && !busy &&
      deps.getAttackerSlot() === null;
    if (canPromote) {
      // Vertical only: a reserve card is legal when its own front slot is free.
      document.querySelectorAll('#player-reserve .slot').forEach((el, i) => {
        if (el.querySelector('.card') && s.p1Front[i] === null) el.classList.add('legal-target');
      });
    }

    // 4. The chosen attacker. Re-applied from app.js's selection rather
    //    than remembered here, because the zone DOM is rebuilt wholesale.
    document.querySelectorAll('#player-front .card.selected').forEach((el) => el.classList.remove('selected'));
    const atk = attackerEl();
    if (atk) atk.classList.add('selected');
    // Rising edge only: app.js has accepted an attacker (a Mine tap and a
    // deselect tap both leave the slot null, so neither makes a sound).
    const atkSlot = deps.getAttackerSlot();
    if (atkSlot !== null && atkSlot !== undefined && lastAttackerSlot === null) Audio.cue('select');
    lastAttackerSlot = (atkSlot === null || atkSlot === undefined) ? null : atkSlot;

    // 5. Not your turn: your board reads as inert, and the turn banner
    //    pulses once on the handover (not on every re-render).
    // COMBAT only, not ISLAND_CAPTURE: onPlayerCardClick routes capture
    // clicks before its turnOwner check and playerCaptureIsland() gates on
    // roundWinner rather than turnOwner, so the player may legitimately act
    // during ISLAND_CAPTURE while turnOwner is 2.
    if (s.phase === deps.PHASE.COMBAT && !myTurn) {
      document.querySelectorAll('#player-front .card, #player-reserve .card')
        .forEach((el) => el.classList.add('illegal-dim'));
    }
    // P9 fix 6: the persistent side-of-the-board accent glow. It has to be
    // driven from here rather than from fx.js's turnChanged(), which is
    // edge-triggered and so could not keep a class on for a whole turn.
    const st = stage();
    if (st) {
      const inCombat = s.phase === deps.PHASE.COMBAT;
      const mine = inCombat && s.turnOwner === 1;
      const theirs = inCombat && s.turnOwner === 2;
      if (st.classList.contains('turn-mine') !== mine) st.classList.toggle('turn-mine', mine);
      if (st.classList.contains('turn-theirs') !== theirs) st.classList.toggle('turn-theirs', theirs);
      // UX1: both fleets are down -- the island band moves to a strip under
      // the top bar (render/stage.css) and comes back to the centre for PREP.
      const bandTop = inCombat || s.phase === 'ISLAND_CAPTURE';
      if (st.classList.contains('band-top') !== bandTop) st.classList.toggle('band-top', bandTop);
      // P13 fix 2: the "last card" warning. When a side is down to ONE unit
      // on its frontline in combat, that card and that side's half get the
      // danger red (render/stage.css). Recomputed every pass from the
      // state, like the glow above, because the zone DOM is rebuilt.
    }
    markKnownCards(s);
    applyHandCollapse(s.phase);
    bindHandExpand();

    if (lastTurnOwner !== s.turnOwner) {
      lastTurnOwner = s.turnOwner;
      const banner = document.getElementById('status-text');
      if (banner && combatish) {
        banner.classList.remove('turn-pulse');
        void banner.offsetWidth;
        banner.classList.add('turn-pulse');
        banner.addEventListener('animationend', () => banner.classList.remove('turn-pulse'), { once: true });
      }
    }

    // 6. Hand: the fan, plus exit/re-flow for whatever just left it.
    const row = document.getElementById('player-hand');
    if (row) {
      // ui.js still marks hand cards draggable for the old HTML5 drag-and-
      // drop path (setupDropZones), which fires dragstart -> pointercancel
      // and would abort every pointer drag started with a mouse. The pointer
      // gesture below replaces it entirely.
      handCards().forEach((el) => { el.draggable = false; });
      const uids = handCards().map((el) => Number(el.dataset.uid));
      const changed = uids.length !== lastHandUids.length || uids.some((u, i) => u !== lastHandUids[i]);
      if (changed) {
        // One card left the hand in PREP -> it was placed; one arrived ->
        // it was returned. A deal, a redraw or a round reset moves several
        // at once and is deliberately silent.
        if (s.phase === deps.PHASE.PREP && lastHandUids.length) {
          const delta = uids.length - lastHandUids.length;
          if (delta === -1) Audio.cue('card_place');
          else if (delta === 1) Audio.cue('card_return');
        }
        reflowHand(lastHandRects);
        lastHandUids = uids;
      } else {
        layoutFan();
      }
      lastHandRects = snapshotHand();
    }

    // 7. The arc lives exactly as long as a selection does.
    if (deps.getAttackerSlot() === null || busy) hideArc();
    else if (arcPoint) updateArcTo(arcPoint.x, arcPoint.y);
  } finally {
    // Drain the records this pass just queued. Without it every refresh --
    // which necessarily rewrites .legal-target / .selected / the fan
    // transforms -- would wake the observer and schedule another refresh,
    // and the board would re-derive itself at 60fps forever. An `applying`
    // boolean cannot do this job: observer callbacks are microtasks that
    // run after the flag has already been cleared.
    if (observer) observer.takeRecords();
  }
}


function queueRefresh() {
  if (refreshQueued) return;
  refreshQueued = true;
  requestAnimationFrame(() => { refreshQueued = false; refresh(); });
}

// -- gestures ------------------------------------------------------
// Spring the dragged card back to its resting place in the fan.
function springBack(el) {
  if (!el) return;
  el.classList.remove('dragging');
  el.classList.add('drag-return');
  // Straight back to the card's resting pose in the fan, synchronously --
  // clearing the transform instead would snap it flat and un-rotated for a
  // frame before the next layoutFan() put the rotation back.
  layoutFan();
  el.addEventListener('transitionend', () => el.classList.remove('drag-return'), { once: true });
}

function boardCardEl(pick) {
  const zone = document.getElementById(pick.zone === 'front' ? 'player-front' : 'player-reserve');
  const slotEl = zone ? zone.querySelector(`.slot[data-slot="${pick.slot}"]`) : null;
  return slotEl ? slotEl.querySelector('.card') : null;
}

function overHand(x, y) {
  const el = document.elementFromPoint(x, y);
  if (el && el.closest && el.closest('#player-hand')) return true;
  // The hand band itself, even where the row has no card under the pointer.
  const row = document.getElementById('player-hand');
  if (!row) return false;
  const r = row.getBoundingClientRect();
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}

// A placed card dropped nowhere useful slides back into its own slot.
function settleBoardCard(el) {
  if (!el || !el.isConnected) return;
  el.classList.remove('dragging');
  el.classList.add('drag-return');
  el.style.transform = '';
  el.addEventListener('transitionend', () => el.classList.remove('drag-return'), { once: true });
}

function slotUnder(x, y) {
  const el = document.elementFromPoint(x, y);
  return el && el.closest ? el.closest('.slot') : null;
}

function onPointerDown(e) {
  if (!deps) return;
  if (e.button !== undefined && e.button > 0) return;
  const card = e.target.closest ? e.target.closest('.card') : null;
  const s = state();
  if (!s) return;

  // Tap on empty space cancels an in-progress attack selection. Checked
  // before the inert() guard so a selection can always be dismissed.
  if (!card && deps.getAttackerSlot() !== null && !(e.target.closest && e.target.closest('.slot'))) {
    deps.cancelAttack();
    hideArc();
    queueRefresh();
    return;
  }
  // Same for a PREP pick: a tap on open water puts the card down. The hand
  // and the slots are left alone -- those taps return or place it.
  if (!card && s.phase === deps.PHASE.PREP && deps.clearPrepPick
      && !(e.target.closest && e.target.closest('.slot, #player-hand, .controls, .hud'))) {
    deps.clearPrepPick();
  }
  if (!card || inert()) return;

  if (card.closest('#player-hand') && s.phase === deps.PHASE.PREP) {
    const idx = handCards().indexOf(card);
    if (idx < 0) return;
    drag = { kind: 'place', el: card, idx, startX: e.clientX, startY: e.clientY, moved: false, pid: e.pointerId };
    // The press itself, not the drag threshold: tap-to-place and drag both
    // start here, and lifting the card is what the player just did.
    Audio.cue('card_pick');
    setHandFocus(card);
    return;
  }
  // A card already placed: drag it to another free slot or back to the hand.
  if ((card.closest('#player-front') || card.closest('#player-reserve'))
      && s.phase === deps.PHASE.PREP && deps.canMoveBoard && deps.canMoveBoard()) {
    const slotEl = card.closest('.slot');
    if (!slotEl) return;
    drag = {
      kind: 'move', el: card,
      from: { zone: slotEl.dataset.zone === 'front' ? 'front' : 'reserve', slot: Number(slotEl.dataset.slot) },
      startX: e.clientX, startY: e.clientY, moved: false, pid: e.pointerId,
    };
    return;
  }
  if (card.closest('#player-front') && s.phase === deps.PHASE.COMBAT && s.turnOwner === 1) {
    const slotEl = card.closest('.slot');
    if (!slotEl) return;
    drag = {
      kind: 'attack', el: card, slot: Number(slotEl.dataset.slot),
      startX: e.clientX, startY: e.clientY, moved: false, pid: e.pointerId,
    };
  }
}

function onPointerMove(e) {
  // Tap-selected attacker with no drag in flight: the arc simply tracks the
  // pointer until a target (or empty space) is tapped.
  if (!drag) {
    if (deps && deps.getAttackerSlot() !== null && !inert()) updateArcTo(e.clientX, e.clientY);
    return;
  }
  if (drag.pid !== undefined && e.pointerId !== drag.pid) return;
  const dx = e.clientX - drag.startX;
  const dy = e.clientY - drag.startY;
  if (!drag.moved) {
    if (Math.hypot(dx, dy) < MOVE_THRESHOLD) return;
    drag.moved = true;
    if (drag.kind === 'move') {
      drag.el.classList.remove('drag-return');
      drag.el.classList.add('dragging');
      deps.setBoardPick(drag.from);
      refresh();
    } else if (drag.kind === 'place') {
      drag.el.classList.remove('drag-return');
      drag.el.classList.add('dragging');
      // Tell app.js which card is in the air through its own pending-card
      // channel, so the drag and the tap fallback share one notion of
      // "a card is picked up" and light exactly the same slots.
      deps.setPending(drag.idx);
      refresh();
    } else {
      // Drag-to-target in one gesture: run the SAME selection the tap
      // handler runs (it owns the rules -- Mine cannot attack, whose turn
      // it is, which row is targetable) and bail if it refused.
      if (deps.getAttackerSlot() !== drag.slot) deps.selectAttacker(drag.slot, null);
      if (deps.getAttackerSlot() !== drag.slot) { drag = null; return; }
      refresh();
    }
  }
  if (drag.kind === 'place' || drag.kind === 'move') {
    drag.el.style.transform = `translate(${dx}px, ${dy}px) scale(1.08) rotate(0deg)`;
    document.querySelectorAll('.slot.dragover').forEach((el) => el.classList.remove('dragover'));
    const slotEl = slotUnder(e.clientX, e.clientY);
    if (slotEl && slotEl.classList.contains('legal-target')) slotEl.classList.add('dragover');
    if (drag.kind === 'move') {
      const row = document.getElementById('player-hand');
      const over = !slotEl && overHand(e.clientX, e.clientY);
      if (row && row.classList.contains('dragover') !== over) row.classList.toggle('dragover', over);
    }
  } else {
    updateArcTo(e.clientX, e.clientY);
  }
}

function onPointerUp(e) {
  if (!drag) return;
  const g = drag;
  drag = null;
  // A touch pointer never fires pointerout, so the raise a press put on the
  // card would stay stuck there after the finger lifts.
  if (e.pointerType !== 'mouse') setHandFocus(null);
  if (!g.moved) return;                   // a tap: leave it to the click handler
  swallowClick = true;
  setTimeout(() => { swallowClick = false; }, 0);
  document.querySelectorAll('.slot.dragover').forEach((el) => el.classList.remove('dragover'));

  const slotEl = slotUnder(e.clientX, e.clientY);
  const legal = !!slotEl && slotEl.classList.contains('legal-target');

  if (g.kind === 'move') {
    const row = document.getElementById('player-hand');
    if (row) row.classList.remove('dragover');
    let done = false;
    if (legal && slotEl.closest('.player-section')) {
      done = deps.moveBoard(g.from, slotEl.dataset.zone === 'front' ? 'front' : 'reserve',
        Number(slotEl.dataset.slot));
    } else if (!slotEl && overHand(e.clientX, e.clientY)) {
      done = deps.returnBoard(g.from);
    }
    if (!done) {
      deps.setBoardPick(null);
      settleBoardCard(g.el);
    }
    queueRefresh();
    return;
  }

  if (g.kind === 'place') {
    if (legal && slotEl.closest('.player-section')) {
      g.el.classList.remove('dragging');
      // The same call tap placement makes -- placement rules stay in game.js.
      deps.placeFromHand(g.idx, slotEl.dataset.zone === 'front' ? 'front' : 'reserve',
        Number(slotEl.dataset.slot));
      // Locally that re-rendered the board and this element is already gone.
      // In a network match mpPlace() only sends the intent and waits for the
      // server frame, so the card is still here -- put it back in the fan
      // rather than leaving it stranded at the drop point.
      if (g.el.isConnected) springBack(g.el);
    } else {
      deps.setPending(null);
      springBack(g.el);
    }
    queueRefresh();
    return;
  }

  if (legal && (slotEl.closest('#opp-front') || slotEl.closest('#opp-reserve'))) {
    // onOppCardClick decides: an attack only ever lands on the frontline
    // (the reserve never fights); a reserve drop only matters to a live
    // island-power or artifact pick.
    deps.attackTarget(slotEl.closest('#opp-reserve') ? 'reserve' : 'front',
      Number(slotEl.dataset.slot), null);
  } else {
    deps.cancelAttack();
  }
  hideArc();
  queueRefresh();
}

// P13: render/hero.js calls this when a press turns out to be a hold. It is
// a pointercancel in every respect -- a picked-up card springs back, an
// armed attacker is dropped -- because the player was reading, not playing.
export function abortGesture() { onPointerCancel(); }

function onPointerCancel() {
  if (!drag) return;
  const g = drag;
  drag = null;
  setHandFocus(null);
  if (!g.moved) return;
  if (g.kind === 'move') {
    deps.setBoardPick(null);
    settleBoardCard(g.el);
    const row = document.getElementById('player-hand');
    if (row) row.classList.remove('dragover');
  } else if (g.kind === 'place') { deps.setPending(null); springBack(g.el); }
  else { deps.cancelAttack(); hideArc(); }
  queueRefresh();
}

// -- init ----------------------------------------------------------
export function init(d) {
  deps = d;
  // Every button in the app, not just the ones on the stage: the menu, the
  // modals and the shop all live outside #game-screen, and a UI click
  // sounds the same wherever it is. Capture phase, on document, so it is
  // not affected by anything that stops propagation further down.
  document.addEventListener('pointerdown', (e) => {
    const btn = e.target && e.target.closest ? e.target.closest('button, .btn-primary, .btn-secondary, .btn-icon') : null;
    if (btn && !btn.disabled) Audio.cue('ui_tap');
  }, true);

  const host = document.getElementById('game-screen');
  if (!host) return;

  host.addEventListener('pointerdown', onPointerDown, true);
  // The gesture lifetime lives on window, not on the card: the dragged card
  // carries pointer-events:none (so elementFromPoint can see the slot under
  // it) and would stop receiving its own move events.
  window.addEventListener('pointermove', onPointerMove, { passive: true });
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerCancel);

  // Swallow the click the browser synthesizes after a completed drag, so a
  // drop does not ALSO run ui.js's tap handler for the same card (which
  // would immediately re-arm tap placement, or toggle the attacker off).
  host.addEventListener('click', (e) => {
    if (!swallowClick) return;
    e.stopPropagation();
    e.preventDefault();
  }, true);

  // Hand focus on hover (mouse) and on press (touch, via onPointerDown).
  // ui.js's own hover-focus path stands down while `.input-fan` is on the
  // row -- see its applyHandHover guard.
  host.addEventListener('pointerover', (e) => {
    if (e.pointerType !== 'mouse' || drag) return;
    const card = e.target.closest ? e.target.closest('#player-hand .card') : null;
    if (card) setHandFocus(card);
  });
  host.addEventListener('pointerout', (e) => {
    if (e.pointerType !== 'mouse' || drag) return;
    const row = document.getElementById('player-hand');
    if (row && !row.contains(e.relatedTarget)) setHandFocus(null);
  });

  // The board DOM is rebuilt from scratch by several paths that are not
  // renderAll() (syncHandClickability's bare renderHand, highlightSlots and
  // clearAllHighlights from the tap handlers). Watching the containers is
  // more reliable than chasing every call site, and refresh() is idempotent.
  observer = new MutationObserver(() => queueRefresh());
  ['player-front', 'player-reserve', 'player-hand', 'opp-front', 'opp-reserve', 'player-islands']
    .map((id) => document.getElementById(id))
    .filter(Boolean)
    .forEach((el) => observer.observe(el,
      { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] }));

  window.addEventListener('resize', () => queueRefresh());
  queueRefresh();
}

export { refresh };

// Per-match state, dropped between matches -- the same contract
// render/fx.js, render/screens.js and render/ocean.js all have, called from
// the same place (ui.js's hideGameOver). Without it the first render of a
// new match ran reflowHand() against the PREVIOUS match's hand rects, so the
// opening deal flew in from wherever the last match's cards happened to sit,
// and the stale `knownUids` set could outline a fresh card back as one the
// player had already seen.
export function resetMatchState() {
  lastHandUids = [];
  lastHandRects = new Map();
  lastTurnOwner = null;
  lastAttackerSlot = null;
  lastPhase = null;
  handExpanded = false;
  chipExpanded = false;
  knownUids.clear();
  knownRound = null;
  hideArc();
}

// -- debug/demo hooks (?demo=drag / ?demo=arc) ---------------------
// Static renderings of the two transient gesture states, so a headless
// screenshot pass can capture them without synthesising pointer input.
// Purely presentational: they touch classes and the overlay, never state.
export function demoDrag() {
  const cards = handCards();
  if (cards.length < 4) return;
  const el = cards[3];
  deps.setPending(3);
  refresh();
  el.classList.add('dragging');
  el.style.transform = 'translate(-56px, -170px) scale(1.08)';
  const target = document.querySelector('#player-front .slot.empty.legal-target');
  if (target) target.classList.add('dragover');
}

export function demoArc() {
  const to = document.querySelector('#opp-front .slot[data-slot="2"]');
  if (!to) return;
  const b = centreOf(to);
  // Park the arc on that target as if the pointer were resting there, so
  // the class refresh the MutationObserver runs next frame redraws it
  // rather than clearing it.
  updateArcTo(b.x, b.y);
  refresh();
}
