import { BEST_SHOWN, BOTS, CHAT_KEEP, CHAT_SHOWN, CHAT_TEXT_MAX, COMMANDS, STARS, Scores, TOP_SHOWN, guessWord,
  nextReset } from '../../site/js/engine.js';
import { RANKS, fakeBackend, local, makeGame, memoryStorage, say, settle, startRound } from './fixtures.js';
import { eq, no, ok, test } from './harness.js';

const types = (events) => events.map((event) => event.type);
const last = (list) => list[list.length - 1];
const sorted = (list) => Array.from(list).sort();
const best = (game) => game.snapshot().best.map((row) => [row.word, row.rank]);
const table = (rows) => rows.map((row) => [row.name, row.score]);

async function nextRound(made) {
  made.clock.t = made.game.results.next_at;
  await settle();
  made.game.tick();
}

test('слово: что считается попыткой', () => {
  eq(['Кот', ' КОТ! ', 'лёд', 'кое-кто', '«серп»', 'привет)))', '-кот-'].map(guessWord),
    ['кот', 'кот', 'лед', 'кое-кто', 'серп', 'привет', 'кот']);
  eq(['', 'я', 'два слова', 'lul', 'кот2', 'ко.т', 'кот--кот', 'а'.repeat(21), '123', null].map(guessWord),
    ['', '', '', '', '', '', '', '', '', '']);
  eq(guessWord('а'.repeat(20)).length, 20);
});

test('запуск: отсчёт, слово загадывается заранее, потом раунд', async () => {
  const { game, clock, events, backend } = makeGame({ settings: { backend: 'wordgun', difficulty: 'hard' } });
  eq(game.state, 'stopped');
  ok(game.open());
  no(game.open());
  eq([game.state, game.startsAt, backend.created], ['countdown', 1010, [{ difficulty: 'hard' }]]);
  await settle();
  game.tick();
  eq([game.state, game.snapshot().best], ['countdown', undefined]);
  clock.t = 1010;
  game.tick();
  const state = game.snapshot();
  eq([state.state, state.round, state.started, state.best, state.words, state.guessers, state.closest, state.players],
    ['playing', 1, 1010, [], 0, 0, null, 0]);
  eq(types(events), ['countdown', 'round_start']);
});

test('запуск: слово не успело загадаться — раунд ждёт, сервер недоступен — попытки всё реже', async () => {
  const { game, clock, backend, timers } = makeGame();
  backend.down = true;
  game.open(0);
  await settle();
  game.tick();
  eq([game.state, game.trouble, game.snapshot().trouble, timers.length], ['countdown', true, true, 1]);
  const waits = [timers[0].at - clock.t];
  for (let attempt = 1; attempt < 6; attempt++) {
    last(timers).action();
    await settle();
    waits.push(last(timers).at - clock.t);
  }
  eq(waits, [2, 4, 8, 16, 30, 30]);
  backend.down = false;
  last(timers).action();
  await settle();
  eq([game.state, game.trouble], ['countdown', false]);
  game.tick();
  eq([game.state, backend.created.length], ['playing', 7]);
});

test('запуск: остановка стирает раунд и отменяет то, что было в пути', async () => {
  const { game, backend, timers } = makeGame();
  backend.down = true;
  game.open(0);
  await settle();
  game.stop();
  eq([game.state, game.trouble, timers[0].dropped], ['stopped', false, true]);
  backend.down = false;
  game.open(0);
  const release = backend.hold();
  await settle();
  game.tick();
  game.feed('Вася', 'молот');
  game.stop();
  release();
  await settle();
  eq([game.state, game.snapshot().best, game.snapshot().round], ['stopped', undefined, 1]);
  game.open(0);
  await settle();
  game.tick();
  eq([game.state, game.snapshot().round, best(game)], ['playing', 2, []]);
});

test('раунд: слово получает число, ближние — сверху', async () => {
  const { game, events } = await startRound();
  eq(await say(game, 'Вася', 'Поле'), null);
  await say(game, 'Петя', 'МОЛОТ!', { color: '#FF69B4', login: 'petya' });
  await say(game, 'Вася', 'кошка');
  const state = game.snapshot();
  eq(best(game), [['молот', 2], ['поле', 120], ['кошка', 4000]]);
  eq(state.best[0], { word: 'молот', rank: 2, user: 'Петя', color: '#ff69b4', star: '', crown: false, hint: false,
    rude: false });
  no('last' in state);
  eq([state.words, state.guessers, state.repeats, state.closest], [3, 2, 0, 2]);
  eq(state.feed.map((message) => [message.text, message.rank]), [['Поле', 120], ['МОЛОТ!', 2], ['кошка', 4000]]);
  eq(events.filter((event) => event.type === 'guess').map((event) => [event.word, event.rank, event.closest]),
    [['поле', 120, true], ['молот', 2, true], ['кошка', 4000, false]]);
});

test('раунд: Ё и Е — одна буква, на экране слово пишется через Е', async () => {
  const backend = fakeBackend({ ranks: { лед: 44 }, tips: [['Ёж', 9]] });
  const { game } = await startRound({ backend });
  await say(game, 'Вася', 'Лёд');
  eq((await say(game, 'Петя', 'лед')).type, 'repeat');
  game.hint();
  await settle();
  eq((await say(game, 'Вася', 'ёж')).type, 'repeat');
  eq([backend.asked, game.snapshot().best.map((row) => [row.word, row.rank])], [['лед'], [['еж', 9], ['лед', 44]]]);
});

test('раунд: повтор слова — «уже было», сервер второй раз не спрашиваем', async () => {
  const { game, backend } = await startRound();
  await say(game, 'Вася', 'молот');
  const event = game.feed('Петя', 'Молот');
  eq([event.type, event.rank], ['repeat', 2]);
  const release = backend.hold();
  game.feed('Оля', 'поле');
  game.feed('Петя', 'поле');
  game.feed('Вася', 'ПОЛЕ');
  release();
  await settle();
  const state = game.snapshot();
  eq(backend.asked, ['молот', 'поле']);
  eq(state.feed.map((message) => [message.user, message.rank, message.repeat]), [['Вася', 2, false],
    ['Петя', 2, true], ['Оля', 120, false], ['Петя', 120, true], ['Вася', 120, true]]);
  eq([state.words, state.repeats, state.guessers, state.best[1].user], [2, 3, 3, 'Оля']);
});

test('раунд: незнакомое слово запоминается, сбой связи — нет', async () => {
  const { game, backend } = await startRound();
  await say(game, 'Вася', 'бежать');
  eq((await say(game, 'Петя', 'бежать')).type, 'unknown');
  eq(backend.asked, ['бежать']);
  backend.down = true;
  await say(game, 'Вася', 'молот');
  backend.down = false;
  await say(game, 'Вася', 'молот');
  const state = game.snapshot();
  eq(state.feed.map((message) => [message.unknown, message.failed, message.rank]), [[true, false, 0],
    [true, false, 0], [false, true, 0], [false, false, 2]]);
  eq([state.words, state.guessers, best(game)], [1, 1, [['молот', 2]]]);
});

test('раунд: фразы, чужие буквы, боты и сообщения вне раунда попытками не считаются', async () => {
  const { game, backend } = makeGame();
  game.feed('Вася', 'молот');
  game.open(0);
  await settle();
  game.feed('Вася', 'молот');
  game.tick();
  for (const text of ['всем привет', 'lul', 'я', '100', 'молот?!', '   ']) await say(game, 'Вася', text);
  await say(game, 'Nightbot', 'поле');
  await say(game, 'Кто-то', 'поле', { login: BOTS[1] });
  eq(backend.asked, ['молот']);
  eq(game.snapshot().feed.map((message) => message.text), ['молот', 'молот', 'всем привет', 'lul', 'я', '100',
    'молот?!']);
});

test('раунд: сервер одновременно спрашиваем не больше четырёх раз, остальные слова ждут', async () => {
  const { game, backend } = await startRound();
  const release = backend.hold(), words = Object.keys(RANKS);
  words.forEach((word, i) => game.feed('Зритель' + i, word));
  await settle();
  eq([backend.asked.length, backend.flying], [4, 4]);
  release();
  for (let i = 0; i < words.length; i++) await settle();
  eq([backend.asked.length, backend.busiest, game.snapshot().words], [words.length, 4, words.length]);
  eq(best(game).map((row) => row[1]), Object.values(RANKS).sort((a, b) => a - b));
});

test('раунд: список на экране ограничен', async () => {
  const ranks = {};
  for (let i = 0; i < 30; i++) ranks['слово' + 'абвгдежзик'[i % 10] + 'абв'[Math.floor(i / 10)]] = 100 + i;
  const { game } = await startRound({ backend: fakeBackend({ ranks }) });
  for (const word of Object.keys(ranks)) await say(game, 'Вася', word);
  const state = game.snapshot();
  eq([state.words, state.best.length, state.best[0].rank, state.best[BEST_SHOWN - 1].rank],
    [30, BEST_SHOWN, 100, 99 + BEST_SHOWN]);
});

test('победа: угадавший — в итогах и в таблице, после паузы новое слово', async () => {
  const made = await startRound({ settings: { pause: 30 } });
  const { game, clock, events, backend } = made;
  await say(game, 'Вася', 'молот');
  clock.t += 100;
  await say(game, 'Петя', 'Серп', { color: '#00FF00', login: 'petya' });
  const state = game.snapshot();
  eq([state.state, state.hint_at, state.top, state.players],
    ['results', null, [{ name: 'Петя', score: 1, crown: true }], 1]);
  eq(state.results, { reason: 'win', round: 1, at: 1100, next_at: 1130, pause: 30, word: 'серп', winner: 'Петя',
    color: '#00ff00', star: '', crown: true, seconds: 100 });
  eq(best(game)[0], ['серп', 1]);
  eq(last(events).type, 'round_end');
  eq(backend.created.length, 2);
  eq(await say(game, 'Вася', 'поле'), null);
  eq(backend.asked, ['молот', 'серп']);
  clock.t = 1129;
  game.tick();
  eq(game.state, 'results');
  await nextRound(made);
  const next = game.snapshot();
  eq([next.state, next.round, next.best, next.words, next.results], ['playing', 2, [], 0, undefined]);
  await say(game, 'Петя', 'серп');
  eq(table(game.snapshot().top), [['Петя', 2]]);
});

test('победа: одно и то же слово написали двое — побеждает первый', async () => {
  const { game, backend } = await startRound();
  const release = backend.hold();
  game.feed('Вася', 'серп');
  game.feed('Петя', 'серп');
  release();
  await settle();
  eq([game.results.winner, table(game.snapshot().top)], ['Вася', [['Вася', 1]]]);
});

test('победа: ответы, опоздавшие к концу раунда, не засчитываются', async () => {
  const made = await startRound();
  const { game, backend } = made;
  const release = backend.hold();
  game.feed('Вася', 'молот');
  game.skip();
  release();
  await settle();
  eq([game.state, best(game)], ['results', []]);
  await nextRound(made);
  eq([game.state, best(game)], ['playing', []]);
});

test('победа: следующее слово не успело загадаться — заставка ждёт его', async () => {
  const { game, clock, backend, timers } = await startRound({ settings: { pause: 30 } });
  backend.closed = true;
  await say(game, 'Вася', 'серп');
  backend.closed = false;
  eq([game.state, game.trouble], ['results', true]);
  clock.t = game.results.next_at;
  game.tick();
  const state = game.snapshot();
  eq([state.state, state.best, state.results, state.starts_at, state.trouble], ['countdown', undefined, undefined,
    clock.t, true]);
  last(timers).action();
  await settle();
  game.tick();
  eq([game.state, game.snapshot().round, game.trouble], ['playing', 2, false]);
});

test('новое слово: раунд заканчивается, загаданное слово открывается', async () => {
  const made = await startRound();
  const { game, events } = made;
  await say(game, 'Вася', 'молот');
  game.skip();
  eq([game.state, game.results.reason, game.results.word, game.results.winner], ['results', 'skip', '', '']);
  await settle();
  eq([game.results.word, game.snapshot().top, last(events).type], ['серп', [], 'round_end']);
  game.skip();
  eq([game.state, game.snapshot().round], ['playing', 2]);
  made.backend.revealed = false;
  game.skip();
  await settle();
  eq([game.results.reason, game.results.word], ['skip', '']);
});

test('новое слово: если следующее ещё не готово, раунд начнётся, как только оно придёт', async () => {
  const { game, backend, timers } = await startRound();
  backend.down = true;
  game.skip();
  await settle();
  game.skip();
  eq(game.state, 'results');
  backend.down = false;
  last(timers).action();
  await settle();
  game.tick();
  eq([game.state, game.snapshot().round], ['playing', 2]);
});

test('подсказки: срок вышел — игра сама открывает слово ближе лучшего', async () => {
  const backend = fakeBackend({ tips: [['Кузнец', 20], ['наковальня', 9]] });
  const { game, clock, events } = await startRound({ backend, settings: { hint_every: 60 } });
  eq([game.snapshot().hint_at, game.snapshot().hint_every, game.snapshot().hinting], [1060, 60, false]);
  clock.t = 1010;
  await say(game, 'Вася', 'поле');
  eq(game.snapshot().hint_at, 1070);
  clock.t = 1069;
  game.tick();
  eq(backend.hinted, []);
  clock.t = 1070;
  game.tick();
  eq([backend.hinted, game.snapshot().hinting], [[120], true]);
  await settle();
  const state = game.snapshot();
  eq(state.best.map((row) => [row.word, row.rank, row.user, row.hint]), [['кузнец', 20, '', true],
    ['поле', 120, 'Вася', false]]);
  eq([state.hints, state.closest, state.words, state.guessers], [1, 20, 1, 1]);
  eq([state.hint_at, state.hinting, last(events).type], [1130, false, 'hint']);
  eq((await say(game, 'Вася', 'кузнец')).type, 'repeat');
  clock.t = 1130;
  game.tick();
  await settle();
  eq([backend.hinted, game.snapshot().closest, game.snapshot().hints], [[120, 20], 9, 2]);
});

test('подсказки: новое лучшее слово откладывает подсказку, остальные слова — нет', async () => {
  const { game, clock } = await startRound({ settings: { hint_every: 60 } });
  clock.t = 1020;
  await say(game, 'Вася', 'колос');
  eq(game.snapshot().hint_at, 1080);
  clock.t = 1040;
  await say(game, 'Петя', 'дом');
  await say(game, 'Петя', 'бежать');
  await say(game, 'Оля', 'колос');
  eq(game.snapshot().hint_at, 1080);
  clock.t = 1050;
  await say(game, 'Оля', 'кузница');
  eq(game.snapshot().hint_at, 1110);
});

test('подсказки: пока запрос в пути, второй не уходит', async () => {
  const { game, clock, backend } = await startRound({ settings: { hint_every: 60 } });
  const release = backend.hold();
  clock.t = 1060;
  game.tick();
  clock.t = 1061;
  game.tick();
  no(game.hint());
  eq([backend.hinted, game.snapshot().hinting], [[null], true]);
  release();
  await settle();
  eq(game.snapshot().hinting, false);
});

test('подсказки: ближе слов нет — ждём следующего срока; сбой связи — повтор через десять секунд', async () => {
  const { game, clock, backend, events } = await startRound({ settings: { hint_every: 60 } });
  clock.t = 1060;
  game.tick();
  await settle();
  const state = game.snapshot();
  eq([backend.hinted, state.best, state.hints, state.hint_at, last(events).type], [[null], [], 0, 1120, 'hint_none']);
  backend.down = true;
  clock.t = 1120;
  game.tick();
  await settle();
  eq([game.snapshot().hint_at, game.snapshot().hinting], [1130, false]);
  backend.down = false;
  backend.tips.push(['наковальня', 5]);
  clock.t = 1130;
  game.tick();
  await settle();
  eq([best(game), game.snapshot().hint_at], [[['наковальня', 5]], 1190]);
});

test('подсказки: выключаются нулём; модератор и кнопка открывают сразу, зрители — нет', async () => {
  const backend = fakeBackend({ tips: [['кузница', 15], ['наковальня', 5], ['молот', 3]] });
  const { game, clock } = await startRound({ backend, settings: { hint_every: 0 } });
  eq(game.snapshot().hint_at, null);
  clock.t = 5000;
  game.tick();
  eq(await say(game, 'Вася', '!подсказка'), null);
  eq(await say(game, 'Вася', '!словотрон-подсказка'), null);
  eq(backend.hinted, []);
  eq((await say(game, 'Модер', '!словотрон-подсказка', { mod: true })).command, 'hint');
  eq((await say(game, 'Модер', '!slv-hint', { mod: true })).command, 'hint');
  ok(game.hint());
  no(game.hint());
  await settle();
  eq([backend.hinted, best(game), game.snapshot().hints, game.snapshot().hint_at], [[null, 15, 5],
    [['молот', 3], ['наковальня', 5], ['кузница', 15]], 3, null]);
  game.skip();
  no(game.hint());
});

test('подсказки: само слово не открывают — на числе 2 таймер останавливается', async () => {
  const backend = fakeBackend({ tips: [['наковальня', 3], ['молот', 2], ['серп', 1]] });
  const { game, clock, events } = await startRound({ backend, settings: { hint_every: 60 } });
  ok(game.canHint());
  clock.t = 1060;
  game.tick();
  await settle();
  eq([game.snapshot().closest, game.snapshot().hint_at, game.canHint()], [3, 1120, true]);
  clock.t = 1120;
  game.tick();
  await settle();
  eq([game.snapshot().closest, game.snapshot().hint_at, game.canHint(), game.snapshot().hints], [2, null, false, 2]);
  clock.t = 9000;
  game.tick();
  no(game.hint());
  eq(game.feed('Модер', '!словотрон-подсказка', { mod: true }).command, 'hint');
  await settle();
  eq([backend.hinted, game.state, best(game), types(events).includes('round_end')],
    [[null, 3], 'playing', [['молот', 2], ['наковальня', 3]], false]);
});

test('подсказки: зритель сам дошёл до числа 2 — подсказок больше нет', async () => {
  const { game, clock, backend } = await startRound({ settings: { hint_every: 60 } });
  await say(game, 'Вася', 'кузница');
  eq([game.snapshot().hint_at, game.canHint()], [1060, true]);
  clock.t = 1030;
  await say(game, 'Вася', 'молот');
  eq([game.snapshot().hint_at, game.canHint(), game.hint()], [null, false, false]);
  game.configure({ ...game.s, hint_every: 20 });
  clock.t = 5000;
  game.tick();
  eq([game.snapshot().hint_at, backend.hinted], [null, []]);
});

test('подсказки: ответ сервера с самим словом отбрасывается', async () => {
  const backend = fakeBackend({ tips: [['Серп', 1], ['кузнец', 20]] });
  const { game, clock, events } = await startRound({ backend, settings: { hint_every: 60 } });
  await say(game, 'Вася', 'поле');
  game.hint();
  await settle();
  eq([game.state, best(game), game.snapshot().hints, game.snapshot().hint_at, last(events).type],
    ['playing', [['поле', 120]], 0, 1060, 'hint_none']);
  clock.t = 1060;
  game.tick();
  await settle();
  eq(best(game), [['кузнец', 20], ['поле', 120]]);
});

test('команды: «раунд» и прежние названия загадывают новое слово, «сброс» очищает таблицу', async () => {
  eq(sorted(new Set(COMMANDS.values())), ['hint', 'pause', 'reset', 'skip']);
  for (const command of ['!словотрон-раунд', '!Словотрон-Рестарт сейчас', '!словотрон-рес', '!srestart', '!sres']) {
    const { game } = await startRound();
    eq(game.feed('Модер', command, { mod: true }), { type: 'command', command: 'skip' });
    eq(game.state, 'results');
  }
  const { game } = await startRound();
  await say(game, 'Вася', 'серп');
  eq(game.scores.size, 1);
  eq(game.feed('Модер', '!словотрон-сброс', { mod: true }).command, 'reset');
  eq([game.scores.size, game.results.winner], [0, 'Вася']);
});

test('команды: только для стримера и модераторов, выключаются настройкой', async () => {
  const { game } = await startRound();
  for (const command of COMMANDS.keys()) eq(game.feed('Вася', command), null);
  eq(game.feed('Модер', '!словотрон', { mod: true }), null);
  eq(game.feed('Модер', '!старт', { mod: true }), null);
  eq(game.state, 'playing');
  const quiet = (await startRound({ settings: { chat_commands: false } })).game;
  eq(quiet.feed('Модер', '!словотрон-раунд', { mod: true }), null);
  eq(quiet.state, 'playing');
});

test('пауза: раунд замирает, «продолжить» возвращает его с того же места', async () => {
  const { game, clock, backend, events } = await startRound({ settings: { hint_every: 60 } });
  await say(game, 'Вася', 'кузница');
  clock.t = 1040;
  eq(game.feed('Модер', '!словотрон-пауза', { mod: true }).command, 'pause');
  no(game.pause());
  eq([game.state, game.snapshot().held], ['paused', 'playing']);
  clock.t = 1500;
  game.tick();
  eq(await say(game, 'Петя', 'поле'), null);
  eq(game.feed('Модер', '!словотрон-раунд', { mod: true }).command, 'skip');
  eq([game.state, backend.asked, backend.hinted, game.snapshot().feed.length], ['paused', ['кузница'], [], 4]);
  eq(game.feed('Модер', '!словотрон-пауза', { mod: true }).command, 'pause');
  const state = game.snapshot();
  eq([state.state, state.held, state.started, state.idle, state.hint_at], ['playing', null, 1000, 460, 1520]);
  no(game.resume());
  clock.t = 1560;
  await say(game, 'Вася', 'серп');
  eq(game.results.seconds, 100);
  eq(types(events).filter((type) => type === 'paused' || type === 'resumed'), ['paused', 'resumed']);
});

test('пауза: отсчёт и перерыв между раундами тоже замирают', async () => {
  const made = makeGame({ settings: { pause: 30 } });
  const { game, clock } = made;
  game.open(10);
  await settle();
  clock.t = 1004;
  game.pause();
  clock.t = 1100;
  game.tick();
  eq(game.state, 'paused');
  game.resume();
  eq([game.state, game.startsAt], ['countdown', 1106]);
  clock.t = 1106;
  game.tick();
  await say(game, 'Вася', 'серп');
  clock.t = 1116;
  game.pause();
  clock.t = 1300;
  game.tick();
  game.resume();
  eq([game.state, game.results.next_at], ['results', 1320]);
  clock.t = 1320;
  game.tick();
  eq([game.state, game.snapshot().round], ['playing', 2]);
});

test('пауза: ответ, пришедший на паузе, засчитывается; победа ждёт «продолжить»', async () => {
  const { game, clock, backend } = await startRound({ settings: { pause: 30 } });
  const release = backend.hold();
  clock.t = 1050;
  game.feed('Вася', 'серп');
  game.pause();
  clock.t = 1090;
  release();
  await settle();
  eq([game.state, game.snapshot().held, game.results.winner, game.results.seconds], ['paused', 'results', 'Вася', 50]);
  clock.t = 1200;
  game.tick();
  eq(game.state, 'paused');
  game.resume();
  eq([game.state, game.results.next_at], ['results', 1230]);
  game.stop();
  eq([game.state, game.snapshot().held], ['stopped', null]);
});

test('сервер закончил игру: раунд прерывается, через несколько секунд — новое слово', async () => {
  const made = await startRound({ settings: { pause: 30 } });
  const { game, backend } = made;
  await say(game, 'Вася', 'молот');
  backend.gone = true;
  await say(game, 'Петя', 'поле');
  eq([game.state, game.results.reason, game.results.pause, game.results.word, game.snapshot().top],
    ['results', 'lost', 5, '', []]);
  backend.gone = false;
  await nextRound(made);
  eq([game.state, game.snapshot().round], ['playing', 2]);
  backend.gone = true;
  game.hint();
  await settle();
  eq(game.results.reason, 'lost');
});

test('настройки на ходу: другой источник слов — со следующего раунда, на заставке — сразу', async () => {
  const first = fakeBackend(), second = fakeBackend({ secret: 'лампа' });
  const backends = (name) => (name === 'wordgun' ? second : first);
  const made = makeGame({ backends });
  const { game } = made;
  game.open(0);
  await settle();
  game.configure({ ...game.s, backend: 'wordgun', difficulty: 'hell' });
  await settle();
  game.tick();
  eq([first.created.length, second.created, game.round.backend === second], [1, [{ difficulty: 'hell' }], true]);
  game.configure({ ...game.s, backend: 'kontekstno', difficulty: '' });
  await say(game, 'Вася', 'лампа');
  eq([game.results.winner, first.created.length], ['Вася', 2]);
  game.configure({ ...game.s, backend: 'wordgun' });
  await nextRound(made);
  eq([game.round.backend === second, second.created.length], [true, 2]);
});

test('настройки на ходу: срок подсказки меняется сразу, ноль её выключает', async () => {
  const { game, clock, backend } = await startRound({ settings: { hint_every: 60 } });
  clock.t = 1030;
  game.configure({ ...game.s, hint_every: 20 });
  eq(game.snapshot().hint_at, 1050);
  game.configure({ ...game.s, hint_every: 0 });
  clock.t = 2000;
  game.tick();
  eq([game.snapshot().hint_at, backend.hinted], [null, []]);
  game.pause();
  clock.t = 2100;
  game.configure({ ...game.s, hint_every: 30 });
  game.resume();
  eq(game.snapshot().hint_at, 2130);
});

test('настройки на ходу: новое расписание очистки не стирает таблицу задним числом', async () => {
  const { game, clock } = makeGame({ at: local(2026, 9, 5, 23) });
  game.scores.add('Вася', 1);
  clock.t = local(2026, 9, 9, 12);
  game.configure({ ...game.s, reset_mode: 'day', reset_hour: 6 });
  game.tick();
  eq(game.scores.size, 1);
  clock.t = local(2026, 9, 10, 6);
  game.tick();
  eq(game.scores.size, 0);
});

test('чат: в ленту идут все сообщения', async () => {
  const { game } = makeGame();
  game.feed('Вася', 'до игры');
  eq(game.snapshot().feed.length, 1);
  game.open(0);
  await settle();
  game.tick();
  await say(game, 'Вася', 'всем привет!');
  await say(game, 'Петя', '   ');
  await say(game, 'Вася', ' МОЛОТ ');
  await say(game, 'Петя', 'молот');
  await say(game, 'Модер', '!словотрон-сброс', { mod: true });
  const feed = game.snapshot().feed;
  eq(feed.map((m) => [m.user, m.text, m.rank, m.repeat]), [['Вася', 'до игры', 0, false],
    ['Вася', 'всем привет!', 0, false], ['Вася', 'МОЛОТ', 2, false], ['Петя', 'молот', 2, true],
    ['Модер', '!словотрон-сброс', 0, false]]);
  const ids = feed.map((m) => m.id);
  eq(ids, Array.from(new Set(ids)).sort((a, b) => a - b));
  eq(sorted(Object.keys(feed[0])), sorted(['id', 'user', 'text', 'color', 'star', 'crown', 'rank', 'repeat',
    'unknown', 'failed']));
});

test('чат: пока игра остановлена, сообщения запоминаются без перерисовки', () => {
  const { game } = makeGame();
  let changes = 0;
  game.onchange = () => { changes++; };
  game.feed('Вася', 'привет');
  eq([changes, game.snapshot().feed.length], [0, 1]);
  game.open();
  const after = changes;
  game.feed('Вася', 'ещё');
  ok(changes > after);
});

test('чат: лента ограничена, длинное сообщение обрезается', async () => {
  const { game } = await startRound();
  for (let i = 0; i < CHAT_KEEP + 15; i++) game.feed('Вася', 'сообщение ' + i);
  const feed = game.snapshot().feed;
  eq(feed.length, CHAT_SHOWN);
  eq(last(feed).text, 'сообщение ' + (CHAT_KEEP + 14));
  game.feed('Вася', 'я'.repeat(CHAT_TEXT_MAX + 50));
  eq(last(game.snapshot().feed).text.length, CHAT_TEXT_MAX);
});

test('чат: цвет ника и невидимые символы', async () => {
  const { game, backend } = await startRound();
  game.feed('Лиса', 'привет всем', { color: '#FF69B4' });
  game.feed('Вася', 'привет всем', { color: 'красный' });
  game.feed('Петя', 'привет всем');
  eq(game.snapshot().feed.map((m) => m.color), ['#ff69b4', '', '']);
  await say(game, 'Петя', 'мо' + String.fromCodePoint(0x200B) + 'лот ' + String.fromCodePoint(0xE0000));
  eq([backend.asked, last(game.snapshot().feed).text], [['молот'], 'молот']);
});

test('чат: удалённое модератором пропадает, а его слово на экране прячется', async () => {
  const { game } = await startRound();
  await say(game, 'Лиса', 'молот', { msgId: 'a1', login: 'lisa' });
  await say(game, 'Вася', 'поле', { msgId: 'a2', login: 'vasya' });
  await say(game, 'Лиса', 'три слова тут', { msgId: 'a3', login: 'lisa' });
  await say(game, 'Петя', 'поле', { msgId: 'a4', login: 'petya' });
  eq(game.unsay({ msgId: 'a2' }), 1);
  let state = game.snapshot();
  eq(state.feed.map((m) => m.text), ['молот', 'три слова тут', 'поле']);
  eq(state.best.map((row) => [row.word, row.rude]), [['молот', false], ['поле', true]]);
  eq(game.unsay({ user: 'LISA' }), 2);
  eq(game.unsay({ user: 'никто' }), 0);
  eq(game.unsay({}), 0);
  eq(game.unsay({ everything: true }), 1);
  state = game.snapshot();
  eq([state.feed, state.words, state.best.map((row) => row.rude)], [[], 2, [true, true]]);
  no(JSON.stringify(state).includes('a4'));
});

test('грубые слова: число показываем, само слово на экране прячем', async () => {
  const backend = fakeBackend({ ranks: { ...RANKS, грубость: 50 } });
  const { game } = await startRound({ backend, banned: new Set(['грубость']) });
  await say(game, 'Вася', 'Грубость');
  await say(game, 'Вася', 'молот');
  eq(game.snapshot().best.map((row) => [row.word, row.rank, row.rude]), [['молот', 2, false], ['грубость', 50, true]]);
});

test('чат: смайлики Twitch доходят до ленты', async () => {
  const { game } = await startRound();
  game.feed('Вася', 'Kappa привет', { emotes: { Kappa: '25' } });
  game.feed('Петя', 'без смайликов');
  game.feed('Оля', 'мусор', { emotes: { 'два слова': '1', ok: 'не номер!', '': '5', LUL: 'emotesv2_a1', x: 7 } });
  game.feed('Тим', 'ещё мусор', { emotes: '25:0-4' });
  const feed = game.snapshot().feed;
  eq(feed[0].emotes, { Kappa: '25' });
  no('emotes' in feed[1]);
  eq(feed[2].emotes, { LUL: 'emotesv2_a1', x: '7' });
  no('emotes' in feed[3]);
});

test('чат: особые ники узнаются по логину — в ленте, в словах и в итогах', async () => {
  const { game } = await startRound();
  eq(Array.from(STARS), [['sumaizu', 'rainbow'], ['sukoshissrb', 'white'], ['fra3a', 'thyme'],
    ['welovegames', 'heart']]);
  game.feed('Sumaizu', 'привет всем', { login: 'sumaizu' });
  game.feed('Петя', 'привет всем', { login: 'petya' });
  game.feed('Ник На Кириллице', 'привет всем', { login: 'sumaizu' });
  game.feed('Sumaizu', 'привет всем', { login: 'samozvanec' });
  game.feed('SUMAIZU', 'привет всем');
  game.feed('SukoshiSSRB', 'привет всем', { login: 'sukoshissrb' });
  game.feed('FRA3A', 'привет всем');
  game.feed('constructor', 'привет всем');
  eq(game.snapshot().feed.map((m) => m.star), ['rainbow', '', 'rainbow', '', 'rainbow', 'white', 'thyme', '']);
  eq(game.snapshot().stars, Array.from(STARS));
  await say(game, 'WELOVEGAMES', 'молот', { login: 'welovegames' });
  await say(game, 'Sumaizu', 'серп', { login: 'sumaizu' });
  const state = game.snapshot();
  eq([state.best[1].star, state.results.star, state.results.winner], ['heart', 'rainbow', 'Sumaizu']);
});

test('очистка таблицы: когда следующая — по дате', () => {
  const monday = local(2026, 9, 5, 12);
  eq(nextReset(monday, 'day', 6), local(2026, 9, 6, 6));
  eq(nextReset(local(2026, 9, 5, 5), 'day', 6), local(2026, 9, 5, 6));
  eq(nextReset(local(2026, 9, 5, 6), 'day', 6), local(2026, 9, 6, 6));
  eq(nextReset(monday, 'day', 0), local(2026, 9, 6, 0));
  eq(nextReset(local(2026, 9, 7, 12), 'week', 6), local(2026, 9, 12, 6));
  eq(nextReset(local(2026, 9, 5, 5), 'week', 6), local(2026, 9, 5, 6));
  eq(nextReset(monday, 'week', 6), local(2026, 9, 12, 6));
  eq(nextReset(local(2026, 9, 11, 23), 'week', 6), local(2026, 9, 12, 6));
  eq(nextReset(local(2026, 10, 1, 12), 'week', 6), local(2026, 10, 2, 6));
  eq(nextReset(local(2026, 9, 1, 12), 'week', 6), local(2026, 9, 5, 6));
  eq(nextReset(monday, 'month', 6), local(2026, 10, 1, 6));
  eq(nextReset(local(2026, 9, 1, 5), 'month', 6), local(2026, 9, 1, 6));
  eq(nextReset(local(2026, 11, 15, 12), 'month', 6), local(2027, 0, 1, 6));
});

test('очистка таблицы: по таймеру и никогда', () => {
  eq(nextReset(1000, 'timer', 6, 2), 1000 + 7200);
  eq(nextReset(1000, 'never', 6, 2), null);
  eq(nextReset(1000, 'как-нибудь', 6, 2), null);
  eq(nextReset(NaN, 'day', 6), null);
});

test('очистка таблицы: по умолчанию победы копятся без срока', async () => {
  const { game, clock } = await startRound();
  await say(game, 'Вася', 'серп');
  clock.t += 1e7;
  game.tick();
  eq([game.snapshot().top[0].score, game.scores.since], [1, null]);
});

test('очистка таблицы: по таймеру, итог раунда остаётся', async () => {
  const { game, clock, events } = await startRound({ settings: { reset_mode: 'timer', reset_hours: 2, pause: 600 } });
  await say(game, 'Вася', 'серп');
  clock.t = 1000 + 7199;
  game.pause();
  game.tick();
  eq(game.scores.size, 1);
  clock.t = 1000 + 7200;
  game.tick();
  const state = game.snapshot();
  eq([state.top, game.scores.size, state.results.winner], [[], 0, 'Вася']);
  eq([last(events).type, last(events).auto], ['scores_reset', true]);
  game.scores.add('Петя', 1);
  clock.t += 100;
  game.resetScores();
  game.scores.add('Петя', 1);
  clock.t += 7199;
  game.tick();
  eq(game.scores.size, 1);
  clock.t += 1;
  game.tick();
  eq(types(events).filter((type) => type === 'scores_reset').length, 3);
});

test('очистка таблицы: каждый день, даже когда игра остановлена', () => {
  const { game, clock, events } = makeGame({ at: local(2026, 9, 5, 23),
    settings: { reset_mode: 'day', reset_hour: 6 } });
  game.scores.add('Вася', 5);
  clock.t = local(2026, 9, 6, 5, 59);
  game.tick();
  eq(game.scores.size, 1);
  clock.t = local(2026, 9, 6, 6, 0);
  game.tick();
  game.tick();
  eq(game.scores.size, 0);
  eq(types(events), ['scores_reset']);
  game.scores.add('Вася', 5);
  clock.t = local(2026, 9, 7, 7);
  game.tick();
  eq(game.scores.top(), []);
});

test('очистка таблицы: пропущенная случается при следующем запуске', () => {
  const storage = memoryStorage();
  const settings = { reset_mode: 'day', reset_hour: 6 };
  const first = makeGame({ at: local(2026, 9, 5, 23), settings, scores: new Scores(storage, 'k') }).game;
  first.scores.add('Вася', 5);
  eq(new Scores(storage, 'k').since, local(2026, 9, 5, 23));
  const later = makeGame({ at: local(2026, 9, 8, 20), settings, scores: new Scores(storage, 'k') }).game;
  eq(later.scores.size, 1);
  later.tick();
  eq(later.scores.size, 0);
  eq(new Scores(storage, 'k').since, local(2026, 9, 8, 20));
});

test('таблица победителей: хранится и переживает перезагрузку', async () => {
  const storage = memoryStorage();
  const made = await startRound({ scores: new Scores(storage, 'победы') });
  const { game } = made;
  await say(game, 'Вася', 'серп');
  await nextRound(made);
  await say(game, 'вася', 'серп');
  made.game.scores.add('Оля', 1);
  made.game.scores.add('Аня', 1);
  eq(table(new Scores(storage, 'победы').top()), [['вася', 2], ['Аня', 1], ['Оля', 1]]);
  eq(table(new Scores(storage, 'победы').top(1)), [['вася', 2]]);
  eq(new Scores(storage, 'другой канал').top(), []);
  game.resetScores();
  eq(new Scores(storage, 'победы').top(), []);
  storage.setItem('победы', 'не json');
  eq(new Scores(storage, 'победы').top(), []);
  storage.setItem('победы', '{"a": 5, "b": {"score": "12"}}');
  eq(table(new Scores(storage, 'победы').top()), [['b', 12]]);
});

test('таблица победителей: хранилище может отказать — игра продолжается', async () => {
  const broken = { getItem: () => { throw new Error('нельзя'); }, setItem: () => { throw new Error('нельзя'); } };
  const { game } = await startRound({ scores: new Scores(broken, 'победы') });
  await say(game, 'Вася', 'серп');
  eq(table(game.snapshot().top), [['Вася', 1]]);
});

test('корона: у победителя последнего раунда — в чате, у слов, в таблице и в итогах', async () => {
  const storage = memoryStorage();
  const made = await startRound({ scores: new Scores(storage, 'победы') });
  const { game } = made;
  const crowns = () => {
    const state = game.snapshot();
    return [state.feed.filter((m) => m.crown).map((m) => m.user), state.best.filter((row) => row.crown)
      .map((row) => row.word), state.top.filter((row) => row.crown).map((row) => row.name)];
  };
  await say(game, 'Вася', 'молот');
  await say(game, 'Петя', 'поле');
  eq(crowns(), [[], [], []]);
  await say(game, 'Петя', 'серп');
  eq(crowns(), [['Петя', 'Петя'], ['серп', 'поле'], ['Петя']]);
  eq([game.results.winner, game.snapshot().results.crown, game.scores.champion], ['Петя', true, 'петя']);
  await nextRound(made);
  await say(game, 'ПЕТЯ', 'поле');
  await say(game, 'Вася', 'молот');
  eq(crowns(), [['Петя', 'Петя', 'ПЕТЯ'], ['поле'], ['Петя']]);
  game.skip();
  eq([crowns()[2], game.snapshot().results.crown], [['Петя'], false]);
  await nextRound(made);
  eq(new Scores(storage, 'победы').champion, 'петя');
  await say(game, 'Вася', 'серп');
  eq([crowns()[1], crowns()[2], new Scores(storage, 'победы').champion], [['серп'], ['Вася'], 'вася']);
  eq(table(new Scores(storage, 'победы').top().filter((row) => row.crown)), [['Вася', 1]]);
  game.resetScores();
  eq([crowns(), game.snapshot().results.crown, new Scores(storage, 'победы').champion], [[[], [], []], false, '']);
});

test('корона: подсказке и пустому имени не достаётся', async () => {
  const backend = fakeBackend({ tips: [['кузнец', 20]] });
  const { game } = await startRound({ backend });
  no(game.scores.crowned(''));
  game.hint();
  await settle();
  eq(game.snapshot().best.map((row) => [row.user, row.crown]), [['', false]]);
});

test('таблица победителей: на экране первая десятка, на паузе — все', async () => {
  const { game } = await startRound();
  for (let i = 0; i < 25; i++) game.scores.add('зритель' + i, 30 - i);
  eq([game.snapshot().top.length, game.snapshot().top[9].name], [TOP_SHOWN, 'зритель9']);
  game.pause();
  eq([game.snapshot().top.length, game.snapshot().top[24].name], [25, 'зритель24']);
  game.resume();
  eq(game.snapshot().top.length, 10);
});

test('таблица победителей: ники, совпадающие со словами самого языка', async () => {
  const made = await startRound();
  for (const name of ['constructor', '__proto__', 'toString']) {
    await say(made.game, name, 'серп');
    await nextRound(made);
  }
  eq(made.game.snapshot().top.map((row) => [row.name, row.score]), [['__proto__', 1], ['constructor', 1],
    ['toString', 1]]);
  const storage = memoryStorage(), scores = new Scores(storage, 'k');
  scores.add('__proto__', 5);
  scores.add('constructor', 2);
  eq(new Scores(storage, 'k').top().map((row) => row.name), ['__proto__', 'constructor']);
});

test('события: слушатель может обращаться к игре, сломанный её не роняет', async () => {
  const { game, events } = makeGame();
  game.listeners.push(() => { throw new Error('сломан'); });
  game.listeners.push((event) => {
    if (event.type === 'round_start' && event.round === 1) game.skip();
  });
  game.open(0);
  await settle();
  game.tick();
  eq(types(events), ['countdown', 'round_start', 'round_end']);
  eq(game.state, 'results');
});

test('игра: много раундов подряд идут без сбоев', async () => {
  const backend = fakeBackend({ tips: Array.from({ length: 400 }, (_, i) => ['намек' + 'абвгдежзик'[i % 10], 50]) });
  const made = makeGame({ backend, settings: { pause: 5, hint_every: 10 } });
  const { game, clock } = made;
  const pool = Object.keys(RANKS).concat(['серп', 'привет', 'два слова', '!подсказка', '!словотрон-раунд',
    '!словотрон-пауза', 'бежать']);
  game.open(1);
  for (let step = 0; step < 1500; step++) {
    clock.t += 0.5;
    game.tick();
    game.feed('Зритель' + (step % 7), pool[(step * 7 + Math.floor(step / 11)) % pool.length], { mod: step % 97 === 0 });
    if (step % 5 === 0) await settle();
    const state = game.snapshot();
    ok(['countdown', 'playing', 'results', 'paused'].includes(state.state), state.state);
    if (state.best) ok(state.best.every((row, i) => !i || state.best[i - 1].rank <= row.rank));
  }
  ok(game.snapshot().round > 20, game.snapshot().round);
  ok(game.scores.size > 0);
});
