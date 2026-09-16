// UI rendering -- DOM, card elements, animations.
import { PHASE } from './game.js';
import { CARDS, CARD_ORDER, IMPACT } from './cards.js';
import { ISLANDS, getIslandDef } from './islands.js';
import { ARTIFACTS } from './artifacts.js';
import { AVATARS as LB_AVATARS } from './profile.js';
// Card visuals live in render/ (phase P1) so the parallel scene/layout pass
// can own index.html + style.css without conflicting here. ui.js keeps state,
// events and animations; these only build markup.
import { decorate as decorateCard, faceHtml, backHtml, titleFor, thumbHtml, roleOf } from './render/cards.js';
import { icon } from './icons.js';
// Combat juice (phase P3). Every animation below is a thin forward into this
// module -- the four exported names and signatures are unchanged, so app.js
// and multiplayer.js keep working untouched.
import * as FX from './render/fx.js';
// Islands and results (phase P4). Island markup, the captured-island chips,
// the capture ceremony and the round-end / game-over screens live in
// render/islands.js + render/screens.js; renderIslands() and showGameOver()
// below are thin forwards, so app.js and multiplayer.js keep their calls.
import * as Islands from './render/islands.js';
import * as Screens from './render/screens.js';
// Shell screens (phase P7). Markup for everything outside the match --
// menu logo, campaign chart nodes, settings toggles, shop cards,
// leaderboard rows, avatar discs. Same forwarding shape as the modules
// above: the exported function names app.js calls are unchanged.
import * as Shell from './render/shell.js';
// P8: the screen event. A no-op unless the player chose a recording mode.
import * as Telemetry from './render/telemetry.js';
// P12 "Living board": the animated ocean behind the stage. Mounts itself on
// the first setRound() and owns its own pausing -- ui.js only ever tells it
// which round we are in.
import * as Ocean from './render/ocean.js';

const $ = id => document.getElementById(id);

const DOM = {
  loading: $('loading-screen'), menu: $('main-menu'), game: $('game-screen'),
  campaignScreen: $('campaign-screen'),
  roundInfo: $('round-info'), scoreInfo: $('score-info'), phaseLabel: $('phase-label'),
  statusText: $('status-text'),
  oppName: $('opp-name'), oppAvatar: $('opp-avatar'),
  oppReserve: $('opp-reserve'), oppFront: $('opp-front'), oppHand: $('opp-hand'),
  playerFront: $('player-front'), playerReserve: $('player-reserve'),
  playerHand: $('player-hand'),
  btnAuto: $('btn-auto'), btnReady: $('btn-ready'), btnPause: $('btn-pause'),
  btnRules: $('btn-rules'), btnCloseRules: $('btn-close-rules'),
  rulesModal: $('rules-modal'), matrixTable: $('matrix-table'),
  goModal: $('game-over-modal'), goIcon: $('go-icon'), goTitle: $('go-title'),
  goScore: $('go-score'), goRounds: $('go-rounds'), goCampaignNote: $('go-campaign-note'),
  btnPlayAgain: $('btn-play-again'), btnBackMenu: $('btn-back-menu'), btnGoLeaderboard: $('btn-go-leaderboard'),
  combatLog: $('combat-log'), logEntries: $('log-entries'),
  impactOverlay: $('impact-overlay'),
  btnCampaign: $('btn-campaign'), btnCampaignBack: $('btn-campaign-back'), campaignLevels: $('campaign-levels'),
  campaignCaption: $('campaign-caption'),
  btnLeaderboard: $('btn-leaderboard'), leaderboardModal: $('leaderboard-modal'),
  btnCloseLeaderboard: $('btn-close-leaderboard'), leaderboardList: $('leaderboard-list'),
  lbTabLocal: $('lb-tab-local'), lbTabRemote: $('lb-tab-remote'),
  btnReference: $('btn-reference'), referenceModal: $('reference-modal'),
  btnCloseReference: $('btn-close-reference'), referenceContent: $('reference-content'),
  btnSettings: $('btn-settings'), settingsModal: $('settings-modal'),
  btnShop: $('btn-shop'), shopScreen: $('shop-screen'), btnShopBack: $('btn-shop-back'),
  shopItems: $('shop-items'), shopBalance: $('shop-balance'), shopHold: $('shop-hold'),
  railBalance: $('rail-balance'),
  goReward: $('go-reward'), btnGoShop: $('btn-go-shop'),
  btnCloseSettings: $('btn-close-settings'), settingsContent: $('settings-content'),
  profileScreen: $('profile-screen'), btnProfile: $('btn-profile'), btnProfileSave: $('btn-profile-save'),
  btnProfileBack: $('btn-profile-back'), profileNick: $('profile-nick'), profileTag: $('profile-tag'),
  avatarGrid: $('avatar-grid'), profilePreview: $('profile-preview'), profileError: $('profile-error'),
  menuAvatar: $('menu-avatar'), menuHandle: $('menu-handle'),
  voyageScreen: $('voyage-screen'), voyageChart: $('voyage-chart'), voyageHud: $('voyage-hud'),
  voyageLog: $('voyage-log'), voyageLegend: $('voyage-legend'), btnVoyageBack: $('btn-voyage-back'),
  btnMultiplayer: $('btn-multiplayer'), mpScreen: $('mp-screen'), btnMpBack: $('btn-mp-back'),
  mpRoom: $('mp-room'), mpName: $('mp-name'), btnMpJoin: $('btn-mp-join'), mpError: $('mp-error'), btnMpBot: $('btn-mp-bot'),
};

function showScreen(name) {
  // P8 telemetry: the one place every screen change goes through, so the
  // `screen` gameplay event is raised here rather than at a dozen call
  // sites. track() is a no-op unless a recording mode is active.
  Telemetry.gameplay('screen', { screen: name });
  [DOM.loading, DOM.menu, DOM.game, DOM.campaignScreen, DOM.shopScreen, DOM.mpScreen, DOM.voyageScreen, DOM.profileScreen].forEach(s => s && s.classList.add('hidden'));
  if (name === 'loading') DOM.loading.classList.remove('hidden');
  if (name === 'menu') DOM.menu.classList.remove('hidden');
  if (name === 'game') DOM.game.classList.remove('hidden');
  if (name === 'campaign') DOM.campaignScreen && DOM.campaignScreen.classList.remove('hidden');
  if (name === 'shop') DOM.shopScreen && DOM.shopScreen.classList.remove('hidden');
  if (name === 'multiplayer') DOM.mpScreen && DOM.mpScreen.classList.remove('hidden');
  if (name === 'voyage') DOM.voyageScreen && DOM.voyageScreen.classList.remove('hidden');
  if (name === 'profile') DOM.profileScreen && DOM.profileScreen.classList.remove('hidden');
}

// Room-code join form. Both players type the same code; a player left alone
// gets a server-side bot after a few seconds, so the screen never dead-ends.
// Voyage chart -- the map INSIDE one campaign mission. Same drawing approach
// as the campaign chart (inline SVG sea, HTML nodes on top), but the nodes are
// destinations the fleet sails between, and only the ones linked to the
// current position can be entered.
const VOYAGE_GLYPH = {
  port:  '<span class="vn-port"></span>',
  fleet: '<span class="vn-fleet"></span>',
  cache: '<span class="vn-cache"></span>',
  storm: '<span class="vn-storm"></span>',
  goal:  '<span class="vn-goal"></span>',
};

export function renderVoyage(chart, info, onSail) {
  if (!DOM.voyageChart) return;
  DOM.voyageChart.innerHTML = '';
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('class', 'campaign-map');
  svg.innerHTML = `
    <defs><linearGradient id="voyage-sea" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#3d93c7"/><stop offset="55%" stop-color="#1b6ca8"/><stop offset="100%" stop-color="#0f4c81"/>
    </linearGradient></defs>
    <rect width="100" height="100" fill="url(#voyage-sea)"/>`;

  const at = chart.nodes.find((n) => n.id === chart.shipAt);
  chart.nodes.forEach((n) => {
    n.links.forEach((id) => {
      const t = chart.nodes.find((x) => x.id === id);
      if (!t) return;
      const lane = document.createElementNS(NS, 'path');
      lane.setAttribute('d', `M${n.x} ${n.y} L${t.x} ${t.y}`);
      const open = at && n.id === at.id;
      lane.setAttribute('class', 'voyage-lane' + (open ? ' open' : '') + (n.visited && t.visited ? ' sailed' : ''));
      svg.appendChild(lane);
    });
  });
  DOM.voyageChart.appendChild(svg);

  chart.nodes.forEach((n) => {
    const reachable = at && at.links.includes(n.id);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'voyage-node ' + n.kind
      + (n.visited ? ' visited' : '')
      + (n.cleared ? ' cleared' : '')
      + (reachable ? ' reachable' : '')
      + (n.id === chart.shipAt ? ' here' : '');
    btn.style.left = n.x + '%';
    btn.style.top = n.y + '%';
    btn.disabled = !reachable;
    btn.title = (info[n.kind] && info[n.kind].title) || n.kind;
    btn.innerHTML = VOYAGE_GLYPH[n.kind] || '';
    if (reachable && onSail) btn.addEventListener('click', () => onSail(n.id));
    DOM.voyageChart.appendChild(btn);
  });

  if (at) {
    const ship = document.createElement('div');
    ship.className = 'map-ship voyage-ship';
    ship.style.left = at.x + '%';
    ship.style.top = at.y + '%';
    DOM.voyageChart.appendChild(ship);
  }
}

// Without this the chart is a row of coloured shapes: nothing on screen says
// a red circle is a fight and a yellow diamond is salvage.
export function renderVoyageLegend() {
  if (!DOM.voyageLegend) return;
  DOM.voyageLegend.innerHTML = `
    <span class="vl"><span class="vn-fleet"></span>Enemy fleet</span>
    <span class="vl"><span class="vn-cache"></span>Cache</span>
    <span class="vl"><span class="vn-port"></span>Port</span>
    <span class="vl"><span class="vn-storm"></span>Storm</span>
    <span class="vl"><span class="vn-goal"></span>Objective</span>`;
}

export function renderVoyageHud(chart) {
  if (!DOM.voyageHud) return;
  DOM.voyageHud.innerHTML = `
    <span class="vh-name">${chart.name}</span>
    <span class="vh-stat">Moves ${chart.movesLeft} / ${chart.movesTotal}</span>
    <span class="vh-stat">Gold ${chart.gold}</span>`;
}

export function setVoyageLog(msg) {
  if (DOM.voyageLog) DOM.voyageLog.textContent = msg || '';
}

// P7: profile.js's AVATARS still carry an `emoji` field -- it is the
// persisted identity and rewriting it would invalidate stored profiles and
// leaderboard rows already on the server -- but it is no longer rendered.
// render/shell.js maps the avatar id to an inline SVG instead.
function avatarDiscHtml(avatar, size) {
  return Shell.avatarDisc(avatar, size || '');
}

export function renderProfileScreen(profile, avatars, avatarOf, onPick) {
  if (!DOM.profileNick) return;
  DOM.profileNick.value = profile.nick;
  DOM.profileTag.value = profile.tag;
  if (DOM.profileError) DOM.profileError.textContent = '';
  const current = avatarOf(profile);
  if (DOM.profilePreview) {
    DOM.profilePreview.innerHTML = `${avatarDiscHtml(current, 'big')}<span class="profile-handle">${profile.nick}#${profile.tag}</span>`;
  }
  if (DOM.avatarGrid) {
    DOM.avatarGrid.innerHTML = '';
    avatars.forEach((a) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'avatar-choice' + (a.id === profile.avatarId ? ' picked' : '');
      btn.innerHTML = avatarDiscHtml(a);
      btn.addEventListener('click', () => onPick(a.id));
      DOM.avatarGrid.appendChild(btn);
    });
  }
}

export function setProfileError(msg) {
  if (DOM.profileError) DOM.profileError.textContent = msg || '';
}

// The menu button doubles as the identity badge, so the player always sees
// who the game thinks they are before entering a match.
export function renderMenuProfile(profile, avatar) {
  if (DOM.menuAvatar) DOM.menuAvatar.innerHTML = avatarDiscHtml(avatar, 'small');
  if (DOM.menuHandle) DOM.menuHandle.textContent = `${profile.nick}#${profile.tag}`;
}

export function renderMultiplayer(onJoin) {
  if (!DOM.btnMpJoin) return;
  if (DOM.mpError) DOM.mpError.textContent = '';
  DOM.btnMpJoin.onclick = () => onJoin(DOM.mpRoom ? DOM.mpRoom.value : '', DOM.mpName ? DOM.mpName.value : '');
}

export function setMultiplayerError(msg) {
  if (DOM.mpError) DOM.mpError.textContent = msg || '';
}

// Shown only while seated alone in a waiting room -- the moment an opponent
// exists (human or requested bot) the choice is gone.
export function setBotButtonVisible(on) {
  if (DOM.btnMpBot) DOM.btnMpBot.classList.toggle('hidden', !on);
}

function setStatus(msg) { DOM.statusText.textContent = msg; }

function updateHUD(state) {
  if (!state) return;
  // P0 stage: the top bar is 44px tall, so these three strings are kept
  // short enough to sit on one line each. The long "PREP -- place your
  // cards" style prompt now lives in the centre band's turn banner
  // (#status-text), which app.js already writes to.
  DOM.roundInfo.textContent = `R${state.roundNum}/10`;
  // P12: the light on the water walks dawn -> day -> dusk -> night with the
  // round. Called from here rather than from app.js so a multiplayer round
  // advance -- which reaches the board through this same renderAll -- turns
  // the sky over exactly like a single-player one. Edge-triggered inside
  // ocean.js, so a render that changed nothing writes nothing.
  Ocean.setRound(state.roundNum);
  const target = state.pointsToWin || 3;
  // P0.1: the "(first to N)" tail is a CSS ::after on data-target
  // (render/stage.css) so the landscape top bar can drop it; P3: the digits
  // live in one-digit-tall masks built by FX.ensureScoreChip so a change can
  // roll instead of popping. scoreChanged() is edge-triggered.
  DOM.scoreInfo.dataset.target = target;
  FX.ensureScoreChip(DOM.scoreInfo, state.score[0], state.score[1], '');
  FX.scoreChanged(DOM.scoreInfo, state.score[0], state.score[1]);

  let phaseText = '';
  if (state.phase === PHASE.PREP) phaseText = 'PREP';
  else if (state.phase === PHASE.COMBAT) phaseText = state.turnOwner === 1 ? 'YOUR TURN' : 'OPPONENT';
  else if (state.phase === PHASE.ISLAND_CAPTURE) phaseText = 'ISLAND CAPTURE';
  else if (state.phase === PHASE.GAME_OVER) phaseText = 'GAME OVER';
  DOM.phaseLabel.textContent = phaseText;

  // P3 turn banner. Also edge-triggered inside FX (this runs on every
  // render), and deliberately placed here rather than in app.js so a
  // multiplayer turn handover -- which reaches the board through the same
  // renderAll -- announces itself the same way an AI handover does.
  FX.turnChanged(state.phase, state.turnOwner, DOM.phaseLabel);

  // Opponent strip identity. No seat name exists in the engine state
  // (game.js never carries one), so `state.oppName` is an optional field a
  // future multiplayer seat can set; until then it falls back to the
  // difficulty-labelled AI captain.
  const oppName = state.oppName || ['', 'Deckhand AI', 'Captain AI', 'Admiral AI'][state.difficulty] || 'Captain AI';
  if (DOM.oppName) DOM.oppName.textContent = oppName;
  if (DOM.oppAvatar && !DOM.oppAvatar.textContent) DOM.oppAvatar.textContent = oppName.charAt(0).toUpperCase();

  if (DOM.btnReady) DOM.btnReady.classList.toggle('hidden', state.phase !== PHASE.PREP);
  if (DOM.btnAuto) DOM.btnAuto.classList.toggle('hidden', state.phase !== PHASE.PREP);
  const btnSkip = document.getElementById('btn-skip');
  if (btnSkip) btnSkip.classList.toggle('hidden', !(state.phase === PHASE.COMBAT && state.turnOwner === 1));
}

// ── Card rendering ──────────────────────────────────────────────
let uidCounter = 0;
function ensureUid(card) {
  if (card && card.uid === undefined) card.uid = ++uidCounter;
  return card;
}

// FLIP-style entrance: the zones fully tear down and rebuild their DOM on
// every renderAll() (see renderZone/renderHand below), so every card is a
// literally brand-new DOM node on every render -- a blanket "always
// animate" CSS rule would replay the entrance on every card, on every
// single action, not just when a card is genuinely placed/dealt/moved.
// This tracks each card's last known logical position (board slot, or
// "in hand") keyed by its uid, and only plays the entrance when that
// position actually changed since the previous render -- i.e. real
// placement, redraw (recycled back into hand), or a board move (Reserve
// -> Front, Teleportation, ...), not a re-render where nothing moved.
const lastCardPosition = new Map();
function isNewPosition(card, positionKey) {
  const prev = lastCardPosition.get(card.uid);
  lastCardPosition.set(card.uid, positionKey);
  return prev !== positionKey;
}

// ── Flying-card FLIP animation ──────────────────────────────────────
// Real FLIP (First-Last-Invert-Play): since every zone wipes and rebuilds
// its DOM on every render (see renderZone/renderHand), there's never a
// single persistent element whose position we could animate with a normal
// CSS transition -- each "move" is actually old-node-destroyed +
// new-node-created. This closes that gap: recordRectsBeforeWipe() grabs
// each on-screen card's bounding rect (keyed by uid, the one thing that
// *does* persist across a render) right before its container is cleared;
// flyNewlyEnteredCards() runs once per renderAll() pass, after the whole
// board has been rebuilt, and for every card whose logical position
// changed (isNewPosition() already said yes -- reuses the same signal
// `.entering` uses, so this never fires on a same-slot re-render) computes
// the delta between that recorded rect and the new element's rect, then
// plays a translate from old->new via requestAnimationFrame + a CSS
// transition, with a slight upward arc (a mid-flight Y lift, expressed as
// a second keyframe) so it reads as a card being tossed rather than
// sliding flat like a puck. Self-contained: no libraries, just rAF +
// inline transforms + one @keyframes block (see style.css's `card-fly`).
const lastCardRect = new Map();
// Cards captured in *this* renderAll() pass -- reset at the top of each
// renderAll() (via beginFlyBatch()) so a card only ever gets its
// pre-this-render rect, never a rect from two renders ago if it happened
// to not move in between.
let flyBatchCards = null;
// Subset of flyBatchCards that flew from the synthetic deal origin (see
// dealOriginRect()) rather than a real prior rect -- these are staggered
// slightly in flyNewlyEnteredCards() so a full hand deal reads as cards
// being dealt out one after another, not one solid blob all moving at
// once (a real board move -- Play/auto-place, Teleportation, ...) always
// has a genuine prior rect, so it's never in this set and always fires
// immediately, un-staggered).
let dealOriginUids = null;

function beginFlyBatch() {
  flyBatchCards = new Set();
  dealOriginUids = new Set();
  // P3 reveal flip: radar, scouting and island powers reveal a card by
  // setting faceUp and re-rendering, never by calling flipCard() -- so the
  // only way to notice is to compare face-down cards either side of the
  // render. This pass and playPendingReveals() below are that comparison.
  FX.snapshotFaceDown();
}

// Called for every zone container right before `container.innerHTML = ''`
// wipes it out -- this is the only moment the "old" rects are still live
// in the DOM.
function recordRectsBeforeWipe(container) {
  if (!container) return;
  container.querySelectorAll('.card[data-uid]').forEach(el => {
    const uid = Number(el.dataset.uid);
    if (!Number.isFinite(uid)) return;
    lastCardRect.set(uid, el.getBoundingClientRect());
  });
}

// Called once, after the entire board (all zones + hand) has been
// rebuilt, to actually kick off the fly animation for anything whose
// position just changed. `movedUids` is the set of uids created this pass
// via createCardEl() with a changed positionKey (see there).
function flyNewlyEnteredCards() {
  // Before the early return below: a reveal is independent of whether any
  // card also moved this pass.
  FX.playPendingReveals();
  if (!flyBatchCards || !flyBatchCards.size) { flyBatchCards = null; dealOriginUids = null; return; }
  const moved = flyBatchCards;
  const dealUids = dealOriginUids || new Set();
  flyBatchCards = null;
  dealOriginUids = null;
  let dealIndex = 0;
  moved.forEach(uid => {
    const from = lastCardRect.get(uid);
    const el = document.querySelector(`.card[data-uid="${uid}"]`);
    if (!from || !el) { if (el) lastCardRect.delete(uid); return; }
    const to = el.getBoundingClientRect();
    const dx = from.left - to.left;
    const dy = from.top - to.top;
    lastCardRect.delete(uid);
    // Skip degenerate/negligible moves (e.g. a card re-rendered in the
    // exact same on-screen spot -- can happen for board slots that don't
    // shift) -- nothing to fly.
    if (Math.abs(dx) < 2 && Math.abs(dy) < 2) return;
    el.style.setProperty('--fly-dx', `${dx}px`);
    el.style.setProperty('--fly-dy', `${dy}px`);
    // Small upward arc: lift proportional to travel distance, capped so
    // short hops (adjacent slot) don't get an exaggerated hop while long
    // ones (deck -> far board slot) read as a real toss.
    const dist = Math.hypot(dx, dy);
    const arc = Math.min(38, Math.max(10, dist * 0.18));
    el.style.setProperty('--fly-arc', `${arc}px`);
    // Stagger only the synthetic-origin deal batch (a whole hand landing
    // at once from the same spot) so it reads as cards being dealt out in
    // sequence, not one solid blob -- a real single-card move (Play,
    // auto-place, Teleportation, ...) always has its own genuine prior
    // rect and is never in dealUids, so it still fires immediately.
    if (dealUids.has(uid)) {
      el.style.animationDelay = `${Math.min(dealIndex * 45, 360)}ms`;
      dealIndex++;
    }
    el.classList.add('flying');
    el.addEventListener('animationend', () => {
      el.classList.remove('flying');
      el.style.removeProperty('--fly-dx');
      el.style.removeProperty('--fly-dy');
      el.style.removeProperty('--fly-arc');
      el.style.removeProperty('animation-delay');
    }, { once: true });
  });
}

// Synthetic "deck" origin for cards that have no real prior rect to fly
// from (the initial deal, or any card drawn into a hand that was empty).
// There's no literal deck DOM element in this layout (unlike the separate,
// unrelated island-deck), so this anchors to the bottom-center of the hand
// row itself -- reads as "cards rising up out of the deck into the hand."
// Returns a DOMRect-shaped plain object (only left/top/width/height are
// read by flyNewlyEnteredCards()).
function dealOriginRect() {
  if (!DOM.playerHand) return null;
  const handRect = DOM.playerHand.getBoundingClientRect();
  const w = 56, h = 74; // matches .card's base size in style.css
  return {
    left: handRect.left + handRect.width / 2 - w / 2,
    top: handRect.top + handRect.height + 24,
    width: w,
    height: h,
  };
}

function createCardEl(card, faceUp, opts = {}) {
  ensureUid(card);
  const el = document.createElement('div');
  el.className = 'card';
  if (opts.positionKey && isNewPosition(card, opts.positionKey)) {
    el.classList.add('entering');
    // A card with no prior on-screen rect (freshly dealt into an
    // previously-empty hand, e.g.) has nothing real to fly *from* -- give
    // it a synthetic origin (the deck's notional spot: bottom-center of
    // the hand row) instead of skipping the fly entirely, so DEAL --
    // priority case #1 for this animation -- still visibly travels rather
    // than just fading in place like a plain re-render would.
    if (flyBatchCards && !lastCardRect.has(card.uid)) {
      const origin = dealOriginRect();
      if (origin) {
        lastCardRect.set(card.uid, origin);
        if (dealOriginUids) dealOriginUids.add(card.uid);
      }
    }
    if (flyBatchCards && lastCardRect.has(card.uid)) flyBatchCards.add(card.uid);
  }
  el.dataset.uid = card.uid;
  el.dataset.cardId = card.def.id;
  // decorate() runs for BOTH faces (frame/role classes must be identical face
  // up and face down, because flipCard() swaps innerHTML only).
  decorateCard(el, card.def);
  if (faceUp) {
    el.innerHTML = faceHtml(card.def);
    el.title = titleFor(card.def);
  } else {
    el.classList.add('face-down');
    el.innerHTML = backHtml();
  }
  if (opts.draggable) {
    el.draggable = true;
    el.addEventListener('dragstart', e => e.dataTransfer.setData('text/plain', String(opts.handIdx)));
  }
  return el;
}

function renderZone(container, cards, faceUp, onClick) {
  if (!container) return;
  recordRectsBeforeWipe(container);
  container.innerHTML = '';
  const side = container === DOM.playerFront || container === DOM.playerReserve ? 'p1' : 'p2';
  const zoneName = container === DOM.playerFront || container === DOM.oppFront ? 'front' : 'reserve';
  cards.forEach((card, slot) => {
    const slotEl = document.createElement('div');
    slotEl.className = 'slot';
    slotEl.dataset.slot = slot;
    slotEl.dataset.zone = zoneName;
    if (card) {
      const cardEl = createCardEl(card, faceUp || card.faceUp, { positionKey: `${side}-${zoneName}:${slot}` });
      if (onClick) {
        cardEl.style.cursor = 'pointer';
        cardEl.addEventListener('click', () => onClick(slot, card));
      }
      slotEl.appendChild(cardEl);
    } else {
      slotEl.classList.add('empty');
    }
    container.appendChild(slotEl);
  });
}

// ── Adaptive hand layout (owner ask, mid=690) ───────────────────────────
// Fan ONLY when the hand doesn't fit the row at normal, non-overlapping
// spacing -- a small hand (e.g. 5 cards) spreads out with plain flex
// `gap`; only once cardCount * cardWidth + gaps would overflow the row's
// actual measured width does this compress the hand into an overlapping
// fan, with the overlap sized (not just toggled) to the overflow, so a
// bigger hand (up to the 13-card max) reads as a progressively tighter
// fan rather than jumping straight to max overlap. See style.css's
// `.hand-row`/`--hand-overlap` comment for how the computed value is
// consumed. Measures real DOM widths (not hardcoded constants) so this
// stays correct across the existing `.card`/`.slot` responsive
// breakpoints (480px / 900px / 1200px) without any extra wiring here.
const HAND_MIN_STEP = 14; // px floor for a fanned card's visible sliver --
                           // below this, `.hand-row`'s existing
                           // fan simply stops tightening. Lowered from 18
                           // for P0: 14 cards at a ~90px stage card width
                           // need a ~23px step on a 412px phone, and the
                           // floor must stay below that on the narrowest
                           // supported viewport or the row would overflow
                           // the stage (which no longer scrolls).

function layoutHandRow(container) {
  if (!container) return;
  const cards = Array.from(container.children).filter(el => el.classList.contains('card'));
  const n = cards.length;
  if (n === 0) return;
  const cs = getComputedStyle(container);
  const availableWidth = container.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
  // offsetWidth, NOT getBoundingClientRect().width: the latter includes the
  // card's current transform, and on the pass that runs right after a deal
  // the cards are still mid `card-fly` (scale 0.97) and mid hand-fan
  // (rotate, see render/input.js). Measuring the transformed box made the
  // solve under-read the card by ~3% and the 14-card row then overflowed
  // the stage by ~40px. The layout width is what the negative margin has
  // to be solved against.
  const cardWidth = cards[0].offsetWidth;
  const gap = parseFloat(cs.columnGap || cs.gap) || 0;
  const naturalWidth = n * cardWidth + (n - 1) * gap;
  // Fits at normal spacing (or nothing to measure yet) -- clear any prior
  // overlap (e.g. the hand just shrank, or the viewport grew) and let
  // flex `gap` do the job.
  if (!cardWidth || !availableWidth || n <= 1 || naturalWidth <= availableWidth) {
    container.style.setProperty('--hand-overlap', '0px');
    container.classList.remove('is-fanned');
    container.dataset.overlap = '0';
    return;
  }
  // Overflow -- solve for the left-edge-to-left-edge step between
  // consecutive cards that makes the whole n-card row exactly span
  // availableWidth, then convert that step into the negative margin
  // needed on top of the card's own width + the row's flex `gap`.
  const rawStep = (availableWidth - cardWidth) / (n - 1);
  const step = Math.max(rawStep, HAND_MIN_STEP);
  const marginLeft = step - cardWidth - gap; // negative = overlap
  container.style.setProperty('--hand-overlap', `${marginLeft}px`);
  container.classList.add('is-fanned');
  container.dataset.overlap = String(Math.max(0, -marginLeft));
}

function layoutAllHands() {
  layoutHandRow(DOM.playerHand);
}

// Re-run on viewport changes -- independent of the next game-state
// render, so rotating a phone or resizing the browser window re-decides
// fit-vs-fan immediately rather than waiting on the next action.
window.addEventListener('resize', layoutAllHands);
// Belt-and-suspenders: catch a hand row's own box-width changing for a
// reason other than a window resize (e.g. an unrelated layout reflow
// elsewhere on the board nudging this row's available width). Doesn't
// double-fire from layoutHandRow()'s own writes -- those only change
// child card margins, never the row's own border-box size, since
// `.hand-row` has no explicit `width` (block-level, fills its
// containing block).
if (typeof ResizeObserver !== 'undefined') {
  const handResizeObserver = new ResizeObserver(() => layoutAllHands());
  if (DOM.playerHand) handResizeObserver.observe(DOM.playerHand);
}

// ── Hover-focus (owner ask, mid=690): spreads fan neighbors ────────────
// CSS `:hover ~ .card` only reaches *following* siblings, so both
// directions (cards before AND after the hovered one) are pushed apart
// here in JS. Only pushes neighbors when the row is actually fanned
// (`.is-fanned`, set by layoutHandRow() above) -- in normal/spread mode
// there's nothing overlapping to reveal, so only the hover lift
// (`.hover-focus`, pure CSS -- see style.css) applies, per the task's
// "in normal mode the hover lift alone is fine." Neighbor transforms are
// a uniform push (not tapered by distance) sized to the row's current
// overlap plus a small buffer for the hovered card's own scale-up, which
// keeps every non-hovered card's relative spacing to its OTHER neighbors
// unchanged (each side moves as one rigid block) -- simple and avoids
// exaggerated shifts for cards far from the hovered one in a 13-card fan.
// Purely additive/visual: doesn't touch DOM order or the click listener
// renderHand/renderOppHand already attached, so click-to-place keeps
// working; the hovered card's own `z-index: 50` (from `.hover-focus`) is
// what makes it -- not a neighbor that merely shifted -- the visually
// topmost element under the cursor, so it's what actually receives the
// click.
// P2 "Input": once render/input.js owns the hand (it flags the row
// `.input-fan`), the fan transform and the rise-above-neighbours lift are
// computed there -- per-card inline transforms that this pair would fight
// over, and a `.hover-focus` class that mouse-compat events would leave
// stuck on a touch tap. Stand down in that case; nothing else about
// renderHand changes.
function inputOwnsHand(container) {
  return !!container && container.classList.contains('input-fan');
}

function clearHandHover(container) {
  if (!container || inputOwnsHand(container)) return;
  container.querySelectorAll(':scope > .card').forEach(el => {
    el.classList.remove('hover-focus');
    el.style.removeProperty('transform');
  });
}

function applyHandHover(container, hoveredEl) {
  if (!container || inputOwnsHand(container)) return;
  const cards = Array.from(container.children).filter(el => el.classList.contains('card'));
  const idx = cards.indexOf(hoveredEl);
  if (idx === -1) return;
  clearHandHover(container);
  hoveredEl.classList.add('hover-focus');
  if (!container.classList.contains('is-fanned')) return;
  const overlap = Number(container.dataset.overlap) || 0;
  const pushBy = overlap + 16; // buffer for hover-focus's own scale(1.15)
  cards.forEach((el, i) => {
    if (i < idx) el.style.transform = `translateX(-${pushBy}px)`;
    else if (i > idx) el.style.transform = `translateX(${pushBy}px)`;
  });
}

function wireHandHover(container, cardEl) {
  cardEl.addEventListener('mouseenter', () => applyHandHover(container, cardEl));
  cardEl.addEventListener('mouseleave', () => clearHandHover(container));
}

function renderHand(hand, onClick) {
  if (!DOM.playerHand) return;
  recordRectsBeforeWipe(DOM.playerHand);
  DOM.playerHand.innerHTML = '';
  hand.forEach((card, idx) => {
    ensureUid(card);
    const cardEl = createCardEl(card, true, { draggable: !!onClick, handIdx: idx, positionKey: `hand:${card.uid}` });
    if (onClick) {
      cardEl.style.cursor = 'pointer';
      cardEl.addEventListener('click', () => onClick(idx, card));
    }
    wireHandHover(DOM.playerHand, cardEl);
    DOM.playerHand.appendChild(cardEl);
  });
  layoutHandRow(DOM.playerHand);
}

let lastOppHandUids = [];

function renderOppHand(hand) {
  if (!DOM.oppHand) return;
  // P0: ONE card back plus a count badge (the badge is a CSS ::after on
  // `data-count` -- see render/stage.css), not a 14-wide row of backs.
  //
  // Fly-origin bookkeeping: with a single shared back there is no
  // per-card element left for recordRectsBeforeWipe() to measure, so a
  // card the AI plays would have no prior rect and createCardEl() would
  // fall back to dealOriginRect() -- the PLAYER's hand -- making enemy
  // cards fly up from the wrong side of the board. Give every uid that
  // was in the opponent's hand at the previous render the back's rect
  // instead, so it flies out of the opponent's hand badge.
  const backEl = DOM.oppHand.querySelector('.card[data-uid]');
  if (backEl && lastOppHandUids.length) {
    const rect = backEl.getBoundingClientRect();
    lastOppHandUids.forEach(uid => lastCardRect.set(uid, rect));
  }

  DOM.oppHand.innerHTML = '';
  DOM.oppHand.dataset.count = String(hand.length);
  lastOppHandUids = hand.map(card => { ensureUid(card); return card.uid; });
  if (!hand.length) return;

  // The top card carries the reveal flag: if an ability ever flips a
  // specific hand card face-up (card.faceUp -- the same universal flag
  // Radar/Scouting set on board cards), showing it here still works.
  const revealed = hand.find(card => card && card.faceUp);
  const shown = revealed || hand[0];
  const cardEl = createCardEl(shown, !!shown.faceUp);
  cardEl.classList.add('opp-hand-card');
  cardEl.title = `Opponent hand: ${hand.length} card${hand.length === 1 ? '' : 's'}`;
  DOM.oppHand.appendChild(cardEl);
}

function highlightSlots(zoneName, on, cls = 'highlight') {
  const container = { 'opp-front': DOM.oppFront, 'opp-reserve': DOM.oppReserve,
                       'player-front': DOM.playerFront, 'player-reserve': DOM.playerReserve }[zoneName];
  if (!container) return;
  container.querySelectorAll('.slot').forEach(slot => slot.classList.toggle(cls, on));
}

function clearAllHighlights() {
  document.querySelectorAll('.slot.highlight, .slot.target-highlight').forEach(slot => {
    slot.classList.remove('highlight', 'target-highlight');
  });
  highlightHand(false);
}

// Rapid Support targets a hand card, not a board slot, so it can't reuse
// highlightSlots() (that walks `.slot` elements, which renderHand never
// creates -- see renderHand below). Toggle the same target-highlight cue
// on the hand row itself instead; style.css styles `.hand-row.target-highlight
// .card` to match `.slot.target-highlight`.
function highlightHand(on) {
  if (DOM.playerHand) DOM.playerHand.classList.toggle('target-highlight', on);
}

// Actually flips a card's DOM face from its (possibly face-down) back to
// its real face, reusing createCardEl's own face-up markup so this never
// drifts out of sync with the normal renderer. Previously this only
// stripped the `.face-down` class without touching the innerHTML, so it
// never visibly changed anything -- the "??" back stayed on screen (it was
// exported but never actually called from anywhere). No-op if the card is
// already showing its face.
function flipCard(card) {
  const el = findCardEl(card.uid);
  if (!el || !el.classList.contains('face-down')) return;
  // P3: the innerHTML swap itself is unchanged (render/cards.js depends on
  // flipCard staying an innerHTML-only swap) -- FX.flip just wraps it in a
  // rotateY and performs the swap edge-on at the 90-degree midpoint, where
  // it is invisible.
  FX.flip(el, () => {
    const revealed = createCardEl(card, true);
    el.innerHTML = revealed.innerHTML;
    el.title = revealed.title;
    el.classList.remove('face-down');
  });
}

function showGameOver(state) {
  if (!DOM.goModal) return;
  const [p, a] = state.score;
  // Network matches carry the server's verdict (forfeit wins at 0:0).
  const verdict = state.mpWinner ? (state.mpWinner === 1 ? 1 : -1) : Math.sign(p - a);
  DOM.goScore.textContent = `${p} : ${a}`;
  // P4: the icon, the verdict wording and the "N rounds played -- why" line
  // are the re-skin's (render/screens.js). Every id in the modal is
  // unchanged -- app.js still writes #go-reward / #go-campaign-note straight
  // after this returns.
  Screens.skinGameOver(state, verdict);
  DOM.goModal.classList.remove('hidden');
}

function hideGameOver() {
  if (DOM.goModal) DOM.goModal.classList.add('hidden');
  // Drop the finished match's round-transition snapshot and any overlay it
  // left behind -- multiplayer calls this when the server restarts a room,
  // and a stale snapshot would read round 1 of the new match as a
  // transition. See render/screens.js's takeSnapshot().
  Screens.reset();
  // ...and the combat-juice module's own per-match baselines. Without this
  // the score ticker's `lastScore` still held the finished match's score, so
  // the next match's first render rolled both digits down from it -- see
  // render/fx.js's reset().
  FX.reset();
  // The two FLIP bookkeeping maps are keyed on uid and nothing ever removes
  // an entry for a card that simply stopped existing -- a finished match, a
  // redeal, a multiplayer frame. Every match mints fresh uids, so left alone
  // they grow for as long as the tab is open. The board is about to be torn
  // down and rebuilt, so there is nothing here worth keeping.
  lastCardPosition.clear();
  lastCardRect.clear();
  lastOppHandUids = [];
  // P12: back to dawn for the next match, and the victory/defeat scene's
  // confetti, fleet clones and count-up torn down with it (Screens.reset
  // does the latter -- see render/screens.js's dismissGameOverFx).
  Ocean.reset();
}

function renderRulesMatrix() {
  let html = '<table class="rules-matrix"><tr><th></th>';
  CARD_ORDER.forEach(id => { html += `<th title="${CARDS[id].name}">${thumbHtml(CARDS[id])}</th>`; });
  html += '</tr>';
  CARD_ORDER.forEach(atkId => {
    html += `<tr><th title="${CARDS[atkId].name}">${thumbHtml(CARDS[atkId])}</th>`;
    CARD_ORDER.forEach(defId => {
      const r = IMPACT[atkId][defId];
      const cls = r === 'WIN' ? 'win' : r === 'LOSS' ? 'loss' : r === 'DRAW' ? 'draw' : 'none';
      // check/cross are the salvaged monoline icons (icons.js); they use
      // currentColor, so td.win / td.loss keep tinting them.
      const sym = r === 'WIN' ? icon('check', { size: 14, className: 'uc-icon' })
        : r === 'LOSS' ? icon('cross', { size: 14, className: 'uc-icon' })
        : r === 'DRAW' ? '=' : '·';
      html += `<td class="${cls}">${sym}</td>`;
    });
    html += '</tr>';
  });
  html += '</table>';
  html += renderIslandsList();
  DOM.matrixTable.innerHTML = html;
}

// No per-unit ability list is rendered: the canonical rule cards give every
// unit exactly a strength plus destroys/destroyed_by and nothing else, so
// there are no unit abilities to list (the former Sea Hunter "Precision"
// entry was an invented tie-break and has been removed).

// Islands are a separate deck from the combat cards. One island is
// "active" (contested) per round; whoever wins that round's combat
// captures it -- +1 point, plus (except Two-Island) a one-time power.
// First to 3 points wins the match. Documented here so the in-game rules
// modal always matches islands.js's ISLANDS data.
function renderIslandsList() {
  let html = '<h3 class="rules-subhead">Islands -- fight to control them</h3>';
  html += '<p class="rules-note">Each round has one contested island. Win the round\'s combat, then place a qualifying ship or Plane (from your Front/Reserve, not a fresh one) onto it to capture: it garrisons the island for +1 point (Two-Island: 2) and (usually) a one-time power. Your score is the islands you currently HOLD -- win the round with no qualifying unit left and the island goes uncaptured, so that round pays nothing. First to 3 points wins.</p>';
  html += '<p class="rules-note">Combat: there is no once-per-round limit -- the same card may attack as many times in a round as you like. Any card that attacks or is attacked is turned face-up and stays face-up for the rest of the round; nothing ever turns it back face-down. A face-down enemy card may always be attacked blind, but a face-up one only when the impact table says you WIN or both sides DRAW. Island powers are one-time for the whole match. If neither side has a legal move left, the round is a stalemate draw and no one takes the island.</p>';
  html += '<div class="ability-list">';
  Object.values(ISLANDS).forEach(def => {
    // icons.js has one entry per island id; an id that arrives off the wire
    // without art (LEGACY_ISLANDS) falls back to the generic island glyph.
    const glyph = icon(def.id, { size: 24 }) || icon('island', { size: 24 });
    html += `<div class="ability-row"><span class="ability-emoji">${glyph}</span><div><strong>${def.name}</strong><span>${def.desc || ''}</span></div></div>`;
  });
  html += '</div>';
  return html;
}

// Readable reference view -- feature request: "a large, READABLE
// overlay/modal" with bigger cards/text than the cramped in-play board.
// Shows two things, reusing the exact same cards.js/islands.js data the
// compact rules-modal above already draws from (never duplicated/
// re-typed): (a) what we currently know about the opponent's hand --
// which specific cards have been revealed (card.faceUp -- see
// renderOppHand's comment for how that flag gets set) grouped by id with
// a count, plus the full roster underneath as a legend of everything that
// COULD be in their hand; (b) the island list with full descriptions.
function renderReferenceView(state) {
  if (!DOM.referenceContent) return;

  const revealed = [];
  if (state) {
    const allOppCards = [...(state.p2Hand || []), ...(state.p2Front || []), ...(state.p2Reserve || [])];
    allOppCards.forEach(c => { if (c && c.faceUp) revealed.push(c); });
  }
  const revealedCounts = new Map(); // cardId -> count
  revealed.forEach(c => revealedCounts.set(c.def.id, (revealedCounts.get(c.def.id) || 0) + 1));

  let html = '<h3 class="rules-subhead">Opponent -- known cards</h3>';
  if (revealedCounts.size === 0) {
    html += '<p class="rules-note">Nothing revealed yet -- Radar, Scouting, and similar powers uncover enemy cards as the match goes on.</p>';
  } else {
    html += '<div class="ref-card-grid">';
    revealedCounts.forEach((count, id) => {
      const def = CARDS[id];
      html += `
        <div class="ref-card">
          <div class="card unit-card ref-card-face role-${roleOf(def.id)}">${faceHtml(def)}</div>
          ${count > 1 ? `<span class="ref-card-count">x${count}</span>` : ''}
        </div>`;
    });
    html += '</div>';
  }

  html += '<h3 class="rules-subhead">Full card roster</h3>';
  html += '<div class="ref-card-grid">';
  CARD_ORDER.forEach(id => {
    const def = CARDS[id];
    html += `
      <div class="ref-card">
        <div class="card unit-card ref-card-face role-${roleOf(def.id)}">${faceHtml(def)}</div>
        <div class="ref-card-ability">${def.ability ? `<strong>${def.ability.name}</strong>: ${def.ability.desc}` : ''}</div>
      </div>`;
  });
  html += '</div>';

  html += renderIslandsList();
  DOM.referenceContent.innerHTML = html;
}

function setupDropZones(onDrop) {
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

// ── Log ─────────────────────────────────────────────────────────
// NOTE: removing 'hidden' here only reveals the small round toggle badge
// (see style.css's #combat-log rules) -- it does NOT open the drawer.
// The drawer (#log-entries) stays `display:none` until app.js toggles
// `.expanded` on #combat-log in response to a tap, so this is safe to
// call on every entry without ever turning into a permanent overlay.
function addLogEntry(msg, type = '') {
  DOM.combatLog.classList.remove('hidden');
  const entry = document.createElement('div');
  entry.className = 'log-entry' + (type ? ` log-${type}` : '');
  entry.textContent = msg;
  DOM.logEntries.prepend(entry); // newest first

  const countEl = document.getElementById('combat-log-count');
  if (countEl) {
    const count = DOM.logEntries.children.length;
    countEl.textContent = count > 99 ? '99+' : String(count);
    countEl.classList.remove('hidden');
  }
}

// ── Animations ──────────────────────────────────────────────────

// Find a card's DOM slot element by its uid
function findCardEl(uid) {
  return document.querySelector(`.card[data-uid="${uid}"]`);
}

// Fly-to animation: attacker lunge, impact, result callout, shard destroy.
// The body lives in render/fx.js (phase P3); this keeps the name, the
// signature and the "resolves only once the board is settled" contract that
// app.js relies on -- it awaits this under store.combatLocked, which is the
// same flag render/input.js's inert() reads, so the board stays untouchable
// for the whole animation and not a millisecond less.
async function animateAttack(atkCard, defCard, result) {
  const atkEl = findCardEl(atkCard.uid);
  const defEl = findCardEl(defCard.uid);
  if (!atkEl || !defEl) return;

  // The impact matrix outcome in words, in the log, alongside the on-board
  // callout -- so the drawer keeps a readable history of what beat what.
  addLogEntry(FX.outcomeText(atkCard, defCard, result), String(result).toLowerCase());

  await FX.attack({
    atkEl,
    defEl,
    result,
    // P12: the two printed strengths, so the callout can float up as
    // "3 vs 5" before it resolves into WIN/LOSS/DRAW. Cards carry their
    // definition under `.def` (game.js's makeCard), the same place
    // FX.outcomeText reads the names from.
    atkStrength: atkCard && atkCard.def ? atkCard.def.strength : null,
    defStrength: defCard && defCard.def ? defCard.def.strength : null,
    // Reveal the defender's face at contact if it was still face-down.
    // resolveAttack() (game.js) flips card.faceUp the instant any card is
    // attacked, win or lose -- this makes that visible before the card can
    // disappear.
    onReveal: () => flipCard(defCard),
    onDestroyDefender: (result === 'WIN' || result === 'DRAW') && defEl.parentElement
      ? () => destroyCardAnimation(defEl.parentElement) : null,
    onDestroyAttacker: (result === 'LOSS' || result === 'DRAW') && atkEl.parentElement
      ? () => destroyCardAnimation(atkEl.parentElement) : null,
  });
}

// Destroy card with animation, then remove from DOM. Resolves only after the
// card element is gone and the slot is empty.
function destroyCardAnimation(slotEl) {
  return FX.destroySlot(slotEl);
}

// Shake animation for blocked/shield
function shakeCard(uid) {
  FX.shake(findCardEl(uid));
}

// Shield glow on Coastal Artillery fortify
function showShieldEffect(uid) {
  const el = findCardEl(uid);
  if (!el) return;
  el.classList.add('shielded');
  setTimeout(() => el.classList.remove('shielded'), 1000);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// `maneuverTargetIds`, when passed, means Maneuver is mid-targeting (see
// app.js's handleIslandClick 'maneuver' branch): the player-islands panel
// switches from its normal "pick a power to activate" wiring to "pick which
// held island to un-garrison" -- every id in the list gets a target-highlight
// + click (regardless of that island's own used/passive status, since
// retrieving a unit doesn't require the TARGET island's power to be unused,
// or even to have an active power at all -- Two-Island can be un-garrisoned
// too), everything else goes inert for the duration of the pick.
export function renderIslands(state, handleIslandClick, maneuverTargetIds = null) {
  Islands.render(state, handleIslandClick, maneuverTargetIds);
}

// Kept for any caller that still wants a bare island element; the renderer
// itself no longer uses it (render/islands.js builds the landscape card).
export function createIslandEl(def, isMine, isUsed = false) {
  return Islands.buildIslandEl(def, 'chip', { mine: isMine, used: isUsed });
}

// ── Artifacts (inventory row) ──────────────────────────────────────
export function renderArtifacts(state, onArtifactClick) {
  if (!state) return;
  const container = document.getElementById('player-artifacts');
  if (!container) return;
  container.innerHTML = '';
  const bag = state.p1Artifacts || [];
  bag.forEach((artifactId, idx) => {
    const def = ARTIFACTS[artifactId];
    if (!def) return;
    const el = document.createElement('div');
    el.className = 'card artifact-card';
    el.title = `${def.name} -- ${def.desc}`;
    el.innerHTML = `
      <div class="card-inner">
        <div class="card-face" style="padding: 4px; text-align: center;">
          <span class="card-emoji">${icon(artifactId, { size: 26 })}</span>
        </div>
      </div>`;
    const usable = state.phase === PHASE.COMBAT && state.turnOwner === 1;
    if (usable && onArtifactClick) {
      el.style.cursor = 'pointer';
      el.addEventListener('click', () => onArtifactClick(artifactId, idx));
    } else {
      el.style.opacity = '0.6';
    }
    container.appendChild(el);
  });
}

// ── Campaign level select ──────────────────────────────────────────
// Campaign chart -- the level list drawn as a sea map: islands are nodes, the
// route between them is the progression, and a ship marker sits on the next
// playable island. Cleared islands keep a flag. Everything is inline SVG so it
// scales to a phone and needs no assets (COEP on games.voicydroid.com blocks
// cross-origin art).
export function renderCampaignMap(levels, progress, onSelect) {
  if (!DOM.campaignLevels) return;
  DOM.campaignLevels.innerHTML = '';

  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('class', 'campaign-map');

  const defs = document.createElementNS(NS, 'defs');
  defs.innerHTML = `
    <linearGradient id="sea-grad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#3d93c7"/>
      <stop offset="55%" stop-color="#1b6ca8"/>
      <stop offset="100%" stop-color="#0f4c81"/>
    </linearGradient>`;
  svg.appendChild(defs);

  const sea = document.createElementNS(NS, 'rect');
  sea.setAttribute('width', '100'); sea.setAttribute('height', '100');
  sea.setAttribute('fill', 'url(#sea-grad)');
  svg.appendChild(sea);

  // Swell lines: pure decoration, drawn under the route so they never compete
  // with it for attention.
  for (let i = 1; i < 8; i++) {
    const wave = document.createElementNS(NS, 'path');
    const y = i * 12;
    wave.setAttribute('d', `M0 ${y} q 12 -3 25 0 t 25 0 t 25 0 t 25 0`);
    wave.setAttribute('class', 'map-swell');
    svg.appendChild(wave);
  }

  const next = Math.min(progress.unlockedLevel, levels.length);
  levels.forEach((level, i) => {
    if (i === 0) return;
    const a = levels[i - 1].map, b = level.map;
    const leg = document.createElementNS(NS, 'path');
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const bulge = 0.18 * len;
    const midX = (a.x + b.x) / 2 - (dy / len) * bulge;
    const midY = (a.y + b.y) / 2 + (dx / len) * bulge;
    leg.setAttribute('d', `M${a.x} ${a.y} Q${midX} ${midY} ${b.x} ${b.y}`);
    leg.setAttribute('class', 'map-leg' + (level.id <= progress.unlockedLevel ? ' sailed' : ''));
    svg.appendChild(leg);
  });

  DOM.campaignLevels.appendChild(svg);

  // Island nodes are HTML on top of the SVG rather than SVG shapes: they need
  // the same button semantics (focus, keyboard, tap target) the list had.
  levels.forEach((level) => {
    const unlocked = level.id <= progress.unlockedLevel;
    const result = progress.results[level.id];
    const cleared = !!(result && result.won);
    const node = document.createElement('button');
    node.type = 'button';
    node.className = 'map-island'
      + (unlocked ? '' : ' locked')
      + (cleared ? ' cleared' : '')
      + (level.id === next && unlocked ? ' current' : '');
    node.style.left = level.map.x + '%';
    node.style.top = level.map.y + '%';
    node.disabled = !unlocked;
    node.setAttribute('aria-label', `${level.id}. ${level.name}`);
    // P7: the node is a round window onto a piece of island art
    // (render/island_art.js) with the number over it and a cleared/locked
    // badge in the corner. The name and blurb moved OUT of the node into the
    // caption strip below the chart -- as absolutely-positioned labels they
    // clipped against the chart edge for any node near a corner.
    node.innerHTML = Shell.islandNodeHtml(level, { unlocked, cleared });
    if (unlocked && onSelect) node.addEventListener('click', () => onSelect(level.id));
    DOM.campaignLevels.appendChild(node);
  });

  const target = levels.find((l) => l.id === next);
  if (target) {
    const ship = document.createElement('div');
    ship.className = 'map-ship';
    ship.style.left = target.map.x + '%';
    ship.style.top = target.map.y + '%';
    DOM.campaignLevels.appendChild(ship);
  }

  if (DOM.campaignCaption) {
    const res = target ? progress.results[target.id] : null;
    DOM.campaignCaption.innerHTML = Shell.mapCaptionHtml(target, { cleared: !!(res && res.won) });
  }
}

// ── Leaderboard ─────────────────────────────────────────────────────
export function renderLeaderboardList(entries, emptyMsg = 'No scores yet -- play a round!') {
  if (!DOM.leaderboardList) return;
  if (!entries || !entries.length) {
    DOM.leaderboardList.innerHTML = `<p class="rules-note">${emptyMsg}</p>`;
    return;
  }
  // P7: a list of surface cards, not a <table>. The three fixed columns
  // clipped long nicknames at 412px; a flex row can ellipsise the name and
  // keep the rank and score legible.
  let html = '';
  entries.forEach((e, i) => {
    const name = e.name || e.username || 'Captain';
    const score = e.score ?? e.total_score ?? 0;
    // Entries written since profiles exist carry an avatar id; the disc is
    // looked up client-side so remote rows stay plain data.
    const av = e.avatar ? LB_AVATARS.find((a) => a.id === e.avatar) : null;
    html += Shell.lbRowHtml(i + 1, name, score, av);
  });
  DOM.leaderboardList.innerHTML = html;
}

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

// ── Settings ────────────────────────────────────────────────────────
// Applies the card-art setting globally via a single class on <body>,
// rather than threading a flag through every createCardEl() call site --
// the `.no-card-art` rules do the actual visual switch. P11 changed what
// they do: they used to blank the art window, and now they only hide the
// downloaded illustration (render/cards.css, render/islands.css), leaving
// the inline SVG that is already in the markup. So the setting is now a
// BANDWIDTH switch, not a minimal-card switch -- see the copy below.
// Cheap to call on every settings change and on initial load; doesn't
// require re-rendering the board since it's pure CSS.
function applyCardArtSetting(cardArtOn) {
  document.body.classList.toggle('no-card-art', !cardArtOn);
}

// `settings` is the plain object from settings.js's loadSettings();
// `onToggle(key, value)` is called when the player flips a checkbox --
// app.js owns actually persisting it (settings.js's setSetting) and
// re-invoking applyCardArtSetting(), same "ui.js renders + reports
// intent, app.js owns state" split as the rest of this module. Structured
// as a small array of {key, label, desc} toggle rows so adding more
// settings later is just adding another entry here, not a new render
// function.
// P5 adds the sound and haptics rows. They are rendered from the same array
// as card art, but they do NOT live in settings.js's bag -- app.js routes
// those two keys to render/audio.js, which persists them under
// seahunter.sound / seahunter.haptics (see openSettings there).
const SETTINGS_TOGGLES = [
  // The description used to say "emoji art" -- card faces have been inline
  // SVG since P1 (render/art.js), so the copy says art.
  { key: 'cardArt', label: 'Card art', desc: 'Download the painted illustrations. Turn off on a slow connection -- cards keep the built-in art and nothing is fetched.' },
  { key: 'sound', label: 'Sound', desc: 'Short synthesized cues for placement, combat and results. No downloads.' },
  { key: 'haptics', label: 'Vibration', desc: 'A short buzz on impacts, destroys and the final result.' },
  { key: 'hints', label: 'Hints', desc: 'One-line tips during your first three matches.' },
];

function renderSettings(settings, onToggle, opts = {}) {
  if (!DOM.settingsContent) return;
  let html = '<div class="settings-list">';
  SETTINGS_TOGGLES.forEach(({ key, label, desc }) => {
    // The <input type="checkbox" data-setting-key> is still a real checkbox --
    // the change listener below binds to exactly that selector and app.js
    // routes the key onward. render/shell.css hides it and paints the switch.
    html += Shell.toggleRowHtml({ key, label, desc, checked: !!settings[key] });
  });
  html += '</div>';
  DOM.settingsContent.innerHTML = html;

  DOM.settingsContent.querySelectorAll('input[data-setting-key]').forEach(input => {
    input.addEventListener('change', () => {
      if (onToggle) onToggle(input.dataset.settingKey, input.checked);
    });
  });

  // P8: everything below the toggles. The Telemetry section is rendered by
  // render/telemetry.js (opts.renderExtras) so its modes, storage keys and
  // wording stay in one file; the feedback entry point is just a button.
  if (opts.onFeedback) {
    const btn = document.createElement('button');
    btn.id = 'btn-settings-feedback';
    btn.className = 'btn-secondary settings-feedback';
    btn.type = 'button';
    btn.textContent = 'Send feedback';
    btn.addEventListener('click', opts.onFeedback);
    DOM.settingsContent.appendChild(btn);
  }
  if (opts.renderExtras) opts.renderExtras(DOM.settingsContent);
}


// -- Trading Post (artifact shop) -----------------------------------
// Purely presentational: every rule (price, affordability, what the hold
// is) lives in economy.js -- this renders what it is handed and calls back
// on a buy click. `balance` = { gold, crystals }, `items` = [{ id, def,
// price, affordable }], `hold` = { artifactId: count }.
// P12 "Living board", part 5: which price band an item sits in.
//
// The catalogue has no rarity field and does not need one -- economy.js's
// price table already says everything the shelf has to show, and inventing a
// second axis that could disagree with the first would be a bug waiting to
// be filed. So the band IS the price: crystals are the currency you can only
// earn by clearing a campaign island for the first time, which makes anything
// priced in them the top shelf by construction. See render/shell.css for what
// each band is worth as a glow.
function priceBand(price) {
  if (!price) return 'band-common';
  if (price.crystals !== undefined) return 'band-legend';
  if (price.gold >= 70) return 'band-rare';
  if (price.gold >= 50) return 'band-fine';
  return 'band-common';
}

// Set by the confirm step just before it calls back into app.js, read by the
// very next render (app.js's renderShopScreen repaints the whole shelf off
// the new balance), cleared on use. The flourish therefore plays on the NEW
// card rather than on the one that is about to be thrown away.
let shopFlourishId = null;

// The coin chip flying from the item to the wallet. Appended to #shop-screen
// and not to #shop-items, because renderShopScreen() wipes that container's
// innerHTML on the same tick and would take the chip with it.
function flyCoinToWallet(fromEl) {
  const screen = document.getElementById('shop-screen');
  const wallet = DOM.shopBalance;
  if (!screen || !wallet || !fromEl || typeof fromEl.animate !== 'function') return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const from = fromEl.getBoundingClientRect();
  const to = wallet.getBoundingClientRect();
  const chip = document.createElement('span');
  chip.className = 'shop-coin-chip';
  chip.setAttribute('aria-hidden', 'true');
  chip.style.left = `${from.left + from.width / 2 - 11}px`;
  chip.style.top = `${from.top + from.height / 2 - 11}px`;
  screen.appendChild(chip);
  const dx = (to.left + to.width / 2) - (from.left + from.width / 2);
  const dy = (to.top + to.height / 2) - (from.top + from.height / 2);
  const anim = chip.animate([
    { transform: 'translate(0px, 0px) scale(0.6)', opacity: 0 },
    { transform: `translate(${(dx * 0.4).toFixed(1)}px, ${(dy * 0.4 - 26).toFixed(1)}px) scale(1.15)`, opacity: 1, offset: 0.45 },
    { transform: `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px) scale(0.55)`, opacity: 0 },
  ], { duration: 620, easing: 'cubic-bezier(0.3, 0.7, 0.4, 1)', fill: 'both' });
  const drop = () => chip.remove();
  anim.finished.then(drop, drop);
  // The wallet acknowledges the arrival rather than just silently changing.
  setTimeout(() => {
    wallet.classList.add('wallet-bump');
    setTimeout(() => wallet.classList.remove('wallet-bump'), 420);
  }, 520);
}

// The Buy button turns into an inline Confirm / Cancel pair IN PLACE -- no
// modal, no re-render, nothing reflowed but the one row. A trading post that
// takes 70 gold off a mis-tap is a trading post players stop visiting; a
// dialog over the shelf is the other failure, where confirming costs a
// screen transition each way.
function armConfirm(card, btn, id, onBuy) {
  const row = document.createElement('div');
  row.className = 'shop-confirm';
  const yes = document.createElement('button');
  yes.className = 'btn-primary shop-confirm-yes';
  yes.textContent = 'Confirm';
  const no = document.createElement('button');
  no.className = 'btn-secondary shop-confirm-no';
  no.textContent = 'Cancel';
  const restore = () => { if (row.parentNode) row.replaceWith(btn); };
  no.addEventListener('click', restore);
  yes.addEventListener('click', () => {
    // Flourish first, purchase second: flyCoinToWallet measures the card
    // that is on screen NOW, and onBuy repaints the shelf out from under it.
    shopFlourishId = id;
    flyCoinToWallet(card);
    if (onBuy) onBuy(id);
    else restore();
  });
  row.appendChild(yes);
  row.appendChild(no);
  btn.replaceWith(row);
}

export function renderShop({ balance, items, hold }, onBuy) {
  if (DOM.shopBalance) {
    DOM.shopBalance.innerHTML = Shell.coinRowHtml(balance);
  }
  if (DOM.shopItems) {
    DOM.shopItems.innerHTML = '';
    const flourish = shopFlourishId;
    shopFlourishId = null;
    items.forEach(({ id, def, price, affordable }) => {
      const card = document.createElement('div');
      card.className = 'version-card shop-item ' + priceBand(price)
        + (affordable ? '' : ' disabled')
        + (id === flourish ? ' just-bought' : '');
      card.innerHTML = Shell.shopCardHtml({ id, def, price });
      const btn = document.createElement('button');
      btn.className = affordable ? 'btn-primary shop-buy' : 'btn-secondary shop-buy';
      btn.textContent = affordable ? 'Buy' : 'Not enough';
      btn.disabled = !affordable;
      if (affordable) btn.addEventListener('click', () => armConfirm(card, btn, id, onBuy));
      card.appendChild(btn);
      DOM.shopItems.appendChild(card);
    });
  }
  if (DOM.shopHold) {
    const entries = Object.entries(hold || {});
    DOM.shopHold.innerHTML = entries.length
      ? '<span class="hold-label">In your hold:</span>' + entries
          .map(([id, n]) => Shell.holdChipHtml(id, ARTIFACTS[id], n))
          .join('')
      : '<span class="hold-label">Your hold is empty.</span>';
  }
}

// Small always-visible balance next to the in-match artifact rail, so the
// player can see what a match paid without leaving the board.
export function renderBalanceBadge(balance) {
  if (!DOM.railBalance || !balance) return;
  DOM.railBalance.textContent = `${balance.gold}g / ${balance.crystals}c`;
}

export {
  DOM, showScreen, setStatus, updateHUD, createCardEl,
  renderZone, renderHand, renderOppHand, highlightSlots, clearAllHighlights, highlightHand,
  addLogEntry, destroyCardAnimation, shakeCard, showShieldEffect, flipCard,
  showGameOver, hideGameOver, renderRulesMatrix, renderReferenceView, setupDropZones,
  animateAttack, sleep, beginFlyBatch, flyNewlyEnteredCards,
  applyCardArtSetting, renderSettings
};
