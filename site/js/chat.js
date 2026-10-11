export const CHAT_URL = 'wss://irc-ws.chat.twitch.tv:443';
const SILENCE_LIMIT = 360;
const WATCH_EVERY = 30;
const TAG_ESC = { s: ' ', ':': ';', '\\': '\\', r: '\r', n: '\n' };

function unescapeTag(value) {
  if (!value.includes('\\')) return value;
  let text = '';
  for (let i = 0; i < value.length; i++) {
    if (value[i] === '\\' && i + 1 < value.length) {
      const next = value[++i];
      text += Object.prototype.hasOwnProperty.call(TAG_ESC, next) ? TAG_ESC[next] : next;
    } else {
      text += value[i];
    }
  }
  return text;
}

function quietly(action) {
  try {
    action();
  } catch (error) {
    return;
  }
}

export function parseLine(line) {
  line = String(line || '').replace(/[\r\n]+$/, '');
  if (!line) return null;
  const tags = new Map();
  if (line.charAt(0) === '@') {
    const end = line.indexOf(' ');
    const raw = end < 0 ? line.slice(1) : line.slice(1, end);
    line = end < 0 ? '' : line.slice(end + 1);
    for (const pair of raw.split(';')) {
      const eq = pair.indexOf('=');
      tags.set(eq < 0 ? pair : pair.slice(0, eq), eq < 0 ? '' : unescapeTag(pair.slice(eq + 1)));
    }
  }
  let prefix = '';
  if (line.charAt(0) === ':') {
    const end = line.indexOf(' ');
    prefix = end < 0 ? line.slice(1) : line.slice(1, end);
    line = end < 0 ? '' : line.slice(end + 1);
  }
  const cut = line.indexOf(' :');
  const head = cut < 0 ? line : line.slice(0, cut);
  const parts = head.split(/\s+/).filter(Boolean);
  if (!parts.length) return null;
  return { command: parts[0].toUpperCase(), tags, nick: prefix.split('!', 1)[0], params: parts.slice(1),
    text: cut < 0 ? '' : line.slice(cut + 2) };
}

export function chatMessage(msg) {
  if (!msg || msg.command !== 'PRIVMSG') return null;
  let text = msg.text;
  if (text.startsWith('\u0001ACTION ') && text.endsWith('\u0001')) text = text.slice(8, -1);
  const badges = msg.tags.get('badges') || '';
  return { name: msg.tags.get('display-name') || msg.nick, text,
    mod: msg.tags.get('mod') === '1' || badges.includes('broadcaster/') || badges.includes('moderator/') };
}

export function chatEmotes(msg) {
  let text = msg.text;
  if (text.startsWith('\u0001ACTION ') && text.endsWith('\u0001')) text = text.slice(8, -1);
  const chars = Array.from(text), emotes = {};
  for (const part of (msg.tags.get('emotes') || '').split('/')) {
    const colon = part.indexOf(':');
    if (colon < 1) continue;
    const place = /^(\d+)-(\d+)/.exec(part.slice(colon + 1));
    if (!place) continue;
    const name = chars.slice(Number(place[1]), Number(place[2]) + 1).join('');
    if (name && !/\s/.test(name)) emotes[name] = part.slice(0, colon);
  }
  return emotes;
}

export function chatMeta(msg) {
  return { msgId: msg.tags.get('id') || '', login: msg.nick.toLowerCase(), color: msg.tags.get('color') || '',
    emotes: chatEmotes(msg) };
}

export function chatClear(msg) {
  if (!msg) return null;
  if (msg.command === 'CLEARMSG') {
    const msgId = msg.tags.get('target-msg-id');
    return msgId ? { msgId } : null;
  }
  if (msg.command === 'CLEARCHAT') return msg.text ? { user: msg.text.toLowerCase() } : { everything: true };
  return null;
}

export class TwitchChat {
  constructor({ onMessage, onClear = null, onStatus = null, channel = '', Socket = null, later = null,
    clock = () => Date.now() / 1000 } = {}) {
    this.onMessage = onMessage;
    this.onClear = onClear;
    this.onStatus = onStatus;
    this.channel = String(channel || '').toLowerCase();
    this.Socket = Socket || WebSocket;
    this.later = later || ((action, seconds) => {
      const id = setTimeout(action, seconds * 1000);
      return () => clearTimeout(id);
    });
    this.clock = clock;
    this.status = { state: 'off', text: 'канал не указан', channel: this.channel, messages: 0, roomId: '' };
    this._ws = null;
    this._running = false;
    this._backoff = 2;
    this._cancelRetry = null;
    this._cancelWatch = null;
    this._last = 0;
  }

  start() {
    this._running = true;
    this._connect();
  }

  stop() {
    this._running = false;
    this._drop();
    this._set('off', 'остановлено');
  }

  setChannel(channel) {
    channel = String(channel || '').toLowerCase();
    if (channel === this.channel) return;
    this.channel = channel;
    this.status = Object.assign({}, this.status, { messages: 0, roomId: '' });
    this._backoff = 2;
    if (this._running) this._connect();
  }

  _set(state, text, extra = {}) {
    this.status = Object.assign({}, this.status, { state, text, channel: this.channel }, extra);
    if (this.onStatus) this.onStatus(this.status);
  }

  _drop() {
    if (this._cancelRetry) this._cancelRetry();
    if (this._cancelWatch) this._cancelWatch();
    this._cancelRetry = this._cancelWatch = null;
    const ws = this._ws;
    this._ws = null;
    if (ws) quietly(() => ws.close());
  }

  _connect() {
    this._drop();
    const channel = this.channel;
    if (!channel) {
      this._set('off', 'канал не указан');
      return;
    }
    this._set('connecting', 'подключаюсь к чату ' + channel + '…');
    let ws;
    try {
      ws = new this.Socket(CHAT_URL);
    } catch (error) {
      this._retry(error && error.message ? error.message : 'не удалось открыть соединение');
      return;
    }
    this._ws = ws;
    this._last = this.clock();
    ws.onopen = () => {
      if (ws !== this._ws) return;
      ws.send('CAP REQ :twitch.tv/tags twitch.tv/commands');
      ws.send('PASS SCHMOOPIIE');
      ws.send('NICK justinfan' + (10000 + Math.floor(Math.random() * 90000)));
      ws.send('JOIN #' + channel);
    };
    ws.onmessage = (event) => {
      if (ws !== this._ws) return;
      this._last = this.clock();
      for (const line of String(event.data).split('\r\n')) {
        if (line && ws === this._ws) this._handle(ws, line);
      }
    };
    ws.onclose = () => {
      if (ws !== this._ws) return;
      this._ws = null;
      this._retry('Twitch закрыл соединение');
    };
    ws.onerror = () => {};
    this._watch();
  }

  _watch() {
    this._cancelWatch = this.later(() => {
      if (!this._ws) return;
      if (this.clock() - this._last > SILENCE_LIMIT) this._fail('Twitch молчит дольше 6 минут');
      else this._watch();
    }, WATCH_EVERY);
  }

  _fail(reason) {
    this._drop();
    this._retry(reason);
  }

  _retry(reason) {
    if (!this._running) return;
    if (this._cancelWatch) this._cancelWatch();
    this._cancelWatch = null;
    const wait = this._backoff;
    this._backoff = Math.min(this._backoff * 2, 60);
    this._set('error', 'нет связи с чатом (' + reason + ') — повтор через ' + wait + ' с');
    this._cancelRetry = this.later(() => {
      this._cancelRetry = null;
      if (this._running) this._connect();
    }, wait);
  }

  _handle(ws, line) {
    const msg = parseLine(line);
    if (!msg) return;
    const cmd = msg.command;
    if (cmd === 'PING') {
      ws.send('PONG :' + (msg.text || 'tmi.twitch.tv'));
    } else if (cmd === 'RECONNECT') {
      this._fail('Twitch попросил переподключиться');
    } else if (cmd === '366' || cmd === 'ROOMSTATE') {
      this._backoff = 2;
      const room = msg.tags.get('room-id') || '';
      const known = /^\d+$/.test(room) && room !== this.status.roomId;
      if (this.status.state !== 'connected') {
        this._set('connected', 'читаю чат ' + this.channel, known ? { roomId: room } : {});
      } else if (known) {
        this._set(this.status.state, this.status.text, { roomId: room });
      }
    } else if (cmd === 'NOTICE' && msg.text) {
      this._set(this.status.state, 'Twitch: ' + msg.text);
    } else if (cmd === 'PRIVMSG') {
      const message = chatMessage(msg);
      if (!message) return;
      this.status.messages = (this.status.messages || 0) + 1;
      quietly(() => this.onMessage(message.name, message.text, message.mod, chatMeta(msg)));
    } else if ((cmd === 'CLEARMSG' || cmd === 'CLEARCHAT') && this.onClear) {
      const removed = chatClear(msg);
      if (removed) quietly(() => this.onClear(removed));
    }
  }
}
