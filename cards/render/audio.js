// Sea Hunter -- phase P5 "Sound and haptics".
//
// Every sound in the game is synthesized here at runtime with the Web Audio
// API. There is not a single audio file in the bundle, and there never
// should be: the whole game is served as plain static files over a mobile
// connection, and sixteen short cues as sample data would outweigh all of
// the JS put together. Oscillators, one shared noise buffer and short
// envelopes cost nothing to ship.
//
// Rules this module holds itself to:
//
//  * Nothing is ever created before a user gesture. No AudioContext exists
//    until the first pointerdown/keydown, so the page can never be accused
//    of autoplay, and a browser that blocks audio outright degrades to
//    silence rather than to an exception.
//  * Every cue is under 400 ms and every envelope ends at EXACTLY zero
//    (linear ramp to 0, then osc.stop). An exponential ramp never reaches
//    zero, so a cue built that way would keep a 1e-4 tail alive forever and
//    measure as "infinite" -- see measureAll(), which is what ?demo=audio
//    renders.
//  * The master chain is gain(0.6) -> compressor -> destination, built by
//    one function that BOTH the live context and the offline measuring
//    context use, so what gets measured is what ships.
//  * cue() is the only entry point, and it owns muting, the AI-turn gate
//    and haptics together. Nothing outside this file may call
//    navigator.vibrate or Telegram's HapticFeedback, or the "no vibration
//    during AI turns" rule would have two enforcers.
//
// The callers are render/fx.js, render/input.js, render/islands.js and
// render/screens.js -- each cue name appears in exactly one place outside
// this file (where two call sites need the same cue, they share a named
// local helper, so the name itself is still written once).

// ---- persisted toggles ----------------------------------------------
//
// Deliberately NOT in settings.js's `seahunter_settings` bag: the spec pins
// these to their own keys, and audio has to be able to read its own state
// during module init, before app.js has loaded anything. Absent key = on.

const SOUND_KEY = 'seahunter.sound';
const HAPTICS_KEY = 'seahunter.haptics';

function readFlag(key) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? true : raw !== '0';
  } catch (e) {
    return true; // private mode / storage disabled: default on, just unsaved
  }
}

function writeFlag(key, on) {
  try { window.localStorage.setItem(key, on ? '1' : '0'); } catch (e) { /* unsaved */ }
}

let soundOn = readFlag(SOUND_KEY);
let hapticsOn = readFlag(HAPTICS_KEY);

export function isSoundOn() { return soundOn; }
export function isHapticsOn() { return hapticsOn; }

export function setSoundOn(on) {
  soundOn = !!on;
  writeFlag(SOUND_KEY, soundOn);
  // Flipping it ON is itself a gesture-driven action, so this is a legal
  // moment to bring the context up. No confirmation cue: every cue name has
  // exactly one trigger site, and adding a second one here behind an alias
  // would only hide that from the grep.
  if (soundOn) unlock();
}

export function setHapticsOn(on) {
  hapticsOn = !!on;
  writeFlag(HAPTICS_KEY, hapticsOn);
  if (hapticsOn) buzz('light');
}

// ---- the AI-turn gate ------------------------------------------------
//
// "No sound or vibration during AI turns beyond the impact cues." fx.js
// flips this from the DOM (an attacker sitting in an opponent zone is, by
// definition, the AI acting) -- see setOpponentActing there. Impact cues
// are the sole exception because they are feedback about what happened to
// the PLAYER's board, not about the opponent's input.

const IMPACT_CUES = new Set(['impact_win', 'impact_loss', 'impact_draw']);
let opponentActing = false;

export function setOpponentActing(v) { opponentActing = !!v; }

// ---- context and master chain ---------------------------------------

let ctx = null;
let master = null;

// gain(0.6) -> compressor -> destination. Used by the live context and by
// the offline measuring context, so measureAll() measures the shipped
// signal (compressor lookahead included).
function buildMaster(c) {
  const gain = c.createGain();
  gain.gain.value = 0.6;
  const comp = c.createDynamicsCompressor();
  comp.threshold.value = -18;
  comp.knee.value = 24;
  comp.ratio.value = 6;
  comp.attack.value = 0.003;
  comp.release.value = 0.12;
  gain.connect(comp);
  comp.connect(c.destination);
  return gain;
}

// Called from the gesture listeners below (and from setSoundOn). Creating
// the context here rather than at import time is what keeps this off the
// autoplay path entirely.
export function unlock() {
  if (!soundOn) return null;
  try {
    if (!ctx) {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return null;
      ctx = new Ctor();
      master = buildMaster(ctx);
    }
    // Not `once`: iOS and the Telegram client suspend the context when the
    // page is backgrounded or a call arrives, so this has to be able to
    // resume it again on any later gesture.
    if (ctx.state !== 'running' && ctx.resume) ctx.resume();
  } catch (e) {
    ctx = null;
    master = null;
  }
  return ctx;
}

// Capture phase on document, registered at import: it runs before
// render/input.js's own #game-screen listener, so the very first tap of a
// session both unlocks the context and plays its own cue.
if (typeof window !== 'undefined' && window.addEventListener) {
  window.addEventListener('pointerdown', () => unlock(), true);
  window.addEventListener('keydown', () => unlock(), true);
}

// ---- voices ----------------------------------------------------------

// One second of white noise, built once per context and shared by every
// noise voice (a BufferSource is single-use, the buffer behind it is not).
const noiseBuffers = new WeakMap();

function noiseBuffer(c) {
  let buf = noiseBuffers.get(c);
  if (buf) return buf;
  buf = c.createBuffer(1, Math.ceil(c.sampleRate), c.sampleRate);
  const data = buf.getChannelData(0);
  // Deterministic LCG rather than Math.random: two renders of the same cue
  // then measure identically, which is what makes ?demo=audio reproducible.
  let seed = 22222;
  for (let i = 0; i < data.length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    data[i] = (seed / 0x3fffffff) - 1;
  }
  noiseBuffers.set(c, buf);
  return buf;
}

// Attack -> two-segment decay -> EXACTLY zero at t0+dur. The final
// linearRamp to 0 is the whole reason a cue has a finite measured length.
function env(c, dest, t0, dur, peak) {
  const g = c.createGain();
  const attack = Math.min(0.008, dur * 0.2);
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(peak, t0 + attack);
  g.gain.linearRampToValueAtTime(peak * 0.22, t0 + attack + (dur - attack) * 0.35);
  g.gain.linearRampToValueAtTime(0, t0 + dur);
  g.connect(dest);
  return g;
}

function tone(c, dest, t0, o) {
  const dur = o.dur;
  const osc = c.createOscillator();
  osc.type = o.type || 'sine';
  const f1 = o.f1 === undefined ? o.f0 : o.f1;
  osc.frequency.setValueAtTime(o.f0, t0);
  if (f1 !== o.f0) osc.frequency.linearRampToValueAtTime(Math.max(1, f1), t0 + dur);
  osc.connect(env(c, dest, t0, dur, o.peak === undefined ? 0.5 : o.peak));
  osc.start(t0);
  osc.stop(t0 + dur);
  return t0 + dur;
}

function noise(c, dest, t0, o) {
  const dur = o.dur;
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c);
  const f = c.createBiquadFilter();
  f.type = o.filter || 'bandpass';
  const f1 = o.f1 === undefined ? o.f0 : o.f1;
  f.frequency.setValueAtTime(o.f0, t0);
  if (f1 !== o.f0) f.frequency.linearRampToValueAtTime(Math.max(20, f1), t0 + dur);
  f.Q.value = o.q === undefined ? 1 : o.q;
  src.connect(f);
  f.connect(env(c, dest, t0, dur, o.peak === undefined ? 0.5 : o.peak));
  src.start(t0);
  src.stop(t0 + dur);
  return t0 + dur;
}

// ---- the cue table ---------------------------------------------------
//
// `build` schedules the cue on `dest` starting at `t0` and returns the time
// it goes silent. `haptic` is the Telegram HapticFeedback style (or
// 'success'/'error' for a notification), resolved in buzz() below.
//
// Every duration here is a hard budget: the longest cue is 340 ms, which
// leaves room for the compressor's lookahead inside the 400 ms ceiling.

const CUES = {
  // A card leaves the hand: soft wooden lift.
  card_pick: {
    build: (c, d, t) => tone(c, d, t, { type: 'triangle', f0: 520, f1: 690, dur: 0.09, peak: 0.34 }),
  },
  // A card lands in a slot: a low body plus a short click of contact.
  card_place: {
    build: (c, d, t) => Math.max(
      tone(c, d, t, { type: 'sine', f0: 190, f1: 92, dur: 0.16, peak: 0.6 }),
      noise(c, d, t, { filter: 'lowpass', f0: 2400, f1: 500, dur: 0.075, peak: 0.34 }),
    ),
  },
  // A placed card goes back to the hand: the same gesture upside down.
  card_return: {
    build: (c, d, t) => tone(c, d, t, { type: 'triangle', f0: 660, f1: 380, dur: 0.13, peak: 0.3 }),
  },
  // An attacker is chosen.
  select: {
    build: (c, d, t) => tone(c, d, t, { type: 'square', f0: 880, dur: 0.055, peak: 0.16 }),
    haptic: 'light',
  },
  // The targeting arc comes up.
  arc_start: {
    build: (c, d, t) => tone(c, d, t, { type: 'sine', f0: 300, f1: 940, dur: 0.14, peak: 0.24 }),
  },
  // The attacker lunges: air moving, no pitch.
  attack_lunge: {
    build: (c, d, t) => noise(c, d, t, { filter: 'bandpass', f0: 500, f1: 2600, q: 0.8, dur: 0.22, peak: 0.42 }),
  },
  // Contact, the player's card survives: bright hit over a deep drop.
  impact_win: {
    build: (c, d, t) => Math.max(
      noise(c, d, t, { filter: 'bandpass', f0: 2200, f1: 700, q: 0.7, dur: 0.3, peak: 0.6 }),
      tone(c, d, t, { type: 'sine', f0: 170, f1: 55, dur: 0.3, peak: 0.7 }),
    ),
    haptic: 'medium',
  },
  // Contact, the player's card dies: same weight, sour falling pitch.
  impact_loss: {
    build: (c, d, t) => Math.max(
      noise(c, d, t, { filter: 'lowpass', f0: 1400, f1: 260, dur: 0.3, peak: 0.55 }),
      tone(c, d, t, { type: 'sawtooth', f0: 220, f1: 68, dur: 0.3, peak: 0.34 }),
    ),
    haptic: 'medium',
  },
  // Contact, both die: two thuds a beat apart.
  impact_draw: {
    build: (c, d, t) => Math.max(
      tone(c, d, t, { type: 'sine', f0: 200, f1: 96, dur: 0.11, peak: 0.6 }),
      tone(c, d, t + 0.11, { type: 'sine', f0: 168, f1: 72, dur: 0.15, peak: 0.55 }),
      noise(c, d, t, { filter: 'lowpass', f0: 1800, f1: 400, dur: 0.26, peak: 0.28 }),
    ),
    haptic: 'medium',
  },
  // The card breaks apart (fx.js's shards).
  destroy: {
    build: (c, d, t) => Math.max(
      noise(c, d, t, { filter: 'highpass', f0: 900, f1: 3200, dur: 0.34, peak: 0.5 }),
      noise(c, d, t, { filter: 'lowpass', f0: 900, f1: 120, dur: 0.22, peak: 0.55 }),
      tone(c, d, t, { type: 'triangle', f0: 130, f1: 44, dur: 0.24, peak: 0.4 }),
    ),
    haptic: 'heavy',
  },
  // A face-down card turns over.
  reveal: {
    build: (c, d, t) => Math.max(
      noise(c, d, t, { filter: 'bandpass', f0: 1600, f1: 3400, q: 1.4, dur: 0.1, peak: 0.26 }),
      tone(c, d, t + 0.05, { type: 'sine', f0: 520, f1: 1180, dur: 0.12, peak: 0.26 }),
    ),
  },
  // An island is garrisoned: a small rising fanfare.
  island_capture: {
    build: (c, d, t) => Math.max(
      tone(c, d, t, { type: 'triangle', f0: 523, dur: 0.1, peak: 0.34 }),
      tone(c, d, t + 0.09, { type: 'triangle', f0: 659, dur: 0.1, peak: 0.34 }),
      tone(c, d, t + 0.18, { type: 'triangle', f0: 784, dur: 0.14, peak: 0.38 }),
    ),
  },
  // The round-end panel appears.
  round_end: {
    build: (c, d, t) => Math.max(
      tone(c, d, t, { type: 'sine', f0: 392, dur: 0.14, peak: 0.34 }),
      tone(c, d, t + 0.13, { type: 'sine', f0: 294, dur: 0.19, peak: 0.34 }),
    ),
  },
  // Match won.
  victory: {
    build: (c, d, t) => Math.max(
      tone(c, d, t, { type: 'triangle', f0: 523, dur: 0.1, peak: 0.36 }),
      tone(c, d, t + 0.08, { type: 'triangle', f0: 659, dur: 0.1, peak: 0.36 }),
      tone(c, d, t + 0.16, { type: 'triangle', f0: 784, dur: 0.1, peak: 0.36 }),
      tone(c, d, t + 0.24, { type: 'triangle', f0: 1047, dur: 0.1, peak: 0.42 }),
    ),
    haptic: 'success',
  },
  // Match lost.
  defeat: {
    build: (c, d, t) => Math.max(
      tone(c, d, t, { type: 'sawtooth', f0: 330, dur: 0.11, peak: 0.24 }),
      tone(c, d, t + 0.1, { type: 'sawtooth', f0: 262, dur: 0.11, peak: 0.24 }),
      tone(c, d, t + 0.2, { type: 'sawtooth', f0: 196, dur: 0.14, peak: 0.28 }),
      tone(c, d, t, { type: 'sine', f0: 110, f1: 66, dur: 0.34, peak: 0.34 }),
    ),
    haptic: 'error',
  },
  // Any button press.
  ui_tap: {
    build: (c, d, t) => noise(c, d, t, { filter: 'bandpass', f0: 2600, q: 1.2, dur: 0.045, peak: 0.3 }),
  },
};

export const CUE_NAMES = Object.keys(CUES);

// ---- haptics ---------------------------------------------------------
//
// Telegram's HapticFeedback when the page is running inside the Telegram
// client, navigator.vibrate everywhere else. Every style is wrapped: older
// Telegram clients expose the object but throw on an unsupported style, and
// a throw here would abort whatever animation step called cue().

const VIBRATE = {
  light: [8],
  medium: [18],
  heavy: [30, 26, 34],
  success: [16, 60, 16],
  error: [40, 50, 40],
};

function tgHaptic() {
  try {
    const app = window.Telegram && window.Telegram.WebApp;
    return (app && app.HapticFeedback) || null;
  } catch (e) {
    return null;
  }
}

function buzz(style) {
  if (!hapticsOn || !style) return;
  const h = tgHaptic();
  if (h) {
    try {
      if (style === 'success' || style === 'error') h.notificationOccurred(style);
      else h.impactOccurred(style);
      return;
    } catch (e) { /* fall through to navigator.vibrate */ }
  }
  try {
    if (navigator.vibrate) navigator.vibrate(VIBRATE[style] || VIBRATE.light);
  } catch (e) { /* no vibration hardware */ }
}

// ---- cue() -----------------------------------------------------------

// Per-cue rate limit. A DRAW destroys both cards, so fx.js calls
// destroySlot() twice in the same frame -- without this that is two
// overlapping shatters and two stacked heavy buzzes.
const MIN_INTERVAL_MS = 60;
const lastAt = new Map();

export function cue(name) {
  const def = CUES[name];
  if (!def) return;
  if (opponentActing && !IMPACT_CUES.has(name)) return;
  const now = Date.now();
  if (now - (lastAt.get(name) || 0) < MIN_INTERVAL_MS) return;
  lastAt.set(name, now);

  buzz(def.haptic);

  if (!soundOn) return;
  // No context yet means no gesture has happened yet -- stay silent rather
  // than creating one off the animation path.
  if (!ctx || !master || ctx.state === 'closed') return;
  // Deliberately NOT gated on state === 'running'. A context is 'suspended'
  // for a moment after construction and after resume() (Safari, and
  // therefore the Telegram client, always), so requiring 'running' would
  // silently swallow the first cue of every session and the first cue after
  // every app switch. Nodes scheduled on a suspended context simply start
  // when it resumes.
  //
  // What that does need is the hidden-tab guard: a backgrounded match keeps
  // running (the AI takes its turn), and without this every cue it queued
  // would fire at once the moment the player came back.
  if (typeof document !== 'undefined' && document.hidden) return;
  try {
    def.build(ctx, master, ctx.currentTime + 0.005);
  } catch (e) { /* a cue must never break the frame that fired it */ }
}

// ---- measurement (?demo=audio) ---------------------------------------
//
// Renders each cue through the SAME master chain offline and reports where
// it actually goes silent. This is the only way to verify the "under
// 400 ms" budget without listening, and it is what the headless screenshot
// pass photographs -- Chrome cannot capture sound.

const RENDER_SECONDS = 0.6;
const SILENCE = 1e-3;

function measure(name) {
  const Ctor = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!Ctor) return Promise.resolve({ name, ms: null, peak: null, error: 'no OfflineAudioContext' });
  const rate = 44100;
  const c = new Ctor(1, Math.ceil(RENDER_SECONDS * rate), rate);
  const dest = buildMaster(c);
  let scheduled = 0;
  try {
    scheduled = CUES[name].build(c, dest, 0);
  } catch (e) {
    return Promise.resolve({ name, ms: null, peak: null, error: String(e) });
  }
  return c.startRendering().then((buf) => {
    const data = buf.getChannelData(0);
    let last = -1;
    let peak = 0;
    for (let i = 0; i < data.length; i++) {
      const v = Math.abs(data[i]);
      if (v > peak) peak = v;
      if (v > SILENCE) last = i;
    }
    return {
      name,
      ms: last < 0 ? 0 : ((last + 1) / rate) * 1000,
      scheduledMs: scheduled * 1000,
      peak,
      haptic: CUES[name].haptic || '',
    };
  }, (e) => ({ name, ms: null, peak: null, error: String(e) }));
}

export function measureAll() {
  // Sequential: sixteen concurrent OfflineAudioContexts is more render
  // threads than some browsers will give out, and the demo is not in a
  // hurry.
  return CUE_NAMES.reduce(
    (chain, name) => chain.then((acc) => measure(name).then((r) => (acc.push(r), acc))),
    Promise.resolve([]),
  );
}

// Debug only (?demo=audio): a plain list of every cue with its measured
// duration, peak and haptic style. Sizes are in px on purpose -- style.css
// sets html{font-size:30px}, so rem units here would render enormous.
export function demoAudio(host) {
  const root = host || document.body;
  const wrap = document.createElement('div');
  wrap.id = 'audio-demo';
  wrap.setAttribute('style', [
    'position:fixed', 'inset:0', 'z-index:9999', 'overflow:auto',
    'background:#0b1622', 'color:#cfe3f2', 'padding:10px 12px',
    'font:400 12px/1.45 system-ui, sans-serif',
  ].join(';'));
  wrap.innerHTML = '<div style="font-weight:700;font-size:14px;margin-bottom:2px">'
    + 'Sea Hunter -- audio cues</div>'
    + '<div style="color:#7f9bb2;font-size:10px;margin-bottom:8px">'
    + 'OfflineAudioContext render at 44100 Hz through the shipped master chain '
    + '(gain 0.6 -&gt; compressor). Budget 400 ms per cue.</div>'
    + '<div id="audio-demo-rows">measuring...</div>';
  root.appendChild(wrap);

  measureAll().then((rows) => {
    const body = rows.map((r) => {
      const ok = r.ms !== null && r.ms <= 400;
      const ms = r.ms === null ? (r.error || 'n/a') : r.ms.toFixed(1) + ' ms';
      const peak = r.peak === null ? '' : r.peak.toFixed(3);
      return '<tr>'
        + `<td style="padding:2px 10px 2px 0;color:#cfe3f2">${r.name}</td>`
        + `<td style="padding:2px 10px 2px 0;text-align:right">${ms}</td>`
        + `<td style="padding:2px 10px 2px 0;text-align:right;color:#7f9bb2">${peak}</td>`
        + `<td style="padding:2px 10px 2px 0;color:#7f9bb2">${r.haptic || '--'}</td>`
        + `<td style="padding:2px 0;color:${ok ? '#6fd08c' : '#e2705f'}">${ok ? 'ok' : 'OVER'}</td>`
        + '</tr>';
    }).join('');
    const el = document.getElementById('audio-demo-rows');
    if (!el) return;
    el.innerHTML = '<table style="border-collapse:collapse;font:400 11px/1.5 monospace">'
      + '<tr style="color:#7f9bb2">'
      + '<td style="padding:2px 10px 2px 0">cue</td>'
      + '<td style="padding:2px 10px 2px 0;text-align:right">measured</td>'
      + '<td style="padding:2px 10px 2px 0;text-align:right">peak</td>'
      + '<td style="padding:2px 10px 2px 0">haptic</td>'
      + '<td style="padding:2px 0">budget</td></tr>'
      + body + '</table>'
      + `<div style="margin-top:8px;color:#7f9bb2;font-size:10px">${rows.length} cues; `
      + `sound ${soundOn ? 'on' : 'off'}, haptics ${hapticsOn ? 'on' : 'off'}; `
      + `storage keys ${SOUND_KEY} / ${HAPTICS_KEY}</div>`;
  });
}
