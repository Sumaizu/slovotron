const KONTEKSTNO_URL = 'https://api.contextno.com/';
const WORDGUN_URL = 'https://api.wordgun.ru';
const WORDGUN_MODEL = 'best';
const TIMEOUT_SECONDS = 10;
const PROBE_WORD = 'банан';
const HINT_CEILING = 300;
const HINT_REACH = 1.5;

async function requestJson(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_SECONDS * 1000);
  try {
    const response = await window.fetch(url, Object.assign({ signal: controller.signal }, options));
    if (!response.ok) {
      const error = new Error('HTTP ' + response.status);
      error.status = response.status;
      throw error;
    }
    const data = await response.json();
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('пустой ответ');
    return data;
  } finally {
    clearTimeout(timer);
  }
}

function rankOf(value) {
  const rank = Math.trunc(Number(value));
  return rank > 0 ? rank : 0;
}

function hintReply(word, rank) {
  return typeof word === 'string' && word && rankOf(rank) ? { word, rank: rankOf(rank) } : { word: '' };
}

function kontekstno(method, params) {
  const url = new URL(method, KONTEKSTNO_URL);
  for (const key of Object.keys(params || {})) url.searchParams.set(key, params[key]);
  if (params) url.searchParams.set('challenge_type', 'random');
  return requestJson(url.href, { headers: { Accept: 'application/json' } });
}

const gameMissing = (data) => /задание/i.test(String(data.error || ''));

export function hintReach(best) {
  const reach = best ? Math.min(HINT_CEILING, Math.floor(best * HINT_REACH)) : HINT_CEILING;
  return Math.ceil(reach / 2) === best ? best : reach;
}

const kontekstnoBackend = {
  async create() {
    const id = String((await kontekstno('random-challenge')).id || '');
    if (!id) throw new Error('нет номера игры');
    const probe = await kontekstno('score', { challenge_id: id, word: PROBE_WORD });
    if (probe.distance === 0) throw new Error('игра сломана');
    return id;
  },

  async score(id, word) {
    const data = await kontekstno('score', { challenge_id: id, word });
    return gameMissing(data) ? { gone: true } : { rank: rankOf(data.distance) };
  },

  async hint(id, best) {
    const data = await kontekstno('tip', { challenge_id: id, last_word_rank: hintReach(best) });
    return gameMissing(data) ? { gone: true } : hintReply(data.word, data.distance);
  },

  async reveal(id) {
    const data = await kontekstno('tip', { challenge_id: id, last_word_rank: 1 });
    return typeof data.word === 'string' ? data.word : '';
  },
};

function wordgun(path, body) {
  const headers = { Accept: 'application/json' };
  if (!body) return requestJson(WORDGUN_URL + path, { headers });
  headers['Content-Type'] = 'application/json';
  return requestJson(WORDGUN_URL + path, { method: 'POST', headers, body: JSON.stringify(body) });
}

async function wordgunGameOver(token) {
  try {
    return (await wordgun('/v2/is_live', { token })).is_live === false;
  } catch (error) {
    return false;
  }
}

async function wordgunAsk(path, body) {
  try {
    return await wordgun(path, body);
  } catch (error) {
    if (await wordgunGameOver(body.token)) return null;
    throw error;
  }
}

const wordgunBackend = {
  async create({ difficulty = '' } = {}) {
    let data = null;
    if (difficulty) {
      try {
        data = await wordgun('/v2/create_game', { model: WORDGUN_MODEL, difficulty });
      } catch (error) {
        if (error.status !== 400) throw error;
      }
    }
    if (!data) data = await wordgun('/v2/create_game', { model: WORDGUN_MODEL });
    const token = String(data.token || '');
    if (!token) throw new Error('нет номера игры');
    return token;
  },

  async score(token, word) {
    const data = await wordgunAsk('/v1/guess', { token, word });
    if (!data) return { gone: true };
    return { rank: data.in_vocab ? rankOf(data.rank) : 0 };
  },

  async hint(token, best) {
    const data = await wordgunAsk('/v2/hint', best ? { token, best_rank: best } : { token });
    return data ? hintReply(data.word, data.rank) : { gone: true };
  },

  async reveal() {
    return '';
  },
};

export function backendFor(name) {
  return name === 'wordgun' ? wordgunBackend : kontekstnoBackend;
}

export async function wordgunDifficulties() {
  const data = await wordgun('/v2/get_model?model=' + WORDGUN_MODEL);
  return (Array.isArray(data.difficulty) ? data.difficulty : [])
    .filter((tier) => tier && typeof tier.name === 'string' && tier.name)
    .map((tier) => ({ name: tier.name, label: (tier.i18n && (tier.i18n.ru || tier.i18n.en)) || tier.name }));
}
