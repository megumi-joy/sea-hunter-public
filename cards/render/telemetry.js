// P8 "Pause, feedback, telemetry" -- anonymous telemetry with consent.
//
// Same semantics as the native Godot clients (Sea Hunter, Spyfall,
// VoxelWorldCraft) and the same ingest endpoint, so one dashboard covers
// every build:
//
//   * a random install_id kept in localStorage under `seahunter.install_id`
//   * a session_id minted per page load (never persisted)
//   * three modes in `seahunter.telemetry`: off / review / on. UNSET is a
//     fourth state and means "ask" -- nothing is ever sent while the mode
//     is unset or off, not even the device record.
//   * batches POSTed every 60 s and on pagehide (sendBeacon, so a closing
//     tab still gets the last batch out)
//
// Review mode is the middle ground the privacy policy promises: events pile
// up in localStorage and leave the device only when the player looks at the
// JSON in Settings and presses Send.
//
// Gameplay events (the `event` field of a `gameplay` record):
//   app_start, screen, match_start, match_end, round_end, connection_lost
//   tutorial_started, tutorial_step {step, name},
//   tutorial_skipped {step, scope: 'step' | 'all'}, tutorial_completed,
//   howto_opened {from: 'menu' | 'pause' | 'demo'}         (P14, render/tutorial.js)
//
// Nothing in this module reads game rules. app.js calls track() at the few
// points that matter and hands the mode/round/score in.

const INSTALL_KEY = 'seahunter.install_id';
const MODE_KEY = 'seahunter.telemetry';
const LANG_KEY = 'seahunter.telemetry_lang';
const QUEUE_KEY = 'seahunter.telemetry_queue';
// Set on a clean shutdown (pagehide) and cleared on the next load. A load
// that finds it MISSING is a run whose previous session never got to say
// goodbye -- a crash, a kill, a battery death. Same trick the Godot clients
// use, and the only "crash reporting" any of them do.
const CLEAN_EXIT_KEY = 'seahunter.clean_exit';

export const GAME_ID = 'seahunter_web';
// The build string sent with telemetry and feedback. Bumped by hand per
// phase -- there is no build step in this game to stamp one in.
export const VERSION = '0.8.0-p8';

const API_DEFAULT = 'https://api.voicydroid.com';
export const PRIVACY_URL = 'https://voicydroid.com/games/privacy.html';
export const TERMS_URL = 'https://voicydroid.com/games/terms.html';

const FLUSH_MS = 60000;
const PERF_SAMPLE_MS = 30000;
// The ingest caps a payload at 64 KB. Batches are tiny, but a review-mode
// queue that sat on a device for a week is not, so it is trimmed oldest-first.
const MAX_QUEUED_EVENTS = 400;

function apiBase() {
  try {
    return (typeof window !== 'undefined' && window.SEAHUNTER_API_BASE) || API_DEFAULT;
  } catch (e) {
    return API_DEFAULT;
  }
}

// Every localStorage access in this file goes through these two: private
// mode and storage-disabled browsers must degrade to "telemetry just does
// not persist", never to a thrown error on a game screen.
function lsGet(key) {
  try {
    return window.localStorage.getItem(key);
  } catch (e) {
    return null;
  }
}

function lsSet(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch (e) { /* nothing to do -- the value just will not survive a reload */ }
}

function randomId() {
  try {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
  } catch (e) { /* fall through to the Math.random id below */ }
  return 'id-' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

// ---- identity --------------------------------------------------------

let sessionId = randomId();

export function getInstallId() {
  let id = lsGet(INSTALL_KEY);
  if (!id) {
    id = randomId();
    lsSet(INSTALL_KEY, id);
  }
  return id;
}

export function getSessionId() {
  return sessionId;
}

// "web" unless we are genuinely inside a Telegram client. index.html loads
// telegram-web-app.js unconditionally, so `window.Telegram.WebApp` EXISTS in
// an ordinary browser too -- testing for the object alone would report every
// player as telegram. initDataUnsafe/initData is only populated by the real
// client, which is the same signal telegram.js's getTelegramUser() uses.
export function platform() {
  try {
    const app = window.Telegram && window.Telegram.WebApp;
    if (!app) return 'web';
    const unsafe = app.initDataUnsafe;
    const hasInit = (unsafe && Object.keys(unsafe).length > 0) || !!app.initData;
    return hasInit ? 'telegram' : 'web';
  } catch (e) {
    return 'web';
  }
}

// ---- mode ------------------------------------------------------------

const MODES = ['off', 'review', 'on'];

// null means unset ("ask on first launch"). A URL override (?telemetry=)
// wins for the page load and is deliberately NOT written to localStorage:
// a QA link or the tour must not silently rewrite a player's stored choice.
let overrideMode = null;

export function getMode() {
  if (overrideMode) return overrideMode;
  const raw = lsGet(MODE_KEY);
  return MODES.indexOf(raw) >= 0 ? raw : null;
}

export function setMode(mode) {
  if (MODES.indexOf(mode) < 0) return;
  overrideMode = null;
  lsSet(MODE_KEY, mode);
  applyMode();
}

export function isDecided() {
  return getMode() !== null;
}

// ---- language --------------------------------------------------------

export function getLang() {
  const stored = lsGet(LANG_KEY);
  if (stored === 'en' || stored === 'ru') return stored;
  try {
    return String(navigator.language || 'en').toLowerCase().startsWith('ru') ? 'ru' : 'en';
  } catch (e) {
    return 'en';
  }
}

export function setLang(lang) {
  lsSet(LANG_KEY, lang === 'ru' ? 'ru' : 'en');
}

// The consent wording. The Godot clients carry this as a TEXT dict in
// Telemetry.gd; that project is not in this repo, so the strings below are
// taken from the same source that dict was written against --
// www/games/privacy.html's "Short version" and "Consent and control"
// sections, in both languages it is published in.
export const TEXT = {
  en: {
    title: 'Anonymous telemetry',
    body: 'Sea Hunter has no accounts. We do not ask for your name, e-mail or'
      + ' phone number, we do not use advertising identifiers, and we do not'
      + ' sell data.',
    what: 'If you turn it on, the game sends: your device (browser, screen,'
      + ' language, memory), performance (frame rate, long frames), and'
      + ' gameplay events (screens opened, matches started and finished,'
      + ' round results, lost connections). Nothing else, and never anything'
      + ' you type.',
    modes: 'Review before sending keeps everything on this device; it leaves'
      + ' only after you look at it in Settings and press Send.',
    refuse: 'Refusing does not limit the game in any way, and you can change'
      + ' this at any time in Settings.',
    accept: 'Accept',
    review: 'Review first',
    decline: 'Decline',
    privacy: 'Privacy policy',
    terms: 'Terms',
    language: 'Language',
  },
  ru: {
    title: 'Анонимная телеметрия',
    body: 'В Sea Hunter нет аккаунтов. Мы не спрашиваем имя, e-mail или номер'
      + ' телефона, не используем рекламные идентификаторы и не продаём'
      + ' данные.',
    what: 'Если вы включите отправку, игра пришлёт: сведения об устройстве'
      + ' (браузер, экран, язык, память), производительность (частота кадров,'
      + ' долгие кадры) и игровые события (открытые экраны, начатые и'
      + ' завершённые матчи, результаты раундов, потери связи). Больше'
      + ' ничего, и никогда то, что вы вводите с клавиатуры.',
    modes: 'Режим «сначала посмотреть» держит всё на этом устройстве; данные'
      + ' уходят только после того, как вы посмотрите их в настройках и'
      + ' нажмёте «Отправить».',
    refuse: 'Отказ никак не ограничивает игру, и изменить выбор можно в любой'
      + ' момент в настройках.',
    accept: 'Разрешить',
    review: 'Сначала посмотреть',
    decline: 'Отказаться',
    privacy: 'Политика конфиденциальности',
    terms: 'Условия',
    language: 'Язык',
  },
};

export function t(key) {
  const dict = TEXT[getLang()] || TEXT.en;
  return dict[key] || TEXT.en[key] || '';
}

// ---- the queue -------------------------------------------------------

let queue = [];

function loadQueue() {
  try {
    const parsed = JSON.parse(lsGet(QUEUE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

function persistQueue() {
  // Only review mode needs the queue to survive a reload -- in `on` mode a
  // batch is at most 60 s old and writing localStorage on every event would
  // be pure churn.
  if (getMode() !== 'review') return;
  try {
    lsSet(QUEUE_KEY, JSON.stringify(queue));
  } catch (e) { /* queue stays in memory only */ }
}

export function getQueue() {
  return queue.slice();
}

export function clearQueue() {
  queue = [];
  lsSet(QUEUE_KEY, '[]');
}

function envelope(events) {
  return {
    game: GAME_ID,
    install_id: getInstallId(),
    session_id: sessionId,
    version: VERSION,
    platform: platform(),
    sent_at: new Date().toISOString(),
    events,
  };
}

// ---- sending ---------------------------------------------------------

function post(body, { beacon = false } = {}) {
  const url = apiBase() + '/v1/games/telemetry/anon';
  const json = JSON.stringify(body);
  if (beacon) {
    try {
      // A JSON Blob keeps the content-type the API expects; the preflight
      // for it is already allowed (Access-Control-Allow-Headers: content-type).
      if (navigator.sendBeacon
        && navigator.sendBeacon(url, new Blob([json], { type: 'application/json' }))) {
        return Promise.resolve(true);
      }
    } catch (e) { /* fall through to fetch below */ }
  }
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: json,
    keepalive: beacon,
  }).then((res) => res.ok).catch(() => false);
}

// Flush whatever is queued. Returns a promise of true on a delivered batch.
// A failed send puts the events back so the next flush retries them rather
// than dropping a batch because the tunnel blinked.
export function flush({ beacon = false, force = false } = {}) {
  const mode = getMode();
  if (!queue.length) return Promise.resolve(true);
  // `force` is the Send button in review mode -- the one path that may send
  // while the mode is not `on`. Never anything while off or unset.
  if (mode !== 'on' && !(force && mode === 'review')) return Promise.resolve(false);
  const batch = queue;
  queue = [];
  persistQueue();
  return Promise.resolve(post(envelope(batch), { beacon })).then((ok) => {
    if (!ok && !beacon) {
      queue = batch.concat(queue).slice(-MAX_QUEUED_EVENTS);
      persistQueue();
    }
    return !!ok;
  });
}

// The Settings "Send" button. Resolves to true only on a delivered batch,
// so the caller can say so on its status line.
export function sendReviewQueue() {
  return flush({ force: true });
}

// ---- recording -------------------------------------------------------

export function track(type, data) {
  const mode = getMode();
  if (mode !== 'on' && mode !== 'review') return;
  queue.push({ type, t: Math.round(performance.now()), ...(data || {}) });
  if (queue.length > MAX_QUEUED_EVENTS) queue = queue.slice(-MAX_QUEUED_EVENTS);
  persistQueue();
}

// Convenience wrapper: every gameplay event shares one envelope type, with
// its own `event` name, so the ingest can filter on `type` alone.
//
// Gameplay events sent by this build, and where they are raised:
//   app_start {platform, version}                               -- this file
//   match_start {mode}, match_end {mode, result, rounds, duration_sec},
//   round_end {round, winner, reason}, connection_lost {mode}   -- app.js
//   screen {screen}                                             -- ui.js
//   level_up {level}, daily_goal_done {goal}, streak_day {day},
//   fleet_opened                                   -- render/progress.js (P15)
export function gameplay(event, data) {
  track('gameplay', { event, ...(data || {}) });
}

function deviceEvent() {
  const d = { ua: navigator.userAgent, dpr: window.devicePixelRatio || 1 };
  try {
    d.screen = (window.screen ? window.screen.width : 0) + 'x'
      + (window.screen ? window.screen.height : 0);
    d.viewport = window.innerWidth + 'x' + window.innerHeight;
    d.language = navigator.language || '';
  } catch (e) { /* a missing field is better than no device record */ }
  // Chrome-only, and absent on iOS Safari and Firefox -- reported when
  // present rather than faked.
  if (typeof navigator.deviceMemory === 'number') d.memory_gb = navigator.deviceMemory;
  if (typeof navigator.hardwareConcurrency === 'number') d.cores = navigator.hardwareConcurrency;
  return d;
}

// ---- performance sampling -------------------------------------------
//
// One rAF loop counts frames; every 30 s the average FPS and the number of
// long tasks observed since the last sample go out as one event. Both the
// loop and the observer are only STARTED once a mode that records is
// chosen -- a declining player pays no rAF at all, not merely no upload.

let rafId = 0;
let perfTimer = 0;
let frames = 0;
let windowStart = 0;
let longTasks = 0;
let longTaskObserver = null;

function frameTick() {
  frames += 1;
  rafId = requestAnimationFrame(frameTick);
}

function samplePerformance() {
  const now = performance.now();
  const elapsed = (now - windowStart) / 1000;
  if (elapsed > 0.5) {
    track('performance', {
      fps: Math.round((frames / elapsed) * 10) / 10,
      long_tasks: longTasks,
      window_sec: Math.round(elapsed),
    });
  }
  frames = 0;
  longTasks = 0;
  windowStart = now;
}

function startSampling() {
  if (rafId) return;
  windowStart = performance.now();
  frames = 0;
  longTasks = 0;
  rafId = requestAnimationFrame(frameTick);
  perfTimer = window.setInterval(samplePerformance, PERF_SAMPLE_MS);
  try {
    longTaskObserver = new PerformanceObserver((list) => {
      longTasks += list.getEntries().length;
    });
    longTaskObserver.observe({ entryTypes: ['longtask'] });
  } catch (e) {
    // longtask is Chromium-only; its absence just means long_tasks stays 0.
    longTaskObserver = null;
  }
}

function stopSampling() {
  if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
  if (perfTimer) { window.clearInterval(perfTimer); perfTimer = 0; }
  if (longTaskObserver) {
    try { longTaskObserver.disconnect(); } catch (e) { /* already gone */ }
    longTaskObserver = null;
  }
}

// ---- lifecycle -------------------------------------------------------

let flushTimer = 0;
let sessionOpened = false;
// Whether the PREVIOUS session ended without a pagehide. Latched at init()
// and emitted with the rest of the once-per-session records.
let pendingUnexpectedExit = false;

// Emit the once-per-session records (device, unexpected_exit, app_start) the
// first time a recording mode is active. Deferred rather than done at init
// because the mode may only be chosen later, in the consent dialog.
function openSession() {
  if (sessionOpened) return;
  sessionOpened = true;
  track('device', deviceEvent());
  if (pendingUnexpectedExit) {
    track('unexpected_exit', { previous_session: true });
    pendingUnexpectedExit = false;
  }
  gameplay('app_start', { platform: platform(), version: VERSION });
}

function applyMode() {
  const mode = getMode();
  if (mode === 'on' || mode === 'review') {
    openSession();
    startSampling();
    if (!flushTimer && mode === 'on') flushTimer = window.setInterval(() => flush(), FLUSH_MS);
  } else {
    stopSampling();
    if (flushTimer) { window.clearInterval(flushTimer); flushTimer = 0; }
    // Anything recorded before a switch to off is discarded, not held:
    // "never send anything when the mode is off" includes later.
    clearQueue();
    queue = [];
  }
}

let initialised = false;

// Call once, at DOMContentLoaded, before anything else wants to track.
// `params` is the page's URLSearchParams. Returns true if the consent
// dialog should be shown (unset mode, and not suppressed by a flag).
export function init(params) {
  if (initialised) return false;
  initialised = true;

  // ?telemetry=off|on|review, and ?tour=1 implies off -- the QA tour must
  // neither send anything nor be interrupted by a first-launch dialog.
  const flag = params && params.get('telemetry');
  if (MODES.indexOf(flag) >= 0) overrideMode = flag;
  else if (params && params.get('tour') === '1') overrideMode = 'off';

  // Read the clean-exit marker before this session overwrites it.
  pendingUnexpectedExit = lsGet(CLEAN_EXIT_KEY) === 'dirty';
  lsSet(CLEAN_EXIT_KEY, 'dirty');

  queue = loadQueue();
  applyMode();

  window.addEventListener('pagehide', () => {
    lsSet(CLEAN_EXIT_KEY, 'clean');
    if (getMode() === 'on') flush({ beacon: true });
    else persistQueue();
  });

  return getMode() === null && !overrideMode;
}

// Exposed for the tour and for a console poke: the exact JSON that would be
// sent right now, which is what Settings shows in review mode.
export function previewPayload() {
  return envelope(getQueue());
}

// ---- consent dialog --------------------------------------------------
//
// Shown once, on the first launch that finds the mode unset. Three answers,
// the same three the Godot clients offer: Accept (on), Review first
// (review), Decline (off) -- plus a language select, because the choice a
// player is being asked to make has to be readable in the language they
// have, and navigator.language is only a guess.

let consentEl = null;
let consentDone = null;

function consentHtml() {
  return `
    <div class="consent-panel">
      <div class="consent-head">
        <h2>${t('title')}</h2>
        <label class="consent-lang">
          <span>${t('language')}</span>
          <select id="consent-lang">
            <option value="en"${getLang() === 'en' ? ' selected' : ''}>English</option>
            <option value="ru"${getLang() === 'ru' ? ' selected' : ''}>Русский</option>
          </select>
        </label>
      </div>
      <p>${t('body')}</p>
      <p>${t('what')}</p>
      <p>${t('modes')}</p>
      <p class="consent-dim">${t('refuse')}</p>
      <div class="consent-links">
        <a href="${PRIVACY_URL}" target="_blank" rel="noopener">${t('privacy')}</a>
        <a href="${TERMS_URL}" target="_blank" rel="noopener">${t('terms')}</a>
      </div>
      <div class="consent-actions">
        <button id="btn-consent-accept" class="btn-primary" type="button">${t('accept')}</button>
        <button id="btn-consent-review" class="btn-secondary" type="button">${t('review')}</button>
        <button id="btn-consent-decline" class="btn-secondary" type="button">${t('decline')}</button>
      </div>
    </div>`;
}

function wireConsent() {
  const pick = (id, mode) => {
    const el = consentEl.querySelector('#' + id);
    if (el) el.addEventListener('click', () => { setMode(mode); closeConsent(); });
  };
  pick('btn-consent-accept', 'on');
  pick('btn-consent-review', 'review');
  pick('btn-consent-decline', 'off');
  const sel = consentEl.querySelector('#consent-lang');
  // Switching language re-renders in place rather than reloading -- the
  // dialog is the first thing a player sees and a reload would look like a
  // crash.
  if (sel) sel.addEventListener('change', () => { setLang(sel.value); renderConsent(); });
}

function renderConsent() {
  consentEl.innerHTML = consentHtml();
  wireConsent();
}

export function openConsent(onDone) {
  consentDone = onDone || null;
  if (!consentEl) {
    consentEl = document.createElement('div');
    consentEl.id = 'telemetry-consent';
    consentEl.className = 'consent-overlay';
    document.body.appendChild(consentEl);
  }
  consentEl.classList.remove('hidden');
  renderConsent();
}

export function closeConsent() {
  if (consentEl) consentEl.classList.add('hidden');
  const fn = consentDone;
  consentDone = null;
  if (fn) fn(getMode());
}

export function isConsentOpen() {
  return !!consentEl && !consentEl.classList.contains('hidden');
}

// ---- the Settings section -------------------------------------------
//
// Rendered into the existing #settings-content by ui.js's renderSettings,
// under the toggle list. Kept here rather than in ui.js so the mode names,
// the storage keys and the wording stay in one file.

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s == null ? '' : s;
  return div.innerHTML;
}

// Whether the "Advanced" disclosure is open, kept at module scope rather
// than read off the <details> element (P10 fix 4).
//
// renderTelemetrySection() tears its whole section down and rebuilds it on
// every mode change, every send and every discard -- the review block
// appears and disappears with the mode, so patching it in place would be
// more code than redrawing. That means the <details> is a NEW element each
// time, and a fresh <details> is closed. Without this flag, changing the
// sending mode would slam the disclosure shut under the player's finger.
let advancedOpen = false;

// ---- the themed segmented control (P10 fix 4) ------------------------
// Replaces the two native <select>s. A <select> on a phone is an OS sheet in
// the OS's own chrome: it is the one control in this build that does not
// belong to the game, and with three short options there is no reason to
// pay that. Real <button>s, so the whole group is keyboard-reachable and
// each option states its own pressed state to a screen reader.
function segHtml(id, value, options) {
  const buttons = options.map(([val, label]) => {
    const on = val === value;
    return `<button type="button" class="seg-btn${on ? ' is-on' : ''}"`
      + ` data-seg="${id}" data-value="${escapeHtml(val)}"`
      + ` aria-pressed="${on ? 'true' : 'false'}">${escapeHtml(label)}</button>`;
  }).join('');
  return `<div class="seg" role="group">${buttons}</div>`;
}

export function renderTelemetrySection(host) {
  if (!host) return;
  const mode = getMode() || 'off';
  const queued = getQueue();
  const section = document.createElement('div');
  section.className = 'telemetry-section';
  // Everything below lives behind one disclosure. Telemetry, the install id
  // and the legal links are all things a player looks for on purpose and
  // never tunes in passing, and putting them inline made the settings sheet
  // open on a wall of small print rather than on the three toggles that are
  // actually settings.
  section.innerHTML = `
    <details class="settings-advanced"${advancedOpen ? ' open' : ''}>
      <summary class="settings-disclosure">
        <span class="settings-disclosure-label">Advanced</span>
        <span class="settings-disclosure-hint">Telemetry, install id, legal</span>
      </summary>
      <div class="settings-advanced-body">
        <h3 class="settings-subhead">Telemetry</h3>
        <p class="settings-note">Anonymous technical data only. Nothing is sent while this is off.</p>
        <div class="settings-field settings-field-stack">
          <span>Sending</span>
          ${segHtml('mode', mode, [['off', 'Off'], ['review', 'Review'], ['on', 'On']])}
        </div>
        <div class="settings-field settings-field-stack">
          <span>Consent language</span>
          ${segHtml('lang', getLang(), [['en', 'English'], ['ru', 'Русский']])}
        </div>
        <div class="settings-field settings-id">
          <span>Install id</span>
          <code id="tm-install" class="settings-chip">${escapeHtml(getInstallId())}</code>
          <button id="btn-tm-copy" class="btn-secondary settings-mini" type="button">Copy</button>
        </div>
        <div id="tm-status" class="settings-note" role="status"></div>
        ${mode === 'review' ? `
          <div class="telemetry-review">
            <div class="settings-note">${queued.length} event${queued.length === 1 ? '' : 's'} waiting on this device.</div>
            <pre id="tm-preview" class="telemetry-json">${escapeHtml(JSON.stringify(previewPayload(), null, 1))}</pre>
            <button id="btn-tm-send" class="btn-primary settings-mini" type="button"${queued.length ? '' : ' disabled'}>Send now</button>
            <button id="btn-tm-clear" class="btn-secondary settings-mini" type="button"${queued.length ? '' : ' disabled'}>Discard</button>
          </div>` : ''}
        <div class="settings-links">
          <a class="settings-link-btn" href="${PRIVACY_URL}" target="_blank" rel="noopener">Privacy policy</a>
          <a class="settings-link-btn" href="${TERMS_URL}" target="_blank" rel="noopener">Terms</a>
        </div>
      </div>
    </details>`;
  host.appendChild(section);

  const details = section.querySelector('.settings-advanced');
  if (details) {
    details.addEventListener('toggle', () => { advancedOpen = details.open; });
  }

  const status = section.querySelector('#tm-status');
  const say = (text) => { if (status) status.textContent = text; };

  // The review block appears and disappears with the mode, so a mode change
  // redraws the whole section rather than patching it. advancedOpen above is
  // what keeps the disclosure from closing underneath that.
  const redraw = () => { section.remove(); renderTelemetrySection(host); };

  section.querySelectorAll('.seg-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.dataset.seg === 'mode') { setMode(btn.dataset.value); redraw(); }
      else { setLang(btn.dataset.value); redraw(); }
    });
  });

  section.querySelector('#btn-tm-copy').addEventListener('click', () => {
    const id = getInstallId();
    try {
      navigator.clipboard.writeText(id).then(() => say('Install id copied.'),
        () => say('Could not copy -- select the id above instead.'));
    } catch (e) {
      say('Could not copy -- select the id above instead.');
    }
  });
  const sendBtn = section.querySelector('#btn-tm-send');
  if (sendBtn) {
    sendBtn.addEventListener('click', () => {
      sendBtn.disabled = true;
      say('Sending...');
      sendReviewQueue().then((ok) => {
        say(ok ? 'Sent.' : 'Could not reach the server. The events are still here.');
        redraw();
      });
    });
  }
  const clearBtn = section.querySelector('#btn-tm-clear');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => { clearQueue(); redraw(); });
  }
}
