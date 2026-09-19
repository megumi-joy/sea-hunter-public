// Sea Hunter -- phase P3 "Combat juice".
//
// Every visible beat of a combat exchange lives here: the attacker's lunge,
// the impact flash, the result callout, the shard destroy, reveal flips, the
// turn banner and the score ticker. ui.js keeps the four public names app.js
// and multiplayer.js already await (animateAttack, destroyCardAnimation,
// shakeCard, flipCard) and forwards them straight into this module, so no
// caller had to change.
//
// Rules this file holds itself to:
//   - transform and opacity only. Nothing here reads or writes width/height/
//     top/left on a live board element, so no effect can force a layout pass
//     on the stage mid-animation.
//   - every effect is cancellable. Animations and transient nodes are tracked
//     in `live`; cancelAll() tears the whole lot down, and attack() calls it
//     on entry so a second attack arriving mid-flight (multiplayer) can never
//     leave a half-lunged card behind.
//   - one attack finishes within 990 ms, start to slot-empty (see TIMELINE).
//     P12 "Living board" added a 90 ms hit-stop at contact and spent the
//     whole of it on the budget rather than shaving the beats after it --
//     the hold IS the weight, and a shorter impact to pay for it would have
//     traded the thing back.
//   - prefers-reduced-motion collapses everything to a 120 ms fade.
//
// Note on keyframe direction: every effect's FIRST keyframe is already
// visible (the flash starts bright and fades, the callout starts opaque and
// rises, the shards start assembled and scatter). That is how MTG Arena reads
// on contact -- brightest at the moment of impact -- and it also means a
// screenshot taken at the instant an effect is created shows the effect,
// which is the only thing a headless capture with a frozen animation clock
// can see.

// P5 "Sound and haptics": every beat below that a player can hear fires one
// cue. audio.js owns muting, haptics and the "opponent is acting" gate -- all
// this file does is say what happened and when.
import * as Audio from './audio.js';

const REDUCED = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Single knob every duration below passes through.
function dur(ms) { return REDUCED() ? 120 : ms; }

// The attack timeline, in ms from the start of animateAttack(). Kept as one
// table so the 900 ms budget is checkable by reading rather than by adding up
// scattered awaits.
// P12: every beat from `contact` onwards is quoted from the END of the
// hit-stop (310 ms), not from the moment the attacker arrives (220 ms).
const TIMELINE = {
  lunge: 220,      // 0 -> 220   attacker travels 60% of the way
  contact: 220,    // 220        attacker arrives; the lunge PAUSES here
  hitStop: 90,     // 220 -> 310 nothing at all happens. That is the point.
  flash: 220,      // 310 -> 530
  defShake: 180,   // 310 -> 490
  stageShake: 140, // 310 -> 450 (P10 fix 3: a DRAW gets one too, at 2 px)
  punch: 80,       // 310 -> 390 (P12: the whole stage scales 1.02 on a WIN)
  splash: 420,     // 310 -> 730 (the particle burst outlives the flash)
  callout: 760,    // 310 -> 1070 -- outlives the sequence on purpose, it is
                   //               the one beat the player reads rather
                   //               than feels. cancelAll() still owns it.
  vsHold: 300,     // 310 -> 610 the callout reads "3 vs 5" for this long,
                   //            then resolves into WIN / LOSS / DRAW.
  snapBack: 200,   // 310 -> 510 with overshoot
  destroyAt: 490,  // 490 -> 990
  destroy: 500,
  total: 990,
};

// ---- lifecycle ------------------------------------------------------

// Animation objects and transient DOM nodes currently on screen, plus the
// timers sequencing them. cancelAll() empties all three.
const live = { anims: new Set(), nodes: new Set(), timers: new Set() };

function track(anim) {
  if (!anim) return anim;
  live.anims.add(anim);
  // .finished rejects with AbortError on cancel -- swallow it here so a
  // cancelled effect never surfaces as an unhandled rejection.
  if (anim.finished) anim.finished.then(() => live.anims.delete(anim), () => {});
  return anim;
}

// BUGFIX: cancel a finished animation whose element OUTLIVES it.
//
// Every effect here runs with `fill: 'both'`, and track() only drops the
// Animation out of `live.anims` when it finishes -- it never cancels it. For
// a transient node that is correct and free: dropNode() removes the element
// and the Animation goes with it. But `.stage` is not transient, it is the
// element the whole match is played on, and stageShake()/cameraPunch() both
// animate its `transform` with `composite: 'add'`. An additive filling
// animation is never replaced by a later one -- they STACK -- so every
// exchange of every round left two more permanently-filling Animations
// attached to one element that lives for the whole match, all of them
// composited on every frame. Both end on the identity transform, so
// cancelling them the moment they finish is visually free and is the only
// thing that stops the pile growing. Deliberately NOT folded into track():
// the lunge depends on filling past its own finish for the length of the
// hit-stop, and is cancelled explicitly by runAttack() instead.
function dropWhenDone(anim) {
  if (anim && anim.finished) {
    anim.finished.then(() => { try { anim.cancel(); } catch (e) { /* already done */ } }, () => {});
  }
  return anim;
}

function trackNode(node) { live.nodes.add(node); return node; }

function dropNode(node) {
  live.nodes.delete(node);
  if (node && node.parentNode) node.remove();
}

// Sequencing helper. Uses setTimeout rather than Animation.finished on
// purpose: it is the one clock that keeps ticking when the compositor's
// animation clock does not (headless capture), so an attack always resolves
// and the busy flag app.js holds around it always gets released.
function after(ms, fn) {
  const entry = { id: 0, fn };
  entry.id = setTimeout(() => { live.timers.delete(entry); fn(); }, ms);
  live.timers.add(entry);
  return entry;
}

function wait(ms) { return new Promise((r) => after(ms, r)); }

export function cancelAll() {
  // Pending callbacks are RUN, not dropped. They are what resolves an
  // in-flight attack's promise (and what empties the destroyed slot) -- and
  // app.js awaits that promise under store.combatLocked, so dropping them
  // would leave the board permanently untouchable. Settling them
  // immediately just skips the remaining animation, which is the point.
  const pending = Array.from(live.timers);
  live.timers.clear();
  pending.forEach((entry) => clearTimeout(entry.id));
  live.anims.forEach((a) => { try { a.cancel(); } catch (e) { /* already done */ } });
  live.anims.clear();
  Array.from(live.nodes).forEach(dropNode);
  pending.forEach((entry) => { try { entry.fn(); } catch (e) { /* best effort */ } });
}

// Per-match state, dropped between matches.
//
// BUGFIX: render/screens.js and render/ocean.js both have a reset() wired
// into ui.js's hideGameOver(); this module had none, so its three
// edge-trigger baselines survived into the next match. The visible one was
// the score ticker: `lastScore` still held the finished match's "3:1", so
// the FIRST render of the new match called scoreChanged(el, 0, 0), saw a
// change, and rolled both digits DOWNWARD from the previous result -- a new
// game opening by counting the old one's score away. `lastTurnKey` did the
// same quieter thing (the new match's first "YOUR TURN" banner was
// swallowed when both matches opened on the same turn owner), and a match
// abandoned mid-attack left `attackRunning` true, so the next attack in the
// next match opened with a stray cancelAll().
export function reset() {
  cancelAll();
  lastScore = null;
  lastTurnKey = null;
  attackRunning = false;
  faceDownBefore = null;
}

// ---- the fx layer ---------------------------------------------------

// Everything transient is appended here, not to document.body: the layer
// lives inside `#game-screen .stage` (already `position: relative`, see
// stage.css), so clones inherit --slot-w and the stage's px-based type scale
// instead of style.css's html{font-size:30px} root, and renderZone's
// innerHTML wipes never touch it.
function stageEl() { return document.querySelector('#game-screen .stage'); }

function fxLayer() {
  const stage = stageEl();
  if (!stage) return null;
  let layer = stage.querySelector(':scope > .fx-layer');
  if (!layer) {
    layer = document.createElement('div');
    layer.className = 'fx-layer';
    stage.appendChild(layer);
  }
  return layer;
}

// Element rect expressed in fx-layer coordinates.
//
// Board geometry is always taken from the `.slot`, never from the card
// inside it: a card can carry a transform of its own (ui.js's FLIP
// entrance scales it up from nothing, a selection lifts it), and measuring
// that would give a half-sized flash, half-sized shards and a short lunge.
// The slot is never transformed, and a card exactly fills its slot.
function geomEl(el) {
  const slot = el && el.closest ? el.closest('.slot') : null;
  return slot || el;
}

function localRect(el) {
  const stage = stageEl();
  if (!stage) return null;
  const r = geomEl(el).getBoundingClientRect();
  const s = stage.getBoundingClientRect();
  return { x: r.left - s.left, y: r.top - s.top, w: r.width, h: r.height,
           cx: r.left - s.left + r.width / 2, cy: r.top - s.top + r.height / 2 };
}

// Debug only: `?fxfreeze=<0..1>` parks every animation at that fraction of
// its duration and keeps the transient nodes on screen instead of clearing
// them. A headless screenshot pass runs timers on a virtual clock but
// animations on the real one, so without this there is no way to photograph
// a mid-flight state. Never set by the game itself.
const freezeAt = (() => {
  const v = new URLSearchParams(window.location.search).get('fxfreeze');
  if (v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : null;
})();

function anim(el, frames, options) {
  if (!el || typeof el.animate !== 'function') return null;
  const a = el.animate(frames, { fill: 'both', ...options });
  if (freezeAt !== null) {
    a.pause();
    a.currentTime = (options && options.duration ? options.duration : 0) * freezeAt;
  }
  return track(a);
}

// Node teardown, as opposed to sequencing: skipped entirely under fxfreeze so
// the effect stays on screen to be photographed. Sequencing still runs, so
// the attack promise resolves on time either way.
function cleanup(ms, fn) { if (freezeAt === null) after(ms, fn); }

// ---- 1 + 2. lunge and impact ---------------------------------------

function lunge(atkEl, dx, dy) {
  // composite:'add' so the card's own resting transform (a .selected lift, a
  // hand-fan rotation) is layered under the lunge instead of being replaced.
  const d = dur(TIMELINE.lunge);
  if (REDUCED()) return anim(atkEl, [{ opacity: 1 }, { opacity: 0.75 }, { opacity: 1 }], { duration: d });
  return anim(atkEl, [
    { transform: 'translate(0px, 0px) scale(1)' },
    { transform: `translate(${dx * 0.6}px, ${dy * 0.6}px) scale(1.06)` },
  ], { duration: d, easing: 'cubic-bezier(0.45, 0, 0.9, 0.5)', composite: 'add' });
}

function snapBack(atkEl, dx, dy) {
  const d = dur(TIMELINE.snapBack);
  if (REDUCED()) return null;
  // Overshoot: past the resting spot by 8% of the travel, then settle.
  return anim(atkEl, [
    { transform: `translate(${dx * 0.6}px, ${dy * 0.6}px) scale(1.06)`, offset: 0 },
    { transform: `translate(${dx * -0.08}px, ${dy * -0.08}px) scale(0.99)`, offset: 0.7 },
    { transform: 'translate(0px, 0px) scale(1)', offset: 1 },
  ], { duration: d, easing: 'cubic-bezier(0.2, 0.7, 0.3, 1)', composite: 'add' });
}

// Radial flash centred on the defender. Starts at full opacity (see the file
// header).
//
// P10 fix 3: the flash is no longer one colour for every outcome. A WIN
// keeps the cyan accent -- the player's own colour, the one the targeting
// arc and the legal-target ring already use. A LOSS gets a hot negative red
// instead, so "my card just died" and "their card just died" are told apart
// in the first frame rather than a beat later when the callout reads out.
//
// DRAW and NONE are NOT in the table and fall through to the cyan default,
// which is the flash P3 already gave them. The red is specifically the
// destroy cue for an exchange the player lost; spending it on a DRAW too
// would spend the one colour that means "this went badly for you".
const FLASH_CLASS = {
  WIN: 'fx-flash-win',
  LOSS: 'fx-flash-loss',
};

function impactFlash(defEl, result) {
  const layer = fxLayer();
  const rect = localRect(defEl);
  if (!layer || !rect) return;
  const size = Math.max(rect.w, rect.h) * 1.6;
  const flash = trackNode(document.createElement('div'));
  flash.className = 'fx-flash ' + (FLASH_CLASS[result] || 'fx-flash-win');
  flash.style.width = `${size}px`;
  flash.style.height = `${size}px`;
  flash.style.left = `${rect.cx - size / 2}px`;
  flash.style.top = `${rect.cy - size / 2}px`;
  layer.appendChild(flash);
  const d = dur(TIMELINE.flash);
  anim(flash, REDUCED()
    ? [{ opacity: 0.9 }, { opacity: 0 }]
    : [
      { transform: 'scale(0.45)', opacity: 1 },
      { transform: 'scale(0.85)', opacity: 0.9, offset: 0.35 },
      { transform: 'scale(1.35)', opacity: 0 },
    ], { duration: d, easing: 'cubic-bezier(0.2, 0.8, 0.4, 1)' });
  cleanup(d + 40, () => dropNode(flash));
}

export function shake(el) {
  if (!el) return;
  const d = dur(TIMELINE.defShake);
  if (REDUCED()) { anim(el, [{ opacity: 0.6 }, { opacity: 1 }], { duration: d }); return; }
  anim(el, [
    { transform: 'translateX(0px)' },
    { transform: 'translateX(-5px)', offset: 0.2 },
    { transform: 'translateX(4px)', offset: 0.45 },
    { transform: 'translateX(-3px)', offset: 0.7 },
    { transform: 'translateX(0px)' },
  ], { duration: d, easing: 'ease-out', composite: 'add' });
}

// A kick of the whole stage on contact (P10 fix 3).
//
// P3 gave a decisive exchange a 120 ms 4 px lurch in one direction and a
// DRAW nothing at all. Two problems: a one-way lurch reads as the board
// sliding, not as an impact, and a silent DRAW made a mutual destruction --
// the single most consequential thing that can happen in an exchange --
// the only one with no physical feedback.
//
// So: 140 ms, alternating 3 px either side of rest, which is a shudder
// rather than a slide. A DRAW gets the same shape at 2 px -- a dull thud,
// audibly present but plainly not the same event.
const SHAKE_PX = { WIN: 3, LOSS: 3, DRAW: 2 };

function stageShake(result) {
  if (REDUCED()) return;
  const px = SHAKE_PX[result];
  if (!px) return;
  const stage = stageEl();
  if (!stage) return;
  // Leading with the sign of the attacker's side keeps a WIN and a LOSS
  // starting in opposite directions, which is what P3's `dir` was for.
  const dir = result === 'LOSS' ? -1 : 1;
  dropWhenDone(anim(stage, [
    { transform: 'translate(0px, 0px)', offset: 0 },
    { transform: `translate(${px * dir}px, 0px)`, offset: 0.2 },
    { transform: `translate(${-px * dir}px, 0px)`, offset: 0.45 },
    { transform: `translate(${px * dir}px, 0px)`, offset: 0.7 },
    { transform: `translate(${-px * dir * 0.5}px, 0px)`, offset: 0.88 },
    { transform: 'translate(0px, 0px)', offset: 1 },
  ], { duration: dur(TIMELINE.stageShake), easing: 'ease-out', composite: 'add' }));
}

// A camera punch on a decisive win (P12).
//
// Distinct from stageShake(), and deliberately so: the shake is lateral and
// says "that landed", the punch is a scale and says "and it was YOURS". 80 ms
// at 1.02 is about as much as the stage can take without the 9:16 desktop
// frame's rounded corners visibly breathing.
//
// WIN only. A LOSS already has the red flash and the shudder, and pushing
// the camera in on the player's own card dying would read as celebrating it.
// `composite: 'add'` so it layers over the shake rather than replacing it --
// both run on `.stage` in the same window.
function cameraPunch(result) {
  if (REDUCED() || result !== 'WIN') return;
  const stage = stageEl();
  if (!stage) return;
  dropWhenDone(anim(stage, [
    { transform: 'scale(1)', offset: 0 },
    { transform: 'scale(1.02)', offset: 0.35 },
    { transform: 'scale(1)', offset: 1 },
  ], { duration: dur(TIMELINE.punch), easing: 'cubic-bezier(0.3, 0.9, 0.4, 1)', composite: 'add' }));
}

// ---- 2b. splash burst (P10 fix 3) -----------------------------------
// Ten small circles thrown out of the impact point on ballistic arcs, fading
// as they go -- water knocked off the sea by a hit. Blue-white, so it reads
// as spray against both the cyan win flash and the red destroy flash rather
// than competing with either.
//
// Deliberately cheap: plain absolutely-positioned divs, each with ONE
// transform+opacity animation and no layout read after creation. Each is
// tracked via trackNode()/cleanup() like every other transient node here, so
// cancelAll() takes the whole burst down with the rest of the attack.
//
// Per the file header, the first keyframe is already visible: the particles
// start at full opacity ON the impact point, so a screenshot taken at the
// instant of contact shows the burst rather than an empty stage.
const SPLASH_N = 10;

function splash(defEl, result) {
  if (REDUCED()) return;
  // Decisive exchanges only. A DRAW's feedback is the 2 px thud and nothing
  // else, and NONE (a Smoke Bomb block) never made contact at all -- there
  // is no water to knock off something that was not hit.
  if (result !== 'WIN' && result !== 'LOSS') return;
  const layer = fxLayer();
  const rect = localRect(defEl);
  if (!layer || !rect) return;
  const d = dur(TIMELINE.splash);
  for (let i = 0; i < SPLASH_N; i++) {
    // Fan across the upper half only -- spray goes up and out, never down
    // through the water it came from. Jittered off the even spacing so the
    // burst does not read as a clock face.
    const a = Math.PI + (i + 0.5 + (i % 3 - 1) * 0.18) * (Math.PI / SPLASH_N);
    // Reach is sized against the FLASH, not against the card.
    //
    // The flash is max(w, h) * 1.6 across and scales out to 1.35, so on a
    // 90 px card its bright zone -- everything inside the gradient's 48%
    // stop -- reaches ~62 px from the impact point. A particle thrown less
    // far than that spends its whole life inside the flash and is simply
    // not on the frame. At 0.95 of a card width the burst is past that edge
    // by its own apex, which is the beat it has to read on.
    const reach = rect.w * 0.95 + (i % 4) * 14;
    // 6-10 px. The first pass used 3-5 and the burst simply did not read
    // at 412px against the mid-blue of an empty slot -- at that size a
    // particle is two or three physical pixels once it has scaled down, and
    // spray you have to look for is spray that is not doing its job.
    const size = 6 + (i % 3) * 2;
    const p = trackNode(document.createElement('div'));
    p.className = 'fx-splash';
    p.style.width = `${size}px`;
    p.style.height = `${size}px`;
    p.style.left = `${rect.cx - size / 2}px`;
    p.style.top = `${rect.cy - size / 2}px`;
    layer.appendChild(p);
    const dx = Math.cos(a) * reach;
    const dy = Math.sin(a) * reach;
    anim(p, [
      { transform: 'translate(0px, 0px) scale(1)', opacity: 1, offset: 0 },
      // Apex, and FULL opacity held all the way to it.
      //
      // This phasing is the whole trick. The flash covers 220-440 ms and the
      // burst 220-640, so the only window in which the particles are seen
      // at all is the back half of their own life -- for the front half they
      // are inside the flash's own bright falloff. A burst that fades from
      // the first frame (the obvious way to write this) is therefore already
      // at a third of its opacity by the moment it becomes visible, and the
      // effect reads as a few grey specks. Held flat to 0.55 -- which is
      // ~450 ms, just as the flash clears -- the spray appears at full
      // strength and falls away from there.
      { transform: `translate(${(dx * 0.72).toFixed(1)}px, ${(dy * 1.05).toFixed(1)}px) scale(0.95)`, opacity: 1, offset: 0.55 },
      // ...and back down past the start height, shrinking out.
      { transform: `translate(${dx.toFixed(1)}px, ${(dy * -0.3 + 20).toFixed(1)}px) scale(0.5)`, opacity: 0, offset: 1 },
    ], { duration: d + i * 12, easing: 'cubic-bezier(0.25, 0.6, 0.5, 1)' });
    cleanup(d + i * 12 + 60, () => dropNode(p));
  }
}

// ---- 3. result callout ----------------------------------------------

const CALLOUT_TEXT = { WIN: 'WIN', LOSS: 'LOSS', DRAW: 'DRAW', NONE: 'no effect' };

// P12: the callout now RESOLVES rather than just announcing.
//
// It rises out of the defender reading "3 vs 5" -- the two strengths, the
// damage-number beat every card game on a phone has and this one did not --
// holds that for 300 ms, and only then snaps to WIN / LOSS / DRAW. The
// player gets the inputs before the verdict, which is the difference
// between being told an outcome and watching one happen.
//
// The swap is an `after()` (setTimeout), not a keyframe, for the reason the
// file header gives: under `?fxfreeze` the animation clock is parked but
// timers still run, so a freeze at 0 photographs the numbers and a later
// freeze photographs the verdict. A keyframed swap would photograph neither.
//
// Known limitation, and it is the matrix's, not this code's: Sea Hunter's
// impact table is NOT strength-ordered (a Plane, strength 1, beats a
// Battleship, strength 5). So "1 vs 5" resolving to WIN is correct and will
// still look wrong to someone reading the numbers as the reason. They are
// the cards' printed stats, which is what a player compares; the verdict
// underneath them is the truth.
function vsText(atkStrength, defStrength) {
  if (atkStrength == null || defStrength == null) return null;
  return `${atkStrength} vs ${defStrength}`;
}

function callout(defEl, result, atkStrength, defStrength) {
  const layer = fxLayer();
  const rect = localRect(defEl);
  if (!layer || !rect) return;
  const el = trackNode(document.createElement('div'));
  const verdict = CALLOUT_TEXT[result] || CALLOUT_TEXT.NONE;
  const vs = vsText(atkStrength, defStrength);
  el.className = `fx-callout fx-callout-${String(result).toLowerCase()}`
    + (vs ? ' fx-callout-vs' : '');
  el.textContent = vs || verdict;
  if (vs) {
    after(dur(TIMELINE.vsHold), () => {
      if (!el.isConnected) return;
      el.textContent = verdict;
      el.classList.remove('fx-callout-vs');
      el.classList.add('fx-callout-resolved');
    });
  }
  // Centred over the defender by its own transform, so no width measurement
  // (and therefore no forced layout) is needed to place it.
  el.style.left = `${rect.cx}px`;
  el.style.top = `${rect.y - 6}px`;
  layer.appendChild(el);
  const d = dur(TIMELINE.callout);
  anim(el, REDUCED()
    ? [{ opacity: 1 }, { opacity: 0 }]
    : [
      { transform: 'translate(-50%, 0px) scale(1.12)', opacity: 1 },
      { transform: 'translate(-50%, -8px) scale(1)', opacity: 1, offset: 0.25 },
      { transform: 'translate(-50%, -24px) scale(1)', opacity: 0 },
    ], { duration: d, easing: 'cubic-bezier(0.25, 0.9, 0.35, 1)' });
  cleanup(d + 40, () => dropNode(el));
}

// The same outcome, in words, for the combat log. `cards` carry their
// definition under `.def` (see game.js's makeCard), so the display name is
// `card.def.name`.
export function outcomeText(atkCard, defCard, result) {
  const a = (atkCard && atkCard.def && atkCard.def.name) || 'Attacker';
  const d = (defCard && defCard.def && defCard.def.name) || 'Defender';
  if (result === 'WIN') return `${a} destroys ${d}`;
  if (result === 'LOSS') return `${a} is destroyed by ${d}`;
  if (result === 'DRAW') return `${a} and ${d} destroy each other`;
  return `${a} vs ${d}: no effect`;
}

// ---- 4. shard destroy ------------------------------------------------

const SHARD_CLIPS = [
  'polygon(0% 0%, 52% 0%, 38% 34%, 0% 44%)',
  'polygon(52% 0%, 100% 0%, 100% 30%, 38% 34%)',
  'polygon(0% 44%, 38% 34%, 46% 66%, 0% 74%)',
  'polygon(38% 34%, 100% 30%, 100% 62%, 46% 66%)',
  'polygon(0% 74%, 46% 66%, 40% 100%, 0% 100%)',
  'polygon(46% 66%, 100% 62%, 100% 100%, 40% 100%)',
  'polygon(40% 100%, 100% 88%, 100% 100%)',
];

// Breaks the card in `slotEl` into 7 clip-path shards that scatter and fade,
// then empties the slot. Resolves only after the card element is gone, which
// is the contract ui.js's destroyCardAnimation() has always had.
// P12: a destroy gets its own red flash and its own DEBRIS, separate from
// the contact beat 180 ms earlier.
//
// P10's splash is blue-white spray thrown off the water by a HIT, and it
// fires at contact for a WIN or a LOSS whether or not anything died. That
// left the moment a card actually breaks with only the shards, so "hit" and
// "killed" shared one visual vocabulary. Debris is the other half: dark hull
// fragments and hot embers, rectangles rather than circles, thrown from the
// slot at the moment it empties. Nothing here is blue, and nothing here is
// round -- the two bursts cannot be confused at a glance, which is the whole
// requirement.
const DEBRIS_N = 12;

function destroyBurst(rect) {
  if (REDUCED()) return;
  const layer = fxLayer();
  if (!layer || !rect) return;

  // The red flash under it: one wash sized to the card, brightest on the
  // first frame (see the file header), gone in 260 ms.
  const size = Math.max(rect.w, rect.h) * 1.5;
  const flash = trackNode(document.createElement('div'));
  flash.className = 'fx-destroy-flash';
  flash.style.width = `${size}px`;
  flash.style.height = `${size}px`;
  flash.style.left = `${rect.cx - size / 2}px`;
  flash.style.top = `${rect.cy - size / 2}px`;
  layer.appendChild(flash);
  const fd = dur(260);
  anim(flash, [
    { transform: 'scale(0.6)', opacity: 1 },
    { transform: 'scale(1.25)', opacity: 0 },
  ], { duration: fd, easing: 'cubic-bezier(0.2, 0.8, 0.4, 1)' });
  cleanup(fd + 40, () => dropNode(flash));

  const dd = dur(520);
  for (let i = 0; i < DEBRIS_N; i++) {
    // A full circle, unlike the splash's upper-half fan: wreckage goes
    // everywhere, spray only goes up. Index-derived, so a screenshot pass
    // reproduces exactly.
    const a = (i + 0.5) * (Math.PI * 2 / DEBRIS_N) + (i % 3) * 0.13;
    const reach = rect.w * (0.5 + (i % 4) * 0.22);
    const w = 3 + (i % 3) * 3;
    const h = 2 + (i % 2) * 3;
    const p = trackNode(document.createElement('div'));
    // Every fourth piece is an ember rather than hull plating -- enough to
    // read as fire, few enough that the burst still reads as dark.
    p.className = 'fx-debris' + (i % 4 === 0 ? ' fx-debris-ember' : '');
    p.style.width = `${w}px`;
    p.style.height = `${h}px`;
    p.style.left = `${rect.cx - w / 2}px`;
    p.style.top = `${rect.cy - h / 2}px`;
    layer.appendChild(p);
    const dx = Math.cos(a) * reach;
    const dy = Math.sin(a) * reach;
    anim(p, [
      { transform: 'translate(0px, 0px) rotate(0deg)', opacity: 1, offset: 0 },
      { transform: `translate(${(dx * 0.7).toFixed(1)}px, ${(dy * 0.7 - 6).toFixed(1)}px) rotate(${i % 2 ? 90 : -90}deg)`, opacity: 1, offset: 0.5 },
      // Everything falls: past the start height, tumbling, out.
      { transform: `translate(${dx.toFixed(1)}px, ${(dy + rect.h * 0.55).toFixed(1)}px) rotate(${i % 2 ? 220 : -220}deg)`, opacity: 0, offset: 1 },
    ], { duration: dd + i * 10, easing: 'cubic-bezier(0.25, 0.5, 0.5, 1)' });
    cleanup(dd + i * 10 + 60, () => dropNode(p));
  }
}

export function destroySlot(slotEl) {
  return new Promise((resolve) => {
    const card = slotEl && slotEl.querySelector('.card');
    const layer = fxLayer();
    // Measured from the slot, not the card -- see geomEl().
    const rect = card ? localRect(slotEl) : null;
    if (!card) { resolve(); return; }
    const d = dur(TIMELINE.destroy);
    // Before the branch: a reduced-motion player still gets the sound and the
    // heavy buzz. audio.js rate-limits the cue, so a DRAW (which destroys both
    // cards in the same frame) shatters once, not twice.
    Audio.cue('destroy');
    if (!layer || !rect || REDUCED()) {
      anim(card, [{ opacity: 1 }, { opacity: 0 }], { duration: d });
      after(d, () => { card.remove(); resolve(); });
      return;
    }

    // P12: the red flash and the debris, fired on the same frame as the
    // 'destroy' cue above rather than a beat after it.
    destroyBurst(rect);

    const shards = SHARD_CLIPS.map((clip, i) => {
      const shard = trackNode(card.cloneNode(true));
      shard.classList.add('fx-shard');
      shard.removeAttribute('id');
      shard.removeAttribute('data-uid');
      // The card may have been cloned mid-entrance: ui.js's FLIP fly writes
      // an inline transform/transition onto the live element and `.entering`
      // carries a keyframe that starts at opacity 0. Neither belongs on a
      // shard -- they would fight the scatter keyframes, or hide the piece
      // outright. Reset the clone to a plain, fully visible card.
      shard.classList.remove('entering', 'flying', 'selected', 'legal-target', 'dragging', 'impact');
      shard.style.removeProperty('--fly-dx');
      shard.style.removeProperty('--fly-dy');
      shard.style.removeProperty('--fly-arc');
      shard.style.transform = 'none';
      shard.style.transition = 'none';
      shard.style.animation = 'none';
      shard.style.opacity = '1';
      // The clone leaves the board, so it also leaves the element that was
      // supplying --slot-w. Pin the size it had at the moment it broke.
      shard.style.setProperty('--slot-w', `${rect.w}px`);
      shard.style.width = `${rect.w}px`;
      shard.style.height = `${rect.h}px`;
      shard.style.left = `${rect.x}px`;
      shard.style.top = `${rect.y}px`;
      shard.style.clipPath = clip;
      layer.appendChild(shard);
      // Deterministic spread (index-derived, not random) so the break reads
      // the same way every time and a screenshot pass is reproducible.
      const angle = (i / SHARD_CLIPS.length) * Math.PI * 2 + 0.6;
      const reach = rect.w * (0.55 + (i % 3) * 0.18);
      anim(shard, [
        { transform: 'translate(0px, 0px) rotate(0deg)', opacity: 1 },
        { transform: `translate(${Math.cos(angle) * reach * 0.45}px, ${Math.sin(angle) * reach * 0.45 - 4}px) rotate(${(i % 2 ? 7 : -7)}deg)`, opacity: 0.95, offset: 0.4 },
        { transform: `translate(${Math.cos(angle) * reach}px, ${Math.sin(angle) * reach + rect.h * 0.35}px) rotate(${(i % 2 ? 22 : -22)}deg)`, opacity: 0 },
      ], { duration: d, easing: 'cubic-bezier(0.2, 0.6, 0.4, 1)' });
      return shard;
    });

    // The real card hands over to the shards immediately; the slot itself
    // only empties once the pieces are gone.
    card.style.opacity = '0';
    after(d, () => {
      if (freezeAt === null) shards.forEach(dropNode);
      card.remove();
      resolve();
    });
  });
}

// ---- 5. reveal flip --------------------------------------------------

// rotateY half-flip. `swap` is called at the 90-degree midpoint, i.e. edge-on,
// where the face change is invisible -- which is exactly what ui.js's
// flipCard() needs, since it swaps innerHTML in place (render/cards.js
// depends on that staying an innerHTML-only swap).
// The single place the 'reveal' cue name is written. Both reveal paths -- the
// mid-attack flip below and playPendingReveals()'s replay of a radar/scout
// reveal -- go through here, so the cue stays one call site.
function revealCue() { Audio.cue('reveal'); }

export function flip(el, swap) {
  if (!el) return;
  revealCue();
  if (REDUCED() || typeof el.animate !== 'function') { if (swap) swap(); return; }
  const half = dur(150);
  // BUGFIX (phase G5, found by comparing this against the Godot port): anim()
  // fills BOTH and composites ADD, so the first half does not go away when it
  // ends -- it holds rotateY(90deg) on the card for good, and the second
  // half's -90 -> 0 adds to it. The card therefore settled at 90deg: edge on,
  // i.e. invisible. In play the next renderAll() replaced the element and hid
  // the damage; ?fxfreeze and the phase G4 'revealed' frame showed the slot
  // empty, which is what it really looked like until the next render.
  // Cancelling the first half at the midpoint -- the moment the face is
  // swapped, where it is already at its end value -- leaves the second half
  // as the only rotation on the card, and it ends on the identity transform.
  const first = anim(el, [
    { transform: 'perspective(600px) rotateY(0deg)' },
    { transform: 'perspective(600px) rotateY(90deg)' },
  ], { duration: half, easing: 'ease-in', composite: 'add' });
  after(half, () => {
    if (first) {
      live.anims.delete(first);
      try { first.cancel(); } catch (e) { /* already done */ }
    }
    if (swap) swap();
    // dropWhenDone: this one also fills additively and also ends on the
    // identity transform, so it is dropped the moment it finishes rather than
    // left stacked on a card that lives for the whole match.
    dropWhenDone(anim(el, [
      { transform: 'perspective(600px) rotateY(-90deg)' },
      { transform: 'perspective(600px) rotateY(0deg)' },
    ], { duration: half, easing: 'ease-out', composite: 'add' }));
  });
}

// Reveals triggered by radar, scouting or an island power never route through
// flipCard(): game.js sets card.faceUp = true and the next renderAll() builds
// a brand-new, already-face-up element. These two functions bracket that
// render (ui.js calls them from beginFlyBatch / flyNewlyEnteredCards, which
// app.js's renderAll already brackets every pass with) and replay the second
// half of the flip on whatever turned over, so those reveals read the same as
// an attack reveal.
let faceDownBefore = null;

export function snapshotFaceDown() {
  faceDownBefore = new Set();
  document.querySelectorAll('#game-screen .card.face-down[data-uid]').forEach((el) => {
    faceDownBefore.add(el.dataset.uid);
  });
}

export function playPendingReveals() {
  const before = faceDownBefore;
  faceDownBefore = null;
  if (!before || !before.size || REDUCED()) return;
  let sounded = false;
  before.forEach((uid) => {
    const el = document.querySelector(`#game-screen .card[data-uid="${uid}"]`);
    if (!el || el.classList.contains('face-down')) return;
    // One cue for the batch, however many cards a radar sweep turned over.
    if (!sounded) { sounded = true; revealCue(); }
    dropWhenDone(anim(el, [
      { transform: 'perspective(600px) rotateY(-90deg)' },
      { transform: 'perspective(600px) rotateY(0deg)' },
    ], { duration: dur(180), easing: 'ease-out', composite: 'add' }));
  });
}

// ---- 6. turn banner --------------------------------------------------

// Fired from updateHUD, which runs on every renderAll -- so the banner has to
// be edge-triggered or it would replay on every single render. The key is
// phase + turn owner; a non-combat phase resets it so the first combat turn
// after PREP still announces itself.
let lastTurnKey = null;

export function turnChanged(phase, turnOwner, phaseLabelEl) {
  // P9 fix 6's persistent half: the 2px glow around the active side's
  // board. Set here, before the edge check, because this function runs from
  // updateHUD on EVERY renderAll -- render/input.js's refresh() also sets
  // it from the same state, but refresh() is driven by a MutationObserver
  // over the six board containers, so a handover that changed nothing on
  // the board left the glow a turn behind.
  const st = stageEl();
  if (st) {
    st.classList.toggle('turn-mine', phase === 'COMBAT' && turnOwner === 1);
    st.classList.toggle('turn-theirs', phase === 'COMBAT' && turnOwner === 2);
  }
  if (phase !== 'COMBAT') { lastTurnKey = null; return; }
  const key = `${phase}:${turnOwner}`;
  if (key === lastTurnKey) return;
  lastTurnKey = key;
  showBanner(turnOwner === 1 ? 'YOUR TURN' : "OPPONENT'S TURN", turnOwner === 1);
  pulse(phaseLabelEl);
}

function showBanner(text, mine) {
  const layer = fxLayer();
  if (!layer) return;
  const el = trackNode(document.createElement('div'));
  el.className = `fx-banner ${mine ? 'fx-banner-mine' : 'fx-banner-theirs'}`;
  el.textContent = text;
  layer.appendChild(el);
  // P9 fix 6: the strip unrolls from its own top edge and rolls back up,
  // rather than sliding a band across the board. scaleY from the top is the
  // whole motion -- nothing travels over a slot at any point in it.
  const d = dur(700);
  anim(el, REDUCED()
    ? [{ opacity: 0 }, { opacity: 1, offset: 0.3 }, { opacity: 0 }]
    : [
      { transform: 'scaleY(0.2)', opacity: 0 },
      { transform: 'scaleY(1)', opacity: 1, offset: 0.22 },
      { transform: 'scaleY(1)', opacity: 1, offset: 0.7 },
      { transform: 'scaleY(0.2)', opacity: 0 },
    ], { duration: d, easing: 'cubic-bezier(0.25, 0.8, 0.3, 1)' });
  cleanup(d + 40, () => dropNode(el));
}

function pulse(el) {
  if (!el) return;
  anim(el, REDUCED()
    ? [{ opacity: 0.4 }, { opacity: 1 }]
    : [
      { transform: 'scale(1)', opacity: 0.6 },
      { transform: 'scale(1.18)', opacity: 1, offset: 0.35 },
      { transform: 'scale(1)', opacity: 1 },
    ], { duration: dur(520), easing: 'ease-out' });
}

// ---- 7. score ticker -------------------------------------------------

// Rolls the score digits inside a fixed-height mask. Only fires when the
// numbers actually change; the plain text is rewritten by updateHUD either
// way, so nothing here is load-bearing for correctness.
let lastScore = null;

export function scoreChanged(el, mine, theirs) {
  const key = `${mine}:${theirs}`;
  const prev = lastScore;
  lastScore = key;
  if (prev === null || prev === key || !el) return;
  const [pm, pt] = prev.split(':');
  rollDigit(el.querySelector('.fx-score-mine'), pm, String(mine));
  rollDigit(el.querySelector('.fx-score-theirs'), pt, String(theirs));
  anim(el, REDUCED()
    ? [{ opacity: 0.5 }, { opacity: 1 }]
    : [
      { transform: 'scale(1)' },
      { transform: 'scale(1.16)', offset: 0.4 },
      { transform: 'scale(1)' },
    ], { duration: dur(420), easing: 'ease-out' });
}

function rollDigit(mask, from, to) {
  if (!mask || from === to) return;
  const strip = mask.querySelector('.fx-roll');
  if (!strip) return;
  // Two stacked digits inside a one-digit-tall mask: show the old one, slide
  // the strip up by exactly half its height to land on the new one.
  strip.innerHTML = `<span>${from}</span><span>${to}</span>`;
  if (REDUCED()) {
    strip.style.transform = 'translateY(-50%)';
    anim(strip, [{ opacity: 0 }, { opacity: 1 }], { duration: 120 });
    return;
  }
  strip.style.transform = 'translateY(-50%)';
  anim(strip, [
    { transform: 'translateY(0%)' },
    { transform: 'translateY(-50%)' },
  ], { duration: dur(420), easing: 'cubic-bezier(0.3, 0.9, 0.3, 1)' });
}

// Builds the two digit masks inside the score chip once. updateHUD keeps
// writing the chip's text itself; this adds the roll target alongside it.
export function ensureScoreChip(el, mine, theirs, suffix) {
  if (!el) return null;
  if (!el.querySelector('.fx-score')) {
    el.textContent = '';
    el.classList.add('fx-score-chip');
    el.innerHTML =
      '<span class="fx-score">' +
      '<span class="fx-score-mine fx-mask"><span class="fx-roll"></span></span>' +
      '<span class="fx-score-sep"> : </span>' +
      '<span class="fx-score-theirs fx-mask"><span class="fx-roll"></span></span>' +
      '</span><span class="fx-score-suffix"></span>';
  }
  const set = (sel, v) => {
    const strip = el.querySelector(`${sel} .fx-roll`);
    if (strip && strip.dataset.v !== v) {
      strip.dataset.v = v;
      if (!strip.children.length) strip.innerHTML = `<span>${v}</span><span>${v}</span>`;
      else strip.children[strip.children.length - 1].textContent = v;
    }
  };
  set('.fx-score-mine', String(mine));
  set('.fx-score-theirs', String(theirs));
  const suf = el.querySelector('.fx-score-suffix');
  if (suf) suf.textContent = suffix || '';
  return el;
}

// ---- the attack sequence --------------------------------------------

// The whole exchange, start to slot-empty, inside TIMELINE.total ms. Awaited
// by app.js under store.combatLocked, so nothing here may be fire-and-forget:
// the promise resolving is what tells render/input.js the board is touchable
// again.
let attackRunning = false;

export async function attack({ atkEl, defEl, result, atkStrength, defStrength, onReveal, onDestroyAttacker, onDestroyDefender }) {
  // Only tear down a previous ATTACK. A blanket cancelAll() here would also
  // kill whatever ambient effect happens to be mid-flight -- typically the
  // "OPPONENT'S TURN" banner, which is still on screen when the AI throws
  // its first attack.
  if (attackRunning) cancelAll();
  if (!atkEl || !defEl) return;
  attackRunning = true;
  // Whose attack this is, read straight off the DOM: an attacker standing in
  // an opponent zone means the AI (or the remote player) is acting, and P5's
  // rule is that nothing but the impact cue may be heard or felt then. No new
  // plumbing through app.js/ui.js for a fact the board already states.
  Audio.setOpponentActing(!!(atkEl.closest && atkEl.closest('#opp-front, #opp-reserve')));
  try {
    await runAttack({ atkEl, defEl, result, atkStrength, defStrength, onReveal, onDestroyAttacker, onDestroyDefender });
  } finally {
    attackRunning = false;
    Audio.setOpponentActing(false);
  }
}

async function runAttack({ atkEl, defEl, result, atkStrength, defStrength, onReveal, onDestroyAttacker, onDestroyDefender }) {

  const a = localRect(atkEl);
  const d = localRect(defEl);
  if (!a || !d) return;
  const dx = d.cx - a.cx;
  const dy = d.cy - a.cy;

  atkEl.classList.add('fx-lunging');
  Audio.cue('attack_lunge');
  const lungeAnim = lunge(atkEl, dx, dy);
  await wait(dur(TIMELINE.contact));

  // ---- the hit-stop (P12) --------------------------------------------
  //
  // The attacker has arrived. For 90 ms nothing moves at all: the lunge is
  // PAUSED on its last frame -- card pressed against card, mid-strike -- and
  // no cue, no flash and no shake has fired yet. Then the whole impact lands
  // at once on the far side of the hold.
  //
  // This is the single cheapest way to give a hit weight, and it is why the
  // reviewer read the P10 attacks as weightless: a lunge that flows straight
  // into its own impact has no moment of contact, only a moment of arrival.
  //
  // Paused rather than cancelled: fill:'both' holds the final transform
  // either way, but pausing leaves the Animation in `live.anims`, so a
  // cancelAll() during the hold still tears the lunge down.
  //
  // NOT run through dur(): reduced motion gets no hold at all. A player who
  // asked for less movement did not ask for a longer wait before it.
  const hold = REDUCED() ? 0 : TIMELINE.hitStop;
  if (hold) {
    if (lungeAnim && freezeAt === null) { try { lungeAnim.pause(); } catch (e) { /* already done */ } }
    await wait(hold);
  }

  if (onReveal) onReveal();
  // One cue per outcome rather than one cue plus a parameter, so each name is
  // greppable to exactly this line. NONE (a Smoke Bomb block) is silent on
  // purpose: nothing was hit.
  if (result === 'WIN') Audio.cue('impact_win');
  else if (result === 'LOSS') Audio.cue('impact_loss');
  else if (result === 'DRAW') Audio.cue('impact_draw');
  impactFlash(defEl, result);
  splash(defEl, result);
  shake(defEl);
  stageShake(result);
  cameraPunch(result);
  callout(defEl, result, atkStrength, defStrength);
  // The lunge fills forward (fill:'both'), and snapBack composites onto the
  // same element -- leaving it running would stack a held +60% under a
  // 60%->0 return and send the card twice as far. Its final value is the
  // snapBack's first keyframe, so cancelling here is seamless.
  if (lungeAnim) { try { lungeAnim.cancel(); } catch (e) { /* already done */ } }
  snapBack(atkEl, dx, dy);

  // destroyAt is measured from the start of the attack, and we are now at
  // contact + the hit-stop -- so the hold has to come off this wait or the
  // destroy would slide 90 ms later than the table says.
  await wait(dur(TIMELINE.destroyAt) - dur(TIMELINE.contact) - hold);
  atkEl.classList.remove('fx-lunging');

  const destroyed = [];
  if (onDestroyDefender) destroyed.push(onDestroyDefender());
  if (onDestroyAttacker) destroyed.push(onDestroyAttacker());
  if (destroyed.length) await Promise.all(destroyed);
  else await wait(dur(TIMELINE.total) - dur(TIMELINE.destroyAt));
}
