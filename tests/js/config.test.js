import { DEFAULTS, clean, fromQuery, toQuery } from '../../site/js/config.js';
import { eq, test } from './harness.js';

test('настройки: значения по умолчанию', () => {
  eq(clean({}), DEFAULTS);
  eq(clean(null), DEFAULTS);
  eq(clean('мусор'), DEFAULTS);
  eq(clean([1, 2]), DEFAULTS);
  eq([DEFAULTS.backend, DEFAULTS.pause, DEFAULTS.hint_every, DEFAULTS.chat_commands, DEFAULTS.accent],
    ['kontekstno', 20, 180, true, '#16a34a']);
});

test('настройки: канал', () => {
  const channel = (value) => clean({ channel: value }).channel;
  eq(channel('  #Some_Streamer '), 'some_streamer');
  eq(channel('https://www.twitch.tv/Some_Streamer/'), 'some_streamer');
  eq(channel('twitch.tv/some_streamer?tab=chat'), 'some_streamer');
  eq(channel('@streamer'), 'streamer');
  eq(channel('два слова'), '');
  eq(channel('слишком_длинное_имя_канала_на_твиче'), '');
  eq(channel(null), '');
});

test('настройки: числа зажаты в пределы', () => {
  const s = clean({ pause: 1, hint_every: -3, volume: 500, reset_hour: 99, reset_hours: 0 });
  eq([s.pause, s.hint_every, s.volume, s.reset_hour, s.reset_hours], [5, 0, 100, 23, 1]);
  const high = clean({ pause: 100000, hint_every: 100000, volume: -5 });
  eq([high.pause, high.hint_every, high.volume], [600, 3600, 0]);
  eq(clean({ pause: '45', hint_every: 90.9 }).pause, 45);
  eq(clean({ hint_every: 90.9 }).hint_every, 90);
});

test('настройки: подсказка — выключена нулём, иначе не чаще раза в десять секунд', () => {
  eq([0, 1, 9, 10, 11, '0', '3'].map((value) => clean({ hint_every: value }).hint_every), [0, 10, 10, 10, 11, 0, 10]);
});

test('настройки: негодные значения заменяются обычными', () => {
  const s = clean({ pause: 'много', hint_every: null, volume: true, accent: 'красный', reset_mode: 'иногда',
    backend: 'свой' });
  eq(s, DEFAULTS);
  eq(clean({ accent: '#AABBCC' }).accent, '#aabbcc');
});

test('настройки: источник слов и сложность', () => {
  eq(clean({ backend: 'wordgun' }).backend, 'wordgun');
  eq(clean({ backend: 'wordgun', difficulty: ' Hard ' }).difficulty, 'hard');
  eq(clean({ backend: 'wordgun', difficulty: 'не то!' }).difficulty, '');
  eq(clean({ backend: 'kontekstno', difficulty: 'hard' }).difficulty, '');
  eq(clean({ difficulty: 'hard' }).difficulty, '');
});

test('настройки: флажки', () => {
  const off = clean({ chat_commands: 'false', sound: 'off', webcam: 'no', chat: 0, side: false, bg: '' });
  eq([off.chat_commands, off.sound, off.webcam, off.chat, off.side, off.bg],
    [false, false, false, false, false, false]);
  const on = clean({ chat_commands: 'да', sound: true, webcam: 1 });
  eq([on.chat_commands, on.sound, on.webcam], [true, true, true]);
});

test('настройки: расписание очистки таблицы победителей', () => {
  eq(['never', 'day', 'week', 'month', 'timer', 'год'].map((mode) => clean({ reset_mode: mode }).reset_mode),
    ['never', 'day', 'week', 'month', 'timer', 'never']);
});

test('настройки: чужие ключи отбрасываются', () => {
  const s = clean({ hints: false, hint_pause: 90, webhook_url: 'https://example.com', __proto__: { x: 1 } });
  eq(Object.keys(s).sort(), Object.keys(DEFAULTS).sort());
});

test('ссылка: в неё попадает только то, что отличается от обычного', () => {
  eq(toQuery({}), '');
  eq(toQuery({ channel: 'streamer' }), 'channel=streamer');
  eq(toQuery({ channel: 'streamer', pause: 20, hint_every: 0, accent: '#00ff88', webcam: false }),
    'channel=streamer&hint_every=0&accent=00ff88&webcam=0');
  eq(toQuery({ backend: 'wordgun', difficulty: 'hard' }), 'backend=wordgun&difficulty=hard');
});

test('ссылка: настройки возвращаются из неё теми же', () => {
  const settings = clean({ channel: 'streamer', backend: 'wordgun', difficulty: 'hell', pause: 45,
    hint_every: 120, chat_commands: false, reset_mode: 'week', reset_hour: 3, reset_hours: 48, sound: false,
    volume: 35, accent: '#12ab9f', webcam: false, chat: false, side: false, bg: false });
  eq(fromQuery('?' + toQuery(settings)), settings);
  eq(fromQuery(''), DEFAULTS);
  eq(fromQuery('?embed=1&channel=Streamer&accent=%2312AB9F').accent, '#12ab9f');
  eq(fromQuery('?embed=1&channel=Streamer').channel, 'streamer');
});
