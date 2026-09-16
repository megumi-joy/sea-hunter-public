// P8 "Pause, feedback, telemetry" -- the in-game feedback form.
//
// One modal, built on demand and reused: a message textarea (1..2000 chars,
// the server's own limit), an optional contact line, Send / Cancel and a
// status line. Reachable from the pause overlay, the Settings modal and the
// game-over screen.
//
// Errors -- a rate limit, a dropped connection, a 4xx -- are written to the
// status line and nowhere else. No alert() anywhere in this file: an alert
// over a match is a modal on top of a modal, and on mobile it is a system
// dialog the player cannot dismiss by tapping the scrim.
//
// POSTs to the same endpoint the native Godot clients use, so one inbox
// covers every build:
//   POST {API_BASE}/v1/games/feedback
//   { game, install_id, session_id, version, platform, message, contact,
//     context: { screen, mode, round, score } }

import * as Telemetry from './telemetry.js';

const MAX_MESSAGE = 2000;
const MAX_CONTACT = 120;
const TIMEOUT_MS = 8000;

function apiBase() {
  try {
    return (typeof window !== 'undefined' && window.SEAHUNTER_API_BASE) || 'https://api.voicydroid.com';
  } catch (e) {
    return 'https://api.voicydroid.com';
  }
}

let modal = null;
let els = null;
let context = {};
let sending = false;

function build() {
  modal = document.createElement('div');
  modal.id = 'feedback-modal';
  modal.className = 'modal hidden';
  modal.innerHTML = `
    <div class="modal-inner feedback-inner">
      <div class="modal-head">
        <h2>Send feedback</h2>
        <button id="btn-close-feedback" class="btn-icon" aria-label="Close">
          <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        </button>
      </div>
      <p class="fb-hint">What went wrong, or what would you change? The message,
        an optional contact, the game version and your install id are all that
        is sent.</p>
      <label class="fb-label" for="fb-message">Message</label>
      <textarea id="fb-message" class="fb-text" maxlength="${MAX_MESSAGE}" rows="5"
        placeholder="The bug, the idea, the thing that annoyed you."></textarea>
      <div id="fb-count" class="fb-count">0 / ${MAX_MESSAGE}</div>
      <label class="fb-label" for="fb-contact">Contact (optional)</label>
      <input id="fb-contact" class="fb-input" maxlength="${MAX_CONTACT}" autocomplete="off"
        placeholder="Telegram or e-mail, if you want a reply">
      <div id="fb-status" class="fb-status" role="status"></div>
      <div class="modal-actions">
        <button id="btn-fb-send" class="btn-primary">Send</button>
        <button id="btn-fb-cancel" class="btn-secondary">Cancel</button>
      </div>
    </div>`;
  document.body.appendChild(modal);

  els = {
    message: modal.querySelector('#fb-message'),
    contact: modal.querySelector('#fb-contact'),
    count: modal.querySelector('#fb-count'),
    status: modal.querySelector('#fb-status'),
    send: modal.querySelector('#btn-fb-send'),
  };

  els.message.addEventListener('input', () => {
    els.count.textContent = `${els.message.value.length} / ${MAX_MESSAGE}`;
  });
  modal.querySelector('#btn-fb-cancel').addEventListener('click', closeFeedback);
  modal.querySelector('#btn-close-feedback').addEventListener('click', closeFeedback);
  els.send.addEventListener('click', submit);
  // Tapping the scrim closes, same as every other overlay in the game --
  // but only the scrim, never a click that started inside the panel.
  modal.addEventListener('click', (e) => { if (e.target === modal) closeFeedback(); });
}

function setStatus(text, kind) {
  if (!els) return;
  els.status.textContent = text;
  els.status.className = 'fb-status' + (kind ? ' is-' + kind : '');
}

function submit() {
  if (sending) return;
  const message = els.message.value.trim();
  if (!message) { setStatus('Write a message first.', 'error'); return; }
  if (message.length > MAX_MESSAGE) { setStatus('Message is too long.', 'error'); return; }

  sending = true;
  els.send.disabled = true;
  setStatus('Sending...');

  const body = {
    game: Telemetry.GAME_ID,
    install_id: Telemetry.getInstallId(),
    session_id: Telemetry.getSessionId(),
    version: Telemetry.VERSION,
    platform: Telemetry.platform(),
    message,
    contact: els.contact.value.trim() || null,
    context,
  };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  fetch(apiBase() + '/v1/games/feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: ctrl.signal,
  }).then((res) => {
    if (res.ok) {
      setStatus('Sent -- thank you.', 'ok');
      els.message.value = '';
      els.count.textContent = `0 / ${MAX_MESSAGE}`;
      setTimeout(closeFeedback, 1200);
      return;
    }
    // 429 is the server's own rate limit (3/min per IP, 10/hour per install)
    // and is the one failure a player is likely to hit twice in a row.
    setStatus(res.status === 429
      ? 'Too many messages just now. Try again in a minute.'
      : `The server refused the message (${res.status}). Try again later.`, 'error');
  }).catch(() => {
    setStatus('Could not reach the server. Check the connection and try again.', 'error');
  }).finally(() => {
    clearTimeout(timer);
    sending = false;
    els.send.disabled = false;
  });
}

// `ctx` is { screen, mode, round, score } -- built by app.js off the live
// store, since this module knows nothing about the game state.
export function openFeedback(ctx) {
  if (!modal) build();
  context = ctx || {};
  setStatus('');
  els.count.textContent = `${els.message.value.length} / ${MAX_MESSAGE}`;
  modal.classList.remove('hidden');
  try { els.message.focus({ preventScroll: true }); } catch (e) { /* focus is a nicety */ }
}

export function closeFeedback() {
  if (modal) modal.classList.add('hidden');
}

export function isFeedbackOpen() {
  return !!modal && !modal.classList.contains('hidden');
}
