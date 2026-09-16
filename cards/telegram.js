// Telegram WebApp integration -- entirely defensive. The game must load and
// play identically in a plain browser where `window.Telegram` never exists
// (it's only injected by the Telegram client when this page is opened from
// a WebApp button, via the telegram-web-app.js script tag in index.html).
//
// See index.html for the <script src="https://telegram.org/js/telegram-web-app.js">
// tag, and the repo root README/PR notes for the bot-side WebAppInfo wiring
// (there is no live non-crypto bot in this tree to wire it into yet -- the
// exact snippet + which bot token is documented there).

const LOCAL_NAME_KEY = 'seahunter_player_name';

function tg() {
  try {
    return (typeof window !== 'undefined' && window.Telegram && window.Telegram.WebApp) || null;
  } catch (e) {
    return null;
  }
}

// Call once on load. Safe no-op outside Telegram.
export function initTelegram() {
  const app = tg();
  if (!app) return;
  try {
    app.ready();
    app.expand();
  } catch (e) { /* older client versions may lack expand() -- ignore */ }
}

// Returns { id, name } from Telegram initData, or null if unavailable.
export function getTelegramUser() {
  const app = tg();
  if (!app || !app.initDataUnsafe || !app.initDataUnsafe.user) return null;
  const u = app.initDataUnsafe.user;
  const name = [u.first_name, u.last_name].filter(Boolean).join(' ') || u.username || null;
  if (!name) return null;
  return { id: u.id ?? null, name };
}

// Resolve the display name used for the leaderboard: Telegram identity first,
// then a locally-remembered guest name, then a generic fallback. Never
// blocks/prompts during normal play -- setPlayerName() below is what a menu
// button would call to let a non-Telegram player set a name once.
export function getPlayerName() {
  const tgUser = getTelegramUser();
  if (tgUser) return tgUser.name;
  try {
    const stored = window.localStorage.getItem(LOCAL_NAME_KEY);
    if (stored) return stored;
  } catch (e) { /* localStorage unavailable (private mode, etc.) */ }
  return 'Captain';
}

export function setPlayerName(name) {
  try {
    window.localStorage.setItem(LOCAL_NAME_KEY, String(name).slice(0, 32));
  } catch (e) { /* ignore */ }
}

export function getTelegramUserId() {
  const u = getTelegramUser();
  return u ? u.id : null;
}
