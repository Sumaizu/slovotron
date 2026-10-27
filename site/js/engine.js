export const COMMANDS = new Map([
  ['!словотрон-раунд', 'skip'], ['!словотрон-рестарт', 'skip'], ['!словотрон-рес', 'skip'],
  ['!srestart', 'skip'], ['!sres', 'skip'],
  ['!словотрон-пауза', 'pause'],
  ['!словотрон-сброс', 'reset'],
  ['!словотрон-подсказка', 'hint'], ['!slovotron-hint', 'hint'], ['!slv-hint', 'hint'],
]);
export const STARS = new Map([
  ['sumaizu', 'rainbow'],
  ['sukoshissrb', 'white'],
  ['fra3a', 'thyme'],
  ['welovegames', 'heart'],
  ['higashi_vo', 'snow'],
]);
export const BOTS = [
  'nightbot', 'streamelements', 'streamlabs', 'moobot', 'fossabot', 'wizebot', 'jeetbot', 'soundalerts', 'sery_bot',
  'kofistreambot', 'tangiabot', 'botisimo', 'lumiastream', 'streamstickers', 'creatisbot', 'own3d', 'dixperbro',
  'pokemoncommunitygame', 'songlistbot', 'pretzelrocks', 'restreambot', 'commanderroot', 'frostytoolsdotcom',
];
export const CHAT_KEEP = 60;
export const CHAT_SHOWN = 30;
export const CHAT_TEXT_MAX = 300;
export const TOP_SHOWN = 10;
export const BEST_SHOWN = 20;

const START_DELAY = 10;
const WIN_RANK = 1;
const HINT_RETRY = 10;
const HINT_FLOOR = 2;
const PARALLEL = 4;
const RETRY_FIRST = 2;
const RETRY_MAX = 30;
const LOST_PAUSE = 5;
const WORD_MIN = 2;
const WORD_MAX = 20;
const EMOTES_MAX = 30;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const EMOTE_ID_RE = /^[A-Za-z0-9_]{1,80}$/;
const WORD_RE = /^[а-я]+(?:-[а-я]+)*$/;
const PUNCTUATION = ' \t.,!?…:;"\'«»()[]<>-—';
const INVISIBLE = /[\u200B\u200C\u200D\u2060\uFEFF\u00AD\u034F\u2800\u{E0000}]/gu;
const IGNORED = new Set(BOTS);

const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const byName = (a, b) => byText(a.name.toLowerCase(), b.name.toLowerCase());
const viewerOf = (entry) => entry.login || entry.user.toLowerCase();
const rounded = (seconds) => Math.round(seconds * 100) / 100;
const plain = (word) => word.toLowerCase().replace(/ё/g, 'е');

function trim(text, chars) {
  let from = 0, to = text.length;
  while (from < to && chars.includes(text[from])) from++;
  while (to > from && chars.includes(text[to - 1])) to--;
  return text.slice(from, to);
}

function cleanEmotes(raw) {
  const emotes = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return emotes;
  let count = 0;
  for (const name of Object.keys(raw)) {
    const id = String(raw[name]);
    if (!name || name.length > 60 || /\s/.test(name) || !EMOTE_ID_RE.test(id)) continue;
    emotes[name] = id;
    if (++count >= EMOTES_MAX) break;
  }
  return emotes;
}

export function guessWord(text) {
  const word = plain(trim(String(text || ''), PUNCTUATION));
  return word.length >= WORD_MIN && word.length <= WORD_MAX && WORD_RE.test(word) ? word : '';
}

export function nextReset(since, mode, hour = 0, hours = 12) {
  if (mode === 'timer') return since + Math.max(1, hours) * 3600;
  if (mode !== 'day' && mode !== 'week' && mode !== 'month') return null;
  const from = new Date(since * 1000);
  if (isNaN(from.getTime())) return null;
  const year = from.getFullYear(), month = from.getMonth(), day = from.getDate();
  let due;
  if (mode === 'day') {
    due = new Date(year, month, day, hour);
    if (due <= from) due = new Date(year, month, day + 1, hour);
  } else if (mode === 'week') {
    const monday = day - (from.getDay() + 6) % 7;
    due = new Date(year, month, monday, hour);
    if (due <= from) due = new Date(year, month, monday + 7, hour);
  } else {
    due = new Date(year, month, 1, hour);
    if (due <= from) due = new Date(year, month + 1, 1, hour);
  }
  return due.getTime() / 1000;
}

export class Scores {
  constructor(storage = null, key = 'slovotron.scores') {
    this.storage = storage;
    this.key = key;
    this.data = new Map();
    this.since = null;
    this.champion = '';
    if (!storage) return;
    try {
      const saved = JSON.parse(storage.getItem(key) || '{}');
      for (const [id, entry] of Object.entries(saved)) {
        if (!entry || typeof entry !== 'object') continue;
        this.data.set(id, { name: String(entry.name || id), score: Math.trunc(Number(entry.score) || 0) });
      }
      const since = Number(storage.getItem(key + '.since'));
      this.since = Number.isFinite(since) && since > 0 ? since : null;
      this.champion = String(storage.getItem(key + '.champion') || '');
    } catch (error) {
      this.data = new Map();
      this.since = null;
      this.champion = '';
    }
  }

  get size() {
    return this.data.size;
  }

  add(name, points) {
    const id = name.toLowerCase();
    const entry = this.data.get(id) || { name, score: 0 };
    entry.name = name;
    entry.score += points;
    this.data.set(id, entry);
    this._save();
  }

  crown(name) {
    this.champion = name.toLowerCase();
    this._save();
  }

  crowned(name) {
    return Boolean(this.champion) && name.toLowerCase() === this.champion;
  }

  reset(now) {
    this.data = new Map();
    this.champion = '';
    if (now !== undefined && now !== null) this.since = now;
    this._save();
  }

  mark(now) {
    this.since = now;
    this._save();
  }

  top(count) {
    const rows = Array.from(this.data.values()).sort((a, b) => b.score - a.score || byName(a, b));
    return (count === undefined ? rows : rows.slice(0, count))
      .map((entry) => ({ name: entry.name, score: entry.score, crown: this.crowned(entry.name) }));
  }

  _save() {
    if (!this.storage) return;
    try {
      this.storage.setItem(this.key, JSON.stringify(Object.fromEntries(this.data)));
      if (this.since === null) this.storage.removeItem(this.key + '.since');
      else this.storage.setItem(this.key + '.since', String(this.since));
      if (this.champion) this.storage.setItem(this.key + '.champion', this.champion);
      else this.storage.removeItem(this.key + '.champion');
    } catch (error) {
      this.storage = null;
    }
  }
}

export class Game {
  constructor(backends, settings, scores = null, { clock = () => Date.now() / 1000, later = null,
    banned = null } = {}) {
    this.backends = backends;
    this.s = Object.assign({}, settings);
    this.scores = scores || new Scores();
    this.clock = clock;
    this.later = later || ((action, seconds) => {
      const id = setTimeout(action, seconds * 1000);
      return () => clearTimeout(id);
    });
    this.banned = banned || new Set();
    this.version = 0;
    this.state = 'stopped';
    this.roundNo = 0;
    this.round = null;
    this.results = null;
    this.startsAt = null;
    this.trouble = false;
    this.listeners = [];
    this.onchange = null;
    this._held = null;
    this._next = null;
    this._making = 0;
    this._backoff = RETRY_FIRST;
    this._cancelRetry = null;
    this._events = [];
    this._delivering = false;
    this._chat = [];
    this._chatNo = 0;
    this._resetDue = null;
    this._planReset();
  }

  open(delay = START_DELAY) {
    return this._run(() => {
      if (this.state !== 'stopped') return false;
      this.state = 'countdown';
      this.startsAt = this.clock() + delay;
      this._prepare();
      this._emit('countdown', { starts_at: this.startsAt });
      this._bump();
      return true;
    });
  }

  stop() {
    return this._run(() => {
      if (this.state === 'stopped') return;
      this._halt();
      this._emit('stopped');
      this._bump();
    });
  }

  pause() {
    return this._run(() => this._pause());
  }

  resume() {
    return this._run(() => this._resume());
  }

  skip() {
    return this._run(() => this._skip());
  }

  hint() {
    return this._run(() => this._forceHint());
  }

  canHint() {
    return this.state === 'playing' && this._hintable(this.round);
  }

  resetScores() {
    return this._run(() => this._resetScores());
  }

  configure(settings) {
    return this._run(() => {
      const before = this.s, s = Object.assign({}, settings);
      const changed = (...keys) => keys.some((key) => before[key] !== s[key]);
      this.s = s;
      if (changed('reset_mode', 'reset_hour', 'reset_hours') && this.scores.since !== null) {
        this.scores.mark(this.clock());
      }
      this._planReset();
      const phase = this._phase();
      if (changed('backend', 'difficulty') && (phase === 'countdown' || phase === 'results')) this._prepare();
      if (changed('hint_every') && phase === 'playing') this._planHint(this.round);
      this._bump();
    });
  }

  feed(user, text, { mod = false, msgId = null, login = null, color = null, emotes = null } = {}) {
    return this._run(() => {
      const name = String(user || '').trim();
      const message = String(text || '').normalize('NFC').replace(INVISIBLE, '').trim();
      login = String(login || '').toLowerCase();
      if (!name || !message || IGNORED.has(login || name.toLowerCase())) return null;
      const entry = this._say(name, message, msgId, login, color, emotes);
      if (message.charAt(0) === '!') return this._command(message, mod);
      if (this.state !== 'playing') return null;
      const word = guessWord(message);
      return word ? this._guess(entry, word) : null;
    });
  }

  unsay({ msgId = null, user = null, everything = false } = {}) {
    return this._run(() => {
      const who = String(user || '').toLowerCase();
      const gone = (entry) => everything || (msgId ? entry.msgId === String(msgId)
        : Boolean(who) && (entry.login === who || entry.user.toLowerCase() === who));
      const removed = new Set(this._chat.filter(gone).map((entry) => entry.id));
      if (!removed.size) return 0;
      this._chat = this._chat.filter((entry) => !removed.has(entry.id));
      if (this.round) {
        for (const record of this.round.words.values()) if (removed.has(record.chat)) record.hidden = true;
      }
      this._bump();
      return removed.size;
    });
  }

  tick(now = this.clock()) {
    return this._run(() => {
      if (this._resetDue !== null && now >= this._resetDue) this._resetScores(true, now);
      if (this.state === 'countdown') {
        if (now >= this.startsAt && this._next) this._begin();
      } else if (this.state === 'playing') {
        const round = this.round;
        if (round.hintAt !== null && now >= round.hintAt && !round.hinting) this._hint(round);
      } else if (this.state === 'results' && now >= this.results.next_at) {
        if (this._next) this._begin();
        else this._await(now);
      }
    });
  }

  snapshot() {
    const round = this.round;
    const state = {
      version: this.version,
      now: rounded(this.clock()),
      state: this.state,
      held: this._held ? this._held.state : null,
      round: this.roundNo,
      starts_at: this.startsAt,
      trouble: this.trouble,
      top: this.scores.top(this.state === 'paused' ? undefined : TOP_SHOWN),
      players: this.scores.size,
      stars: Array.from(STARS),
      feed: this._chat.slice(-CHAT_SHOWN).map((entry) => {
        const message = { id: entry.id, user: entry.user, text: entry.text, color: entry.color, star: entry.star,
          crown: this.scores.crowned(entry.user), rank: entry.rank, repeat: entry.repeat, unknown: entry.unknown,
          failed: entry.failed };
        if (Object.keys(entry.emotes).length) message.emotes = Object.assign({}, entry.emotes);
        return message;
      }),
    };
    if (!round) return state;
    state.started = rounded(round.started);
    state.idle = rounded(round.idle);
    state.best = Array.from(round.words.values()).sort((a, b) => a.rank - b.rank || a.no - b.no)
      .slice(0, BEST_SHOWN).map((record) => ({ word: record.word, rank: record.rank, user: record.user,
        color: record.color, star: record.star, crown: this.scores.crowned(record.user), hint: record.hint,
        rude: Boolean(record.hidden) || this.banned.has(record.word) }));
    state.words = round.found;
    state.repeats = round.repeats;
    state.guessers = round.users.size;
    state.hints = round.hints;
    state.closest = round.best;
    state.hint_at = this.results ? null : round.hintAt;
    state.hint_every = this.s.hint_every;
    state.hinting = round.hinting;
    if (this.results) {
      state.results = Object.assign({}, this.results, { crown: this.scores.crowned(this.results.winner) });
    }
    return state;
  }

  _run(action) {
    const result = action();
    this._deliver();
    return result;
  }

  _deliver() {
    if (this._delivering) return;
    this._delivering = true;
    try {
      while (this._events.length) {
        const event = this._events.shift();
        for (const listener of this.listeners.slice()) {
          try {
            listener(event);
          } catch (error) {
            continue;
          }
        }
      }
    } finally {
      this._delivering = false;
    }
  }

  _emit(type, data = {}) {
    const event = Object.assign({ type, at: this.clock() }, data);
    this._events.push(event);
    return event;
  }

  _bump() {
    this.version += 1;
    if (this.onchange) this.onchange();
  }

  _phase() {
    return this._held ? this._held.state : this.state;
  }

  _time() {
    return this._held ? this._held.at : this.clock();
  }

  _enter(state) {
    if (this._held) this._held.state = state;
    else this.state = state;
  }

  _dropRetry() {
    if (this._cancelRetry) this._cancelRetry();
    this._cancelRetry = null;
  }

  _halt() {
    this.state = 'stopped';
    this.round = null;
    this.results = null;
    this.startsAt = null;
    this.trouble = false;
    this._held = null;
    this._next = null;
    this._making += 1;
    this._backoff = RETRY_FIRST;
    this._dropRetry();
  }

  _prepare() {
    const making = ++this._making, backend = this.backends(this.s.backend);
    this._next = null;
    this._dropRetry();
    backend.create({ difficulty: this.s.difficulty }).then((id) => this._run(() => {
      if (making !== this._making) return;
      this._next = { backend, id };
      this._backoff = RETRY_FIRST;
      this.trouble = false;
      this._bump();
    }), () => this._run(() => {
      if (making !== this._making) return;
      const wait = this._backoff;
      this._backoff = Math.min(wait * 2, RETRY_MAX);
      this.trouble = true;
      this._cancelRetry = this.later(() => {
        this._cancelRetry = null;
        if (making === this._making) this._prepare();
      }, wait);
      this._bump();
    }));
  }

  _begin() {
    const game = this._next, now = this.clock();
    this._next = null;
    this.roundNo += 1;
    this.round = {
      backend: game.backend,
      id: game.id,
      started: now,
      idle: 0,
      words: new Map(),
      unknown: new Set(),
      asks: new Map(),
      queue: [],
      flying: 0,
      users: new Set(),
      found: 0,
      repeats: 0,
      best: null,
      hints: 0,
      hinting: false,
      hintAt: null,
    };
    this.results = null;
    this.startsAt = null;
    this.state = 'playing';
    this._planHint(this.round);
    this._emit('round_start', { round: this.roundNo });
    this._bump();
  }

  _await(now) {
    this.round = null;
    this.results = null;
    this.state = 'countdown';
    this.startsAt = now;
    this._bump();
  }

  _pause() {
    if (this.state === 'stopped' || this.state === 'paused') return false;
    this._held = { state: this.state, at: this.clock() };
    this.state = 'paused';
    this._emit('paused');
    this._bump();
    return true;
  }

  _resume() {
    if (this.state !== 'paused') return false;
    const idle = this.clock() - this._held.at, round = this.round;
    if (this.startsAt !== null) this.startsAt += idle;
    if (this.results) this.results.next_at += idle;
    if (round) {
      round.idle += idle;
      if (round.hintAt !== null) round.hintAt += idle;
    }
    this.state = this._held.state;
    this._held = null;
    this._emit('resumed');
    this._bump();
    return true;
  }

  _skip() {
    if (this.state === 'playing') {
      this._finish('skip');
    } else if (this.state === 'results') {
      this.results.next_at = this.clock();
      if (this._next) this._begin();
      else this._bump();
    }
  }

  _resetScores(auto = false, now = this.clock()) {
    this.scores.reset(now);
    this._planReset();
    this._emit('scores_reset', { auto });
    this._bump();
  }

  _planReset() {
    const s = this.s;
    if (!s.reset_mode || s.reset_mode === 'never') {
      this._resetDue = null;
      return;
    }
    if (this.scores.since === null) this.scores.mark(this.clock());
    this._resetDue = nextReset(this.scores.since, s.reset_mode, s.reset_hour || 0, s.reset_hours || 12);
  }

  _command(message, mod) {
    const command = COMMANDS.get(message.toLowerCase().split(/\s+/)[0]);
    if (!command || !mod || this.s.chat_commands === false) return null;
    if (command === 'skip') this._skip();
    else if (command === 'reset') this._resetScores();
    else if (command === 'hint') this._forceHint();
    else if (!this._resume()) this._pause();
    return { type: 'command', command };
  }

  _say(name, text, msgId, login, color, emotes) {
    this._chatNo += 1;
    const entry = {
      id: this._chatNo,
      user: name,
      text: text.slice(0, CHAT_TEXT_MAX),
      color: typeof color === 'string' && COLOR_RE.test(color) ? color.toLowerCase() : '',
      star: STARS.get(login || name.toLowerCase()) || '',
      rank: 0,
      repeat: false,
      unknown: false,
      failed: false,
      emotes: cleanEmotes(emotes),
      msgId: String(msgId || ''),
      login,
    };
    this._chat.push(entry);
    if (this._chat.length > CHAT_KEEP) this._chat.shift();
    if (this.state !== 'stopped') this._bump();
    return entry;
  }

  _guess(entry, word) {
    const round = this.round, known = round.words.get(word);
    if (known) return this._repeat(round, entry, known);
    if (round.unknown.has(word)) return this._unknown(round, [entry], word);
    const waiting = round.asks.get(word);
    if (waiting) {
      waiting.push(entry);
      return null;
    }
    round.asks.set(word, [entry]);
    if (round.flying < PARALLEL) this._score(round, word);
    else round.queue.push(word);
    return null;
  }

  _repeat(round, entry, known) {
    entry.rank = known.rank;
    entry.repeat = true;
    round.repeats += 1;
    round.users.add(viewerOf(entry));
    this._bump();
    return this._emit('repeat', { user: entry.user, word: known.word, rank: known.rank });
  }

  _unknown(round, entries, word) {
    for (const entry of entries) entry.unknown = true;
    this._bump();
    return this._emit('unknown', { user: entries[0].user, word });
  }

  _score(round, word) {
    round.flying += 1;
    const settle = (reply) => this._run(() => {
      round.flying -= 1;
      if (this.round !== round || this.results) return;
      this._answer(round, word, reply);
      if (this.round === round && !this.results && round.queue.length) this._score(round, round.queue.shift());
    });
    round.backend.score(round.id, word).then(settle, () => settle(null));
  }

  _answer(round, word, reply) {
    const entries = round.asks.get(word);
    round.asks.delete(word);
    if (!reply) {
      for (const entry of entries) entry.failed = true;
      this._bump();
    } else if (reply.gone) {
      this._finish('lost');
    } else if (!reply.rank) {
      round.unknown.add(word);
      this._unknown(round, entries, word);
    } else {
      this._found(round, word, reply.rank, entries);
    }
  }

  _found(round, word, rank, entries) {
    const first = entries[0], closest = round.best === null || rank < round.best;
    round.words.set(word, { word, rank, user: first.user, color: first.color, star: first.star, hint: false,
      no: round.words.size, chat: first.id });
    round.found += 1;
    round.users.add(viewerOf(first));
    if (closest) {
      round.best = rank;
      this._planHint(round);
    }
    first.rank = rank;
    for (const entry of entries.slice(1)) {
      entry.rank = rank;
      entry.repeat = true;
      round.repeats += 1;
      round.users.add(viewerOf(entry));
    }
    this._emit('guess', { user: first.user, word, rank, closest });
    if (rank === WIN_RANK) this._finish('win', first, word);
    else this._bump();
  }

  _hintable(round) {
    return !round.hinting && (round.best === null || round.best > HINT_FLOOR);
  }

  _planHint(round, seconds = this.s.hint_every) {
    const useful = round.best === null || round.best > HINT_FLOOR;
    round.hintAt = this.s.hint_every && useful ? this._time() + seconds : null;
  }

  _forceHint() {
    if (!this.canHint()) return false;
    this._hint(this.round);
    return true;
  }

  _hint(round) {
    round.hinting = true;
    const settle = (reply) => this._run(() => {
      round.hinting = false;
      if (this.round !== round || this.results) return;
      if (!reply) {
        this._planHint(round, Math.min(HINT_RETRY, this.s.hint_every));
        this._bump();
      } else if (reply.gone) {
        this._finish('lost');
      } else {
        this._hinted(round, reply);
      }
    });
    round.backend.hint(round.id, round.best).then(settle, () => settle(null));
    this._bump();
  }

  _hinted(round, reply) {
    if (!reply.word || reply.rank <= WIN_RANK) {
      this._planHint(round);
      this._emit('hint_none');
      this._bump();
      return;
    }
    const word = plain(reply.word), rank = reply.rank;
    if (!round.words.has(word)) {
      round.words.set(word, { word, rank, user: '', color: '', star: '', hint: true, no: round.words.size, chat: 0 });
    }
    if (round.best === null || rank < round.best) round.best = rank;
    round.hints += 1;
    this._planHint(round);
    this._emit('hint', { word, rank });
    this._bump();
  }

  _finish(reason, entry = null, word = '') {
    const round = this.round, now = this._time(), pause = reason === 'lost' ? LOST_PAUSE : this.s.pause;
    this.results = { reason, round: this.roundNo, at: now, next_at: now + pause, pause, word,
      winner: entry ? entry.user : '', color: entry ? entry.color : '', star: entry ? entry.star : '',
      seconds: Math.max(0, now - round.started - round.idle) };
    if (reason === 'win') {
      this.scores.add(entry.user, 1);
      this.scores.crown(entry.user);
    }
    this._enter('results');
    this._prepare();
    if (reason === 'skip') this._reveal(round);
    this._emit('round_end', { round: this.roundNo, reason, winner: this.results.winner, word });
    this._bump();
  }

  _reveal(round) {
    const results = this.results;
    round.backend.reveal(round.id).then((word) => this._run(() => {
      if (this.results !== results || results.word || !word) return;
      results.word = plain(word);
      this._bump();
    }), () => {});
  }
}
