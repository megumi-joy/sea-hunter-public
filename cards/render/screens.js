// Round-end and game-over screens -- phase P4 "Islands and results".
//
// WHY THE ROUND RESULT IS DIFFED RATHER THAN HANDED IN
//
// A round ends inside one synchronous engine call: the last kill (or the
// winner's garrison pick) runs checkRoundEnd -> executeIslandCapture ->
// endRound, which increments roundNum, redraws the active island and resets
// both boards before app.js ever gets to call renderAll(). game.js is
// read-only for this phase and emits no round-end event, so by the time any
// renderer runs, the round that just finished is already gone from state.
//
// So render/islands.js snapshots the fields that matter on every pass
// (takeSnapshot below) and hands the previous snapshot back in
// (roundObserved). A roundNum increment is the round-end signal, and the
// snapshot is what still knows which island was contested and who held what
// before it resolved.
//
// That diff is also what makes multiplayer work with no new network calls:
// multiplayer.js's adaptState replaces store.state wholesale on every
// game_update frame, and this compares values, not object identity. Note
// that adaptState does NOT currently carry the server's round_winner /
// win_reason fields, so the winner is derived from which side's captured
// list gained the contested island -- which is true in both modes -- and
// state.roundWinner (single-player only) is used only as a fallback for the
// "won the round but had nothing to garrison with" case. See deriveResult().

import { getIslandDef } from '../islands.js';
import { buildIslandEl, flyCapture, closeIslandDetail } from './islands.js';
// P5 "Sound and haptics".
import * as Audio from './audio.js';
// P13 "Hero card moments": the captured island and the victorious fleet.
import * as Hero from './hero.js';
import { CARDS } from '../cards.js';

// How long each hero beat holds. The capture beat comes before the flight,
// so it also delays the round-end panel by this much.
const HERO_CAPTURE_MS = 1100;
const HERO_FLEET_MS = 760;

const AUTO_CONTINUE_MS = 4000;

let snap = null;
let ceremonyBusy = false;
let autoTimer = 0;
// The highest round number roundObserved() has processed. The capture
// ceremony's completion callback is ~620 ms late (render/islands.js's
// flyCapture), and it is what shows the round-end panel -- so if ANOTHER
// round resolves inside that window (it can: a stalemate round ends with no
// attack animation to slow it down, and a multiplayer frame can land at any
// time) the later round's panel goes up first and is then replaced by the
// earlier one's, which reads out a stale round number, verdict and score.
// The callback compares against this before it paints.
let observedRound = 0;

function stageEl() {
  return document.querySelector('#game-screen .stage') || document.body;
}

function statusNow() {
  const el = document.getElementById('status-text');
  return el ? el.textContent || '' : '';
}

// The newest few combat-log lines. This is where the engine's round-end
// prose actually lands: app.js pushes playerAttack()/aiTurn()'s result.msg
// through UI.addLogEntry (newest first) and only its LAST line through
// setStatus, so "Neither side can act -- stalemate!" -- the sole place a
// stalemate is ever named -- is in the log and not in the status bar.
// addLogEntry runs before renderAll(), so the line is already in the DOM by
// the time this pass reads it.
function recentLog() {
  const el = document.getElementById('log-entries');
  if (!el) return '';
  return Array.from(el.children).slice(0, 3).map((c) => c.textContent || '').join(' ');
}

// Called at the top of every island render, before the DOM is rewritten.
// Returns the PREVIOUS snapshot (null on the first pass of a match) and
// stores a fresh one.
export function takeSnapshot(state) {
  const fresh = {
    roundNum: state.roundNum,
    phase: state.phase,
    activeIsland: state.activeIsland || null,
    p1Islands: [...(state.p1Islands || [])],
    p2Islands: [...(state.p2Islands || [])],
    held: [...(state.p1Islands || []), ...(state.p2Islands || [])],
    score: [...(state.score || [0, 0])],
    // There is no round-reason field anywhere in the engine or on the wire,
    // so the prose is all there is -- see recentLog() above for where the
    // round-end string actually goes.
    status: statusNow(),
  };
  const prev = snap;
  snap = fresh;
  // A new match rewinds the round counter -- drop the old match's snapshot
  // so round 1 of the new one can never be read as a round transition.
  if (prev && state.roundNum < prev.roundNum) return null;
  return prev;
}

export function reset() {
  snap = null;
  ceremonyBusy = false;
  observedRound = 0;
  clearTimeout(autoTimer);
  dismissRoundEnd();
  // P12: the victory/defeat scene is torn down with everything else. ui.js's
  // hideGameOver() calls this, and "Play again" goes through hideGameOver --
  // without it the next match would start under the last one's confetti.
  dismissGameOverFx();
}

// ---- deriving the round result --------------------------------------

function deriveResult(state, prev) {
  const island = prev.activeIsland;
  const gainedByP1 = island && (state.p1Islands || []).includes(island) && !prev.p1Islands.includes(island);
  const gainedByP2 = island && (state.p2Islands || []).includes(island) && !prev.p2Islands.includes(island);
  // The engine's own verdict first: game.js sets roundWinner, and an online
  // state carries the server's round_winner (multiplayer.js's adaptState).
  // The capture is only the fallback -- a round can be won with no
  // qualifying unit left to garrison with (hasEligibleCapturer), and a
  // re-garrison at round end is not a capture.
  let winner = state.roundWinner === 1 || state.roundWinner === 2 ? state.roundWinner
    : gainedByP1 ? 1 : gainedByP2 ? 2 : 0;

  // The engine's own combat log keeps the round's last lines (a yield is
  // logged there, not always on the status line), local matches only.
  const lastLog = (state.combatLog || []).slice(-2).join(' ');
  const text = (prev.status + ' ' + statusNow() + ' ' + recentLog() + ' ' + lastLog + ' ' + (state.winReason || '')).toLowerCase();
  let reason;
  if (/surrender|forfeit|disconnect/.test(text)) reason = 'Surrender';
  else if (/stalemate|cannot act|neither side/.test(text)) reason = 'Stalemate -- neither fleet could act';
  // No passing (owner ruling 2026-09-16): the side to move with no legal
  // move yields the round (game.js's checkRoundEnd logs "yields the round").
  else if (/yields? the round/.test(text)) reason = 'No legal move -- the round was yielded';
  // Otherwise the round ended on an emptied frontline; the reserve never
  // counts. A draw that empties both frontlines at once is a drawn round.
  else if (winner) reason = 'Frontline cleared';
  else reason = 'Both frontlines cleared';

  return {
    round: prev.roundNum,
    winner,
    reason,
    captured: (gainedByP1 || gainedByP2) ? island : null,
    capturedBy: gainedByP1 ? 1 : gainedByP2 ? 2 : 0,
    uncaptured: !!island && !gainedByP1 && !gainedByP2,
    score: [...(state.score || [0, 0])],
  };
}

// ---- the round-end sequence -----------------------------------------

// Called by render/islands.js at the end of every full render pass.
export function roundObserved(state, prev, { fromRect, landedEl } = {}) {
  if (!prev || state.roundNum <= prev.roundNum) return;
  const result = deriveResult(state, prev);
  const def = result.captured ? getIslandDef(result.captured) : null;

  // The match can end on the very same transition: endRound increments
  // roundNum and THEN checks the win condition, and app.js calls
  // UI.showGameOver() straight after this render. Play the capture ceremony
  // either way, but let the game-over screen have the stage to itself
  // instead of stacking a round summary under it.
  const matchOver = state.phase === 'GAME_OVER';

  const thisRound = result.round;
  if (thisRound > observedRound) observedRound = thisRound;

  if (def && fromRect && landedEl && !ceremonyBusy) {
    ceremonyBusy = true;
    const fly = (heroRect) => {
      // The hero card's rect when there was one, so the flight starts where
      // the player is already looking; the band's rect otherwise.
      const from = heroRect && heroRect.width ? heroRect : fromRect;
      flyCapture(def, from, landedEl, () => {
        ceremonyBusy = false;
        // A newer round resolved while the ghost was in flight -- its panel is
        // already on screen and is the true one. Showing this one now would
        // call dismissRoundEnd() on it and replace it with a stale summary.
        if (thisRound < observedRound) return;
        if (!matchOver) showRoundEnd(result);
      });
    };
    // P13: the island at hero size first, for a beat, then the flight.
    // Reduced motion keeps the beat (a still card is not motion) but halves
    // it. landedEl is checked again after the beat, because a re-render in
    // that window replaces the chip the flight was aimed at.
    const shown = Hero.showIsland(def, buildIslandEl(def, 'big', {}), {
      duration: reduced() ? HERO_CAPTURE_MS / 2 : HERO_CAPTURE_MS,
      cls: 'hero-moment-capture' + (result.capturedBy === 2 ? ' hero-theirs' : ''),
      meta: result.capturedBy === 2
        ? '<span class="hero-capture hero-capture-theirs">Captured by the opponent</span>'
        : undefined,
      onDone: (rect) => {
        if (!landedEl.isConnected) {
          const again = document.querySelector(`#game-screen .islands-row .island-card[data-island-id="${def.id}"]`);
          if (again) landedEl = again;
        }
        fly(rect);
      },
    });
    if (!shown) fly(null);
    return;
  }
  if (!matchOver) showRoundEnd(result);
}

function verdictOf(winner) {
  return winner === 1 ? { cls: 'win', text: 'You win' }
    : winner === 2 ? { cls: 'loss', text: 'Opponent wins' }
      : { cls: 'draw', text: 'Draw' };
}

export function dismissRoundEnd() {
  clearTimeout(autoTimer);
  const el = document.getElementById('round-end-screen');
  if (el) el.remove();
}

export function showRoundEnd(result) {
  dismissRoundEnd();
  closeIslandDetail();
  Audio.cue('round_end');
  const v = verdictOf(result.winner);
  const wrap = document.createElement('div');
  wrap.id = 'round-end-screen';
  wrap.className = 'round-end verdict-' + v.cls;

  const panel = document.createElement('div');
  panel.className = 'round-end-panel';

  const head = document.createElement('div');
  head.className = 'round-end-head';
  head.innerHTML = `<span class="re-round">Round ${result.round}</span>`
    + `<h2 class="re-verdict">${v.text}</h2>`
    + `<p class="re-reason">${result.reason}</p>`;
  panel.appendChild(head);

  const score = document.createElement('div');
  score.className = 're-score';
  score.innerHTML = `<span class="re-score-mine">${result.score[0]}</span>`
    + '<span class="re-score-sep">:</span>'
    + `<span class="re-score-theirs">${result.score[1]}</span>`;
  panel.appendChild(score);

  const spoil = document.createElement('div');
  spoil.className = 're-spoil';
  const def = result.captured ? getIslandDef(result.captured) : null;
  if (def) {
    spoil.appendChild(buildIslandEl(def, 'active', { mine: result.capturedBy === 1 }));
    const cap = document.createElement('span');
    cap.className = 're-spoil-note';
    cap.textContent = result.capturedBy === 1 ? 'Captured by you' : 'Captured by the opponent';
    spoil.appendChild(cap);
  } else {
    const cap = document.createElement('span');
    cap.className = 're-spoil-note';
    cap.textContent = result.uncaptured ? 'The island went uncaptured' : 'No island was contested';
    spoil.appendChild(cap);
  }
  panel.appendChild(spoil);

  const btn = document.createElement('button');
  btn.className = 'btn-primary re-next';
  btn.textContent = 'Next round';
  btn.addEventListener('click', dismissRoundEnd);
  panel.appendChild(btn);

  wrap.appendChild(panel);
  // The scrim swallows board taps for as long as it is up -- the next round
  // is already in PREP underneath, and a stray tap would place a card.
  wrap.addEventListener('click', (e) => { if (e.target === wrap) dismissRoundEnd(); });
  stageEl().appendChild(wrap);

  autoTimer = setTimeout(dismissRoundEnd, AUTO_CONTINUE_MS);
}

// ---- game over -------------------------------------------------------
//
// Re-skin only. index.html's #game-over-modal keeps every id it had: app.js
// writes #go-reward and #go-campaign-note AFTER ui.js's showGameOver()
// returns, and wires btn-play-again / btn-back-menu / btn-go-leaderboard /
// btn-go-shop by id at startup. Nothing below removes or replaces a node --
// it sets text, adds classes and swaps the icon for an inline SVG (the
// trophy/skull/handshake emojis are out under the project's no-emoji rule).

const GO_ICON = {
  win: '<path d="M14 8h20v14a10 10 0 0 1-20 0zM14 10H8v4a7 7 0 0 0 6 7M34 10h6v4a7 7 0 0 1-6 7M20 32h8v6h-8zM15 38h18v4H15z" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linejoin="round"/>',
  loss: '<path d="M24 7c9 0 15 6 15 14 0 5-3 8-3 12v5H12v-5c0-4-3-7-3-12 0-8 6-14 15-14z" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linejoin="round"/><circle cx="18" cy="22" r="3.4" fill="currentColor"/><circle cx="30" cy="22" r="3.4" fill="currentColor"/>',
  draw: '<path d="M6 26l8-8 10 4 10-4 8 8-7 7-5-4-6 5-6-5-5 4z" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linejoin="round"/>',
};

function goIconSvg(cls) {
  return `<svg viewBox="0 0 48 48" class="go-icon-svg" aria-hidden="true" focusable="false">${GO_ICON[cls]}</svg>`;
}

// `state` is the live game state; ui.js already computed the verdict the
// same way (mpWinner wins over the score, for a network forfeit at 0:0).
export function skinGameOver(state, verdict) {
  dismissRoundEnd();
  closeIslandDetail();
  const modal = document.getElementById('game-over-modal');
  if (!modal) return;
  const cls = verdict > 0 ? 'win' : verdict < 0 ? 'loss' : 'draw';
  // A drawn match gets no cue of its own: reusing round_end here would put
  // that name in two places, and a draw has just played its last round-end
  // panel anyway.
  if (verdict > 0) Audio.cue('victory');
  else if (verdict < 0) Audio.cue('defeat');
  modal.classList.add('go-screen');
  modal.classList.remove('verdict-win', 'verdict-loss', 'verdict-draw');
  modal.classList.add('verdict-' + cls);
  const inner = modal.querySelector('.modal-inner');
  if (inner) inner.classList.add('go-skin');

  const icon = document.getElementById('go-icon');
  if (icon) icon.innerHTML = goIconSvg(cls);

  const title = document.getElementById('go-title');
  if (title) title.textContent = verdict > 0 ? 'Victory' : verdict < 0 ? 'Defeat' : 'Draw';

  const rounds = document.getElementById('go-rounds');
  if (rounds) {
    const n = Math.max(0, (state.roundNum || 1) - 1);
    // The server's own end reason (forfeit, disconnect, ...) when a network
    // match ended -- app.js stashes meta.reason on the state as mpReason.
    const why = state.mpReason ? String(state.mpReason)
      : state.winReason === 'points' ? `first to ${state.pointsToWin || 3} islands`
        : state.winReason === 'rounds' ? 'round limit'
          : '';
    rounds.textContent = `${n} round${n === 1 ? '' : 's'} played` + (why ? ` -- ${why}` : '');
  }

  // "Main menu" reads better than "Menu" on a full-stage verdict screen; the
  // id (and app.js's listener on it) is untouched.
  const back = document.getElementById('btn-back-menu');
  if (back) back.textContent = 'Main menu';

  // P12: the verdict stops being a system dialog and becomes a scene.
  buildGameOverScene(modal, cls, state);
}

// ---- P12 "Living board": the victory / defeat scene ------------------
//
// The reviewer's complaint was exact: "victory is a system dialog". It was
// -- a centred panel with an icon and four buttons, appearing instantly.
//
// What this adds, and what it deliberately does NOT touch:
//
//   * It adds ONE element, `.go-fx`, as the modal's first child, behind
//     `.modal-inner`. Every id inside the panel keeps its node, its text and
//     its listener; app.js still writes #go-reward and #go-campaign-note
//     straight after showGameOver() returns, and the multiplayer payload
//     path (app.js's handleGameOver -> leaderboard/economy) never sees this
//     file at all.
//   * The one existing node it writes is #go-score, and only to count it up
//     from 0:0 to the value ui.js already put there -- it lands on exactly
//     that string, and the teardown below writes it again in case the scene
//     is dismissed mid-count.
//   * A DRAW gets no scene. Confetti for a draw is a lie and a sinking fleet
//     for a draw is a different one; the plain panel is the honest answer.
//
// Cost: the clones are at most five real card elements and the confetti is
// 24 spans, all transform/opacity keyframes, all removed on teardown. The
// board underneath is already static by this point -- the match is over.

let goFx = null;
let goCount = { raf: 0, el: null, final: '' };

const FLEET_MAX = 5;
const CONFETTI_N = 24;
const CONFETTI_COLOURS = ['#f6d67a', '#e8b23c', '#fff3cf', '#c9952a', '#ffe9a8'];

function reduced() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// The player's own fleet, in board order. Falls back to the hand: a match
// that ended on the last card leaves both board zones empty, and a victory
// scene with nothing rising in it is worse than one that raises the cards
// still held.
function fleetCards() {
  let els = Array.from(document.querySelectorAll('#player-front .card, #player-reserve .card'));
  if (!els.length) els = Array.from(document.querySelectorAll('#player-hand .card'));
  return els.slice(0, FLEET_MAX);
}

// A board card, lifted out of the board and pinned in viewport coordinates.
// `.go-fx` is `position: absolute; inset: 0` inside `#game-over-modal`,
// which style.css makes `position: fixed; inset: 0` -- so the layer's
// coordinate system IS the viewport and the rect can be used as-is.
function cloneFleetCard(el) {
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height) return null;
  const clone = el.cloneNode(true);
  clone.removeAttribute('id');
  clone.removeAttribute('data-uid');
  // The board classes that carry a transform or an entrance of their own --
  // the same list render/fx.js strips off a destroy shard, for the same
  // reason: they would fight the rise.
  clone.classList.remove('entering', 'flying', 'selected', 'legal-target', 'dragging', 'impact', 'fx-lunging');
  clone.classList.add('go-fleet-card');
  clone.style.animation = 'none';
  clone.style.transition = 'none';
  // The clone leaves the stage, so it leaves the element supplying --slot-w
  // (render/cards.css sizes a card's innards off it). Pin what it had.
  clone.style.setProperty('--slot-w', `${r.width}px`);
  clone.style.left = `${r.left}px`;
  clone.style.top = `${r.top}px`;
  clone.style.width = `${r.width}px`;
  clone.style.height = `${r.height}px`;
  // The rect is handed back with the clone because the clone's OWN rect is
  // not usable: ui.js's showGameOver() calls skinGameOver() and only then
  // drops `.hidden` off the modal, so at the moment this runs the whole
  // scene is inside a `display: none` subtree and every measurement of it
  // is zero. The source card is on the live board and measures fine.
  return { clone, rect: r };
}

function animate(el, frames, options) {
  if (!el || typeof el.animate !== 'function') return null;
  try { return el.animate(frames, { fill: 'both', ...options }); } catch (e) { return null; }
}

// Victory: the fleet rises out of the board and fans across the upper third.
// Defeat: the same cards drift down and fade out -- the fleet sinking.
function playFleet(layer, win) {
  const cards = fleetCards();
  if (!cards.length) return;
  const cx = window.innerWidth / 2;
  const cy = window.innerHeight * 0.24;
  const mid = (cards.length - 1) / 2;
  cards.forEach((src, i) => {
    const made = cloneFleetCard(src);
    if (!made) return;
    const { clone, rect: r } = made;
    layer.appendChild(clone);
    const off = i - mid;
    if (reduced()) { animate(clone, [{ opacity: 0 }, { opacity: 1 }], { duration: 160 }); return; }
    if (win) {
      const dx = cx + off * 34 - (r.left + r.width / 2);
      const dy = cy - (r.top + r.height / 2);
      animate(clone, [
        { transform: 'translate(0px, 0px) rotate(0deg) scale(1)', opacity: 1, offset: 0 },
        { transform: `translate(${(dx * 0.55).toFixed(1)}px, ${(dy * 0.62).toFixed(1)}px) rotate(${(off * 4).toFixed(1)}deg) scale(1.08)`, opacity: 1, offset: 0.6 },
        { transform: `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px) rotate(${(off * 8).toFixed(1)}deg) scale(1.16)`, opacity: 1, offset: 1 },
      ], { duration: 640, delay: 90 + i * 80, easing: 'cubic-bezier(0.2, 0.85, 0.3, 1)' });
    } else {
      animate(clone, [
        { transform: 'translate(0px, 0px) rotate(0deg)', opacity: 1, offset: 0 },
        { transform: `translate(${(off * 5).toFixed(1)}px, 46px) rotate(${(off * 3).toFixed(1)}deg)`, opacity: 0.55, offset: 0.55 },
        { transform: `translate(${(off * 9).toFixed(1)}px, 140px) rotate(${(off * 7).toFixed(1)}deg)`, opacity: 0, offset: 1 },
      ], { duration: 900, delay: i * 90, easing: 'cubic-bezier(0.4, 0.05, 0.6, 1)' });
    }
  });
}

// Gold confetti. Plain spans with one transform/opacity keyframe each, all
// parameters index-derived rather than random so a screenshot pass is
// reproducible (the same rule render/fx.js's shards follow).
function playConfetti(layer) {
  if (reduced()) return;
  for (let i = 0; i < CONFETTI_N; i++) {
    const p = document.createElement('span');
    p.className = 'go-confetti';
    p.style.left = `${(i * 4.1 + (i % 5) * 1.7) % 98}%`;
    p.style.width = `${5 + (i % 3) * 2}px`;
    p.style.height = `${8 + (i % 4) * 3}px`;
    p.style.background = CONFETTI_COLOURS[i % CONFETTI_COLOURS.length];
    p.style.animationDelay = `${(i % 8) * 140}ms`;
    p.style.animationDuration = `${1900 + (i % 6) * 320}ms`;
    layer.appendChild(p);
  }
}

// #go-score counts up to the value ui.js already wrote. `final` is captured
// first and written again by the teardown, so the panel can never be left
// showing a partial score.
function countScore(mine, theirs) {
  const el = document.getElementById('go-score');
  if (!el) return;
  const final = `${mine} : ${theirs}`;
  goCount = { raf: 0, el, final };
  if (reduced() || (!mine && !theirs)) { el.textContent = final; return; }
  const started = performance.now();
  const DURATION = 760;
  const DELAY = 240;
  el.textContent = '0 : 0';
  const tick = (now) => {
    const t = Math.min(1, Math.max(0, (now - started - DELAY) / DURATION));
    // ease-out, so the last point lands slowly instead of the row blurring
    // past its own result.
    const e = 1 - Math.pow(1 - t, 3);
    el.textContent = `${Math.round(mine * e)} : ${Math.round(theirs * e)}`;
    if (t >= 1) { goCount.raf = 0; el.textContent = final; return; }
    goCount.raf = requestAnimationFrame(tick);
  };
  goCount.raf = requestAnimationFrame(tick);
}

export function dismissGameOverFx() {
  if (goCount.raf) cancelAnimationFrame(goCount.raf);
  if (goCount.el && goCount.final) goCount.el.textContent = goCount.final;
  goCount = { raf: 0, el: null, final: '' };
  if (goFx && goFx.parentNode) goFx.remove();
  goFx = null;
  // P13: a hero still up from the victory sequence goes with the scene.
  Hero.close();
  const modal = document.getElementById('game-over-modal');
  if (modal) modal.classList.remove('go-scene');
}

function buildGameOverScene(modal, cls, state) {
  dismissGameOverFx();
  const score = state && state.score ? state.score : [0, 0];
  if (cls === 'draw') { countScore(score[0], score[1]); return; }

  const layer = document.createElement('div');
  layer.className = 'go-fx go-fx-' + cls;
  layer.setAttribute('aria-hidden', 'true');

  // The wash: the stage dims to gold-black on a win, to a cold blue on a
  // loss. One element, one opacity fade -- no backdrop-filter, which would
  // be a full-screen blur on a phone at the exact moment the fleet clones
  // are animating over it.
  const wash = document.createElement('div');
  wash.className = 'go-wash';
  layer.appendChild(wash);

  if (cls === 'loss') {
    // The muted banner. Deliberately not a second "Defeat" -- the title
    // already says that; this is the caption underneath the sinking.
    const banner = document.createElement('div');
    banner.className = 'go-banner';
    banner.textContent = 'The fleet is lost';
    layer.appendChild(banner);
  }

  // First child, so the whole scene paints behind `.modal-inner` and the
  // four buttons stay the topmost, tappable thing on the screen.
  modal.insertBefore(layer, modal.firstChild);
  modal.classList.add('go-scene');
  goFx = layer;

  const fleet = fleetCards();
  playFleet(layer, cls === 'win');
  if (cls === 'win') {
    playConfetti(layer);
    // P13: once the fan has risen, each ship of the winning fleet gets the
    // hero treatment in turn. Mounted on the modal (the stage is behind it)
    // and pointer-events: none, so Continue stays tappable throughout; the
    // sequence stops the moment the scene is torn down.
    // P15: at most three heroes, so the results ladder (render/progress.js)
    // that waits for this parade starts within ~3.5 s of the verdict.
    const defs = fleet.map((el) => CARDS[el.dataset.cardId]).filter(Boolean).slice(0, 3);
    const riseMs = 90 + fleet.length * 80 + 640;
    const scene = layer;
    setTimeout(() => {
      if (goFx !== scene) return;
      Hero.playSequence(defs, { host: modal, each: HERO_FLEET_MS, alive: () => goFx === scene });
    }, riseMs);
  }
  countScore(score[0], score[1]);
}

// ---- debug entry points (?demo=roundend / ?demo=gameover) ------------

export function demoRoundEnd(state, opts = {}) {
  showRoundEnd({
    round: opts.round || 3,
    winner: opts.winner == null ? 1 : opts.winner,
    reason: opts.reason || 'Frontline cleared',
    captured: opts.captured || 'radar',
    capturedBy: opts.capturedBy == null ? 1 : opts.capturedBy,
    uncaptured: false,
    score: opts.score || [2, 1],
  });
}
