// Sea Hunter -- phase P15 "Progression and retention". Paint for
// progression.js, plus the per-match bookkeeping that feeds it.
//
//   1. observe(state)       -- called from app.js's renderAll(); counts what
//      a match did (captures, reveals, drawn rounds, cards and islands seen).
//   2. matchEnded(state)    -- called from app.js's handleGameOver() once the
//      payout is written; records the match and plays the results ladder
//      inside the P12 game-over panel. The panel's buttons stay disabled
//      until the ladder lands (a tap on the panel skips to the end).
//   3. init(deps)           -- the menu: level strip, campaign card, daily
//      goals and streak; "Play" sails the next voyage once the tutorial is
//      done; the profile card; the Fleet screen.
//
// Vocabulary reused rather than restyled: the P12 count-up (ease-out cubic
// on rAF, render/screens.js countScore), the re-rise entrance keyframe from
// render/screens.css, the P13 hero overlay classes from render/hero.css for
// the level-up moment, render/hero.js for the Fleet inspect view, and the
// P13 item art (coins, rank cups) through render/shell.js's itemImg.
//
// Timers, not animation events, sequence everything -- the same rule
// render/hero.js and render/fx.js follow, so a headless capture advances it.

import * as P from '../progression.js';
import { MISSION_COUNT, missionMeta, loadVoyageProgress, loadVoyage } from '../voyage.js';
import { CARDS, CARD_ORDER, DECK_IDS } from '../cards.js';
import { ISLANDS } from '../islands.js';
import { buildCardEl } from './cards.js';
import { buildIslandEl } from './islands.js';
import { itemImg } from './shell.js';
import * as Hero from './hero.js';
import * as Audio from './audio.js';
import * as Telemetry from './telemetry.js';

// The key render/tutorial.js writes when the guided match ends or is skipped.
// 'sh_tutorial_done' is kept for the ?seed=progress demo path; the veteran
// keys mean someone played here before the tutorial shipped and never ran it.
const TUTORIAL_KEY = 'seahunter.tutorial_done';
const TUTORIAL_KEYS = [TUTORIAL_KEY, 'sh_tutorial_done', 'seahunter_local_scores', 'seahunter_campaign_progress'];
let deps = {};

const $ = (id) => document.getElementById(id);

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function reduced() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function tutorialDone() {
  try { return TUTORIAL_KEYS.some((k) => !!window.localStorage.getItem(k)); } catch (e) { return false; }
}

function pct(into, need) {
  return need ? Math.max(0, Math.min(100, (into / need) * 100)) : 100;
}

// ---- 1. per-match bookkeeping ---------------------------------------------

let track = null;

function newTrack(state) {
  return {
    ref: state, round: state.roundNum || 1, phase: state.phase, done: false,
    revealMax: 0, reveals: 0, draws: 0, captures: 0,
    held: new Set(state.p1Islands || []),
    captured: new Set(), seenCards: new Set(), seenIslands: new Set(),
  };
}

export function observe(state) {
  if (!state) return;
  const round = state.roundNum || 1;
  const fresh = track && state !== track.ref && round === 1 && state.phase === 'PREP' && track.phase !== 'PREP';
  if (!track || round < track.round || fresh || (track.done && state.phase !== 'GAME_OVER')) track = newTrack(state);
  const t = track;
  t.ref = state;
  t.phase = state.phase;
  if (t.done) return;

  if (round > t.round) {
    // A round ended between two renders. Face-up enemy cards are reset with
    // the board, so the round's peak count is what was revealed in it.
    t.reveals += t.revealMax;
    t.revealMax = 0;
    if (state.roundWinner === 0) t.draws += round - t.round;
    t.round = round;
  }

  let shown = 0;
  ['p2Hand', 'p2Front', 'p2Reserve', 'p2Discard'].forEach((k) => {
    (state[k] || []).forEach((c) => { if (c && c.faceUp) shown++; });
  });
  t.revealMax = Math.max(t.revealMax, shown);

  ['p1Front', 'p1Reserve', 'p2Front', 'p2Reserve'].forEach((k) => {
    (state[k] || []).forEach((c) => { if (c && c.faceUp && c.def) t.seenCards.add(c.def.id); });
  });
  if (state.activeIsland) t.seenIslands.add(state.activeIsland);

  const now = state.p1Islands || [];
  now.forEach((id) => {
    if (!t.held.has(id)) { t.captures++; t.captured.add(id); }
  });
  t.held = new Set(now);
}

// ---- 2. the results ladder -------------------------------------------------

let ladder = null;

export function matchEnded(state, { won, paid } = {}) {
  if (!state) return;
  if (!track || track.ref !== state) observe(state);
  const t = track;
  if (t.done) return;
  t.done = true;
  t.reveals += t.revealMax;
  t.revealMax = 0;

  const res = P.recordMatch({
    won, score: state.score, captures: t.captures, reveals: t.reveals, drawRounds: t.draws,
    voyage: !!state.voyageMissionId,
    seenCards: [...t.seenCards], seenIslands: [...t.seenIslands], capturedIslands: [...t.captured],
  });
  res.levelUps.forEach((l) => Telemetry.gameplay('level_up', { level: l.level }));
  res.goalsDone.forEach((g) => Telemetry.gameplay('daily_goal_done', { goal: g }));
  if (res.streakDay) Telemetry.gameplay('streak_day', { day: res.streakDay });
  playLadder(res, paid || { gold: 0, crystals: 0 });
}

const KIND_LABEL = {
  win: 'Victory haul',
  close: 'Close fight -- lost by one island',
  loss: 'Defeat pay',
};

function coin(size) { return itemImg('coin_gold', size, 'pg-coin-img'); }

function ladderHtml(res, paid, startGold) {
  const b = res.before;
  const pips = Array.from({ length: P.PIPS_PER_DIVISION }, (_, i) =>
    `<i class="${i < b.rank.pips ? 'on' : ''}"></i>`).join('');
  const extras = [];
  res.goalsDone.forEach((id) => extras.push(
    `<div class="pg-row pg-extra" data-gold="${P.GOALS[id].gold}"><span class="pg-tick"></span><span class="pg-label">Daily goal: ${esc(P.GOALS[id].text)}</span><span class="pg-num">+${P.GOALS[id].gold}</span></div>`));
  if (res.streakDay) {
    const r = res.streakReward;
    extras.push(`<div class="pg-row pg-extra" data-gold="${r ? r.gold || 0 : 0}"><span class="pg-tick pg-tick-streak"></span><span class="pg-label">Day ${res.streakDay} streak${r && r.crystals ? ' and a crystal' : ''}</span><span class="pg-num">${r ? '+' + r.gold : ''}</span></div>`);
  }
  return `
    <div class="pg-wallet">${coin(16)}<span class="pg-wallet-n">${startGold}</span></div>
    <div class="pg-row pg-reward pg-kind-${res.kind}"><span class="pg-ico">${coin(22)}</span><span class="pg-label">${KIND_LABEL[res.kind]}${paid.crystals ? ' and a crystal' : ''}</span><span class="pg-num">+0</span></div>
    <div class="pg-row pg-xp"><span class="pg-lv">${b.level.level}</span><span class="pg-xp-body"><span class="pg-xp-head"><span class="pg-title">${esc(b.level.title)}</span><span class="pg-num">+0 XP</span></span><span class="pg-bar"><i style="width:${pct(b.level.into, b.level.need)}%"></i></span></span></div>
    <div class="pg-row pg-rank"><span class="pg-ico">${itemImg(b.rank.item, 22, 'pg-cup')}</span><span class="pg-label">${esc(b.rank.name)}</span><span class="pg-pips">${pips}</span></div>
    ${extras.join('')}`;
}

// The P12 count-up. A tick that outlives its ladder (skipped, or replaced)
// stops without writing, so finish()'s final values are never overwritten.
function countUp(el, from, to, ms, fmt) {
  const owner = ladder;
  if (!el || !owner) return;
  const t0 = performance.now();
  const tick = (now) => {
    if (ladder !== owner) return;
    const k = Math.min(1, (now - t0) / ms);
    const e = 1 - Math.pow(1 - k, 3);
    el.textContent = fmt(Math.round(from + (to - from) * e));
    if (k < 1) requestAnimationFrame(tick);
  };
  el.textContent = fmt(from);
  requestAnimationFrame(tick);
}

// Coin chips from a row to the wallet -- the Trading Post's flight
// (ui.js's flyCoinToWallet), re-aimed at the ladder's wallet.
function flyCoins(fromEl, walletEl, n) {
  if (reduced() || !fromEl || !walletEl) return;
  const host = $('game-over-modal');
  const f = fromEl.getBoundingClientRect();
  const w = walletEl.getBoundingClientRect();
  for (let i = 0; i < n; i++) {
    const chip = document.createElement('span');
    chip.className = 'pg-coin-fly';
    chip.innerHTML = coin(20);
    chip.style.left = `${f.left + 18 + i * 6}px`;
    chip.style.top = `${f.top + f.height / 2 - 10}px`;
    host.appendChild(chip);
    const dx = w.left + 8 - (f.left + 18 + i * 6);
    const dy = w.top + w.height / 2 - (f.top + f.height / 2);
    const a = chip.animate([
      { transform: 'translate(0px, 0px) scale(0.6)', opacity: 0 },
      { transform: `translate(${(dx * 0.4).toFixed(1)}px, ${(dy * 0.4 - 26).toFixed(1)}px) scale(1.15)`, opacity: 1, offset: 0.45 },
      { transform: `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px) scale(0.55)`, opacity: 0 },
    ], { duration: 620, delay: i * 90, easing: 'cubic-bezier(0.3, 0.7, 0.4, 1)', fill: 'both' });
    const drop = () => chip.remove();
    a.finished.then(drop, drop);
  }
}

function bump(el) {
  if (!el) return;
  el.classList.remove('pg-bump');
  void el.offsetWidth;
  el.classList.add('pg-bump');
}

function stopLadder() {
  if (!ladder) return;
  ladder.timers.forEach(clearTimeout);
  if (ladder.onTap) $('game-over-modal').removeEventListener('click', ladder.onTap, true);
  ladder = null;
}

function playLadder(res, paid) {
  stopLadder();
  const modal = $('game-over-modal');
  const inner = modal && modal.querySelector('.modal-inner');
  if (!inner) return;
  const old = inner.querySelector('.pg-ladder');
  if (old) old.remove();
  const reward = $('go-reward');
  if (reward) reward.classList.add('hidden');

  // res.balance is only set when a bonus was paid on top of the payout.
  const walletEnd = res.balance ? res.balance.gold : (paid.balance ? paid.balance.gold : paid.gold);
  const walletStart = Math.max(0, walletEnd - paid.gold - res.bonus.gold);
  const box = document.createElement('div');
  box.className = 'pg-ladder';
  box.setAttribute('role', 'status');
  box.innerHTML = ladderHtml(res, paid, walletStart);
  const actions = inner.querySelector('.modal-actions');
  inner.insertBefore(box, actions);

  const buttons = actions ? Array.from(actions.querySelectorAll('button')) : [];
  buttons.forEach((b) => { b.disabled = true; });
  if (actions) actions.classList.add('pg-wait');

  const rows = Array.from(box.querySelectorAll('.pg-row'));
  const wallet = box.querySelector('.pg-wallet');
  const walletN = box.querySelector('.pg-wallet-n');
  const xpRow = box.querySelector('.pg-xp');
  const bar = xpRow.querySelector('.pg-bar i');
  const lvEl = xpRow.querySelector('.pg-lv');
  const titleEl = xpRow.querySelector('.pg-title');
  const rankRow = box.querySelector('.pg-rank');

  const L = { timers: [], onTap: null, done: false };
  ladder = L;
  const at = (ms, fn) => { L.timers.push(setTimeout(() => { if (ladder === L) fn(); }, ms)); };

  const finish = () => {
    if (L.done) return;
    L.done = true;
    L.timers.forEach(clearTimeout);
    const a = res.after;
    rows.forEach((r) => r.classList.add('pg-in'));
    rows[0].querySelector('.pg-num').textContent = `+${paid.gold}`;
    walletN.textContent = String(walletEnd);
    xpRow.querySelector('.pg-num').textContent = `+${res.xpGain} XP`;
    lvEl.textContent = a.level.level;
    titleEl.textContent = a.level.title;
    bar.style.transition = 'none';
    bar.style.width = pct(a.level.into, a.level.need) + '%';
    rankRow.querySelector('.pg-label').textContent = a.rank.name;
    rankRow.querySelectorAll('.pg-pips i').forEach((p, i) => p.classList.toggle('on', i < a.rank.pips));
    const cup = rankRow.querySelector('.pg-cup');
    if (cup && a.rank.item !== res.before.rank.item) cup.outerHTML = itemImg(a.rank.item, 22, 'pg-cup');
    buttons.forEach((b) => { b.disabled = false; });
    if (actions) actions.classList.remove('pg-wait');
    modal.removeEventListener('click', L.onTap, true);
    ladder = null;
  };
  L.onTap = (e) => {
    if (e.target.closest && e.target.closest('.modal-actions')) return;
    finish();
  };
  modal.addEventListener('click', L.onTap, true);
  // Safety net: the buttons must come back even if a timer is starved.
  L.timers.push(setTimeout(finish, 14000));
  if (reduced()) { finish(); return; }

  // Wait for the P12/P13 victory parade (fleet rise, then at most three
  // heroes over this very panel) before the ladder starts.
  const began = performance.now();
  const n = modal.querySelectorAll('.go-fleet-card').length;
  const minWait = res.kind === 'win' && n ? 90 + n * 80 + 740 : 650;
  const poll = () => {
    if (ladder !== L) return;
    if (performance.now() - began < minWait || Hero.isOpen()) { L.timers.push(setTimeout(poll, 100)); return; }
    run();
  };
  poll();

  function run() {
    let t = 0;
    // Row 1: the match payout counts up and flies into the wallet.
    at(t, () => {
      rows[0].classList.add('pg-in');
      countUp(rows[0].querySelector('.pg-num'), 0, paid.gold, 600, (v) => `+${v}`);
      wallet.classList.add('pg-in');
    });
    at(t + 250, () => flyCoins(rows[0], wallet, 3));
    at(t + 700, () => { bump(wallet); countUp(walletN, walletStart, walletStart + paid.gold, 400, String); });
    t += 750;

    // Row 2: XP. The bar fills level by level, with the level-up moment
    // between levels.
    at(t, () => {
      xpRow.classList.add('pg-in');
      countUp(xpRow.querySelector('.pg-num'), 0, res.xpGain, 800, (v) => `+${v} XP`);
    });
    t += 200;
    let gold = walletStart + paid.gold;
    const ups = res.levelUps;
    const fillTo = (w, ms) => { bar.style.transition = `width ${ms}ms cubic-bezier(0.25, 0.8, 0.3, 1)`; bar.style.width = w + '%'; };
    const afterXp = () => {
      const a = res.after;
      fillTo(pct(a.level.into, a.level.need), 600);
      at(650, rankStep);
    };
    const levelStep = (i) => {
      if (i >= ups.length) { afterXp(); return; }
      fillTo(100, 550);
      at(600, () => {
        const prevTitle = titleEl.textContent;
        showLevelUp(ups[i], prevTitle, () => {
          if (ladder !== L) return;
          lvEl.textContent = ups[i].level;
          titleEl.textContent = ups[i].title;
          bump(lvEl);
          // The level's own gold lands in the wallet as the moment closes.
          const from = gold;
          gold += P.LEVEL_REWARD.gold;
          bump(wallet);
          countUp(walletN, from, Math.min(gold, walletEnd), 300, String);
          bar.style.transition = 'none';
          bar.style.width = '0%';
          void bar.offsetWidth;
          levelStep(i + 1);
        });
      });
    };
    at(t, () => levelStep(0));

    // Row 3: rank pips tick; then goals and the streak, each paying out.
    function rankStep() {
      rankRow.classList.add('pg-in');
      const a = res.after;
      const b = res.before;
      at(250, () => {
        rankRow.querySelector('.pg-label').textContent = a.rank.name;
        if (a.rank.item !== b.rank.item) {
          const cup = rankRow.querySelector('.pg-cup');
          if (cup) cup.outerHTML = itemImg(a.rank.item, 22, 'pg-cup');
        }
        rankRow.querySelectorAll('.pg-pips i').forEach((p, i) => {
          const on = i < a.rank.pips;
          if (on !== p.classList.contains('on')) { p.classList.toggle('on', on); bump(p); }
        });
      });
      const extras = rows.slice(3);
      extras.forEach((row, i) => {
        at(500 + i * 300, () => {
          row.classList.add('pg-in');
          const g = Number(row.dataset.gold) || 0;
          if (g) {
            flyCoins(row, wallet, 2);
            const from = gold;
            gold += g;
            const to = Math.min(gold, walletEnd);
            at(560, () => { bump(wallet); countUp(walletN, from, to, 300, String); });
          }
        });
      });
      at(500 + extras.length * 300 + 500, finish);
    }
  }
}

// ---- level-up moment ------------------------------------------------------

const BADGE_SVG = '<svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">'
  + '<g stroke="#f4c24f" stroke-width="5" stroke-linecap="round">'
  + '<path d="M50 4v14M50 82v14M4 50h14M82 50h14M17 17l10 10M73 73l10 10M83 17L73 27M27 73L17 83"/></g>'
  + '<circle cx="50" cy="50" r="33" fill="#0f3050" stroke="#f4c24f" stroke-width="5"/>'
  + '<circle cx="50" cy="50" r="26" fill="none" stroke="rgba(255,233,168,0.45)" stroke-width="2"/></svg>';

export function showLevelUp(up, prevTitle, onDone) {
  const wrap = document.createElement('div');
  wrap.className = 'hero-view hero-moment-victory pg-levelup';
  wrap.setAttribute('role', 'presentation');
  const swap = up.newTitle && prevTitle && prevTitle !== up.title;
  wrap.innerHTML = `<div class="hero-backdrop"></div>
    <div class="hero-frame">
      <div class="pg-badge">${BADGE_SVG}<span>${up.level}</span></div>
      <div class="hero-panel">
        <div class="hero-meta"><span class="hero-capture">Level up</span></div>
        <div class="hero-title pg-lu-title">${esc(swap ? prevTitle : up.title)}</div>
        <div class="hero-ability">+${P.LEVEL_REWARD.gold} gold${up.newTitle ? ' and a crystal -- new title' : ''}</div>
      </div>
    </div>`;
  document.body.appendChild(wrap);
  Audio.cue('island_capture');
  const titleEl = wrap.querySelector('.pg-lu-title');
  if (swap) {
    setTimeout(() => {
      titleEl.textContent = up.title;
      titleEl.classList.add('pg-title-swap');
    }, 700);
  }
  setTimeout(() => {
    wrap.remove();
    if (onDone) onDone();
  }, 1800);
}

// ---- 3. menu, profile, fleet ----------------------------------------------

// The next voyage to sail: a voyage in progress first, else the lowest
// uncleared unlocked mission. null once all twenty are cleared.
function nextVoyage() {
  const prog = loadVoyageProgress();
  const live = loadVoyage();
  if (live && !live.done) return { id: live.missionId, live, prog };
  for (let id = 1; id <= Math.min(prog.unlocked, MISSION_COUNT); id++) {
    if (!prog.cleared[id]) return { id, live: null, prog };
  }
  return null;
}

function routeSvg(prog, current) {
  let dots = '';
  let path = 'M';
  for (let i = 1; i <= MISSION_COUNT; i++) {
    const x = 6 + (i - 1) * (288 / (MISSION_COUNT - 1));
    const y = 13 + Math.sin(i * 0.9) * 6;
    path += `${x.toFixed(1)} ${y.toFixed(1)} `;
    const cls = prog.cleared[i] ? 'done' : i === current ? 'here' : i <= prog.unlocked ? 'open' : 'shut';
    dots += `<circle class="pg-dot ${cls}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${i === current ? 4.6 : 3}"/>`;
  }
  return `<svg class="pg-route" viewBox="0 0 300 26" aria-hidden="true" focusable="false"><path d="${path.trim()}" /></svg>`
    .replace('</svg>', dots + '</svg>');
}

function levelStripHtml(p) {
  const lv = P.levelOf(p.xp);
  const seen = Object.keys(p.seen.cards).filter((id) => CARDS[id]).length
    + Object.keys(p.seen.islands).filter((id) => ISLANDS[id]).length;
  const total = CARD_ORDER.length + Object.keys(ISLANDS).length;
  return `<span class="pg-lv">${lv.level}</span>
    <span class="pg-xp-body"><span class="pg-xp-head"><span class="pg-title">${esc(lv.title)}</span>
    <span class="pg-dim">${lv.need ? `${lv.into} / ${lv.need} XP` : 'Max level'}</span></span>
    <span class="pg-bar"><i style="width:${pct(lv.into, lv.need)}%"></i></span></span>
    <button type="button" class="pg-fleet-btn">Fleet<span>${seen}/${total}</span></button>`;
}

function campaignHtml() {
  const nv = nextVoyage();
  if (!nv) {
    return `<div class="pg-card-head"><span class="pg-kicker">Campaign</span></div>
      <div class="pg-camp-name">All twenty voyages cleared</div>${routeSvg(loadVoyageProgress(), 0)}`;
  }
  const meta = missionMeta(nv.id);
  const firstClear = !nv.prog.cleared[nv.id];
  const where = nv.live ? 'under way' : 'next';
  return `<div class="pg-card-head"><span class="pg-kicker">Campaign -- voyage ${nv.id} of ${MISSION_COUNT}, ${where}</span>
      <button type="button" class="pg-link" data-pg="quick">Quick match</button></div>
    <div class="pg-camp-name">${esc(meta.name)}</div>
    ${routeSvg(nv.prog, nv.id)}
    <div class="pg-next">${itemImg(firstClear ? 'coin_crystal' : 'coin_gold', 16)}<span>Next reward: ${firstClear ? '1 crystal for taking the objective' : 'gold for every battle won'}, +${P.XP.win} XP a win</span></div>`;
}

function untilMidnight() {
  const now = new Date();
  const mid = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const m = Math.max(1, Math.round((mid - now) / 60000));
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function goalsHtml(p) {
  const s = P.streakView(p);
  const goals = p.goals.map((g) => {
    const def = P.GOALS[g.id];
    return `<div class="pg-goal${g.done ? ' done' : ''}"><span class="pg-tick"></span>
      <span class="pg-goal-text">${esc(def.text)}</span>
      <span class="pg-dim">${g.done ? 'Done' : `${g.n}/${def.need}`}</span>
      <span class="pg-goal-gold">${coin(12)}${def.gold}</span>
      <span class="pg-bar"><i style="width:${pct(g.n, def.need)}%"></i></span></div>`;
  }).join('');
  const pips = Array.from({ length: 7 }, (_, i) => {
    const d = i + 1;
    const gift = P.STREAK_REWARDS[d] ? ' gift' : '';
    return `<i class="${d <= s.pip ? 'on' : ''}${gift}">${P.STREAK_REWARDS[d] ? d : ''}</i>`;
  }).join('');
  return `<div class="pg-card-head"><span class="pg-kicker">Daily goals</span><span class="pg-dim">New in ${untilMidnight()}</span></div>
    ${goals}
    <div class="pg-streak"><span class="pg-kicker">Streak</span><span class="pg-pips7">${pips}</span>
      <span class="pg-dim">${s.count} day${s.count === 1 ? '' : 's'}${s.playedToday ? '' : ', play today'}</span></div>`;
}

function ensureEl(id, cls, parent, before) {
  let el = $(id);
  if (!el) {
    el = document.createElement('div');
    el.id = id;
    el.className = cls;
    parent.insertBefore(el, before || null);
  }
  return el;
}

function renderMenu() {
  const menu = $('main-menu');
  const inner = menu && menu.querySelector('.menu-inner');
  const start = $('btn-start');
  if (!inner || !start) return;
  const p = P.loadProgress();
  // Guarded: classList.add on a class already present still counts as an
  // attribute write, and watch() below would re-render forever.
  if (!menu.classList.contains('pg-on')) menu.classList.add('pg-on');
  ensureEl('pg-level', 'pg-level', start.parentNode, start).innerHTML = levelStripHtml(p);
  const after = start.nextSibling;
  ensureEl('pg-campaign', 'pg-card pg-campaign', start.parentNode, after).innerHTML = campaignHtml();
  const camp = $('pg-campaign');
  ensureEl('pg-goals', 'pg-card pg-goals', start.parentNode, camp.nextSibling).innerHTML = goalsHtml(p);

  const nv = nextVoyage();
  if (tutorialDone() && nv) {
    start.dataset.pgVoyage = String(nv.id);
    start.textContent = `Set sail: ${missionMeta(nv.id).name}`;
    camp.classList.add('pg-default');
  } else {
    delete start.dataset.pgVoyage;
    start.textContent = 'Play vs AI';
    camp.classList.remove('pg-default');
  }
}

function renderProfileCard() {
  const preview = $('profile-preview');
  if (!preview) return;
  const p = P.loadProgress();
  const lv = P.levelOf(p.xp);
  const rank = P.rankOf(p.rank);
  const s = P.streakView(p);
  const el = ensureEl('pg-profile', 'pg-card pg-profile', preview.parentNode, preview.nextSibling);
  el.innerHTML = `<div class="pg-level">${levelStripHtml(p)}</div>
    <div class="pg-profile-row">${itemImg(rank.item, 20, 'pg-cup')}<span>${esc(rank.name)}</span>
      <span class="pg-dim">${p.matches || 0} matches, streak ${s.count}</span></div>`;
}

// ---- the Fleet screen --------------------------------------------------------

let fleetHost = null;

function fleetScreen() {
  let scr = $('fleet-screen');
  if (scr) return scr;
  scr = document.createElement('div');
  scr.id = 'fleet-screen';
  scr.className = 'screen hidden';
  scr.innerHTML = `<div class="menu-inner pg-fleet-inner">
      <h1 class="pg-fleet-title">Fleet</h1>
      <p class="pg-dim">Every ship and island in the game. Sight one in a match and it joins your log. Tap a sighted card to see it up close.</p>
      <div id="pg-fleet-body"></div>
      <button type="button" id="btn-fleet-back" class="btn-secondary">Back</button>
    </div>`;
  document.body.appendChild(scr);
  fleetHost = document.createElement('div');
  fleetHost.className = 'pg-hero-host';
  document.body.appendChild(fleetHost);
  scr.querySelector('#btn-fleet-back').addEventListener('click', closeFleet);
  scr.addEventListener('click', (e) => {
    const tile = e.target.closest('.pg-tile');
    if (!tile || tile.classList.contains('locked')) return;
    const opts = { interactive: true, host: fleetHost, cls: 'hero-moment-inspect' };
    if (tile.dataset.card) Hero.showCard(CARDS[tile.dataset.card], opts);
    else {
      const def = ISLANDS[tile.dataset.island];
      Hero.showIsland(def, buildIslandEl(def, 'big', {}), { ...opts, meta: tile.dataset.owned ? '<span class="hero-capture">Held</span>' : '' });
    }
  });
  return scr;
}

function renderFleet() {
  const body = $('pg-fleet-body');
  const p = P.loadProgress();
  const count = (id) => DECK_IDS.filter((d) => d === id).length;
  const units = CARD_ORDER.slice().sort((a, b) => CARDS[b].strength - CARDS[a].strength);
  const unitSeen = units.filter((id) => p.seen.cards[id]).length;
  const isl = Object.keys(ISLANDS);
  const islSeen = isl.filter((id) => p.seen.islands[id]).length;
  body.innerHTML = `<h2 class="pg-h">Ships and planes <span class="pg-dim">${unitSeen}/${units.length} sighted</span></h2>
    <div class="pg-grid pg-grid-units"></div>
    <h2 class="pg-h">Islands <span class="pg-dim">${islSeen}/${isl.length} sighted, ${Object.keys(p.owned.islands).length} held</span></h2>
    <div class="pg-grid pg-grid-islands"></div>`;
  const ug = body.querySelector('.pg-grid-units');
  units.forEach((id) => {
    const seen = !!p.seen.cards[id];
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'pg-tile' + (seen ? '' : ' locked');
    tile.dataset.card = id;
    tile.appendChild(buildCardEl(CARDS[id], seen));
    tile.insertAdjacentHTML('beforeend', `<span class="pg-tile-name">${esc(CARDS[id].name)}</span>
      <span class="pg-dim">${seen ? `In your deck x${count(id)}` : 'Not yet sighted'}</span>`);
    ug.appendChild(tile);
  });
  const ig = body.querySelector('.pg-grid-islands');
  isl.forEach((id) => {
    const def = ISLANDS[id];
    const seen = !!p.seen.islands[id];
    const owned = !!p.owned.islands[id];
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'pg-tile pg-tile-island' + (seen ? '' : ' locked') + (id === 'two_island' ? ' tier-gold' : ' tier-silver');
    tile.dataset.island = id;
    if (owned) tile.dataset.owned = '1';
    tile.appendChild(buildIslandEl(def, 'big', { mine: owned }));
    tile.insertAdjacentHTML('beforeend', `<span class="pg-tile-name">${esc(def.name)}</span>
      <span class="pg-dim">${owned ? 'Held' : seen ? 'Sighted' : 'Not yet sighted'}</span>`);
    ig.appendChild(tile);
  });
}

export function openFleet() {
  const scr = fleetScreen();
  renderFleet();
  if (deps.showScreen) deps.showScreen('fleet');
  document.querySelectorAll('.screen').forEach((s) => { if (s !== scr) s.classList.add('hidden'); });
  scr.classList.remove('hidden');
  scr.scrollTop = 0;
  Telemetry.gameplay('fleet_opened', {});
}

function closeFleet() {
  Hero.close();
  const scr = $('fleet-screen');
  if (scr) scr.classList.add('hidden');
  if (deps.showScreen) deps.showScreen('menu');
}

// ---- wiring ------------------------------------------------------------------

function watch(id, onShow) {
  const el = $(id);
  if (!el) return;
  new MutationObserver(() => { if (!el.classList.contains('hidden')) onShow(); })
    .observe(el, { attributes: true, attributeFilter: ['class'] });
  if (!el.classList.contains('hidden')) onShow();
}

export function init(d) {
  deps = d || {};
  if (!document.querySelector('link[data-pg]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = new URL('./progress.css', import.meta.url).href;
    link.dataset.pg = '1';
    document.head.appendChild(link);
  }
  const params = new URLSearchParams(window.location.search);
  // Debug-only seeding for the screenshot pass.
  if (params.get('seed') === 'progress' || params.get('levelup') === '1') {
    P.seedDemo({ nearLevelUp: params.get('levelup') === '1' });
    try { window.localStorage.setItem(TUTORIAL_KEY, '1'); } catch (e) { /* demo only */ }
  }

  // "Play" sails the next voyage once the tutorial is done. Capture phase on
  // the document, so this runs before app.js's own listener on the button
  // and only swallows the click when it takes it.
  document.addEventListener('click', (e) => {
    const t = e.target.closest && e.target.closest('#btn-start, .pg-fleet-btn, #pg-campaign');
    if (!t) return;
    if (t.classList.contains('pg-fleet-btn')) { e.stopPropagation(); openFleet(); return; }
    if (t.id === 'pg-campaign') {
      if (e.target.closest('[data-pg="quick"]')) { if (deps.startGame) deps.startGame(); return; }
      const nv = nextVoyage();
      if (nv && deps.startVoyage) deps.startVoyage(nv.id);
      return;
    }
    const id = Number(t.dataset.pgVoyage);
    if (id && deps.startVoyage && tutorialDone()) {
      e.stopPropagation();
      e.preventDefault();
      deps.startVoyage(id);
    }
  }, true);

  watch('main-menu', renderMenu);
  watch('profile-screen', renderProfileCard);
  // A new day can start while the menu is open.
  setInterval(() => { const m = $('main-menu'); if (m && !m.classList.contains('hidden')) renderMenu(); }, 60000);

  const demo = params.get('demo');
  if (demo === 'levelup') {
    setTimeout(() => showLevelUp({ level: 8, title: 'Helmsman', newTitle: true }, 'Boatswain', null), 900);
  } else if (demo === 'fleet') {
    setTimeout(openFleet, 900);
  }
}
