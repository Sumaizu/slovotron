import { backendFor, hintReach, wordgunDifficulties } from '../../site/js/backends.js';
import { fakeNet, useNet } from './fixtures.js';
import { eq, ok, test } from './harness.js';

function recordingNet(replies) {
  const requests = [];
  window.__net = async (address, options = {}) => {
    const url = new URL(address);
    requests.push({ url, method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null,
      headers: options.headers || {} });
    const answer = replies(url, options);
    if (answer instanceof Error) throw answer;
    const status = answer.status || 200;
    return { ok: status < 300, status, json: async () => answer.data };
  };
  return requests;
}

async function fails(action) {
  try {
    await action();
  } catch (error) {
    return error;
  }
  return null;
}

test('контекстно: новая игра — номер и проверка, что слово не сломано', async () => {
  const requests = recordingNet((url) => (url.pathname === '/random-challenge' ? { data: { id: 'abc' } }
    : { data: { distance: 2722 } }));
  eq(await backendFor('kontekstno').create({ difficulty: '' }), 'abc');
  eq(requests.map((request) => request.url.href), ['https://api.contextno.com/random-challenge',
    'https://api.contextno.com/score?challenge_id=abc&word=%D0%B1%D0%B0%D0%BD%D0%B0%D0%BD&challenge_type=random']);
  eq(requests.map((request) => [request.method, request.headers.Accept]), [['GET', 'application/json'],
    ['GET', 'application/json']]);
  useNet(null);
});

test('контекстно: сломанная игра и ответ без номера — ошибка', async () => {
  recordingNet((url) => (url.pathname === '/random-challenge' ? { data: { id: 'abc' } } : { data: { distance: 0 } }));
  ok(await fails(() => backendFor('kontekstno').create()));
  recordingNet(() => ({ data: {} }));
  ok(await fails(() => backendFor('kontekstno').create()));
  recordingNet(() => ({ data: [1, 2] }));
  ok(await fails(() => backendFor('kontekstno').create()));
  recordingNet(() => ({ status: 502, data: {} }));
  eq((await fails(() => backendFor('kontekstno').create())).status, 502);
  recordingNet(() => new TypeError('нет связи'));
  ok(await fails(() => backendFor('kontekstno').create()));
  useNet(null);
});

test('контекстно: близость слова, незнакомое слово, пропавшая игра', async () => {
  const net = useNet(fakeNet()), backend = backendFor('kontekstno');
  eq(await backend.score('игра-1', 'молот'), { rank: 2 });
  eq(await backend.score('игра-1', 'серп'), { rank: 1 });
  eq(await backend.score('игра-1', 'ываыва'), { rank: 0 });
  net.gone = true;
  eq(await backend.score('игра-1', 'молот'), { gone: true });
  eq(await backend.hint('игра-1', 100), { gone: true });
  useNet(null);
});

test('контекстно: подсказка просит слово чуть ближе лучшего, а не вдвое', async () => {
  eq([null, 0, 5000, 300, 200, 100, 10, 4, 3, 2].map(hintReach), [300, 300, 300, 300, 300, 150, 15, 6, 4, 2]);
  const requests = recordingNet((url) => ({ data: { word: 'Курган', distance: Number(url.searchParams.get(
    'last_word_rank')) / 2 } }));
  const backend = backendFor('kontekstno');
  eq(await backend.hint('abc', 100), { word: 'Курган', rank: 75 });
  eq(await backend.hint('abc', null), { word: 'Курган', rank: 150 });
  eq(requests.map((request) => request.url.search), ['?challenge_id=abc&last_word_rank=150&challenge_type=random',
    '?challenge_id=abc&last_word_rank=300&challenge_type=random']);
  recordingNet(() => ({ data: { word: null, distance: null } }));
  eq(await backend.hint('abc', 100), { word: '' });
  useNet(null);
});

test('контекстно: загаданное слово можно узнать', async () => {
  const requests = recordingNet(() => ({ data: { word: 'Серп', distance: 1 } }));
  eq(await backendFor('kontekstno').reveal('abc'), 'Серп');
  eq(requests[0].url.search, '?challenge_id=abc&last_word_rank=1&challenge_type=random');
  recordingNet(() => ({ data: { error: 'Задание не найдено' } }));
  eq(await backendFor('kontekstno').reveal('abc'), '');
  useNet(null);
});

test('wordgun: новая игра — жетон; незнакомая сложность — игра по всему словарю', async () => {
  let requests = recordingNet(() => ({ data: { token: 'wg1.abc' } }));
  const backend = backendFor('wordgun');
  eq(await backend.create({ difficulty: 'hard' }), 'wg1.abc');
  eq(await backend.create({ difficulty: '' }), 'wg1.abc');
  eq(requests.map((request) => [request.url.href, request.method, request.body]), [
    ['https://api.wordgun.ru/v2/create_game', 'POST', { model: 'best', difficulty: 'hard' }],
    ['https://api.wordgun.ru/v2/create_game', 'POST', { model: 'best' }]]);
  eq(requests[0].headers['Content-Type'], 'application/json');
  requests = recordingNet((url, options) => (JSON.parse(options.body).difficulty
    ? { status: 400, data: { error: 'unknown difficulty' } } : { data: { token: 'wg1.all' } }));
  eq(await backend.create({ difficulty: 'старая' }), 'wg1.all');
  eq(requests.length, 2);
  recordingNet(() => ({ status: 503, data: {} }));
  eq((await fails(() => backend.create({ difficulty: 'hard' }))).status, 503);
  recordingNet(() => ({ data: {} }));
  ok(await fails(() => backend.create()));
  useNet(null);
});

test('wordgun: близость слова, подсказка, закончившаяся игра', async () => {
  const net = useNet(fakeNet()), backend = backendFor('wordgun');
  eq(await backend.score('жетон', 'молот'), { rank: 2 });
  eq(await backend.score('жетон', 'ываыва'), { rank: 0 });
  eq(await backend.hint('жетон', 150), { word: 'курган', rank: 75 });
  eq(await backend.hint('жетон', null), { word: 'намек', rank: 9000 });
  eq(await backend.hint('жетон', 2), { word: '' });
  eq(await backend.reveal('жетон'), '');
  net.gone = true;
  eq(await backend.score('жетон', 'молот'), { gone: true });
  eq(await backend.hint('жетон', 150), { gone: true });
  useNet(null);
});

test('wordgun: ошибка сервера при живой игре остаётся ошибкой', async () => {
  recordingNet((url) => (url.pathname === '/v2/is_live' ? { data: { is_live: true } } : { status: 500, data: {} }));
  eq((await fails(() => backendFor('wordgun').score('жетон', 'молот'))).status, 500);
  recordingNet((url) => (url.pathname === '/v2/is_live' ? new TypeError('нет связи') : { status: 500, data: {} }));
  eq((await fails(() => backendFor('wordgun').score('жетон', 'молот'))).status, 500);
  useNet(null);
});

test('wordgun: список сложностей с названиями по-русски', async () => {
  useNet(fakeNet());
  eq(await wordgunDifficulties(), [{ name: 'medium', label: 'Средняя' }, { name: 'hard', label: 'Hard' },
    { name: 'hell', label: 'hell' }]);
  useNet(null);
});
