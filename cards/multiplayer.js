// Multiplayer WebSocket client for Sea Hunter card game.
//
// The server (src/games/sea_hunter/multiplayer.py) is turn-authoritative and
// speaks a "my/op" board view: every frame is already written from the seated
// player's perspective, with the opponent's face-down cards masked. The local
// engine (game.js) is hard-wired to "I am player 1", so this module adapts the
// server view onto that shape -- my_* becomes p1*, op_* becomes p2*, and the
// absolute player numbers the server sends (turn_owner, score, winner) are
// remapped to relative ones. That way ui.js/app.js render a remote match with
// the exact code path they use for the local AI match.
import { store } from './store.js';
import { CARDS } from './cards.js';
import { DEFAULT_POINTS_TO_WIN } from './game.js';

export let mpActive = false;
let ws = null;
let roomId = null;
let myPlayer = 1;
let onUpdate = null;   // (state, meta) -> void, set by app.js
let onEvent = null;    // (type, msg) -> void, set by app.js

// games.voicydroid.com serves the static gallery at the root and proxies the
// backend under /api only (Caddy: handle /api/* -> voicy-cloud-api:8001 with
// strip_prefix). On the main host the API answers at /v1 directly. Getting
// this wrong is a silent 404 into the static fallback, never an upgrade.
function apiPrefix() {
  return window.location.hostname.startsWith('games.') ? '/api' : '';
}

// A masked opponent card carries no id, so there is nothing to look up in
// CARDS. ui.js dereferences card.def unconditionally (emoji/abbr/strength/
// name/id), so hand it a placeholder def rather than letting it throw on the
// first opponent frame.
const HIDDEN_DEF = { id: '__hidden__', abbr: '??', name: 'Unknown', emoji: '?', strength: '?', ability: null };

function adaptCard(c) {
  if (!c) return null;
  const known = c.id !== null && c.id !== undefined;
  return {
    // The wire format carries only id/abbr/name/emoji -- strength and ability
    // live in the shared card table, which the browser already has.
    def: known ? (CARDS[c.id] || { id: c.id, abbr: c.abbr, name: c.name, emoji: c.emoji, strength: '?', ability: null }) : HIDDEN_DEF,
    faceUp: !!c.face_up,
    slot: typeof c.slot === 'number' ? c.slot : -1,
    hidden: !known,
  };
}

function adaptList(list) {
  return (list || []).map(adaptCard);
}

// ---- uid continuity across server frames -----------------------------
//
// BUGFIX. adaptState() below rebuilds every card as a BRAND NEW object on
// every game_update frame, and no uid was ever carried over. ui.js's
// ensureUid() therefore stamped a fresh number on every card on every frame,
// which made three separate things in the render layer misfire at once:
//
//   * createCardEl()'s isNewPosition() compares a uid to its last known
//     position, so an unmoved card looked brand new -- every board card
//     replayed the `.entering` FLIP entrance on every frame.
//   * with no prior rect under the new uid, createCardEl() fell back to
//     dealOriginRect(), so those entrances all flew up out of the PLAYER's
//     hand -- including the opponent's own cards, from the wrong end of the
//     board.
//   * render/fx.js's snapshotFaceDown() and render/input.js's knownUids are
//     both keyed on data-uid, so a reveal was never noticed and a card the
//     player had legitimately seen never kept its "known" outline.
//
// So: carry the uid of the card that was standing in the same place last
// frame. Two invariants, in this order --
//
//   1. a card that did not move keeps its uid (else this fixes nothing);
//   2. a uid never transfers to a physically different card (else the churn
//      is traded for a worse bug -- a card animating as though it were
//      another one).
//
// Matching is therefore by def.id: the same slot of the same zone FIRST,
// then anywhere in that zone, and only then anywhere on the previous board.
// Each previous uid is consumed at most once. A masked opponent card carries
// no id at all (HIDDEN_DEF), so those match each other, which is the only
// honest thing available -- and is harmless, because two cards the player
// cannot tell apart cannot be seen swapping identities either.
//
// Ordering matters and is the reason this is one pass over the WHOLE board
// rather than a per-zone call: every zone's tier-1 claim must be settled
// before any zone's tier-3 claim, or a card that merely sat still in Front
// could lose its uid to a card that moved into Reserve simply because
// Reserve happened to be adapted first. carryBoardUids() therefore runs each
// tier across all zones in turn.
function carryBoardUids(zones, prevState) {
  const idOf = (c) => (c && c.def ? c.def.id : null);
  const used = new Set();
  const claim = (card, was) => {
    if (!was || was.uid === undefined || used.has(was.uid)) return false;
    card.uid = was.uid;
    used.add(was.uid);
    return true;
  };
  const entries = Object.keys(zones).map((key) => ({
    key,
    fresh: zones[key],
    before: (prevState && prevState[key]) || [],
  }));

  // Tier 1, every zone: same index of the same zone -- the overwhelmingly
  // common case (a frame in which this card did not move at all).
  entries.forEach(({ fresh, before }) => {
    fresh.forEach((card, i) => {
      if (!card) return;
      const was = before[i];
      if (was && idOf(was) === idOf(card)) claim(card, was);
    });
  });
  // Tier 2, every zone: the same card id elsewhere in the SAME zone -- a
  // Teleportation swap, a Secret Move reorder.
  entries.forEach(({ fresh, before }) => {
    fresh.forEach((card) => {
      if (!card || card.uid !== undefined) return;
      for (let j = 0; j < before.length; j++) {
        const was = before[j];
        if (was && idOf(was) === idOf(card) && claim(card, was)) return;
      }
    });
  });
  // Tier 3, every zone: the same card id anywhere on the previous board --
  // it changed zone. A Reserve -> Front promotion is the most common board
  // action in the game after placement, and the promoted card is by
  // definition absent from the previous Front list, so without this tier it
  // would still be given a fresh uid and flown in from the deal origin.
  const all = [];
  if (prevState) {
    ['p1Hand', 'p1Front', 'p1Reserve', 'p2Front', 'p2Reserve', 'p2Hand'].forEach((k) => {
      (prevState[k] || []).forEach((c) => { if (c && c.uid !== undefined) all.push(c); });
    });
  }
  entries.forEach(({ fresh }) => {
    fresh.forEach((card) => {
      if (!card || card.uid !== undefined) return;
      for (let j = 0; j < all.length; j++) {
        if (idOf(all[j]) === idOf(card) && claim(card, all[j])) return;
      }
    });
  });
  return zones;
}

// Absolute player number -> relative (1 = me, 2 = opponent).
function rel(n) {
  if (n !== 1 && n !== 2) return n;
  return n === myPlayer ? 1 : 2;
}

export function adaptState(view) {
  if (!view) return null;
  const opPlaced = [...(view.op_front || []), ...(view.op_reserve || [])].filter(Boolean).length;
  const myScore = myPlayer === 1 ? view.score[0] : view.score[1];
  const opScore = myPlayer === 1 ? view.score[1] : view.score[0];
  // The frame this one replaces -- the source of the uids carried below. A
  // LOCAL match's state is never a valid source (different card objects, a
  // different match), so only a multiplayer one is read.
  const was = (store.state && store.state.multiplayer) ? store.state : null;
  // Every zone is adapted first and then given its uids in one board-wide
  // pass, so the tier ordering above holds across zones and not merely
  // within each one.
  const zones = carryBoardUids({
    p1Hand: adaptList(view.my_hand),
    p1Front: adaptList(view.my_front),
    p1Reserve: adaptList(view.my_reserve),
    // The server never ships the opponent's hand (it would leak the fleet).
    // During PREP the UI only needs a count of card backs, so synthesise it
    // from what the opponent has not placed yet; afterwards it is empty.
    //
    // One object per entry, not Array().fill(one shared object): ui.js's
    // ensureUid() writes a uid onto the card it is handed, and a shared
    // reference would give every back in the row the same one.
    p2Hand: view.phase === 'PREP'
      ? Array.from({ length: Math.max(0, 8 - opPlaced) },
        () => ({ def: HIDDEN_DEF, faceUp: false, slot: -1, hidden: true }))
      : [],
    p2Front: adaptList(view.op_front),
    p2Reserve: adaptList(view.op_reserve),
  }, was);
  return {
    phase: view.phase,
    roundNum: view.round_num,
    turnOwner: rel(view.turn_owner),
    score: [myScore, opScore],
    lastAction: view.last_action || '',
    combatLog: view.combat_log || [],
    p1Hand: zones.p1Hand,
    p1Front: zones.p1Front,
    p1Reserve: zones.p1Reserve,
    p2Hand: zones.p2Hand,
    p2Front: zones.p2Front,
    p2Reserve: zones.p2Reserve,
    activeIsland: view.active_island,
    islandDeck: Array(view.island_deck_count || 0).fill(null),
    p1Islands: view.my_captured_islands || [],
    p2Islands: view.op_captured_islands || [],
    p1PowersUsed: view.my_powers_used || [],
    p2PowersUsed: view.op_powers_used || [],
    p1IslandGarrison: view.my_island_garrison || {},
    p2IslandGarrison: view.op_island_garrison || {},
    p1Artifacts: (store.state && store.state.p1Artifacts) || [],
    pointsToWin: view.points_to_win || DEFAULT_POINTS_TO_WIN,
    multiplayer: true,
  };
}

export function mpSetHandlers({ update, event }) {
  onUpdate = update || null;
  onEvent = event || null;
}

// Last room/name, so "Play again" can retake the same seat without the
// player typing the code again (see mpRematch).
let myName = '';
let rematching = false;

export function mpConnect(room, name) {
  roomId = room;
  myName = name || myName;
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${proto}//${window.location.host}${apiPrefix()}/v1/games/sea-hunter/ws/${encodeURIComponent(room)}?name=${encodeURIComponent(name || 'player')}`;
  try {
    ws = new WebSocket(url);
    ws.onopen = () => { mpActive = true; rematching = false; store.mode = 'multiplayer'; if (onEvent) onEvent('open', roomId); };
    // The close code matters: the server refuses a full room with an error
    // frame and close(1008), and both land in the same tick -- without the
    // code the generic "disconnected" text overwrites the real reason.
    ws.onclose = (ev) => { mpActive = false; store.mode = 'single'; if (onEvent) onEvent('close', { room: roomId, code: ev && ev.code, intentional: rematching }); rematching = false; };
    ws.onerror = () => { if (onEvent) onEvent('error', 'connection failed'); };
    ws.onmessage = (evt) => {
      let msg;
      try { msg = JSON.parse(evt.data); } catch (e) { return; }
      handleServerMessage(msg);
    };
  } catch (e) {
    mpActive = false;
  }
}

export function mpDisconnect() {
  if (ws) { ws.close(); ws = null; }
  mpActive = false;
  store.mode = 'single';
}

// The server has no "rematch" message: a finished room resets itself when a
// seat frees up and someone connects (multiplayer.py connect()). So a
// rematch is literally drop the socket, take the seat back.
export function mpRematch() {
  if (!roomId) return false;
  const room = roomId, name = myName;
  // The close that mpDisconnect triggers is ours, not a lost connection --
  // without the flag the "Disconnected from the room." notice overwrites the
  // rematch status for the quarter second before the socket comes back.
  rematching = true;
  mpDisconnect();
  setTimeout(() => mpConnect(room, name), 250);
  return true;
}

function send(obj) {
  if (!mpActive || !ws || ws.readyState !== WebSocket.OPEN) return false;
  ws.send(JSON.stringify(obj));
  return true;
}

export function mpAutoPlace() { return send({ type: 'auto_place' }); }
export function mpReady() { return send({ type: 'ready' }); }
export function mpPlace(handIdx, zone, slot) { return send({ type: 'place', hand_idx: handIdx, zone, slot }); }
export function mpAttack(atkSlot, defSlot) { return send({ type: 'attack', atk_slot: atkSlot, def_slot: defSlot }); }
export function mpMove(reserveSlot) { return send({ type: 'move', reserve_slot: reserveSlot }); }
export function mpCaptureIsland(slot, zone) { return send({ type: 'capture_island', slot, zone }); }
export function mpSkip() { return send({ type: 'skip' }); }
// Playing the server captain is an explicit choice -- the server has no
// auto-joining bot timer any more.
export function mpAddBot() { return send({ type: 'add_bot' }); }

// The server reads `island_idx` (an index into the captured-island list), not
// an island id -- sending island_id made every power resolve to index 0.
export function mpUsePower(islandIdx, args) { return send({ type: 'use_power', island_idx: islandIdx, args: args || {} }); }

function handleServerMessage(msg) {
  const t = msg && msg.type;
  if (t === 'game_start') {
    myPlayer = msg.your_player === 2 ? 2 : 1;
    const st = adaptState(msg.state);
    if (st && onUpdate) onUpdate(st, { kind: 'start', opponent: msg.opponent });
    return;
  }
  if (t === 'game_update') {
    const st = adaptState(msg.state);
    if (st && onUpdate) onUpdate(st, { kind: 'update', log: msg.log });
    return;
  }
  if (t === 'game_over') {
    const st = adaptState(msg.state);
    if (st) {
      st.phase = 'GAME_OVER';
      st.mpWinner = rel(msg.winner);
      if (onUpdate) onUpdate(st, { kind: 'over', winner: rel(msg.winner), reason: msg.reason });
    }
    return;
  }
  if (t === 'room_state' || t === 'error' || t === 'pong') {
    if (onEvent) onEvent(t, msg);
  }
}
