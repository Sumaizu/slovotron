const TWITCH_CDN = 'https://static-cdn.jtvnw.net/emoticons/v2/';
const TWITCH_ID = /^[A-Za-z0-9_]+$/;
const SAFE_ID = /^[0-9A-Za-z]{1,40}$/;
const REFRESH_SECONDS = 600;
const RETRY_SECONDS = 120;

function fromSevenTv(data, urls) {
  const emotes = data && (data.emotes || (data.emote_set && data.emote_set.emotes));
  for (const emote of Array.isArray(emotes) ? emotes : []) {
    if (emote && typeof emote.name === 'string' && SAFE_ID.test(String(emote.id))) {
      urls.set(emote.name, 'https://cdn.7tv.app/emote/' + emote.id + '/2x.webp');
    }
  }
}

function fromBetterTtv(data, urls) {
  const emotes = Array.isArray(data) ? data
    : [].concat((data && data.channelEmotes) || [], (data && data.sharedEmotes) || []);
  for (const emote of emotes) {
    if (emote && typeof emote.code === 'string' && SAFE_ID.test(String(emote.id))) {
      urls.set(emote.code, 'https://cdn.betterttv.net/emote/' + emote.id + '/2x');
    }
  }
}

function fromFrankerFaceZ(data, urls) {
  const sets = (data && data.sets) || {};
  const ids = data && data.room ? [data.room.set] : (data && data.default_sets) || Object.keys(sets);
  for (const id of ids) {
    const emotes = sets[id] && sets[id].emoticons;
    for (const emote of Array.isArray(emotes) ? emotes : []) {
      if (!emote || typeof emote.name !== 'string' || !SAFE_ID.test(String(emote.id))) continue;
      const images = emote.animated || emote.urls || {};
      const folder = emote.animated ? '/animated/' : '/';
      urls.set(emote.name, 'https://cdn.frankerfacez.com/emote/' + emote.id + folder + (images['2'] ? '2' : '1'));
    }
  }
}

const SOURCES = [
  { url: 'https://api.frankerfacez.com/v1/set/global', read: fromFrankerFaceZ },
  { url: 'https://api.betterttv.net/3/cached/emotes/global', read: fromBetterTtv },
  { url: 'https://7tv.io/v3/emote-sets/global', read: fromSevenTv },
  { url: 'https://api.frankerfacez.com/v1/room/id/', read: fromFrankerFaceZ, channel: true },
  { url: 'https://api.betterttv.net/3/cached/users/twitch/', read: fromBetterTtv, channel: true },
  { url: 'https://7tv.io/v3/users/twitch/', read: fromSevenTv, channel: true },
];

async function fetchSource(source, room) {
  try {
    const response = await fetch(source.url + (source.channel ? room : ''));
    const urls = new Map();
    if (response.ok) source.read(await response.json(), urls);
    else if (response.status !== 404) return null;
    return urls;
  } catch (error) {
    return null;
  }
}

export class Emotes {
  constructor(onChange) {
    this.onChange = onChange;
    this.urls = new Map();
    this.room = '';
    this._signature = '';
    this._timer = 0;
  }

  get size() {
    return this.urls.size;
  }

  watch(room) {
    room = /^\d+$/.test(room || '') ? room : '';
    if (room === this.room) return;
    this.room = room;
    clearTimeout(this._timer);
    if (this.urls.size) this._replace(new Map());
    if (room) this._load(room);
  }

  url(word, twitchEmotes) {
    const own = twitchEmotes && Object.prototype.hasOwnProperty.call(twitchEmotes, word) ? twitchEmotes[word] : '';
    if (own && TWITCH_ID.test(own)) return TWITCH_CDN + own + '/default/dark/2.0';
    return this.urls.get(word) || '';
  }

  async _load(room) {
    const loaded = await Promise.all(SOURCES.map((source) => fetchSource(source, room)));
    if (room !== this.room) return;
    const failed = loaded.filter((urls) => !urls).length;
    const merged = new Map(failed ? this.urls : []);
    for (const urls of loaded) if (urls) urls.forEach((url, name) => merged.set(name, url));
    this._replace(merged);
    this._timer = setTimeout(() => this._load(room), (failed ? RETRY_SECONDS : REFRESH_SECONDS) * 1000);
  }

  _replace(urls) {
    const signature = Array.from(urls, (pair) => pair.join(' ')).join('\n');
    if (signature === this._signature) return;
    this.urls = urls;
    this._signature = signature;
    this.onChange();
  }
}
