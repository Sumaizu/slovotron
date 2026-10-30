import { SOUNDS, measure } from '../../site/js/sound.js';
import { answerSize, barWidth, masked, rowsThatFit, tone } from '../../site/js/view.js';
import { fakeNet, useNet } from './fixtures.js';
import { eq, no, ok, test } from './harness.js';

const SITE = '/site/';
const WHITE = 'rgb(255, 255, 255)';
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(check, note = 'условие', ms = 15000) {
  const deadline = Date.now() + ms;
  for (;;) {
    let value = null;
    try {
      value = check();
    } catch (error) {
      value = null;
    }
    if (value) return value;
    if (Date.now() > deadline) throw new Error('не дождались: ' + note);
    await wait(30);
  }
}

async function open(path, ready) {
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;left:0;top:0;width:1280px;height:720px;border:0;background:#333';
  frame.src = SITE + path;
  document.body.append(frame);
  await until(() => ready(frame.contentWindow), 'страница ' + path + ' не поднялась');
  return frame;
}

const element = (w, id) => w.document.getElementById(id);
const all = (w, selector) => Array.from(w.document.querySelectorAll(selector));
const box = (node) => {
  const rect = node.getBoundingClientRect();
  return [Math.round(rect.left), Math.round(rect.right)];
};
const camAt = (w) => {
  const stage = w.document.getElementById('stage').getBoundingClientRect();
  const cam = w.document.querySelector('.cam').getBoundingClientRect();
  return [cam.left - stage.left, cam.top - stage.top, cam.width, cam.height].map(Math.round);
};
const rows = (w, id) => all(w, '#' + id + ' .row:not(.empty)').map((row) => [
  row.querySelector('.word').textContent, row.querySelector('.who').textContent,
  row.querySelector('.rank') ? row.querySelector('.rank').textContent : '']);
const listed = (w, id) => all(w, '#' + id + ' li').map((row) => row.textContent);

function fresh(options) {
  for (const key of Object.keys(localStorage)) if (key.startsWith('slovotron')) localStorage.removeItem(key);
  return useNet(fakeNet(options));
}

const overlay = (query = '') => open('overlay.html' + (query ? '?' + query : ''),
  (w) => w.slovotron && w.slovotron.game);
const embedded = (query = '') => open('overlay.html?embed=1' + (query ? '&' + query : ''),
  (w) => w.slovotron && w.slovotron.game);

async function begin(w, game) {
  await until(() => !element(w, 'lobby').hidden && game._next, 'отсчёт на экране, слово загадано');
  game.tick(game.startsAt);
  await until(() => element(w, 'lobby').hidden && !element(w, 'play').hidden, 'раунд на экране');
}

async function playing(query = '') {
  const frame = await overlay(query);
  const w = frame.contentWindow, game = w.slovotron.game;
  await begin(w, game);
  return { frame, w, game, chat: w.slovotron.chat, view: w.slovotron.view };
}

function noImages(w) {
  Object.defineProperty(w.HTMLImageElement.prototype, 'src', {
    configurable: true,
    get() { return this.getAttribute('data-src') || ''; },
    set(value) { this.setAttribute('data-src', value); },
  });
}

function showSource(w, visible) {
  w.dispatchEvent(new w.CustomEvent('obsSourceVisibleChanged', { detail: { visible } }));
}

function fakeSockets(chat) {
  const sockets = [];
  chat.Socket = class {
    constructor(url) {
      this.url = url;
      this.sent = [];
      this.closed = false;
      sockets.push(this);
    }

    send(line) {
      this.sent.push(line);
    }

    close() {
      this.closed = true;
    }
  };
  return sockets;
}

function inStep(w, name, count) {
  const phases = w.document.getAnimations().filter((item) => item.animationName === name)
    .map((item) => item.effect.getComputedTiming().progress);
  if (phases.length < count || phases.includes(null)) return false;
  const range = Math.max(...phases) - Math.min(...phases);
  return Math.min(range, 1 - range) < 0.02;
}

const EMOTE_REPLIES = {
  'https://7tv.io/v3/emote-sets/global': {
    emotes: [{ name: 'catJAM', id: '01ABCDEFGHJKMNPQRSTVWXYZ01' }, { name: 'плохой', id: '../x' }],
  },
  'https://7tv.io/v3/users/twitch/123': {
    emote_set: { emotes: [{ name: 'Channel7', id: '01ZZZZZZZZZZZZZZZZZZZZZZZZ' }] },
  },
  'https://api.betterttv.net/3/cached/emotes/global': [{ id: '54fa8f1401e468494b85b537', code: ':tf:' }],
  'https://api.betterttv.net/3/cached/users/twitch/123': {
    channelEmotes: [], sharedEmotes: [{ id: 'bbbbbbbbbbbbbbbbbbbbbbbb', code: 'Shared' }],
  },
  'https://api.frankerfacez.com/v1/set/global': {
    default_sets: [3], sets: { 3: { emoticons: [{ id: 28136, name: 'LilZ', urls: { 1: 'x', 2: 'x' } }] } },
  },
  'https://api.frankerfacez.com/v1/room/id/123': {
    room: { set: 77 },
    sets: {
      77: { emoticons: [{ id: 720810, name: 'Dance', urls: { 1: 'x', 2: 'x' }, animated: { 1: 'x', 2: 'x' } }] },
    },
  },
};

function withEmotes(net) {
  const words = net.handle;
  window.__net = async (address, options) => {
    const reply = EMOTE_REPLIES[address];
    if (reply) return { ok: true, status: 200, json: async () => reply };
    return new URL(address).host.startsWith('api.contextno') ? words(address, options) : { ok: false, status: 404 };
  };
}

test('шкала: цвет зависит от числа, полоса убывает ровно, единица — победа', () => {
  eq([1, 2, 150, 151, 550, 551, 1400, 1401, 20000].map(tone),
    ['won', 'near', 'near', 'mid', 'mid', 'far', 'far', 'away', 'away']);
  eq([1, 280, 1400, 2800, 20000].map(barWidth), [100, 90, 50, 0, 0]);
  const widths = [1, 3, 10, 40, 150, 550, 1400, 2700].map(barWidth);
  ok(widths.every((width, i) => !i || width < widths[i - 1]), widths.join(' '));
});

test('экран: сколько строк помещается, размер слова на плашке, как прячется грубое слово', () => {
  eq([552, 550, 549, 414, 32, 10].map(rowsThatFit), [15, 15, 14, 11, 1, 1]);
  eq([answerSize(4, 400), answerSize(6, 400), answerSize(20, 390), answerSize(40, 100), answerSize(0, 400)],
    [44, 44, 22, 18, 44]);
  eq([masked('грубость'), masked('ой'), masked('я')], ['г•••••••', 'о•', 'я']);
});

test('звуки: каждый не пуст, не перегружен и не тянется', async () => {
  eq(SOUNDS.slice().sort(), ['best', 'end', 'hint', 'start', 'tick', 'win']);
  for (const name of SOUNDS) {
    const loud = await measure(name, 100), quiet = await measure(name, 30);
    ok(loud.peak > 0.08 && loud.peak < 0.98, name + ': пик ' + loud.peak.toFixed(3));
    ok(loud.seconds > 0.05 && loud.seconds < 3.6, name + ': длится ' + loud.seconds.toFixed(2) + ' с');
    ok(quiet.peak < loud.peak * 0.7, name + ': громкость не слушается настройки');
  }
  ok((await measure('best', 0)).peak < 0.001);
});

test('оверлей: открылся — отсчёт десять секунд, потом раунд', async () => {
  const net = fresh();
  const frame = await overlay();
  const w = frame.contentWindow, game = w.slovotron.game;
  eq(game.state, 'countdown');
  ok(Math.abs(game.startsAt - game.clock() - 10) < 1.5);
  await until(() => !element(w, 'stage').hidden && !element(w, 'lobby').hidden, 'отсчёт на экране');
  ok(['10', '9'].includes(element(w, 'countdown-number').textContent));
  ok(element(w, 'play').hidden && element(w, 'waiting').hidden);
  const title = w.document.querySelector('#lobby .title');
  eq([title.textContent, w.getComputedStyle(title).backgroundColor, all(w, '.tile').length],
    ['Словотрон', 'rgb(22, 163, 74)', 0]);
  ok(title.getBoundingClientRect().width > 400 && title.getBoundingClientRect().width < 700);
  eq(w.slovotron.chat.status.state, 'off');
  await begin(w, game);
  eq(net.calls, ['api.contextno.com/random-challenge', 'api.contextno.com/score банан']);
  eq([game.state, element(w, 'round').textContent, element(w, 'count').textContent], ['playing', '1', '0']);
  eq([all(w, '#best .row').length, all(w, '.row.empty').length], [1, 1]);
  ok(element(w, 'plaque').hidden && element(w, 'play').classList.contains('enter'));
  ok(/^подсказка через (3:00|2:5\d)$/.test(element(w, 'label').textContent), element(w, 'label').textContent);
  eq(w.getComputedStyle(w.document.querySelector('.brand')).color, 'rgb(22, 163, 74)');
  eq(w.slovotron.view.heard, ['start']);
  frame.remove();
});

test('оверлей: сервер слов недоступен — заставка ждёт и говорит об этом, появился — раунд', async () => {
  const net = fresh();
  net.down = true;
  const frame = await overlay();
  const w = frame.contentWindow, game = w.slovotron.game;
  await until(() => game.trouble, 'сбой замечен');
  game.startsAt = game.clock();
  game._bump();
  await until(() => !element(w, 'waiting').hidden, 'заставка ждёт');
  ok(element(w, 'countdown').hidden && element(w, 'waiting').textContent.includes('Нет связи'));
  eq(game.state, 'countdown');
  net.down = false;
  await until(() => game.state === 'playing' && !element(w, 'play').hidden, 'раунд начался сам', 8000);
  frame.remove();
});

test('оверлей: слово из чата получает число и встаёт в столбик, ник — справа от плашки слова', async () => {
  fresh();
  const { frame, w, game, chat, view } = await playing();
  const style = (selector) => w.getComputedStyle(w.document.querySelector(selector));
  chat.onMessage('Вася', 'Поле', false, { msgId: 'm1', login: 'vasya', color: '#FF69B4' });
  chat.onMessage('Петя', 'всем привет', false, { msgId: 'm2', login: 'petya' });
  chat.onMessage('Оля', 'бежать', false, {});
  await until(() => rows(w, 'best').length === 1 && all(w, '#chat .mark').length === 1, 'слово и пометка в чате');
  chat.onMessage('Петя', 'молот!', false, { msgId: 'm3', login: 'petya' });
  await until(() => rows(w, 'best').length === 2, 'два слова по близости');
  chat.onMessage('Оля', 'поле', false, {});
  await until(() => all(w, '#chat .mark').length === 2, 'повтор помечен в чате');
  eq(rows(w, 'best'), [['молот', 'Петя', '2'], ['поле', 'Вася', '120']]);
  eq([all(w, '.column').length, all(w, '#last').length, w.document.querySelector('.column h3').textContent],
    [1, 0, 'Ближе всего']);
  eq(all(w, '#best .row').map((row) => row.className.replace(' pop', '')), ['row near', 'row near']);
  eq(all(w, '#best .row').map((row) => parseFloat(row.style.getPropertyValue('--w'))), [99.9, 95.7]);
  ok(style('#best .bar').backgroundImage.includes('rgb(22, 163, 74)'), style('#best .bar').backgroundImage);
  eq([style('#best .rank').color, style('#best .word').color, style('#best .word').textTransform],
    [WHITE, 'rgb(244, 240, 232)', 'uppercase']);
  eq(w.getComputedStyle(all(w, '#best .who b')[1]).color, 'rgb(255, 105, 180)');
  eq(style('#best .who').backgroundColor, 'rgba(0, 0, 0, 0)');
  await wait(500);
  const place = (selector) => w.document.querySelector(selector).getBoundingClientRect();
  const slab = place('#best .slab'), who = place('#best .who'), field = place('#main');
  eq([Math.round(slab.width), Math.round(who.width)], [344, 190]);
  ok(slab.left - field.left > 60 && Math.abs((slab.left - field.left) - (field.right - who.right)) <= 1,
    [field.left, slab.left, who.right, field.right].join(' '));
  ok(who.left >= slab.right && Math.abs(place('.column h3').left - slab.left) < 0.5);
  ok(who.top >= slab.top && who.bottom <= slab.bottom);
  ok(place('#best .rank').right <= slab.right && place('#best .word').left >= slab.left);
  eq(all(w, '#chat .msg').map((row) => row.innerText), ['Вася Поле 120', 'Петя всем привет',
    'Оля бежать нет в словаре', 'Петя молот! 2', 'Оля поле 120 уже было']);
  eq(style('#chat .rank').color, 'rgb(74, 222, 128)');
  eq(listed(w, 'list-round'), ['Участников3', 'Слов2', 'Повторов1', 'Подсказок0', 'Ближе всего2']);
  eq(element(w, 'count').textContent, '2');
  await until(() => view.heard.length === 3, 'звук каждого нового лучшего слова');
  eq(view.heard, ['start', 'best', 'best']);
  const kept = all(w, '#best .row')[1];
  chat.onMessage('Тим', 'кошка', false, {});
  await until(() => rows(w, 'best').length === 3, 'далёкое слово');
  ok(all(w, '#best .row')[1] === kept && all(w, '#best .row')[2].classList.contains('away'));
  eq(all(w, '#best .row')[2].style.getPropertyValue('--w'), '0%');
  await wait(300);
  eq(view.heard.length, 3);
  chat.onClear({ msgId: 'm1' });
  await until(() => rows(w, 'best')[1][0] === 'п•••', 'слово удалённого сообщения спрятано');
  no(element(w, 'chat').innerText.includes('Поле 120'));
  eq(game.snapshot().words, 3);
  frame.remove();
});

test('оверлей: много слов — столбик не переполняется, показаны ближайшие', async () => {
  const ranks = {};
  for (let i = 0; i < 30; i++) ranks['слово' + 'абвгдежзик'[i % 10] + 'абв'[Math.floor(i / 10)]] = 10 + i * 40;
  fresh({ ranks });
  const { frame, w, game } = await playing();
  for (const word of Object.keys(ranks)) game.feed('Зритель', word);
  await until(() => game.snapshot().words === 30, 'все слова проверены');
  await until(() => rows(w, 'best').length === 15, 'пятнадцать строк');
  eq([rows(w, 'best')[0][2], rows(w, 'best')[14][2]], ['10', '570']);
  await wait(600);
  const list = element(w, 'best'), lowest = list.lastElementChild.getBoundingClientRect();
  ok(lowest.bottom <= list.getBoundingClientRect().bottom + 0.5);
  ok(element(w, 'main').scrollHeight <= element(w, 'main').clientHeight);
  frame.remove();
});

test('оверлей: победа — длинная фиолетовая плашка со словом и победителем, таблица, конфетти', async () => {
  fresh();
  const { frame, w, game, chat, view } = await playing('pause=30');
  const style = (node, pseudo) => w.getComputedStyle(node, pseudo);
  chat.onMessage('Вася', 'молот', false, {});
  chat.onMessage('Лиса Алиса', 'Серп', false, { color: '#FF69B4' });
  await until(() => element(w, 'card').classList.contains('victory'), 'итоги раунда');
  const plaque = element(w, 'plaque'), answer = element(w, 'answer');
  eq([plaque.hidden, plaque.classList.contains('won'), answer.textContent, style(answer).textTransform,
    style(answer).fontSize, all(w, '.tile').length], [false, true, 'серп', 'uppercase', '44px', 0]);
  ok(style(plaque).backgroundImage.includes('rgb(147, 51, 234)'), style(plaque).backgroundImage);
  eq([plaque.offsetWidth, plaque.offsetHeight], [720, 80]);
  eq([element(w, 'status').textContent, element(w, 'verdict').textContent, element(w, 'winner').textContent],
    ['Слово угадано!', 'Победитель', 'Лиса Алиса']);
  eq(style(w.document.querySelector('#winner .chip b')).color, 'rgb(255, 105, 180)');
  no(style(w.document.querySelector('#winner .chip')).backgroundColor === 'rgba(0, 0, 0, 0)');
  eq(rows(w, 'best')[0], ['серп', 'Лиса Алиса', '1']);
  const won = all(w, '.row.won');
  eq([won.length, won[0].style.getPropertyValue('--w'), style(won[0].querySelector('.rank')).color],
    [1, '100%', WHITE]);
  ok(style(won[0].querySelector('.bar')).backgroundImage.includes('rgb(147, 51, 234)'));
  const glow = style(won[0].querySelector('.slab')).boxShadow;
  ok(glow.includes('147, 51, 234'), glow);
  eq([style(element(w, 'best')).overflow, style(w.document.querySelector('.column')).overflow],
    ['visible', 'visible']);
  eq(style(w.document.querySelector('#chat .rank.won')).color, 'rgb(192, 132, 252)');
  eq(listed(w, 'list-total'), ['1Лиса Алиса1']);
  ok(element(w, 'label').textContent.startsWith('следующее слово через 0:'));
  ok(view.confetti.running && view.confetti.pieces.length > 50);
  await until(() => view.heard.includes('win'), 'звук победы');
  await wait(600);
  ok(answer.getBoundingClientRect().right <= element(w, 'winner').getBoundingClientRect().left);
  ok(rows(w, 'best').length === 2 && element(w, 'main').scrollHeight <= element(w, 'main').clientHeight);
  ok(element(w, 'best').getBoundingClientRect().bottom <= element(w, 'main').getBoundingClientRect().bottom + 0.5);
  chat.onMessage('Вася', 'поле', false, {});
  await wait(200);
  eq(rows(w, 'best').length, 2);
  await until(() => game._next, 'следующее слово загадано');
  game.tick(game.results.next_at);
  await until(() => !element(w, 'card').classList.contains('results') && element(w, 'round').textContent === '2',
    'второй раунд');
  ok(plaque.hidden && !view.confetti.running);
  eq([rows(w, 'best'), listed(w, 'list-total')], [[], ['1Лиса Алиса1']]);
  frame.remove();
});

test('оверлей: длинное слово и длинный ник помещаются на плашке', async () => {
  fresh({ secret: 'самоедлинноесловотут' });
  const { frame, w, chat } = await playing();
  chat.onMessage('Очень_Длинный_Ник_Зрителя', 'самоедлинноесловотут', false, {});
  await until(() => !element(w, 'plaque').hidden, 'плашка победы');
  await wait(600);
  const plaque = element(w, 'plaque').getBoundingClientRect(), answer = element(w, 'answer');
  const size = parseFloat(w.getComputedStyle(answer).fontSize);
  ok(size >= 18 && size < 30, size);
  ok(answer.scrollWidth <= answer.clientWidth + 1, [answer.scrollWidth, answer.clientWidth].join(' '));
  const chip = w.document.querySelector('#winner .chip').getBoundingClientRect();
  ok(chip.width > 100 && chip.right <= plaque.right && answer.getBoundingClientRect().right <= chip.left);
  frame.remove();
});

test('оверлей: «новое слово» открывает загаданное на обычной плашке, победителя нет', async () => {
  fresh();
  const { frame, w, game, chat, view } = await playing();
  chat.onMessage('Вася', '!словотрон-раунд', false, {});
  eq(game.state, 'playing');
  chat.onMessage('Модер', '!словотрон-раунд', true, {});
  await until(() => element(w, 'answer').textContent === 'серп', 'слово открыто');
  eq([element(w, 'status').textContent, element(w, 'verdict').textContent, element(w, 'winner').textContent],
    ['Раунд окончен', 'Никто не угадал', '']);
  no(view.confetti.running || element(w, 'card').classList.contains('victory') ||
    element(w, 'plaque').classList.contains('won'));
  eq(w.getComputedStyle(element(w, 'plaque')).backgroundImage, 'none');
  await until(() => view.heard.includes('end'), 'звук конца раунда');
  eq(listed(w, 'list-total'), ['пока никто']);
  frame.remove();
});

test('оверлей: подсказка приходит сама по таймеру, команды у зрителей нет', async () => {
  fresh();
  const { frame, w, game, chat, view } = await playing('hint_every=30');
  chat.onMessage('Вася', 'колос', false, {});
  await until(() => rows(w, 'best').length === 1, 'слово на экране');
  ok(/^подсказка через 0:(30|2\d)$/.test(element(w, 'label').textContent), element(w, 'label').textContent);
  ok(Number(element(w, 'fill').style.getPropertyValue('--p')) > 0.9);
  eq(all(w, '#command').length, 0);
  chat.onMessage('Вася', '!подсказка', false, {});
  await wait(200);
  eq([game.snapshot().hints, rows(w, 'best').length], [0, 1]);
  game.round.hintAt = game.clock() + 9;
  game._bump();
  await until(() => element(w, 'label').textContent === 'подсказка через 0:09', 'отсчёт до подсказки');
  ok(Number(element(w, 'fill').style.getPropertyValue('--p')) < 0.35);
  game.round.hintAt = game.clock() - 1;
  await until(() => rows(w, 'best').length === 2, 'подсказка пришла сама');
  eq(rows(w, 'best')[0], ['холм', 'подсказка', '150']);
  ok(all(w, '#best .row')[0].classList.contains('hint') && w.document.querySelector('#best .who.note'));
  eq(listed(w, 'list-round').slice(3), ['Подсказок1', 'Ближе всего150']);
  await until(() => view.heard.includes('hint'), 'звук подсказки');
  ok(/^подсказка через 0:(30|2\d)$/.test(element(w, 'label').textContent), element(w, 'label').textContent);
  ok(element(w, 'rules').textContent.includes('Подсказка — раз в 30 с'));
  frame.remove();
});

test('оверлей: подсказки выключены — полосы и правила про них нет', async () => {
  fresh();
  const { frame, w } = await playing('hint_every=0');
  eq(w.getComputedStyle(element(w, 'timeline')).visibility, 'hidden');
  eq(listed(w, 'rules').length, 4);
  no(element(w, 'rules').textContent.includes('Подсказка'));
  frame.remove();
});

test('оверлей: на паузе вместо игры — раунд слева и победители справа', async () => {
  fresh();
  const { frame, w, game, chat } = await playing();
  game.scores.add('Оля', 3);
  chat.onMessage('Вася', 'молот', false, {});
  await until(() => rows(w, 'best').length === 1, 'слово на экране');
  ok(element(w, 'pause').hidden);
  const field = box(element(w, 'main')), card = box(element(w, 'card'));
  game.pause();
  await until(() => !element(w, 'pause').hidden, 'экран паузы');
  eq([element(w, 'head').hidden, element(w, 'play').hidden, element(w, 'lobby').hidden], [true, true, true]);
  eq(w.document.querySelector('#pause h2').textContent, 'Пауза');
  eq(listed(w, 'pause-round'), ['Участников1', 'Слов1', 'Повторов0', 'Подсказок0', 'Ближе всего2']);
  eq(listed(w, 'pause-total'), ['1Оля3']);
  const main = box(element(w, 'main')), left = box(element(w, 'board-round')), right = box(element(w, 'board-total'));
  ok(main[0] <= left[0] && left[1] < right[0] && right[1] <= main[1], [main, left, right].join(' | '));
  eq([w.getComputedStyle(element(w, 'side')).display, main[1] > field[1], box(element(w, 'card'))],
    ['none', true, card]);
  chat.onMessage('Петя', 'поле', false, {});
  await until(() => element(w, 'chat').innerText.includes('Петя'), 'сообщение в чате');
  eq(game.snapshot().words, 1);
  game.resume();
  await until(() => element(w, 'pause').hidden && !element(w, 'play').hidden, 'игра вернулась');
  eq([rows(w, 'best'), element(w, 'head').hidden], [[['молот', 'Вася', '2']], false]);
  eq([w.getComputedStyle(element(w, 'side')).display, box(element(w, 'main'))], ['flex', field]);
  await wait(300);
  eq(w.slovotron.view.heard.filter((name) => name === 'start').length, 1);
  frame.remove();
});

test('оверлей: плашка победителей — ровно под десять строк и «и ещё…», на паузе список всех листается', async () => {
  fresh();
  let round = await playing();
  const sized = (w) => {
    const plate = element(w, 'box-total').getBoundingClientRect();
    const lowest = element(w, 'list-total').lastElementChild.getBoundingClientRect();
    return [Math.round(plate.height), Math.round(plate.bottom - lowest.bottom)];
  };
  eq([listed(round.w, 'list-total'), sized(round.w)[0]], [['пока никто'], 306]);
  for (let i = 0; i < 10; i++) round.game.scores.add('зритель' + i, 40 - i);
  round.game._bump();
  await until(() => all(round.w, '#list-total li').length === 10, 'десять строк');
  eq(sized(round.w), [306, 34]);
  for (let i = 10; i < 40; i++) round.game.scores.add('зритель' + i, 40 - i);
  round.frame.remove();
  round = await playing();
  const { w, game } = round;
  await until(() => all(w, '#list-total li').length === 11, 'десять строк и приписка');
  const side = element(w, 'side');
  eq([listed(w, 'list-total')[0], listed(w, 'list-total')[9], listed(w, 'list-total')[10]],
    ['1зритель040', '10зритель931', 'и ещё 30 игроков']);
  eq(sized(w), [306, 10]);
  ok(side.scrollHeight <= side.clientHeight);
  ok(element(w, 'box-total').scrollHeight <= element(w, 'box-total').clientHeight);
  ok(element(w, 'rules').getBoundingClientRect().top > element(w, 'list-round').getBoundingClientRect().bottom);
  ok(element(w, 'box-rules').getBoundingClientRect().bottom <= side.getBoundingClientRect().bottom + 0.5);
  eq(listed(w, 'rules').length, 5);
  ok(all(w, '#rules li').every((rule) => rule.getBoundingClientRect().height < 20));
  game.pause();
  await until(() => all(w, '#pause-total li').length === 40, 'все победители на паузе');
  const list = element(w, 'pause-total'), board = element(w, 'board-total').getBoundingClientRect();
  eq([listed(w, 'pause-total')[0], listed(w, 'pause-total')[39], w.getComputedStyle(list).overflowY],
    ['1зритель040', '40зритель391', 'auto']);
  ok(list.scrollHeight > list.clientHeight + 400 && list.getBoundingClientRect().bottom <= board.bottom);
  const lowest = list.lastElementChild;
  ok(lowest.getBoundingClientRect().top > board.bottom);
  list.scrollTop = list.scrollHeight;
  ok(list.scrollTop > 400 && lowest.getBoundingClientRect().bottom <= board.bottom + 0.5);
  game.resume();
  await until(() => element(w, 'pause').hidden && all(w, '#list-total li').length === 11, 'снова десятка');
  round.frame.remove();
  fresh();
});

test('оверлей: у победителя последнего раунда золотая корона перед ником — пока не победит другой', async () => {
  fresh();
  const { frame, w, game, chat } = await playing();
  const crowned = (selector) => all(w, selector + ' .crown').map((crown) => crown.nextElementSibling.textContent);
  chat.onMessage('Вася', 'поле', false, {});
  chat.onMessage('Петя', 'молот', false, {});
  await until(() => rows(w, 'best').length === 2, 'два слова');
  eq(all(w, '.crown').length, 0);
  chat.onMessage('Петя', 'серп', false, {});
  await until(() => element(w, 'card').classList.contains('victory'), 'Петя победил');
  await until(() => crowned('#chat').length === 2, 'короны в чате');
  eq([crowned('#chat'), crowned('#best'), crowned('#list-total'), crowned('#winner')],
    [['Петя', 'Петя'], ['Петя', 'Петя'], ['Петя'], ['Петя']]);
  const crown = w.document.querySelector('#best .crown'), nick = crown.nextElementSibling;
  ok(w.getComputedStyle(crown).backgroundImage.includes('ffc928'), w.getComputedStyle(crown).backgroundImage);
  const tip = crown.getBoundingClientRect();
  ok(tip.width > 12 && tip.right <= nick.getBoundingClientRect().left, [tip.width, tip.right].join(' '));
  const inChat = w.document.querySelector('#chat .crown');
  ok(inChat.nextElementSibling.getBoundingClientRect().left - inChat.getBoundingClientRect().right >= 3);
  await until(() => game._next, 'следующее слово загадано');
  game.tick(game.results.next_at);
  await until(() => element(w, 'round').textContent === '2', 'второй раунд');
  chat.onMessage('Петя', 'поле', false, {});
  chat.onMessage('Вася', 'молот', false, {});
  await until(() => rows(w, 'best').length === 2, 'слова второго раунда');
  eq([crowned('#best'), crowned('#list-total')], [['Петя'], ['Петя']]);
  game.pause();
  await until(() => !element(w, 'pause').hidden, 'пауза');
  eq(crowned('#pause-total'), ['Петя']);
  game.resume();
  chat.onMessage('Вася', 'серп', false, {});
  await until(() => crowned('#winner')[0] === 'Вася', 'теперь корона у Васи');
  eq([crowned('#best'), crowned('#list-total'), new Set(crowned('#chat')).size], [['Вася', 'Вася'], ['Вася'], 1]);
  frame.remove();
  fresh();
});

test('оверлей: пауза во время отсчёта в минималистичном оверлее — рамка на месте, потом отсчёт продолжается', async () => {
  fresh();
  const frame = await overlay('mini=1');
  const w = frame.contentWindow, game = w.slovotron.game;
  await until(() => !element(w, 'lobby').hidden, 'отсчёт на экране');
  const field = box(element(w, 'main')), card = box(element(w, 'card'));
  game.pause();
  await until(() => !element(w, 'pause').hidden && element(w, 'lobby').hidden, 'экран паузы');
  eq([listed(w, 'pause-round'), listed(w, 'pause-total')], [['раунд ещё не начался'], ['пока никто не победил']]);
  eq([box(element(w, 'main')), box(element(w, 'card'))], [field, card]);
  game.resume();
  await until(() => element(w, 'pause').hidden && !element(w, 'lobby').hidden, 'снова отсчёт');
  ok(Number(element(w, 'countdown-number').textContent) >= 8);
  frame.remove();
});

test('оверлей: источник скрыли — игра на паузе, показали — тот же раунд продолжается', async () => {
  fresh();
  const { frame, w, game, chat } = await playing();
  chat.onMessage('Вася', 'молот', false, {});
  await until(() => rows(w, 'best').length === 1, 'слово на экране');
  showSource(w, false);
  eq(game.state, 'paused');
  chat.onMessage('Петя', 'поле', false, {});
  showSource(w, false);
  await wait(200);
  showSource(w, true);
  eq([game.state, game.snapshot().round], ['playing', 1]);
  await until(() => !element(w, 'play').hidden && element(w, 'pause').hidden, 'раунд на экране');
  eq(rows(w, 'best'), [['молот', 'Вася', '2']]);
  showSource(w, true);
  eq(game.state, 'playing');
  chat.onMessage('Модер', '!словотрон-пауза', true, {});
  showSource(w, false);
  showSource(w, true);
  eq(game.state, 'paused');
  frame.remove();
});

test('оверлей: сайт обновился — страница перезагружается сама, но не посреди раунда', async () => {
  fresh();
  const { frame, w, game } = await playing();
  const fetchFile = w.fetch.bind(w);
  w.fetch = (url, options) => (options && options.method === 'HEAD'
    ? Promise.resolve({ ok: true, headers: { get: () => 'новая версия' } })
    : fetchFile(url, options));
  w.loadedBefore = true;
  await wait(5500);
  ok(frame.contentWindow.loadedBefore);
  game.skip();
  await until(() => !frame.contentWindow.loadedBefore, 'страница перезагрузилась');
  frame.remove();
  fresh();
});

test('оверлей: окошко под вебку на общем месте, минималистичный оверлей — вертикальный и без фона', async () => {
  fresh();
  const full = await playing();
  eq([box(element(full.w, 'card')), box(element(full.w, 'main'))], [[6, 1274], [318, 1038]]);
  eq(camAt(full.w), [18, 494, 280, 210], 'окошко под вебку — там же, где в других играх');
  full.frame.remove();
  const vtuber = await playing('webcam=vtuber');
  ok(vtuber.w.document.body.classList.contains('vtuber'));
  eq(camAt(vtuber.w), [18, 344, 280, 360], 'окошко витубера — там же, где в других играх');
  eq(box(element(vtuber.w, 'main'))[1], 1038, 'правый край поля на месте');
  ok(vtuber.w.getComputedStyle(element(vtuber.w, 'stage'), '::before').clipPath.includes('344px'));
  vtuber.frame.remove();
  const back = await playing();
  const backdrop = back.w.getComputedStyle(element(back.w, 'stage'), '::before');
  ok(backdrop.display !== 'none' && backdrop.boxShadow.includes('1400px'), 'место за рамкой залито, окошко пустое');
  eq(back.w.document.documentElement.style.getPropertyValue('--accent'), '#16a34a');
  back.frame.remove();
  const mini = await playing('mini=1&accent=3fa7ff');
  ok(mini.w.document.body.classList.contains('mini'));
  const stage = box(element(mini.w, 'stage')), field = box(element(mini.w, 'main'));
  eq([stage[1] - stage[0], field[0] - stage[0], stage[1] - field[1]], [640, 16, 16], 'вертикальная сцена 640×720');
  eq(mini.w.getComputedStyle(element(mini.w, 'stage'), '::before').display, 'none');
  for (const node of [mini.w.document.querySelector('.chatbox'), element(mini.w, 'side'), mini.w.document.querySelector('.cam'),
    element(mini.w, 'round').parentNode, element(mini.w, 'label')]) {
    eq(mini.w.getComputedStyle(node).display, 'none');
  }
  eq(mini.w.getComputedStyle(element(mini.w, 'card')).backgroundImage, 'none');
  ok(mini.w.document.querySelector('.head .logo').naturalWidth > 0, 'логотип сайта рядом с названием');
  eq(mini.w.document.documentElement.style.getPropertyValue('--accent'), '#3fa7ff');
  await wait(900);
  const column = box(mini.w.document.querySelector('.column')), brand = box(mini.w.document.querySelector('.head .brand'));
  const hint = box(element(mini.w, 'timeline'));
  ok([column[0] - field[0], column[1] - brand[1], hint[1] - brand[1]].every((gap) => Math.abs(gap) <= 3),
    'полоска и плашки — до конца названия: ' + [column, hint, brand, field]);
  mini.w.slovotron.chat.onMessage('Петя', 'молот', false, {});
  await until(() => all(mini.w, '#best .who').length, 'слово в списке');
  ok(all(mini.w, '#best .who').every((who) => mini.w.getComputedStyle(who).display === 'none'), 'ников нет');
  mini.frame.remove();
  const nocam = await playing('webcam=0');
  eq(nocam.w.getComputedStyle(nocam.w.document.querySelector('.cam')).display, 'none');
  nocam.frame.remove();
});

test('оверлей: грубое слово на экране спрятано, число видно', async () => {
  fresh({ ranks: { негр: 50 } });
  const { frame, w, game, chat } = await playing();
  await until(() => game.banned.size > 50, 'список загружен');
  chat.onMessage('Вася', 'негр', false, {});
  await until(() => rows(w, 'best').length === 1, 'слово проверено');
  eq(rows(w, 'best'), [['н•••', 'Вася', '50']]);
  frame.remove();
});

test('оверлей: без звука — тишина', async () => {
  fresh();
  const { frame, w, chat, view } = await playing('sound=0');
  chat.onMessage('Вася', 'серп', false, {});
  await until(() => element(w, 'card').classList.contains('results'), 'итоги раунда');
  eq(view.heard, []);
  frame.remove();
});

test('оверлей: в чате — особые ники и смайлики; число дописывается в ту же строку', async () => {
  const net = fresh();
  const { frame, w, game, chat } = await playing();
  noImages(w);
  withEmotes(net);
  const lines = () => all(w, '#chat .msg');
  const images = (row) => Array.from(row.querySelectorAll('img'), (image) => image.getAttribute('data-src'));
  const style = (node, pseudo) => w.getComputedStyle(node, pseudo);
  const replies = window.__net;
  let release = null;
  const gate = new Promise((resolve) => { release = resolve; });
  window.__net = async (address, options) => {
    if (address.includes('/score')) await gate;
    return replies(address, options);
  };
  chat.onMessage('Sumaizu', 'молот', false, { login: 'sumaizu' });
  chat.onMessage('WELOVEGAMES', 'привет всем', false, { login: 'welovegames' });
  chat.onMessage('Оля', 'Kappa ну и слово constructor', false, { emotes: { Kappa: '25' } });
  await until(() => lines().length === 3, 'три сообщения');
  const second = lines()[1];
  eq([lines()[0].innerText, lines()[0].className], ['Sumaizu молот', 'msg star star-rainbow pop']);
  release();
  await until(() => lines()[0].innerText === 'Sumaizu молот 2', 'число дописано');
  eq([lines().length, lines()[0].className, lines()[1] === second], [3, 'msg hit star star-rainbow', true]);
  ok(lines()[0].querySelector('b').classList.contains('rainbow') && lines()[0].querySelector('.rank.near'));
  eq(style(lines()[0], '::before').animationName, 'rainbow');
  eq([style(second).borderTopColor, style(second, '::after').animationName], ['rgb(212, 36, 38)', 'heart']);
  ok(w.document.querySelector('#best .who b.rainbow'));
  eq(images(lines()[2]), ['https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/2.0']);
  chat.status.roomId = '123';
  game._bump();
  await until(() => w.slovotron.view.emotes.size === 6, 'смайлики каналов загружены');
  chat.onMessage('Оля', 'catJAM Channel7 :tf: Shared LilZ Dance плохой', false, {});
  await until(() => lines().length === 4 && lines()[3].querySelectorAll('img').length === 6, 'смайлики в чате');
  ok(lines()[3].innerText.includes('плохой'));
  chat.onMessage('Sumaizu', 'серп', false, { login: 'sumaizu' });
  await until(() => element(w, 'winner').textContent === 'Sumaizu', 'победитель');
  ok(w.document.querySelector('#winner b.rainbow') && w.document.querySelector('#list-total .name.rainbow'));
  frame.remove();
});

test('оверлей: снежный ник — голубая рамка, по нику бежит блик, в лад у всех сообщений', async () => {
  fresh();
  const { frame, w, chat } = await playing();
  const style = (node, pseudo) => w.getComputedStyle(node, pseudo);
  const lines = () => all(w, '#chat .msg');
  chat.onMessage('higashi_vo', 'привет всем', false, { login: 'higashi_vo' });
  await wait(700);
  chat.onMessage('higashi_vo', 'я тут', false, { login: 'higashi_vo' });
  await until(() => lines().length === 2, 'два сообщения');
  eq(lines()[0].className.split(' ').slice(0, 3), ['msg', 'star', 'star-snow']);
  eq(style(lines()[0]).borderTopColor, 'rgb(166, 214, 255)');
  eq(style(lines()[0].querySelector('b')).animationName, 'snow-glint');
  ok(lines()[0].querySelector('b').classList.contains('snow'));
  eq(style(lines()[0], '::after').content, 'none');
  await until(() => {
    const phases = w.document.getAnimations().filter((item) => item.animationName === 'snow-glint')
      .map((item) => item.effect.getComputedTiming().progress);
    return phases.length === 2 && !phases.includes(null) && Math.abs(phases[0] - phases[1]) < 0.02;
  }, 'блик идёт в лад');
  frame.remove();
});

test('оверлей: радуга автора идёт в лад везде, где есть его ник, — при любой длине слова', async () => {
  fresh();
  const { frame, w, chat } = await playing();
  const author = { login: 'sumaizu' };
  chat.onMessage('Sumaizu', 'дом', false, author);
  await wait(400);
  chat.onMessage('Sumaizu', 'трактор', false, author);
  chat.onMessage('Петя', 'поле', false, {});
  await wait(350);
  chat.onMessage('Sumaizu', 'железо', false, author);
  await until(() => all(w, '#best .who b.rainbow').length === 3, 'три ника автора в столбике');
  await wait(500);
  const nicks = all(w, '#best .who b.rainbow, #chat .msg b.rainbow');
  eq(nicks.length, 6);
  for (const nick of nicks) {
    const letters = w.document.createRange();
    letters.selectNodeContents(nick);
    ok(Math.abs(letters.getBoundingClientRect().left - nick.getBoundingClientRect().left) < 0.5);
    ok(Math.abs(letters.getBoundingClientRect().width - nick.getBoundingClientRect().width) < 0.5);
    eq(w.getComputedStyle(nick).animationName, 'rainbow');
  }
  await until(() => inStep(w, 'rainbow', 9), 'ники в столбике, ники и рамки в чате переливаются в лад');
  chat.onMessage('Sumaizu', 'серп', false, author);
  await until(() => w.document.querySelector('#winner b.rainbow'), 'автор победил');
  ok(w.document.querySelector('#winner .crown') && w.document.querySelector('#best .who .crown'));
  await until(() => inStep(w, 'rainbow', 14), 'плашка победы и таблица победителей — тоже в лад, и с короной');
  eq(w.getComputedStyle(w.document.querySelector('#winner b.rainbow')).webkitTextFillColor, 'rgba(0, 0, 0, 0)');
  frame.remove();
  fresh();
});

test('оверлей: отсчёт не откатывается назад, когда догрузились смайлики', async () => {
  const net = fresh();
  const frame = await overlay();
  const w = frame.contentWindow, { game, chat, view } = w.slovotron;
  noImages(w);
  let release = null;
  const gate = new Promise((resolve) => { release = resolve; });
  withEmotes(net);
  const replies = window.__net;
  window.__net = async (address, options) => {
    if (EMOTE_REPLIES[address]) await gate;
    return replies(address, options);
  };
  const shown = () => Number(element(w, 'countdown-number').textContent);
  await until(() => !element(w, 'lobby').hidden && shown() > 0, 'отсчёт на экране');
  const first = shown();
  chat.onMessage('Оля', 'catJAM привет', false, {});
  chat.status.roomId = '123';
  game._bump();
  await until(() => shown() < first, 'отсчёт пошёл', 3000);
  const before = shown();
  release();
  await until(() => view.emotes.size, 'смайлики загружены');
  const after = [shown()];
  await wait(300);
  after.push(shown());
  ok(Math.max(...after) <= before, after.join(', ') + ' после ' + before);
  eq(all(w, '#chat .msg img').length, 1);
  frame.remove();
});

test('встроенный оверлей: пока игру не начали — неподвижный пример, сервер слов не тревожим', async () => {
  const net = fresh();
  const frame = await embedded();
  const w = frame.contentWindow, api = w.slovotron;
  eq([api.game.state, api.chat.status.state], ['stopped', 'off']);
  const chat = element(w, 'chat').innerText;
  ok(chat.includes('уже было') && chat.includes('нет в словаре') && !chat.includes('!подсказка'), chat);
  eq([rows(w, 'best').length, all(w, '#last').length], [15, 0]);
  eq([rows(w, 'best')[0], rows(w, 'best')[2]], [['пламя', 'Борщ', '3'], ['дрова', 'подсказка', '12']]);
  eq([listed(w, 'list-total').length, listed(w, 'list-total')[10], listed(w, 'list-round').includes('Участников10')],
    [11, 'и ещё 3 игрока', true]);
  eq([all(w, '#best .crown').length, all(w, '#list-total .crown').length, all(w, '#chat .crown').length], [2, 1, 2]);
  eq([element(w, 'label').textContent, element(w, 'clock').textContent], ['подсказка через 2:06', '5:12']);
  await wait(600);
  eq([element(w, 'clock').textContent, api.view.heard, net.calls], ['5:12', [], []]);
  api.apply({ mini: true, hint_every: 0, accent: '#3fa7ff' });
  ok(w.document.body.classList.contains('mini'));
  eq(w.getComputedStyle(element(w, 'timeline')).visibility, 'hidden');
  no(rows(w, 'best').some((row) => row[1] === 'подсказка'));
  eq(w.document.documentElement.style.getPropertyValue('--accent'), '#3fa7ff');
  showSource(w, true);
  eq([api.game.state, net.calls], ['stopped', []]);
  frame.remove();
});

test('встроенный оверлей: «начать» — настоящая игра, настройки меняются на ходу, «остановить» — пример', async () => {
  fresh();
  const frame = await embedded();
  const w = frame.contentWindow, api = w.slovotron;
  const sockets = fakeSockets(api.chat);
  api.apply({ channel: 'some_channel' });
  eq(sockets.length, 0);
  api.start();
  eq([api.game.state, sockets.length, sockets[0].closed], ['countdown', 1, false]);
  await until(() => !element(w, 'lobby').hidden, 'отсчёт на экране');
  ok(element(w, 'chat').innerText.includes('пока тихо'));
  await begin(w, api.game);
  api.chat.onMessage('Вася', 'кузница', false, {});
  await until(() => rows(w, 'best').length === 1, 'слово на экране');
  const shown = w.document.querySelector('#best .row');
  await until(() => api.view.heard.length === 2, 'звук лучшего слова');
  api.apply({ channel: 'some_channel', mini: true, hint_every: 300, pause: 45 });
  eq([api.game.state, api.game.s.hint_every, api.game.snapshot().round], ['playing', 300, 1]);
  await until(() => w.document.body.classList.contains('mini'), 'минималистичный оверлей на ходу');
  await until(() => element(w, 'label').textContent.startsWith('подсказка через 5:0'), 'новый срок подсказки');
  await wait(300);
  eq([rows(w, 'best').length, w.document.querySelector('#best .row') === shown, api.view.heard.length], [1, true, 2]);
  showSource(w, false);
  eq(api.game.state, 'playing');
  api.game.scores.add('Вася', 1);
  api.apply({ channel: 'other_channel' });
  eq([sockets.length, sockets[0].closed, api.chat.channel, api.game.snapshot().top], [2, true, 'other_channel', []]);
  api.stop();
  eq([api.game.state, api.chat.status.state, sockets[1].closed], ['stopped', 'off', true]);
  await until(() => element(w, 'chat').innerText.includes('уже было'), 'снова пример');
  api.start();
  eq([api.game.state, sockets.length], ['countdown', 3]);
  api.stop();
  frame.remove();
  fresh();
});

const gameOf = (w) => element(w, 'game').contentWindow;
const mainPage = (query = '') => open('index.html' + query,
  (w) => gameOf(w).slovotron && gameOf(w).slovotron.game && !element(w, 'play').disabled);
const link = (w) => element(w, 'link').value;
const query = (w) => (link(w).split('?')[1] || '');

function type(w, id, value) {
  const field = element(w, id);
  if (field.type === 'checkbox') field.checked = value;
  else field.value = value;
  field.dispatchEvent(new w.Event('input', { bubbles: true }));
  field.dispatchEvent(new w.Event('change', { bubbles: true }));
}

async function started(w) {
  const game = gameOf(w), api = game.slovotron;
  const sockets = fakeSockets(api.chat);
  element(w, 's-channel').value = 'some_one';
  element(w, 'play').click();
  await begin(game, api.game);
  return { game, api, sockets };
}

test('страница: при первом заходе — пример, рекомендуемые настройки и готовая ссылка для OBS', async () => {
  const net = fresh();
  const frame = await mainPage();
  const w = frame.contentWindow, game = gameOf(w);
  ok(link(w).endsWith('/site/overlay.html'), link(w));
  ok(element(w, 'link-status').textContent.includes('канал'));
  eq(element(w, 'status').textContent, '');
  ok(element(w, 'link-panel').hidden && element(w, 'settings').hidden);
  ok(element(w, 'example-note').textContent.includes('Пример') && !element(w, 'example-note').hidden);
  eq([game.slovotron.game.state, rows(game, 'best').length], ['stopped', 15]);
  eq(['play', 'pause', 'hint', 'skip', 'reset'].map((id) => [element(w, id).textContent, element(w, id).disabled]),
    [['Начать', false], ['Пауза', true], ['Подсказка', true], ['Новое слово', true], ['Сброс', true]]);
  const fields = ['pause', 'hint_every', 'volume', 'backend', 'difficulty', 'reset_mode', 'accent'];
  eq(fields.map((key) => element(w, 's-' + key).value), ['20', '180', '100', 'kontekstno', '', 'never', '#16a34a']);
  ok(element(w, 's-sound').checked && element(w, 's-chat_commands').checked);
  ok(element(w, 'difficulty-field').hidden && element(w, 'backend-hint').textContent.includes('контекстно.рф'));
  eq(w.document.querySelector('.author').textContent, 'Оригинальная идея FRA3A · Автор копии Sumaizu');
  const icon = decodeURIComponent(w.document.querySelector('link[rel="icon"]').getAttribute('href'));
  eq([icon.split('<rect').length - 1, icon.includes('<text')], [4, false]);
  eq(all(w, '.author a').map((node) => [node.textContent, node.getAttribute('href')]),
    [['FRA3A', 'https://fra3a.ru/'], ['Sumaizu', 'https://www.twitch.tv/sumaizu']]);
  const home = w.document.querySelector('.top .logo');
  eq([home.getAttribute('href'), home.target, home.querySelector('img').alt],
    ['https://gamesonstream.ru/', '', 'Games on Stream']);
  ok(home.querySelector('img').naturalWidth > 0, 'логотип загрузился');
  eq([w.getComputedStyle(element(w, 'play')).backgroundColor, w.getComputedStyle(element(w, 'play')).color],
    ['rgb(22, 163, 74)', WHITE]);
  eq(net.calls, []);
  frame.remove();
});

test('страница: логотип и кнопки — одной полосой по центру, внизу строка состояния и авторы, игра между ними', async () => {
  fresh();
  const frame = await mainPage();
  const w = frame.contentWindow;
  frame.style.width = '1900px';
  frame.style.height = '1000px';
  await until(() => w.innerWidth === 1900, 'окно стало шире');
  const place = (node) => node.getBoundingClientRect();
  const strip = w.document.querySelector('.top');
  const parts = [w.document.querySelector('.top .logo'), element(w, 's-channel'), element(w, 'play'),
    element(w, 'pause'), element(w, 'hint'), element(w, 'skip'), element(w, 'reset'), element(w, 'toggle-settings'),
    element(w, 'toggle-link')];
  const inLine = (width) => {
    const title = place(parts[0]);
    parts.forEach((node, i) => {
      ok(place(node).top < title.bottom && place(node).bottom > title.top, width + ': не в строке — ' + i);
      if (i) ok(place(node).left - place(parts[i - 1]).right < 30, width + ': разрыв перед ' + i);
    });
    const left = place(strip).left, right = w.innerWidth - place(strip).right;
    ok(Math.abs(left - right) <= 2, width + ': не по центру — ' + left + ' и ' + right);
  };
  inLine(1900);
  const screen = place(element(w, 'game'));
  ok(screen.top < place(parts[0]).bottom + 30 && screen.bottom > w.innerHeight - 60, [screen.top, screen.bottom]);
  const foot = place(w.document.querySelector('.foot')), author = place(w.document.querySelector('.foot .author'));
  ok(foot.top >= screen.bottom && foot.bottom <= w.innerHeight, [foot.top, foot.bottom]);
  ok(w.document.querySelector('.foot').contains(element(w, 'status')));
  ok(Math.abs(author.left + author.right - w.innerWidth) <= 4, 'подпись по центру: ' + [author.left, author.right]);
  ok(Math.abs(screen.width / screen.height - 16 / 9) < 0.02);
  eq([w.document.documentElement.scrollHeight, w.document.documentElement.scrollWidth], [w.innerHeight, w.innerWidth]);
  const before = place(element(w, 'play')).left;
  element(w, 'status').textContent = 'Подключаюсь к чату очень_длинное_название_канала…';
  eq(place(element(w, 'play')).left, before);
  for (const width of [1536, 1280]) {
    frame.style.width = width + 'px';
    await until(() => w.innerWidth === width, 'окно стало уже');
    eq(w.document.documentElement.scrollWidth, width);
    ok(Math.abs(place(strip).left - (width - place(strip).right)) <= 2);
    ok(place(element(w, 'game')).top >= place(strip).bottom);
  }
  frame.remove();
});

test('страница: ссылка для OBS выезжает по кнопке и не двигает игру', async () => {
  fresh();
  const frame = await mainPage();
  const w = frame.contentWindow;
  const place = (node) => node.getBoundingClientRect();
  const toggle = element(w, 'toggle-link'), panel = element(w, 'link-panel'), screen = element(w, 'game');
  const before = place(screen);
  ok(panel.hidden);
  toggle.click();
  no(panel.hidden);
  eq(toggle.getAttribute('aria-expanded'), 'true');
  ok(place(panel).top >= place(toggle).bottom && place(panel).bottom > before.top);
  ok(place(element(w, 'link')).width > 300 && place(element(w, 'copy')).width > 0);
  ok(panel.textContent.includes('1920×1080') && panel.textContent.includes('на паузе'));
  eq([place(screen).top, place(screen).width], [before.top, before.width]);
  w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape' }));
  ok(panel.hidden);
  toggle.click();
  element(w, 'link').click();
  no(panel.hidden);
  element(w, 'status').click();
  ok(panel.hidden);
  eq(toggle.getAttribute('aria-expanded'), 'false');
  frame.remove();
});

test('страница: кнопка «Настройки» открывает панель рядом с игрой', async () => {
  fresh();
  const frame = await mainPage();
  const w = frame.contentWindow;
  const place = (node) => node.getBoundingClientRect();
  const toggle = element(w, 'toggle-settings'), panel = element(w, 'settings'), screen = element(w, 'game');
  ok(panel.hidden);
  const wide = place(screen).width;
  toggle.click();
  no(panel.hidden);
  eq(toggle.getAttribute('aria-expanded'), 'true');
  ok(place(panel).left >= place(screen).right && place(screen).width < wide);
  ok(Math.abs(place(screen).width / place(screen).height - 16 / 9) < 0.02);
  ok(panel.scrollHeight > panel.clientHeight && place(panel).bottom <= w.innerHeight);
  eq(w.document.documentElement.scrollHeight, w.innerHeight);
  for (const id of ['s-backend', 's-hint_every', 's-accent', 's-mini', 'defaults']) {
    ok(place(element(w, id)).left >= place(panel).left && place(element(w, id)).right <= place(panel).right, id);
  }
  eq(all(w, '.check code').map((node) => node.textContent), ['!словотрон-раунд', '!словотрон-подсказка',
    '!словотрон-пауза', '!словотрон-сброс']);
  no(panel.textContent.includes('!подсказка') || panel.textContent.includes('голосован'));
  toggle.click();
  ok(panel.hidden);
  eq(Math.round(place(screen).width), Math.round(wide));
  frame.remove();
});

test('страница: «Начать» запускает игру в браузере, «Остановить» возвращает пример', async () => {
  fresh();
  const frame = await mainPage();
  const w = frame.contentWindow, game = gameOf(w), api = game.slovotron;
  const sockets = fakeSockets(api.chat);
  element(w, 'play').click();
  eq([api.game.state, sockets.length], ['stopped', 0]);
  ok(element(w, 'status').classList.contains('warn') && element(w, 'status').textContent.includes('канал'));
  eq(w.document.activeElement, element(w, 's-channel'));
  element(w, 's-channel').value = 'https://twitch.tv/Some_One';
  element(w, 'toggle-link').click();
  element(w, 'play').click();
  eq([element(w, 's-channel').value, query(w), api.game.state, sockets.length], ['some_one', 'channel=some_one',
    'countdown', 1]);
  eq(element(w, 'play').textContent, 'Остановить');
  ok(element(w, 'link-panel').hidden && element(w, 'example-note').hidden);
  await begin(game, api.game);
  await until(() => element(w, 'status').textContent === 'Подключаюсь к чату some_one…', 'состояние чата в шапке');
  ok(element(w, 'status').classList.contains('warn'));
  eq(rows(game, 'best'), []);
  api.chat.onMessage('Вася', 'молот', false, {});
  await until(() => rows(game, 'best').length === 1, 'слово на экране');
  element(w, 'play').click();
  eq([api.game.state, element(w, 'play').textContent, sockets[0].closed], ['stopped', 'Начать', true]);
  await until(() => element(game, 'chat').innerText.includes('уже было'), 'снова пример');
  eq(element(w, 'status').textContent, '');
  no(element(w, 'example-note').hidden);
  frame.remove();
  fresh();
});

test('страница: «Пауза», «Подсказка», «Новое слово» и «Сброс» управляют игрой', async () => {
  fresh();
  const frame = await mainPage();
  const w = frame.contentWindow;
  const { game, api } = await started(w);
  const pause = element(w, 'pause'), hint = element(w, 'hint'), skip = element(w, 'skip'), reset = element(w, 'reset');
  await until(() => !hint.disabled && !skip.disabled && !pause.disabled && !reset.disabled, 'кнопки ожили');
  api.chat.onMessage('Вася', 'колос', false, {});
  await until(() => rows(game, 'best').length === 1, 'слово на экране');
  hint.click();
  await until(() => rows(game, 'best').length === 2, 'подсказка открыта кнопкой');
  eq(rows(game, 'best')[0], ['холм', 'подсказка', '150']);
  for (let i = 0; i < 14; i++) api.game.scores.add('зритель' + i, 20 - i);
  pause.click();
  eq([api.game.state, pause.textContent, element(w, 'status').textContent], ['paused', 'Продолжить', 'Пауза']);
  await until(() => !element(game, 'pause').hidden && hint.disabled && skip.disabled, 'экран паузы в рамке');
  await until(() => all(game, '#pause-total li').length === 14, 'на паузе видны все победители');
  pause.click();
  eq([api.game.state, pause.textContent], ['playing', 'Пауза']);
  await until(() => element(game, 'pause').hidden && rows(game, 'best').length === 2 && !skip.disabled,
    'раунд вернулся');
  eq([listed(game, 'list-total').length, listed(game, 'list-total')[10]], [11, 'и ещё 4 игрока']);
  api.chat.onMessage('Петя', 'молот', false, {});
  await until(() => rows(game, 'best').length === 3 && hint.disabled, 'на числе 2 подсказок больше нет');
  skip.click();
  eq([skip.textContent, api.game.state, skip.classList.contains('armed'), hint.disabled],
    ['Точно?', 'playing', true, true]);
  await until(() => skip.textContent === 'Новое слово', 'без второго нажатия раунд идёт дальше', 8000);
  eq(api.game.state, 'playing');
  api.chat.onMessage('Вася', 'серп', false, {});
  await until(() => api.game.state === 'results', 'победа');
  reset.click();
  eq([reset.textContent, api.game.scores.size], ['Точно?', 15]);
  reset.click();
  eq([reset.textContent, api.game.scores.size], ['Сброс', 0]);
  await until(() => api.game._next && hint.disabled && !skip.disabled, 'следующее слово готово');
  skip.click();
  skip.click();
  eq([api.game.state, api.game.snapshot().round], ['playing', 2]);
  skip.click();
  skip.click();
  eq([api.game.state, skip.textContent], ['results', 'Новое слово']);
  api.game.feed('Модер', '!словотрон-пауза', { mod: true });
  await until(() => pause.textContent === 'Продолжить', 'кнопка следует за командой из чата');
  element(w, 'play').click();
  eq([api.game.state, pause.textContent, pause.disabled, hint.disabled, skip.disabled, reset.disabled],
    ['stopped', 'Пауза', true, true, true, true]);
  frame.remove();
  fresh();
});

test('страница: сервер слов недоступен — об этом сказано в шапке', async () => {
  const net = fresh();
  const frame = await mainPage();
  const w = frame.contentWindow, api = gameOf(w).slovotron;
  fakeSockets(api.chat);
  net.down = true;
  element(w, 's-channel').value = 'some_one';
  element(w, 'play').click();
  await until(() => element(w, 'status').textContent.startsWith('Нет связи с сервером слов'), 'сбой в шапке');
  ok(element(w, 'status').classList.contains('warn'));
  net.down = false;
  await until(() => !element(w, 'status').textContent.startsWith('Нет связи'), 'связь вернулась', 8000);
  element(w, 'play').click();
  frame.remove();
  fresh();
});

test('страница: настройки действуют сразу — и на игру, и на ссылку для OBS', async () => {
  const net = fresh();
  const frame = await mainPage();
  const w = frame.contentWindow;
  const { game, api } = await started(w);
  element(w, 'toggle-settings').click();
  type(w, 's-pause', '45');
  type(w, 's-hint_every', '5');
  eq([api.game.s.pause, api.game.s.hint_every, element(w, 's-hint_every').value, api.game.state], [45, 10, '10',
    'playing']);
  eq(query(w), 'channel=some_one&pause=45&hint_every=10');
  eq(JSON.parse(localStorage.getItem('slovotron.settings')).pause, 45);
  await until(() => /^подсказка через 0:(10|0\d)$/.test(element(game, 'label').textContent), 'новый срок подсказки');
  type(w, 's-hint_every', '0');
  await until(() => game.getComputedStyle(element(game, 'timeline')).visibility === 'hidden',
    'полоса подсказок скрыта');
  type(w, 's-mini', true);
  eq(all(w, '[data-webcam]').map((button) => button.textContent), ['Без вебки', 'С вебкой', 'Витубер']);
  w.document.querySelector('[data-webcam="none"]').click();
  ok(w.document.querySelector('[data-webcam="none"]').classList.contains('on'));
  await until(() => game.document.body.classList.contains('mini'), 'минималистичный оверлей на ходу');
  ok(element(w, 'webcam-field').hidden && element(w, 'game').parentNode.classList.contains('mini'));
  eq(query(w), 'channel=some_one&pause=45&hint_every=0&webcam=none&mini=1');
  type(w, 's-accent', '#3fa7ff');
  await until(() => game.document.documentElement.style.getPropertyValue('--accent') === '#3fa7ff', 'цвет на ходу');
  type(w, 's-backend', 'wordgun');
  no(element(w, 'difficulty-field').hidden);
  ok(element(w, 'backend-hint').textContent.includes('wordgun.ru'));
  await until(() => element(w, 's-difficulty').options.length === 4, 'сложности загружены');
  eq(Array.from(element(w, 's-difficulty').options, (option) => [option.value, option.textContent]),
    [['', 'любые слова'], ['medium', 'средняя'], ['hard', 'hard'], ['hell', 'hell']]);
  type(w, 's-difficulty', 'hard');
  ok(query(w).includes('backend=wordgun&difficulty=hard'));
  eq([api.game.s.backend, api.game.s.difficulty, api.game.snapshot().round, api.game.state], ['wordgun', 'hard', 1,
    'playing']);
  api.game.skip();
  await until(() => api.game._next, 'следующая игра загадана');
  ok(net.calls.includes('api.wordgun.ru/v2/create_game') && api.game._next.id.endsWith('-hard'), api.game._next.id);
  element(w, 'defaults').click();
  eq([query(w), element(w, 's-channel').value, element(w, 's-mini').checked, element(w, 's-backend').value,
    element(w, 's-accent').value, api.game.s.pause, api.game.s.hint_every],
  ['channel=some_one', 'some_one', false, 'kontekstno', '#16a34a', 20, 180]);
  ok(element(w, 'difficulty-field').hidden);
  element(w, 'play').click();
  frame.remove();
  fresh();
});

test('страница: настройки запоминаются между заходами, адрес страницы важнее запомненного', async () => {
  fresh();
  localStorage.setItem('slovotron.settings', JSON.stringify({ pause: 12, backend: 'wordgun', difficulty: 'hell',
    mini: true }));
  let frame = await mainPage();
  let w = frame.contentWindow;
  eq(query(w), 'backend=wordgun&difficulty=hell&pause=12&mini=1');
  eq([element(w, 's-pause').value, element(w, 's-backend').value, element(w, 's-mini').checked], ['12', 'wordgun',
    true]);
  await until(() => element(w, 's-difficulty').options.length === 4, 'сложности загружены');
  eq([element(w, 's-difficulty').value, query(w)], ['hell', 'backend=wordgun&difficulty=hell&pause=12&mini=1']);
  ok(gameOf(w).document.body.classList.contains('mini'));
  frame.remove();
  frame = await mainPage('?pause=45&hint_every=0');
  w = frame.contentWindow;
  eq(query(w), 'pause=45&hint_every=0');
  frame.remove();
  fresh();
});

test('страница: расписание очистки таблицы, звук и «Послушать»', async () => {
  fresh();
  const frame = await mainPage();
  const w = frame.contentWindow;
  ok(element(w, 'reset-hour-field').hidden && element(w, 'reset-hours-field').hidden);
  type(w, 's-reset_mode', 'week');
  no(element(w, 'reset-hour-field').hidden);
  ok(element(w, 'reset-hours-field').hidden);
  type(w, 's-reset_hour', '9');
  type(w, 's-sound', false);
  type(w, 's-volume', '35');
  eq(element(w, 'volume-text').textContent, '35%');
  eq(query(w), 'reset_mode=week&reset_hour=9&sound=0&volume=35');
  type(w, 's-reset_mode', 'timer');
  ok(element(w, 'reset-hour-field').hidden);
  no(element(w, 'reset-hours-field').hidden);
  let volume = null;
  gameOf(w).slovotron.playSounds = (value) => { volume = value; };
  element(w, 'listen').click();
  eq(volume, 35);
  frame.remove();
  fresh();
});
