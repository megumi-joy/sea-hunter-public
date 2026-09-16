// Sea Hunter -- phase P12 "Living board", part 1: the stage is a PLACE.
//
// Up to P10 the match sat on one flat `--sea-gradient`. This module paints
// an actual ocean behind the board: three wave bands drifting at different
// speeds, a horizon glow that walks dawn -> day -> dusk -> night as the
// rounds go by, two slow cloud shadows, and a foam line breaking against
// the frontline plank.
//
// Rules this file holds itself to -- the whole thing has a ~2% phone CPU
// budget, so they are not style preferences:
//
//   * TRANSFORM AND OPACITY ONLY. Every moving part is a CSS keyframe
//     animating translate/opacity, which the compositor runs off the main
//     thread. No background-position, no filter, no blur, no box-shadow
//     animation, no <canvas>, no JS per-frame loop of any kind.
//   * SEVEN animated layers, total, for the whole ocean (3 waves, 2 clouds,
//     2 foam). That is the number the budget was measured at; adding an
//     eighth is a measurement, not a free decision.
//   * `will-change: transform` on the three wave bands ONLY. Putting it on
//     all seven promoted enough layers to cost more than it saved.
//   * Nothing here is ever read back. No getBoundingClientRect, no
//     getComputedStyle, so the ocean can never force a layout pass on the
//     board it sits behind.
//
// Stacking (render/stage.css carries the rules):
//   `.stage` is `display: grid` with seven explicit rows, so the ocean can
//   NOT be a flow child -- it would become an eighth row and shove the hand
//   off the bottom. It is `position: absolute; inset: 0; z-index: -1`, and
//   `.stage` has `isolation: isolate` so that -1 stays inside the stage's
//   own stacking context (on top of the stage's background, underneath every
//   non-positioned grid item) instead of falling through to #game-screen.
//
// Pausing:
//   * prefers-reduced-motion: reduce -- handled entirely in CSS
//     (`animation: none`), so there is no frame where motion is visible.
//     The layers stay, as still art.
//   * tab hidden -- `visibilitychange` puts `.ocean-paused` on the root,
//     which is `animation-play-state: paused`. Resuming is deferred to one
//     requestAnimationFrame so the un-pause lands on a frame boundary
//     rather than mid-composite. A permanent rAF poll is deliberately NOT
//     used: a 60 Hz JS loop whose only job is to notice idleness would
//     itself spend more of the budget than the animations it guards.
//
// Debug: `?ocean=0` skips mounting entirely. That is how the CPU cost of
// this file is isolated in a measurement pass -- it is never set by the game.

const QUERY = new URLSearchParams(window.location.search);
const ENABLED = QUERY.get('ocean') !== '0';

// P13 debug: `?round=<n>` pins the time of day to what round n would show
// (`?round=4` is night), and `?tod=dawn|day|dusk|night` pins it by name.
// Only the LIGHT is pinned -- the match, the HUD's round counter and every
// rule keep running on the real round. Exists so a screenshot pass can shoot
// a night board without playing three rounds first. Never set by the game.
const FORCED_TOD = (() => {
  const named = QUERY.get('tod');
  if (named && ['dawn', 'day', 'dusk', 'night'].includes(named)) return named;
  const r = parseInt(QUERY.get('round'), 10);
  return Number.isFinite(r) && r > 0 ? timeOfDay(r) : null;
})();

// Round -> time of day. Round 4 and everything after it is night: a ten
// round match would otherwise spend six rounds cycling through weather
// nobody asked for, and "it got dark and stayed dark" is the arc.
function timeOfDay(round) {
  const r = Number(round) || 1;
  if (r <= 1) return 'dawn';
  if (r === 2) return 'day';
  if (r === 3) return 'dusk';
  return 'night';
}

let root = null;      // the .ocean element
let currentTod = null;

function svgNS(name) { return document.createElementNS('http://www.w3.org/2000/svg', name); }

// One wave band. The <svg> is 200% of the stage wide and holds TWO copies of
// the same crest, one period apart; translating it left by exactly half its
// own width therefore loops seamlessly with a single keyframe and no
// background-position anywhere.
//
// `preserveAspectRatio="none"` lets one path shape serve all three bands at
// three different heights -- the squash is the point, it is what makes the
// far band read as further away.
function waveBand(cls, fill, opacity) {
  const band = document.createElement('div');
  band.className = 'ocean-band ' + cls;
  const svg = svgNS('svg');
  svg.setAttribute('viewBox', '0 0 240 40');
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const path = svgNS('path');
  // Two periods of 120 units each, closed down to the baseline so the band
  // is a filled swell rather than a hairline.
  path.setAttribute('d',
    'M0 22 C 20 10, 40 10, 60 22 S 100 34, 120 22'
    + ' S 160 10, 180 22 S 220 34, 240 22 L240 40 L0 40 Z');
  path.setAttribute('fill', fill);
  path.setAttribute('opacity', String(opacity));
  svg.appendChild(path);
  band.appendChild(svg);
  return band;
}

function divWith(cls) {
  const el = document.createElement('div');
  el.className = cls;
  return el;
}

function build() {
  const el = divWith('ocean');
  el.setAttribute('aria-hidden', 'true');

  // 1. Horizon. Four stacked gradient sheets, cross-faded by OPACITY --
  //    a background-image transition is not interpolable and would hard-cut.
  ['dawn', 'day', 'dusk', 'night'].forEach((tod) => {
    el.appendChild(divWith('ocean-sky ocean-sky-' + tod));
  });

  // 2. Weather, under the waves: two wide, very soft dark ellipses crossing
  //    the stage on their own long cycles. Cloud SHADOWS, not clouds -- the
  //    camera is looking down at water.
  el.appendChild(divWith('ocean-cloud ocean-cloud-a'));
  el.appendChild(divWith('ocean-cloud ocean-cloud-b'));

  // 3. Three wave bands, far to near. Parallax is the whole illusion: the
  //    far band is slowest and palest, the near one fastest and strongest.
  el.appendChild(waveBand('ocean-band-far', '#bfe6ff', 0.30));
  el.appendChild(waveBand('ocean-band-mid', '#8fcdf5', 0.36));
  el.appendChild(waveBand('ocean-band-near', '#4f9ed0', 0.46));

  return el;
}

// The foam lives in the centre band, not in the ocean root: it has to break
// against the frontline PLANK, and the plank is a grid row whose position
// the ocean layer has no way to know without measuring (which it may not
// do). Two children of `.centre-band`, one per long edge.
function mountFoam(stage) {
  const band = stage.querySelector('.centre-band');
  if (!band || band.querySelector('.ocean-foam')) return;
  ['ocean-foam-top', 'ocean-foam-bottom'].forEach((cls) => {
    const foam = divWith('ocean-foam ' + cls);
    foam.setAttribute('aria-hidden', 'true');
    band.appendChild(foam);
  });
}

function stageEl() { return document.querySelector('#game-screen .stage'); }

// Idempotent: safe to call from every render pass.
export function mount() {
  if (!ENABLED) return null;
  const stage = stageEl();
  if (!stage) return null;
  if (!root || !root.isConnected) {
    root = stage.querySelector(':scope > .ocean');
    if (!root) {
      root = build();
      // First child, so it is the first thing painted inside the stage.
      stage.insertBefore(root, stage.firstChild);
    }
    if (currentTod) root.dataset.tod = currentTod;
  }
  mountFoam(stage);
  return root;
}

// Called from ui.js's updateHUD, which runs on every renderAll -- so this is
// edge-triggered on the time of day rather than on the round number, and a
// render that changed nothing writes nothing.
export function setRound(round) {
  const tod = FORCED_TOD || timeOfDay(round);
  // P13: the stage carries the time of day too, for the wash that lies over
  // the board rows (render/stage.css). Written before the ocean mount check
  // so `?ocean=0` -- the CPU measurement pass -- still gets the light.
  const stage = stageEl();
  if (stage && stage.dataset.tod !== tod) stage.dataset.tod = tod;
  if (!mount()) return;
  if (tod === currentTod) return;
  currentTod = tod;
  root.dataset.tod = tod;
}

// A new match rewinds to dawn. Called from ui.js's hideGameOver, alongside
// the other per-match resets.
export function reset() {
  currentTod = null;
  setRound(1);
}

// ---- pausing ---------------------------------------------------------

let resumeRaf = 0;

function applyHidden(hidden) {
  if (!root) return;
  if (hidden) {
    if (resumeRaf) { cancelAnimationFrame(resumeRaf); resumeRaf = 0; }
    root.classList.add('ocean-paused');
    return;
  }
  if (resumeRaf) return;
  resumeRaf = requestAnimationFrame(() => {
    resumeRaf = 0;
    if (root) root.classList.remove('ocean-paused');
  });
}

document.addEventListener('visibilitychange', () => applyHidden(document.hidden));
