// Game settings -- localStorage-persisted, same load/save shape as
// campaign.js's progress store (try/catch around every localStorage call
// so private-mode/unavailable storage degrades to "just use defaults"
// instead of throwing). Currently one setting (card art on/off); structured
// as a flat key/value bag with a single storage key so more settings can be
// added later as new fields on defaultSettings() without a migration step.
const SETTINGS_KEY = 'seahunter_settings';

function defaultSettings() {
  return {
    // true: download render/art/*.svg; false: use the inline SVG art only.
    cardArt: true,
    // P14: one-line tips during the first three matches (render/tutorial.js).
    hints: true,
  };
}

export function loadSettings() {
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) return defaultSettings();
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return defaultSettings();
    return { ...defaultSettings(), ...parsed };
  } catch (e) {
    return defaultSettings();
  }
}

export function saveSettings(settings) {
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (e) { /* settings just won't persist across sessions */ }
}

export function setSetting(key, value) {
  const settings = loadSettings();
  settings[key] = value;
  saveSettings(settings);
  return settings;
}
