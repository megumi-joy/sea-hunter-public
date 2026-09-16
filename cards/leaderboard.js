// Leaderboard -- localStorage-first, remote-optional. The local store always
// works (matches the "fastest version" / weak-connection ethos and PR #63's
// bare-HTML approach); the remote fetch/submit are best-effort enhancements
// that must never block or break play if the API is unreachable, slow, or
// missing entirely (see BACKEND NOTE below).
//
// BACKEND NOTE: the remote endpoint this calls is
//   GET  {API_BASE}/v1/games/sea-hunter/leaderboard
//   POST {API_BASE}/v1/games/sea-hunter/leaderboard
// GET already exists and is live on voicy-dev (src/routers/games.py, mounted
// via cloud_api.py's `_mount("games", ...)`). POST is added alongside it in
// the companion backend PR (base: voicy-dev) -- see that PR's description.
// API_BASE defaults to the public voicy API host; override with
// `window.SEAHUNTER_API_BASE` for local/staging testing.

import { getPlayerName, getTelegramUserId } from './telegram.js';
import { loadProfile, handleOf } from './profile.js';
import { syncFields } from './progression.js';

const LOCAL_KEY = 'seahunter_local_scores';
const LOCAL_MAX = 20;
const REMOTE_TIMEOUT_MS = 4000;

function apiBase() {
  try {
    return (typeof window !== 'undefined' && window.SEAHUNTER_API_BASE) || 'https://api.voicydroid.com';
  } catch (e) {
    return 'https://api.voicydroid.com';
  }
}

// ── Local (always available) ───────────────────────────────────────
export function getLocalScores() {
  try {
    const raw = window.localStorage.getItem(LOCAL_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch (e) {
    return [];
  }
}

export function recordLocalScore(entry) {
  try {
    const list = getLocalScores();
    list.push({ ...entry, ts: Date.now() });
    list.sort((a, b) => b.score - a.score);
    window.localStorage.setItem(LOCAL_KEY, JSON.stringify(list.slice(0, LOCAL_MAX)));
  } catch (e) { /* localStorage unavailable -- local leaderboard just won't persist */ }
}

// ── Remote (best-effort) ───────────────────────────────────────────
async function withTimeout(promise, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await promise(ctrl.signal);
  } finally {
    clearTimeout(t);
  }
}

export async function fetchRemoteLeaderboard(limit = 10) {
  try {
    const res = await withTimeout(
      (signal) => fetch(`${apiBase()}/v1/games/sea-hunter/leaderboard?limit=${limit}`, { signal }),
      REMOTE_TIMEOUT_MS
    );
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data.leaderboard) ? data.leaderboard : null;
  } catch (e) {
    return null; // offline, CORS, 404 (route not deployed yet), timeout -- all degrade silently
  }
}

// `result` = { score, rounds, won, campaignLevelId }. Never throws.
export async function submitRemoteScore(result) {
  try {
    const profile = loadProfile();
    const body = {
      // The profile handle is the identity now; the telegram name stays as a
      // fallback for very old saves that predate profiles.
      name: handleOf(profile) || getPlayerName(),
      avatar: profile.avatarId,
      tag: profile.tag,
      telegram_id: getTelegramUserId(),
      score: result.score,
      rounds: result.rounds,
      won: !!result.won,
      campaign_level: result.campaignLevelId || null,
      // P15: level, title, xp and rank ride along on the same POST.
      ...syncFields(),
    };
    await withTimeout(
      (signal) => fetch(`${apiBase()}/v1/games/sea-hunter/leaderboard`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      }),
      REMOTE_TIMEOUT_MS
    );
  } catch (e) {
    // Best-effort only -- the local leaderboard already has this score.
  }
}

// Record a finished game everywhere it can go: local always, remote if
// reachable. Returns the local entry (for immediate UI feedback).
export async function recordGameResult(result) {
  const profile = loadProfile();
  const entry = {
    name: handleOf(profile) || getPlayerName(),
    avatar: profile.avatarId,
    score: result.score,
    rounds: result.rounds,
    won: !!result.won,
    campaignLevelId: result.campaignLevelId || null,
  };
  recordLocalScore(entry);
  submitRemoteScore(result); // fire-and-forget, no await -- must not block the UI
  return entry;
}
