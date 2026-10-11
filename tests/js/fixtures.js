import { clean } from '../../site/js/config.js';
import { Game } from '../../site/js/engine.js';

export const PLAIN = { pause: 30, hint_every: 60 };
export const RANKS = { молот: 2, кузница: 15, железо: 40, поле: 120, колос: 300, трактор: 700, дом: 1500,
  кошка: 4000, банан: 2722 };
export const SECRET = 'серп';

export const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

export function fakeClock(start = 1000) {
  const clock = () => clock.t;
  clock.t = start;
  return clock;
}

export function memoryStorage() {
  const data = new Map();
  return {
    data,
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => { data.set(key, String(value)); },
    removeItem: (key) => { data.delete(key); },
  };
}

export function fakeBackend({ secret = SECRET, ranks = RANKS, tips = [], revealed = true } = {}) {
  const backend = {
    secret,
    ranks: new Map(Object.entries(ranks)),
    tips: tips.slice(),
    revealed,
    down: false,
    closed: false,
    gone: false,
    gate: null,
    created: [],
    asked: [],
    hinted: [],
    flying: 0,
    busiest: 0,
    async create(options) {
      backend.created.push(options);
      if (backend.down || backend.closed) throw new Error('нет связи');
      return 'игра-' + backend.created.length;
    },
    async score(id, word) {
      backend.asked.push(word);
      backend.flying += 1;
      backend.busiest = Math.max(backend.busiest, backend.flying);
      if (backend.gate) await backend.gate;
      backend.flying -= 1;
      if (backend.down) throw new Error('нет связи');
      if (backend.gone) return { gone: true };
      return { rank: word === backend.secret ? 1 : backend.ranks.get(word) || 0 };
    },
    async hint(id, best) {
      backend.hinted.push(best);
      if (backend.gate) await backend.gate;
      if (backend.down) throw new Error('нет связи');
      if (backend.gone) return { gone: true };
      const tip = backend.tips.shift();
      return tip ? { word: tip[0], rank: tip[1] } : { word: '' };
    },
    async reveal() {
      if (backend.down) throw new Error('нет связи');
      return backend.revealed ? backend.secret.toUpperCase() : '';
    },
    hold() {
      let open = null;
      backend.gate = new Promise((resolve) => { open = resolve; });
      return () => {
        backend.gate = null;
        open();
      };
    },
  };
  return backend;
}

export function makeGame({ settings = {}, backend = fakeBackend(), backends = null, scores = null, at = 1000,
  banned = null } = {}) {
  const clock = fakeClock(at), timers = [], events = [];
  const later = (action, seconds) => {
    const timer = { action, at: clock.t + seconds, dropped: false };
    timers.push(timer);
    return () => { timer.dropped = true; };
  };
  const game = new Game(backends || (() => backend), clean({ ...PLAIN, ...settings }), scores,
    { clock, later, banned });
  game.listeners.push((event) => events.push(event));
  return { game, clock, events, backend, timers };
}

export async function startRound(options = {}) {
  const made = makeGame(options);
  made.game.open(0);
  await settle();
  made.game.tick();
  return made;
}

export async function say(game, user, text, details = {}) {
  const result = game.feed(user, text, details);
  await settle();
  return result;
}

export const local = (...when) => new Date(...when).getTime() / 1000;

const reply = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data,
  text: async () => JSON.stringify(data) });

export function fakeNet({ secret = SECRET, ranks = RANKS, tips = { 150: 'холм', 75: 'курган', 1: SECRET } } = {}) {
  const net = { secret, ranks: new Map(Object.entries(ranks)), tips, down: false, gone: false, calls: [], games: 0 };
  net.handle = async (address, options = {}) => {
    const url = new URL(address), query = url.searchParams;
    const body = options.body ? JSON.parse(options.body) : {};
    const word = query.get('word') || body.word || '';
    const rank = word === net.secret ? 1 : net.ranks.get(word) || 0;
    net.calls.push(url.host + url.pathname + (word ? ' ' + word : ''));
    if (net.down) throw new TypeError('нет связи');
    if (url.host === 'api.contextno.com') {
      if (url.pathname === '/random-challenge') return reply({ id: 'игра-' + (++net.games) });
      if (net.gone) return reply({ distance: null, error: 'Задание не найдено' });
      if (url.pathname === '/score') {
        return reply(rank ? { word, distance: rank, error: null }
          : { word, distance: null, error: 'Слово ' + word + ' не найдено в словаре' });
      }
      if (url.pathname === '/tip') {
        const closer = Math.ceil(Number(query.get('last_word_rank')) / 2);
        return reply({ word: net.tips[closer] || 'намек', distance: closer, error: null });
      }
    }
    if (url.host === 'api.wordgun.ru') {
      if (url.pathname === '/v2/get_model') {
        return reply({ difficulty: [{ name: 'medium', i18n: { ru: 'Средняя', en: 'Medium' } },
          { name: 'hard', i18n: { en: 'Hard' } }, { name: 'hell' }, { i18n: { ru: 'без имени' } }] });
      }
      if (url.pathname === '/v2/create_game') {
        if (body.difficulty === 'старая') return reply({ error: 'unknown difficulty' }, 400);
        return reply({ token: 'жетон-' + (++net.games) + (body.difficulty ? '-' + body.difficulty : '') });
      }
      if (url.pathname === '/v2/is_live') return reply({ is_live: !net.gone });
      if (net.gone) return reply({ error: 'expired' }, 400);
      if (url.pathname === '/v1/guess') return reply(rank ? { in_vocab: true, rank } : { in_vocab: false });
      if (url.pathname === '/v2/hint') {
        const closer = body.best_rank ? Math.ceil(body.best_rank / 2) : 9000;
        return reply(closer > 1 ? { word: net.tips[closer] || 'намек', rank: closer } : { word: null });
      }
    }
    return reply({}, 404);
  };
  return net;
}

export function useNet(net) {
  window.__net = net ? net.handle : null;
  return net;
}
