// Player profile -- ONE identity used everywhere a name shows up: the
// leaderboards, the multiplayer seat, campaign records. Before this, each
// surface had its own idea of who you are (telegram.js name, the mp-screen
// name field, plain 'Captain'), so the same player appeared under three
// different labels.
//
// Avatars are emoji on a coloured disc, drawn by CSS -- no image files, both
// because the game ships as bare HTML and because games.voicydroid.com sends
// COEP headers that would block cross-origin art.

const PROFILE_KEY = 'seahunter_profile';

export const AVATARS = [
  { id: 'anchor',    emoji: '⚓',      color: '#2f6f9f' },
  { id: 'wheel',     emoji: '⎈',      color: '#8a5a2b' },
  { id: 'kraken',    emoji: '🐙', color: '#6a4f9e' },
  { id: 'shark',     emoji: '🦈', color: '#3d7a8c' },
  { id: 'parrot',    emoji: '🦜', color: '#2f8a4a' },
  { id: 'skull',     emoji: '☠',      color: '#5a5f6b' },
  { id: 'compass',   emoji: '🧭', color: '#a8762e' },
  { id: 'wave',      emoji: '🌊', color: '#2b6fae' },
  { id: 'lighthouse',emoji: '🗼', color: '#b0483a' },
  { id: 'gull',      emoji: '🕊', color: '#4a7f9a' },
  { id: 'crown',     emoji: '👑', color: '#b08a2e' },
  { id: 'cannon',    emoji: '💥', color: '#8c3d3d' },
];

const DEFAULT_NICKS = [
  'Salty Dog', 'Reef Runner', 'Storm Rider', 'Iron Gull',
  'Night Tide', 'Deep Current', 'Gold Fin', 'Sea Wolf',
];

function randomTag() {
  // Four characters, unambiguous alphabet (no O/0, I/1 confusion).
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let tag = '';
  for (let i = 0; i < 4; i++) tag += alphabet[Math.floor(Math.random() * alphabet.length)];
  return tag;
}

function defaultProfile() {
  return {
    nick: DEFAULT_NICKS[Math.floor(Math.random() * DEFAULT_NICKS.length)],
    tag: randomTag(),
    avatarId: AVATARS[Math.floor(Math.random() * AVATARS.length)].id,
  };
}

export function loadProfile() {
  try {
    const raw = window.localStorage.getItem(PROFILE_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      if (p && typeof p.nick === 'string' && typeof p.tag === 'string' && p.avatarId) return p;
    }
  } catch (e) { /* fall through to a fresh profile */ }
  // First launch: mint an identity right away, so the tag stays stable from
  // the player's very first leaderboard entry instead of appearing later.
  const fresh = defaultProfile();
  saveProfile(fresh);
  return fresh;
}

export function saveProfile(profile) {
  try {
    window.localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  } catch (e) { /* private mode -- the profile just will not persist */ }
}

export function sanitizeNick(raw) {
  const clean = String(raw || '').replace(/[<>&"']/g, '').trim().slice(0, 16);
  return clean.length >= 2 ? clean : null;
}

export function sanitizeTag(raw) {
  const clean = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
  return clean.length >= 2 ? clean : null;
}

export function updateProfile({ nick, tag, avatarId } = {}) {
  const p = loadProfile();
  const cleanNick = sanitizeNick(nick);
  const cleanTag = sanitizeTag(tag);
  if (cleanNick) p.nick = cleanNick;
  if (cleanTag) p.tag = cleanTag;
  if (avatarId && AVATARS.some((a) => a.id === avatarId)) p.avatarId = avatarId;
  saveProfile(p);
  return p;
}

export function avatarOf(profile) {
  return AVATARS.find((a) => a.id === (profile && profile.avatarId)) || AVATARS[0];
}

// "Nick#TAG" -- the display handle. The tag exists so two captains named
// Salty Dog stay distinguishable on a shared leaderboard and in a room.
export function handleOf(profile = loadProfile()) {
  return `${profile.nick}#${profile.tag}`;
}
