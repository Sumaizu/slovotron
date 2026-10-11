import { Confetti } from './confetti.js';
import { Emotes } from './emotes.js';
import { play } from './sound.js';

const STAGE_WIDTH = 1280, STAGE_HEIGHT = 720;
const ROW = { height: 32, gap: 5, usual: 15, finale: 12 };
const TOP_ROWS = 10;
const ANSWER = { room: 660, gap: 20, verdict: 250, largest: 44, smallest: 18, letter: 0.86 };
const NEAR = 150, MID = 550, FAR = 1400, BAR_SPAN = 2800;
const BEST_SOUND_RANK = 150;
const FINAL_SECONDS = 3;
const CLOCK_SLACK = 0.05;
const CONFETTI = { rest: 5, shortest: 5, longest: 30 };
const CYCLES = new Map([['rainbow', 2400], ['heart', 15000]]);
const HEADLINES = { win: 'Слово угадано!', skip: 'Раунд окончен', lost: 'Раунд прерван' };
const VERDICTS = { win: 'Победитель', skip: 'Никто не угадал', lost: 'Сервер слов завершил игру' };
const NOTES = { repeat: 'уже было', unknown: 'нет в словаре', failed: 'не проверено' };
const HINT_NOTE = 'подсказка';
const NICK_COLORS = ['#ff8f85', '#ffb547', '#f2dd6e', '#8fe3ae', '#7fd4ff', '#b7a6ff', '#ff9ad5', '#8fe0d2'];
const SOUND_PRIORITY = ['win', 'end', 'start', 'best', 'hint', 'tick'];

const $ = (id) => document.getElementById(id);
const share = (value) => Math.max(0, Math.min(1, value));
const wholeSeconds = (left) => Math.ceil(left - CLOCK_SLACK);

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function plural(n, one, few, many) {
  const units = n % 10, tens = n % 100;
  if (units === 1 && tens !== 11) return one;
  return units >= 2 && units <= 4 && (tens < 12 || tens > 14) ? few : many;
}

function clockText(seconds) {
  const whole = Math.max(0, Math.floor(seconds));
  return Math.floor(whole / 60) + ':' + String(whole % 60).padStart(2, '0');
}

function luminance(red, green, blue) {
  return (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
}

function nickColor(person) {
  if (!/^#[0-9a-f]{6}$/i.test(person.color || '')) {
    let hash = 0;
    for (const ch of person.user.toLowerCase()) hash = (hash * 31 + ch.codePointAt(0)) >>> 0;
    return NICK_COLORS[hash % NICK_COLORS.length];
  }
  const value = parseInt(person.color.slice(1), 16);
  let rgb = [value >> 16 & 255, value >> 8 & 255, value & 255];
  const light = luminance(...rgb);
  if (light < 0.45) {
    const lift = (0.45 - light) / (1 - light);
    rgb = rgb.map((channel) => Math.round(channel + (255 - channel) * lift));
  }
  return 'rgb(' + rgb.join(',') + ')';
}

function nickParts(person) {
  const nick = el('b', person.star || '', person.user);
  if (!person.star) nick.style.color = nickColor(person);
  return person.crown ? [el('i', 'crown'), nick] : [nick];
}

function nickBox(className, person) {
  const box = el('span', className);
  box.append(...nickParts(person));
  return box;
}

function keepInStep(event) {
  const cycle = CYCLES.get(event.animationName);
  if (cycle) event.target.style.setProperty('--phase', -(Date.now() % cycle) + 'ms');
}

export function tone(rank) {
  if (rank <= 1) return 'won';
  if (rank <= NEAR) return 'near';
  if (rank <= MID) return 'mid';
  return rank <= FAR ? 'far' : 'away';
}

export function barWidth(rank) {
  return Math.round(share(1 - rank / BAR_SPAN) * 1000) / 10;
}

export function rowsThatFit(height) {
  return Math.max(1, Math.floor((height + ROW.gap) / (ROW.height + ROW.gap)));
}

export function answerSize(letters, room) {
  const size = Math.floor(room / (Math.max(1, letters) * ANSWER.letter));
  return Math.max(ANSWER.smallest, Math.min(ANSWER.largest, size));
}

export function masked(word) {
  return word.charAt(0) + '•'.repeat(Math.max(0, word.length - 1));
}

export class View {
  constructor() {
    this.still = false;
    this.settings = null;
    this.state = null;
    this.offset = 0;
    this.heard = [];
    this.emotes = new Emotes(() => this._redrawFeed());
    this.confetti = new Confetti($('confetti'));
    this._animate = false;
    this._roundKey = '';
    this._finaleKey = '';
    this._wasOver = false;
    this._closest = '';
    this._hints = 0;
    this._rows = new Map();
    this._listKeys = {};
    this._stars = new Map();
    this._starsKey = '';
    this._cues = [];
    this._feedRows = new Map();
    this._feedNewest = 0;
    this._feedStale = false;
    this._secondsLeft = null;
    this._countdownFrom = null;
    window.addEventListener('resize', () => this._fitStage());
    document.addEventListener('animationstart', keepInStep);
    this._fitStage();
    setInterval(() => this.tick(), 250);
  }

  setStill(still) {
    this.still = still;
    this._animate = false;
    this._roundKey = '';
    this._listKeys = {};
    this._feedStale = true;
    this._cues = [];
    this.confetti.stop();
  }

  use(settings) {
    this.settings = settings;
    const root = document.documentElement, body = document.body;
    const value = parseInt(settings.accent.slice(1), 16);
    const light = luminance(value >> 16 & 255, value >> 8 & 255, value & 255);
    root.style.setProperty('--accent', settings.accent);
    root.style.setProperty('--accent-ink', light > 0.55 ? '#06150b' : '#ffffff');
    body.classList.toggle('nocam', !settings.webcam);
    body.classList.toggle('nochat', !settings.chat);
    body.classList.toggle('noside', !settings.side);
    body.classList.toggle('nobg', !settings.bg);
    this._paintRules();
    this._listKeys = {};
  }

  render(state) {
    this.state = state;
    this.offset = state.now - Date.now() / 1000;
    this._setStars(state.stars);
    this.emotes.watch(state.room_id);
    const stage = $('stage');
    if (state.state === 'stopped') {
      stage.hidden = $('lobby').hidden = true;
      this._roundKey = '';
      this._cues = [];
      this.confetti.stop();
      return;
    }
    stage.hidden = false;
    const paused = state.state === 'paused', waiting = !state.best, over = Boolean(state.results);
    const wasWaiting = !$('lobby').hidden;
    $('card').classList.toggle('results', over && !paused);
    $('card').classList.toggle('victory', over && !paused && state.results.reason === 'win');
    $('card').classList.toggle('paused', paused);
    $('pause').hidden = !paused;
    $('head').hidden = $('play').hidden = waiting || paused;
    $('lobby').hidden = !waiting || paused;
    const roundKey = waiting ? '' : state.round + ':' + state.started;
    if (roundKey !== this._roundKey) {
      this._roundKey = roundKey;
      this._listKeys = {};
      this._wasOver = over;
      this._closest = '';
      this._hints = waiting ? 0 : state.hints;
      this.confetti.stop();
      if (!waiting) this._startRound(over);
    }
    if (over && !this._wasOver) this._celebrate(state.results);
    this._wasOver = over;
    this._paintFeed(state);
    this._paintLists(state);
    if (paused) {
      this._paintPause(state);
    } else if (waiting) {
      if (!wasWaiting) this._countdownFrom = this._secondsLeft = null;
    } else {
      $('round').textContent = state.round;
      $('status').textContent = over ? HEADLINES[state.results.reason] || HEADLINES.skip : '';
      $('count').textContent = state.words;
      this._paintPlaque(state.results || null);
      this._paintRows(state, over);
    }
    this._paintClock();
    this._playCues();
    this._animate = !this.still;
  }

  tick() {
    if (this.still) return;
    this._paintClock();
    this._playCues();
  }

  _paintClock() {
    const state = this.state;
    if (!state || state.state === 'paused' || $('stage').hidden) return;
    const now = this.still ? state.now : Date.now() / 1000 + this.offset;
    if (!state.best) {
      this._paintCountdown(state.starts_at - now, state.trouble);
      return;
    }
    const results = state.results;
    let label = '', progress = 0;
    if (results) {
      const left = results.next_at - now;
      progress = left / Math.max(1, results.pause);
      if (left > 0) label = 'следующее слово через ' + clockText(wholeSeconds(left));
      else label = state.trouble ? 'нет связи с сервером слов…' : 'загадываю слово…';
    } else if (state.hinting) {
      label = 'ищу подсказку…';
    } else if (state.hint_at) {
      const left = Math.max(0, state.hint_at - now);
      label = 'подсказка через ' + clockText(wholeSeconds(left));
      progress = left / Math.max(1, state.hint_every);
    }
    $('clock').textContent = clockText(results ? results.seconds : now - state.started - state.idle);
    $('timeline').style.visibility = label ? 'visible' : 'hidden';
    $('label').textContent = label;
    $('fill').style.setProperty('--p', share(progress).toFixed(3));
  }

  _fitStage() {
    const scale = Math.min(window.innerWidth / STAGE_WIDTH, window.innerHeight / STAGE_HEIGHT);
    $('stage').style.setProperty('--k', scale);
  }

  _cue(name) {
    if (this._animate) this._cues.push(name);
  }

  _playCues() {
    const name = SOUND_PRIORITY.find((sound) => this._cues.includes(sound));
    this._cues = [];
    if (!name || this.still || !this.settings.sound) return;
    this.heard.push(name);
    if (this.heard.length > 50) this.heard.shift();
    play(name, this.settings.volume);
  }

  _setStars(stars) {
    const key = JSON.stringify(stars || []);
    if (key === this._starsKey) return;
    this._starsKey = key;
    this._stars = new Map(stars || []);
    this._listKeys = {};
    this._feedStale = true;
  }

  _starOf(name) {
    return this._stars.get(String(name || '').toLowerCase()) || '';
  }

  _redrawFeed() {
    this._feedStale = true;
    if (this.state) this._paintFeed(this.state);
  }

  _startRound(over) {
    $('best').textContent = '';
    this._rows = new Map();
    if (over) return;
    this._cue('start');
    if (!this._animate) return;
    const field = $('play');
    field.classList.remove('enter');
    void field.offsetWidth;
    field.classList.add('enter');
  }

  _celebrate(results) {
    if (!this._animate) return;
    this._cue(results.reason === 'win' ? 'win' : 'end');
    if (results.reason !== 'win') return;
    const seconds = Math.max(CONFETTI.shortest, Math.min(CONFETTI.longest, results.pause - CONFETTI.rest));
    this.confetti.start(seconds);
  }

  _paintPlaque(results) {
    const key = results ? JSON.stringify([results.reason, results.word, results.winner, results.star, results.color,
      results.crown]) : '';
    if (key === this._finaleKey) return;
    this._finaleKey = key;
    const plaque = $('plaque'), answer = $('answer'), winner = $('winner');
    plaque.hidden = !results;
    if (!results) return;
    plaque.className = 'plaque' + (results.reason === 'win' ? ' won' : '') + (this._animate ? ' pop' : '');
    $('verdict').textContent = VERDICTS[results.reason] || VERDICTS.skip;
    winner.textContent = '';
    if (results.winner) {
      winner.append(nickBox('chip', { user: results.winner, star: results.star, color: results.color,
        crown: results.crown }));
    }
    answer.hidden = !results.word;
    answer.textContent = results.word;
    const taken = winner.parentNode.offsetWidth || ANSWER.verdict;
    answer.style.fontSize = answerSize(results.word.length, ANSWER.room - ANSWER.gap - taken) + 'px';
  }

  _row(row) {
    if (row.empty) return el('div', 'row empty', row.empty);
    const node = el('div', 'row ' + tone(row.rank) + (row.hint ? ' hint' : '')), slab = el('div', 'slab');
    node.style.setProperty('--w', barWidth(row.rank) + '%');
    slab.append(el('i', 'bar'), el('span', 'word', row.rude ? masked(row.word) : row.word), el('b', 'rank', row.rank));
    node.append(slab, row.hint ? el('span', 'who note', HINT_NOTE) : nickBox('who', row));
    return node;
  }

  _paintRows(state, over) {
    const box = $('best'), old = this._rows, next = new Map();
    const fits = box.clientHeight ? rowsThatFit(box.clientHeight) : over ? ROW.finale : ROW.usual;
    const rows = state.best.length ? state.best.slice(0, fits) : [{ empty: 'пока пусто — напиши слово в чат' }];
    for (const row of rows) {
      const key = row.empty ? '' : row.word, signature = JSON.stringify(row);
      let known = old.get(key);
      if (!known || known.signature !== signature) {
        const node = this._row(row);
        if (known) known.node.replaceWith(node);
        else if (this._animate && !row.empty) node.classList.add('pop');
        known = { node, signature };
      }
      next.set(key, known);
    }
    old.forEach((known, key) => {
      if (!next.has(key)) known.node.remove();
    });
    let place = box.firstChild;
    next.forEach((known) => {
      if (known.node === place) place = place.nextSibling;
      else box.insertBefore(known.node, place);
    });
    this._rows = next;
    const top = state.best[0], closest = top ? top.word : '';
    if (closest && closest !== this._closest && !top.hint && !over && top.rank <= BEST_SOUND_RANK) this._cue('best');
    this._closest = closest;
    if (state.hints > this._hints) this._cue('hint');
    this._hints = state.hints;
  }

  _paintList(id, rows, emptyText, hidden) {
    const key = JSON.stringify([rows, emptyText, hidden]);
    if (this._listKeys[id] === key) return;
    this._listKeys[id] = key;
    const list = $(id);
    list.textContent = '';
    if (!rows.length) list.append(el('li', 'note', emptyText));
    rows.forEach((row, i) => {
      const star = this._starOf(row.name);
      const item = el('li', i === 0 ? 'first' : '');
      item.append(el('span', 'place', i + 1));
      if (row.crown) item.append(el('i', 'crown'));
      item.append(el('span', star ? 'name ' + star : 'name', row.name), el('span', 'points', row.score));
      list.append(item);
    });
    if (hidden > 0) {
      list.append(el('li', 'note', 'и ещё ' + hidden + ' ' + plural(hidden, 'игрок', 'игрока', 'игроков')));
    }
  }

  _paintFacts(id, state) {
    const facts = !state.best ? [] : [['Участников', state.guessers], ['Слов', state.words],
      ['Повторов', state.repeats], ['Подсказок', state.hints], ['Ближе всего', state.closest || '—']];
    const key = JSON.stringify(facts);
    if (this._listKeys[id] === key) return;
    this._listKeys[id] = key;
    const list = $(id);
    list.textContent = '';
    if (!facts.length) list.append(el('li', 'note', 'раунд ещё не начался'));
    for (const [name, value] of facts) {
      const item = el('li', 'fact');
      item.append(el('span', 'name', name), el('span', 'points', value));
      list.append(item);
    }
  }

  _paintPause(state) {
    this._paintFacts('pause-round', state);
    this._paintList('pause-total', state.top || [], 'пока никто не победил', 0);
  }

  _paintLists(state) {
    const top = (state.top || []).slice(0, TOP_ROWS);
    $('box-round').hidden = !state.best;
    this._paintFacts('list-round', state);
    this._paintList('list-total', top, 'пока никто', (state.players || 0) - top.length);
  }

  _paintRules() {
    const rules = ['Пиши в чат одно слово', 'Меньше число — ближе', 'Число 1 — слово угадано',
      'Только существительные'];
    if (this.settings.hint_every) rules.push('Подсказка — раз в ' + this.settings.hint_every + ' с');
    const list = $('rules');
    list.textContent = '';
    for (const rule of rules) list.append(el('li', '', rule));
  }

  _fillText(box, message) {
    const own = message.emotes || null;
    if (message.rank || (!own && !this.emotes.size)) {
      box.textContent = message.text;
      return;
    }
    let plain = '';
    message.text.split(' ').forEach((word, i) => {
      const url = word ? this.emotes.url(word, own) : '';
      if (!url) {
        plain += (i ? ' ' : '') + word;
        return;
      }
      if (plain || i) box.append(plain + (i ? ' ' : ''));
      plain = '';
      const image = el('img');
      image.alt = word;
      image.onerror = () => image.replaceWith(word);
      image.src = url;
      box.append(image);
    });
    if (plain) box.append(plain);
  }

  _messageRow(message, fresh) {
    const star = message.star || '', scored = message.rank > 0;
    const marks = (scored && !message.repeat ? ' hit' : '') + (star ? ' star star-' + star : '') +
      (fresh ? ' pop' : '');
    const row = el('div', 'msg' + marks), text = el('span', 'text');
    this._fillText(text, message);
    row.append(...nickParts(message), ' ', text);
    if (scored) row.append(' ', el('i', 'rank ' + tone(message.rank), message.rank));
    const note = message.repeat ? NOTES.repeat : message.unknown ? NOTES.unknown : message.failed ? NOTES.failed : '';
    if (note) row.append(' ', el('i', 'mark', note));
    return row;
  }

  _paintFeed(state) {
    const feed = state.feed || [], box = $('chat');
    if (this._feedStale) {
      this._feedStale = false;
      this._feedRows.clear();
      box.textContent = '';
    }
    const newest = feed.length ? feed[feed.length - 1].id : 0;
    if (newest < this._feedNewest) this._feedNewest = 0;
    const ids = new Set(feed.map((message) => message.id));
    this._feedRows.forEach((known, id) => {
      if (ids.has(id)) return;
      known.row.remove();
      this._feedRows.delete(id);
    });
    const note = box.querySelector('.note');
    if (feed.length && note) note.remove();
    if (!feed.length && !note) box.append(el('div', 'msg note', 'пока тихо'));
    for (const message of feed) {
      const mark = [message.rank, message.repeat, message.unknown, message.failed, message.crown].join();
      const known = this._feedRows.get(message.id);
      if (known && known.mark === mark) continue;
      const row = this._messageRow(message, !known && this._animate && message.id > this._feedNewest);
      if (known) known.row.replaceWith(row);
      else box.append(row);
      this._feedRows.set(message.id, { row, mark });
    }
    this._feedNewest = Math.max(this._feedNewest, newest);
  }

  _paintCountdown(left, trouble) {
    const seconds = Math.max(1, wholeSeconds(left)), ring = $('countdown'), number = $('countdown-number');
    const waiting = $('waiting');
    ring.hidden = left <= 0;
    waiting.hidden = left > 0;
    if (left <= 0) {
      waiting.textContent = trouble ? 'Нет связи с сервером слов — пробую ещё раз…' : 'Загадываю слово…';
      return;
    }
    if (this._countdownFrom === null) this._countdownFrom = Math.max(1, left);
    ring.style.setProperty('--p', share(left / this._countdownFrom).toFixed(3));
    if (seconds === this._secondsLeft) return;
    this._secondsLeft = seconds;
    number.textContent = seconds;
    ring.classList.toggle('final', seconds <= FINAL_SECONDS);
    number.classList.remove('beat');
    void number.offsetWidth;
    number.classList.add('beat');
    if (seconds <= FINAL_SECONDS) this._cue('tick');
  }
}
