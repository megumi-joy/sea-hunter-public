// P8 "Pause, feedback, telemetry" -- the pause overlay behind #btn-pause.
//
// The top bar has carried a pause button since P0 and nothing was ever
// wired to it. This is that menu: Resume, Settings, Send feedback,
// Surrender (only while a match is live) and Main menu.
//
// Look: the P4 round-end panel, not the P7 shell modals. Pause opens OVER
// the stage, next to the round-end and game-over screens, so it borrows
// their dark gradient panel and verdict-neutral accent rather than the
// cream Settings sheet -- see render/shell.css's P8 section.
//
// Two destructive entries, two inline confirms. A confirm is a second row
// that replaces the button list in place (never a window.confirm, which on
// mobile is a system dialog over a full-screen game and reads as a crash).
//
// Dismissal, in the three ways a player expects:
//   * the Resume button, or a tap on the scrim
//   * Esc on a keyboard
//   * the Android back gesture -- there is no navigation in this app for
//     back to act on, so opening the overlay pushes a history entry and
//     `popstate` closes it. Closing by any OTHER route calls history.back()
//     to consume that entry again, so back is never left swallowing one
//     press with nothing on screen to show for it.

let overlay = null;
let panel = null;
let deps = {};
let open = false;
// Whether THIS overlay put the history entry on the stack. Guards the
// history.back() on close: a popstate-driven close has already consumed it.
let pushedState = false;

const STATE_MARK = 'seahunter-pause';

// P14: entries another module adds below Settings (render/tutorial.js: How to
// play, Exit tutorial). A function, read on every open, so an entry can come
// and go with live state. Each entry is { id, label, onClick }.
let extras = () => [];
export function setPauseExtras(fn) {
  extras = typeof fn === 'function' ? fn : () => [];
}

function buttonRow(id, cls, label) {
  return `<button id="${id}" class="${cls} pause-btn" type="button">${label}</button>`;
}

function menuHtml() {
  return '<div class="pause-list">'
    + buttonRow('btn-pause-resume', 'btn-primary', 'Resume')
    + buttonRow('btn-pause-settings', 'btn-secondary', 'Settings')
    + extras().map((x) => buttonRow(x.id, 'btn-secondary', x.label)).join('')
    + buttonRow('btn-pause-feedback', 'btn-secondary', 'Send feedback')
    + (deps.inMatch && deps.inMatch()
      ? buttonRow('btn-pause-surrender', 'btn-secondary pause-danger', 'Surrender')
      : '')
    + buttonRow('btn-pause-menu', 'btn-secondary', 'Main menu')
    + '</div>';
}

// `danger` puts the confirm in the P13 --danger red. Only the surrender
// confirm sets it: that red means "this counts as a defeat", and leaving for
// the menu is a plain primary.
function confirmHtml(question, note, yesLabel, danger) {
  return '<div class="pause-confirm">'
    + `<p class="pause-q">${question}</p>`
    + (note ? `<p class="pause-note">${note}</p>` : '')
    + `<button id="btn-pause-yes" class="btn-primary pause-btn${danger ? ' pause-danger' : ''}" type="button">${yesLabel}</button>`
    + '<button id="btn-pause-no" class="btn-secondary pause-btn" type="button">Keep playing</button>'
    + '</div>';
}

function build() {
  overlay = document.createElement('div');
  overlay.id = 'pause-overlay';
  overlay.className = 'pause-overlay hidden';
  overlay.innerHTML = '<div class="pause-panel"><h2 class="pause-title">Paused</h2>'
    + '<div class="pause-body"></div></div>';
  document.body.appendChild(overlay);
  panel = overlay.querySelector('.pause-body');
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closePause(); });
}

function renderMenu() {
  panel.innerHTML = menuHtml();
  on('btn-pause-resume', closePause);
  on('btn-pause-settings', () => { closePause(); if (deps.onSettings) deps.onSettings(); });
  on('btn-pause-feedback', () => { closePause(); if (deps.onFeedback) deps.onFeedback(); });
  extras().forEach((x) => on(x.id, () => { closePause(); x.onClick(); }));
  on('btn-pause-surrender', () => renderConfirm('surrender'));
  on('btn-pause-menu', () => renderConfirm('menu'));
}

function renderConfirm(which) {
  panel.innerHTML = which === 'surrender'
    ? confirmHtml('Surrender this match?',
      'The match ends now and counts as a defeat.', 'Surrender', true)
    : confirmHtml('Leave for the main menu?',
      'The match is abandoned. Unspent artifacts go back to the hold.', 'Leave match');
  on('btn-pause-no', renderMenu);
  on('btn-pause-yes', () => {
    closePause();
    if (which === 'surrender') { if (deps.onSurrender) deps.onSurrender(); }
    else if (deps.onMainMenu) deps.onMainMenu();
  });
}

function on(id, fn) {
  const el = panel.querySelector('#' + id);
  if (el) el.addEventListener('click', fn);
}

function onKey(e) {
  if (e.key === 'Escape') { e.preventDefault(); closePause(); }
}

function onPop() {
  // The back gesture (or the history.back() below) landed. The entry is
  // already gone, so close without trying to pop it a second time.
  if (!open) return;
  pushedState = false;
  closePause();
}

// `d` = { inMatch, onSettings, onFeedback, onSurrender, onMainMenu }.
export function initPause(d) {
  deps = d || {};
  window.addEventListener('popstate', onPop);
}

export function openPause() {
  if (open) return;
  if (!overlay) build();
  open = true;
  renderMenu();
  overlay.classList.remove('hidden');
  document.addEventListener('keydown', onKey);
  try {
    history.pushState({ [STATE_MARK]: 1 }, '');
    pushedState = true;
  } catch (e) {
    // A sandboxed iframe can refuse pushState. Esc and the buttons still
    // work; only the back gesture is unavailable there.
    pushedState = false;
  }
}

export function closePause() {
  if (!open) return;
  open = false;
  if (overlay) overlay.classList.add('hidden');
  document.removeEventListener('keydown', onKey);
  if (pushedState) {
    pushedState = false;
    try { history.back(); } catch (e) { /* see the pushState note above */ }
  }
}

export function isPauseOpen() {
  return open;
}
