export const DEFAULTS = {
  channel: '',
  backend: 'kontekstno',
  difficulty: '',
  pause: 20,
  hint_every: 180,
  chat_commands: true,
  reset_mode: 'never',
  reset_hour: 6,
  reset_hours: 12,
  sound: true,
  volume: 100,
  accent: '#16a34a',
  webcam: 'cam',
  mini: false,
};

const BACKEND_NAMES = ['kontekstno', 'wordgun'];
const RESET_MODES = ['never', 'day', 'week', 'month', 'timer'];
const HINT_MIN = 10;
const LOGIN_RE = /^[a-z0-9_]{1,25}$/;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const DIFFICULTY_RE = /^[a-z0-9_-]{1,24}$/;

function int(value, fallback, min, max) {
  const n = typeof value === 'boolean' || value === null || value === '' ? NaN : Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.trunc(n))) : fallback;
}

const CAMERAS = ['none', 'cam', 'vtuber'];

function flag(value, fallback) {
  if (value === undefined) return fallback;
  if (typeof value === 'string') return !['', '0', 'false', 'no', 'off'].includes(value.trim().toLowerCase());
  return Boolean(value);
}

function camera(value, fallback) {
  if (value === undefined) return fallback;
  const name = String(value).trim().toLowerCase();
  if (CAMERAS.includes(name)) return name;
  return flag(value, true) ? 'cam' : 'none';
}

function channel(value) {
  let name = String(value == null ? '' : value).trim().toLowerCase().replace(/^[#@]+/, '');
  name = name.split(/[?#]/, 1)[0].replace(/\/+$/, '');
  name = name.slice(name.lastIndexOf('/') + 1).replace(/^@+/, '');
  return LOGIN_RE.test(name) ? name : '';
}

function difficulty(value, backend) {
  const name = String(value == null ? '' : value).trim().toLowerCase();
  return backend === 'wordgun' && DIFFICULTY_RE.test(name) ? name : '';
}

export function clean(raw) {
  raw = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const d = DEFAULTS, s = {};
  s.channel = channel(raw.channel);
  s.backend = BACKEND_NAMES.includes(raw.backend) ? raw.backend : d.backend;
  s.difficulty = difficulty(raw.difficulty, s.backend);
  s.pause = int(raw.pause, d.pause, 5, 600);
  s.hint_every = int(raw.hint_every, d.hint_every, 0, 3600);
  if (s.hint_every) s.hint_every = Math.max(HINT_MIN, s.hint_every);
  s.chat_commands = flag(raw.chat_commands, d.chat_commands);
  s.reset_mode = RESET_MODES.includes(raw.reset_mode) ? raw.reset_mode : d.reset_mode;
  s.reset_hour = int(raw.reset_hour, d.reset_hour, 0, 23);
  s.reset_hours = int(raw.reset_hours, d.reset_hours, 1, 720);
  s.sound = flag(raw.sound, d.sound);
  s.volume = int(raw.volume, d.volume, 0, 100);
  s.accent = COLOR_RE.test(String(raw.accent || '')) ? String(raw.accent).toLowerCase() : d.accent;
  s.webcam = camera(raw.webcam, d.webcam);
  s.mini = flag(raw.mini, d.mini);
  return s;
}

export function toQuery(settings) {
  const s = clean(settings), params = new URLSearchParams();
  for (const key of Object.keys(DEFAULTS)) {
    const value = s[key];
    if (value === DEFAULTS[key]) continue;
    if (typeof value === 'boolean') params.set(key, value ? '1' : '0');
    else params.set(key, key === 'accent' ? value.slice(1) : String(value));
  }
  return params.toString();
}

export function fromQuery(search) {
  const params = new URLSearchParams(search), raw = {};
  for (const key of Object.keys(DEFAULTS)) {
    if (params.has(key)) raw[key] = key === 'accent' ? '#' + params.get(key).replace(/^#/, '') : params.get(key);
  }
  return clean(raw);
}
