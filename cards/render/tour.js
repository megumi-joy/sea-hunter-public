// P6 "QA tour": a self-driving walk through every screen of the web game,
// mirroring the Godot client's --ui-tour. Opened with ?tour=1 it starts a
// vs-AI match under a FIXED seed and steps through menu, campaign, online,
// settings, rules, PREP, drag, arc, three attacks, island capture, round
// end, round two, game over and the shop.
//
// Every step announces itself twice: `document.title` becomes
// "tour:<step>", and a `tour:step` CustomEvent is dispatched on `window`
// with { index, name, skipped }. An external driver (tools/webtour.ps1)
// only needs the title -- it polls it over the DevTools protocol and takes
// one PNG per change -- while anything running inside the page (a future
// in-browser recorder, a test harness) can listen for the event instead.
//
// Nothing here is a mock-up. Each step drives the same handlers a tap
// drives: the menu buttons are really clicked, the attacks really go
// through app.js's onOppCardClick, and the capture/round-end/game-over
// screens come out of the engine and the render diff exactly as they do in
// a played match. That is the point of a QA tour -- a shot of a faked
// screen would prove nothing.

import * as Input from './input.js';
import { dismissRoundEnd } from './screens.js';

// How long each screen is held once its title is set, so a driver polling
// the title always catches it. Matches the Godot tour's own dwell.
const HOLD_MS = 1200;

// ---- deterministic RNG ------------------------------------------------
//
// game.js/ai.js/profile.js all use bare Math.random (deal shuffle, who
// moves first, AI tie-breaks, the generated nickname), so a tour run would
// otherwise produce a different board -- and different screenshots -- every
// time. There is no seed parameter to thread through, so under ?tour=1
// only, Math.random is replaced wholesale by a seeded mulberry32. Installed
// at module evaluation time, which is long before DOMContentLoaded deals a
// hand -- nothing in this module graph calls Math.random while it is being
// evaluated, only later from a deal, an AI pick or a generated profile.
// Outside ?tour=1 this module touches nothing at all.

// Chosen by walking seeds until one produced a first round that is worth
// looking at: three player attacks that all land (the AI trades hard enough
// that some deals leave nothing able to attack by the third), and a round
// that ends on a contested island so the capture ceremony and the round-end
// screen both appear.
const DEFAULT_TOUR_SEED = 19;

function params() {
  try {
    return new URLSearchParams(window.location.search);
  } catch (e) {
    return new URLSearchParams('');
  }
}

export function isTourRequested() {
  return params().get('tour') === '1';
}

// `&seed=<n>` picks a different deal. The default is the seed the committed
// reference shots were taken with; overriding it is how you go looking for a
// board that exercises some particular position.
function tourSeed() {
  const raw = parseInt(params().get('seed'), 10);
  return Number.isFinite(raw) ? raw : DEFAULT_TOUR_SEED;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Returns true if the patch was installed. Safe to call more than once.
export function installSeededRandom() {
  if (!isTourRequested() || Math.random.__tourSeeded) return false;
  const next = mulberry32(tourSeed());
  next.__tourSeeded = true;
  Math.random = next;
  return true;
}

installSeededRandom();

// ---- step plumbing ----------------------------------------------------

let stepIndex = 0;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Announce a step without holding -- used where the hold is managed by the
// caller because the shot has to land on a moving frame (the attacks fire,
// then announce a beat later, then hold).
function announce(name) {
  stepIndex += 1;
  document.title = 'tour:' + name;
  window.dispatchEvent(new CustomEvent('tour:step', {
    detail: { index: stepIndex, name, skipped: false },
  }));
}

// The ordinary case: whatever the step shows is already on screen, so
// announce it and hold it still long enough to be captured.
async function step(name, fn) {
  if (fn) await fn();
  announce(name);
  await sleep(HOLD_MS);
}

// A step the web build has no surface for. No title change (so the driver
// takes no shot and the PNG numbering stays honest about what exists), but
// the event still fires with skipped:true so a listener can log the gap.
function skipStep(name, reason) {
  stepIndex += 1;
  window.dispatchEvent(new CustomEvent('tour:step', {
    detail: { index: stepIndex, name, skipped: true, reason },
  }));
  console.log('[tour] skipped ' + name + ': ' + reason);
  // Also parked on the page so a driver that only speaks Runtime.evaluate
  // (tools/webtour.ps1 does) can read the gaps back out at the end of a run
  // and print them next to the PNG list, instead of the run silently being
  // one shot short.
  window.__tourNotes = window.__tourNotes || [];
  window.__tourNotes.push(name + ': ' + reason);
}

function click(id) {
  const el = document.getElementById(id);
  if (el) el.click();
  return !!el;
}

// Poll a predicate. Used instead of fixed sleeps wherever the wait is on
// the game (an AI turn plus its attack animation, the round-end screen
// appearing out of the render diff) rather than on a CSS transition.
async function waitFor(pred, timeoutMs = 8000, everyMs = 80) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (pred()) return true;
    await sleep(everyMs);
  }
  return false;
}

// Freeze the deal. The FLIP entrance is a CSS transition and a headless
// capture's virtual clock advances timers but not transitions, so cards
// left mid-entrance would float across the stage and hide the very thing
// being shot. Same settle() the ?demo= passes in app.js use.
function settle() {
  document.querySelectorAll('#game-screen .card').forEach((el) => {
    el.classList.remove('entering', 'flying');
    el.style.transition = 'none';
    el.style.animation = 'none';
    el.style.transform = '';
    el.style.opacity = '';
  });
}

// ---- the tour ---------------------------------------------------------
//
// `deps` is the same shape of hand-off Input.init() takes: app.js owns
// every rule and handler, this module only decides what to touch and when.
// { store, PHASE, UI, renderAll, startGame, getAttackerSlot,
//   onPlayerCardClick, onOppCardClick, onPlayerReserveClick,
//   handleGameOver, engine: { autoPlace, lockIn, checkRoundEnd } }
async function walk(deps) {
  const { store, PHASE, UI, renderAll, engine } = deps;
  const st = () => store.state;
  // The AI attacks back on a timer and its impact animation holds
  // store.combatLocked -- every "now do the next thing" below waits on
  // this rather than guessing a delay.
  const playerReady = () => !!st() && !store.combatLocked
    && st().phase === PHASE.COMBAT && st().turnOwner === 1;

  // 1. Menu. app.js already showed it; hold it as the opening shot.
  await step('menu');

  // 2-4. The three stand-alone screens, each reached by clicking the very
  // button a player clicks, and left the same way.
  await step('campaign', async () => { click('btn-campaign'); await sleep(400); });
  click('btn-campaign-back');
  await sleep(200);

  await step('online', async () => { click('btn-multiplayer'); await sleep(400); });
  click('btn-mp-back');
  await sleep(200);

  await step('settings', async () => { click('btn-settings'); await sleep(400); });
  // P10 fix 4 put telemetry, the install id and the legal links behind an
  // "Advanced" disclosure that is collapsed by default -- which is the
  // point, and also means the frame above can no longer show any of it. A
  // second frame with the block open is what makes the segmented controls,
  // the id chip and the link buttons checkable on a QA sheet at all.
  await step('settings-advanced', async () => {
    const summary = document.querySelector('#settings-modal .settings-disclosure');
    if (summary) summary.click();
    await sleep(400);
  });
  click('btn-close-settings');
  await sleep(200);

  // 4b-4c. Leaderboard and profile. Added in P9: the art-director pass
  // restyled both, and neither was reachable on a tour frame before, so
  // there was no way to check them without driving the app by hand.
  // The leaderboard fetches from the server, so what a local QA run
  // captures is its empty/offline state -- which is the state that has to
  // look deliberate rather than broken.
  // Two local rows first. A tour profile is brand new, so the board would
  // otherwise only ever capture its empty state -- which is worth a frame,
  // but not the only frame, since the medal rows are the part with a design
  // to check. Written straight to leaderboard.js's own localStorage key
  // (this Chrome profile is thrown away after the pass -- see the
  // --user-data-dir note in tools/webtour.ps1).
  try {
    window.localStorage.setItem('seahunter_local_scores', JSON.stringify([
      { name: 'Salty Dog#MR29', score: 9, avatar: 'kraken', ts: Date.now() },
      { name: 'Captain AI#BOT', score: 6, avatar: 'skull', ts: Date.now() - 1 },
      { name: 'Deckhand#TIDE', score: 3, avatar: 'gull', ts: Date.now() - 2 },
    ]));
  } catch (e) { /* private mode -- the empty state is then what gets shot */ }
  await step('leaderboard', async () => { click('btn-leaderboard'); await sleep(600); });
  click('btn-close-leaderboard');
  await sleep(200);

  await step('profile', async () => { click('btn-profile'); await sleep(400); });
  click('btn-profile-back');
  await sleep(200);

  // 5. Feedback (P8). The form is the same modal the pause overlay, the
  // Settings sheet and the game-over screen all open -- reached here
  // through app.js's own entry point, with the live context attached.
  if (deps.p8 && deps.p8.openFeedback) {
    await step('feedback', async () => { deps.p8.openFeedback(); await sleep(300); });
    const cancel = document.getElementById('btn-fb-cancel');
    if (cancel) cancel.click();
    await sleep(200);
  } else {
    skipStep('feedback', 'the build did not hand the tour a feedback entry point');
  }

  // 5b. The first-launch telemetry consent dialog. ?tour=1 forces the mode
  // to off and suppresses the dialog (a QA run must neither send anything
  // nor be interrupted), so it is opened explicitly here and declined --
  // declining is also what leaves the rest of the tour recording nothing.
  if (deps.p8 && deps.p8.Telemetry) {
    await step('consent', async () => { deps.p8.Telemetry.openConsent(); await sleep(300); });
    click('btn-consent-decline');
    await sleep(200);
  } else {
    skipStep('consent', 'the build did not hand the tour the telemetry module');
  }

  // 6. Rules. #rules-modal is a page-level overlay, so it opens over the
  // menu exactly as it does over the board.
  await step('rules', async () => { click('btn-rules'); await sleep(400); });
  click('btn-close-rules');
  await sleep(200);

  // 7. PREP with the hand fanned -- a real vs-AI match off the fixed seed.
  await step('prep', async () => {
    deps.startGame();
    await sleep(600);
    settle();
  });

  // 7b. Pause (P8). #btn-pause opens over the live stage, which is the only
  // place it is ever seen -- so it is shot here, on a dealt PREP board,
  // rather than over the menu. Resumed the way a player resumes it.
  if (deps.p8 && deps.p8.Pause) {
    await step('pause', async () => { click('btn-pause'); await sleep(300); });
    click('btn-pause-resume');
    await sleep(200);
  } else {
    skipStep('pause', 'the build did not hand the tour the pause module');
  }

  // 8. Mid-drag: a hand card lifted over a legal, highlighted slot. This is
  // the genuine transient gesture state (render/input.js owns it), parked
  // rather than mocked.
  await step('drag', async () => { Input.demoDrag(); await sleep(200); });

  // 9. Targeting arc. Place the board for real, lock in, then select an
  // attacker through the ordinary tap handler so the shot shows the true
  // selection + legal-target highlighting under the arc. autoPlace/lockIn
  // also clear the parked drag above, since the hand is dealt out into the
  // zones and re-rendered from scratch.
  await step('arc', async () => {
    engine.autoPlace(st(), 1);
    engine.lockIn(st());
    st().turnOwner = 1;
    renderAll();
    settle();
    // A Mine may not attack and onPlayerCardClick refuses to select one, so
    // pick with the same predicate the attack loop below uses -- otherwise
    // the arc would be drawn with nothing selected under it.
    const first = st().p1Front.findIndex((c) => c && c.def.id !== 'mine');
    if (first >= 0) deps.onPlayerCardClick(first, st().p1Front[first]);
    Input.demoArc();
    await sleep(200);
  });

  // 10-12. Three attacks. render/fx.js's timeline puts contact at 220 ms and
  // runs the callout/shards out to 900 ms, so each attack is fired first and
  // the title flipped ~260 ms later: the driver's shot then lands on the
  // impact beat instead of on the settled board. Between attacks we wait out
  // the AI's reply (it holds store.combatLocked for its own animation)
  // rather than guessing a delay.
  //
  // The AI trades pieces off, so the player's Front can run out of anything
  // that may attack (a Mine never can) while Reserve is still full. That is
  // an ordinary board position, not a dead end: promote a Reserve card the
  // same way a tap does and carry on. The promotion costs the turn, hence
  // the retry budget rather than a plain three-iteration loop.
  let attacks = 0;
  let stopped = '';
  // Slots whose attack the engine turned down (a card with a "cannot
  // attack" rule of its own). Remembered so a refusal moves on to the next
  // attacker instead of re-offering the same one until the budget runs out.
  const refused = new Set();
  for (let tries = 0; tries < 10 && attacks < 3; tries++) {
    if (!(await waitFor(playerReady, 12000))) {
      stopped = 'the match left the player-on-turn COMBAT state (phase '
        + (st() ? st().phase : 'none') + ')';
      break;
    }
    // Only the enemy frontline is ever attacked (an empty one ends the round).
    const row = st().p2Front;
    const defSlot = row.findIndex(Boolean);
    if (defSlot < 0) { stopped = 'the opponent had no card left to attack'; break; }
    const atkSlot = st().p1Front.findIndex(
      (c, i) => c && c.def.id !== 'mine' && !refused.has(i));
    if (atkSlot < 0) {
      const spare = st().p1Reserve.findIndex((c) => c && c.def.id !== 'mine');
      if (spare < 0) { stopped = 'the player had nothing left that may attack'; break; }
      deps.onPlayerReserveClick(spare, st().p1Reserve[spare]);
      continue;
    }
    // Selecting an ALREADY-selected slot is app.js's deselect toggle, and
    // the arc step above leaves the first attacker selected -- so re-clicking
    // it here would silently drop the selection and the following target
    // click would do nothing at all. Only select when it is not already the
    // chosen attacker.
    if (deps.getAttackerSlot() !== atkSlot) {
      deps.onPlayerCardClick(atkSlot, st().p1Front[atkSlot]);
    }
    deps.onOppCardClick('front', defSlot, row[defSlot]);
    // doAttack sets store.combatLocked synchronously, before its first
    // await, exactly when it has a real attack to animate -- so this is a
    // check that there IS an effect to photograph, not a hope that there is.
    if (!store.combatLocked) {
      refused.add(atkSlot);
      stopped = 'every remaining attacker was refused by the engine';
      continue;
    }
    attacks += 1;
    stopped = '';
    // render/fx.js puts contact at 220 ms and runs the callout out to
    // 900 ms; announcing here lands the driver's shot on the impact.
    await sleep(260);
    announce('attack-' + attacks);
    await sleep(HOLD_MS);
  }
  for (let n = attacks + 1; n <= 3; n++) {
    skipStep('attack-' + n, stopped || 'the attack budget ran out');
  }

  // 13. Island capture. Clear what is left of the opponent's board and let
  // the engine resolve the round: checkRoundEnd() puts the match in the
  // ISLAND_CAPTURE phase, where the board waits on the player to pick which
  // survivor garrisons the island. THAT prompt is the shot -- the ceremony
  // that follows the pick is over in a few frames and lands on an already
  // re-dealt round two, while the spoils themselves are on the round-end
  // screen in the next step.
  await waitFor(() => !!st() && !store.combatLocked, 8000);
  await step('island-capture', async () => {
    const s = st();
    s.p2Front = s.p2Front.map(() => null);
    s.p2Reserve = s.p2Reserve.map(() => null);
    UI.setStatus(engine.checkRoundEnd(s) || '');
    renderAll();
    settle();
    await sleep(150);
  });
  // ...then garrison, which is what the shot above is the prompt for. Not
  // every survivor may garrison (Mine / Landing Craft / Coastal Artillery
  // may not -- game.js owns that rule), so walk the Front until the engine
  // accepts one, then the Reserve: after three attacks the Front is
  // routinely down to Mines while the Reserve is untouched, and Reserve
  // cards garrison too (app.js's onPlayerReserveClick routes an
  // ISLAND_CAPTURE click straight to doCaptureIsland).
  for (let slot = 0; slot < st().p1Front.length; slot++) {
    if (st().phase !== 'ISLAND_CAPTURE') break;
    const card = st().p1Front[slot];
    if (card) deps.onPlayerCardClick(slot, card);
  }
  for (let slot = 0; slot < st().p1Reserve.length; slot++) {
    if (st().phase !== 'ISLAND_CAPTURE') break;
    const card = st().p1Reserve[slot];
    if (card) deps.onPlayerReserveClick(slot, card);
  }

  // 14. Round-end screen -- raised by the same render diff once the
  // ceremony finishes, so wait for it rather than assuming a delay. It
  // auto-continues after 4 s, which is longer than the hold.
  const sawRoundEnd = await waitFor(() => document.getElementById('round-end-screen'), 6000);
  if (sawRoundEnd) {
    await step('round-end');
    dismissRoundEnd();
  } else {
    skipStep('round-end', 'the round did not end on a contested island this run');
  }
  await sleep(300);

  // 15. Round two: a fresh PREP with a new hand, the score carried over and
  // the captured island now sitting in the player's strip.
  await step('round-2', async () => { renderAll(); await sleep(400); settle(); });

  // 16. Game over. Set the finishing phase and go through app.js's real
  // handleGameOver, so the rewards line on the shot is whatever economy.js
  // actually pays for this result -- not a placeholder.
  await step('game-over', async () => {
    const s = st();
    s.winReason = 'points';
    s.phase = PHASE.GAME_OVER;
    deps.handleGameOver(s);
    await sleep(500);
  });

  // 17. Shop, entered by its button on the game-over modal -- the
  // route a player actually takes to spend what the match just paid.
  await step('shop', async () => { click('btn-go-shop'); await sleep(400); });

}

// A tour that threw would otherwise leave the driver polling a title that
// never changes again for its whole budget, with nothing to explain the
// short run. Record the failure where the driver already looks, then raise
// the terminal signal either way.
export async function run(deps) {
  try {
    await walk(deps);
  } catch (err) {
    skipStep('remaining-steps',
      'the tour threw: ' + ((err && err.message) ? err.message : String(err)));
  }
  announce('done');
}
