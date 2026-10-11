import { CHAT_URL, TwitchChat, chatClear, chatEmotes, chatMessage, chatMeta, parseLine } from '../../site/js/chat.js';
import { fakeClock } from './fixtures.js';
import { eq, ok, test } from './harness.js';

const PRIVMSG = '@badge-info=;badges=moderator/1,subscriber/6;color=#FF69B4;display-name=Лиса\\sАлиса;id=abc-123;' +
  'mod=1;user-id=42 :lisa!lisa@lisa.tmi.twitch.tv PRIVMSG #channel :привет: кот\r\n';
const JOINED = ':tmi.twitch.tv 366 justinfan1 #channel :End of /NAMES list';

test('чат: сообщение с метками', () => {
  const m = parseLine(PRIVMSG);
  eq([m.command, m.nick, m.params, m.text], ['PRIVMSG', 'lisa', ['#channel'], 'привет: кот']);
  eq(m.tags.get('display-name'), 'Лиса Алиса');
  eq(chatMessage(m), { name: 'Лиса Алиса', text: 'привет: кот', mod: true });
});

test('чат: обычный зритель, стример, /me', () => {
  let m = parseLine('@badges=;display-name=;mod=0 :vasya!vasya@vasya.tmi.twitch.tv PRIVMSG #channel :кот');
  eq(chatMessage(m), { name: 'vasya', text: 'кот', mod: false });
  m = parseLine('@badges=broadcaster/1;display-name=Streamer;mod=0 :s!s@s PRIVMSG #s :!словотрон-раунд');
  eq(chatMessage(m), { name: 'Streamer', text: '!словотрон-раунд', mod: true });
  const mark = String.fromCharCode(1);
  m = parseLine(':vasya!vasya@vasya PRIVMSG #channel :' + mark + 'ACTION кот' + mark);
  eq(chatMessage(m), { name: 'vasya', text: 'кот', mod: false });
});

test('чат: служебные строки', () => {
  eq(parseLine('PING :tmi.twitch.tv').command, 'PING');
  eq(parseLine('PING :tmi.twitch.tv').text, 'tmi.twitch.tv');
  eq(parseLine(JOINED).command, '366');
  eq(parseLine(''), null);
  eq(parseLine('\r\n'), null);
  eq(parseLine(null), null);
  eq(chatMessage(parseLine(':tmi.twitch.tv RECONNECT')), null);
  eq(chatMessage(null), null);
  eq(parseLine('@a=1;b :x!y PRIVMSG #c :д: в').tags.get('b'), '');
});

test('чат: номер сообщения, логин и цвет ника', () => {
  eq(chatMeta(parseLine(PRIVMSG)), { msgId: 'abc-123', login: 'lisa', color: '#FF69B4', emotes: {} });
  const bare = parseLine(':Vasya!vasya@vasya.tmi.twitch.tv PRIVMSG #channel :кот');
  eq(chatMeta(bare), { msgId: '', login: 'vasya', color: '', emotes: {} });
});

test('чат: смайлики Twitch — по местам в тексте узнаём, как смайлик написан', () => {
  let m = parseLine('@emotes=25:0-4,12-16/emotesv2_abc:6-10 :v!v@v PRIVMSG #c :Kappa LUL:) Kappa');
  eq(chatEmotes(m), { 'Kappa': '25', 'LUL:)': 'emotesv2_abc' });
  eq(chatMeta(m).emotes, { 'Kappa': '25', 'LUL:)': 'emotesv2_abc' });
  m = parseLine('@emotes=25:7-11 :v!v@v PRIVMSG #c :привет Kappa');
  eq(chatEmotes(m), { Kappa: '25' });
  const smile = String.fromCodePoint(0x1F600);
  m = parseLine('@emotes=25:2-6 :v!v@v PRIVMSG #c :' + smile + ' Kappa');
  eq(chatEmotes(m), { Kappa: '25' });
  const mark = String.fromCharCode(1);
  m = parseLine('@emotes=25:0-4 :v!v@v PRIVMSG #c :' + mark + 'ACTION Kappa кот' + mark);
  eq(chatEmotes(m), { Kappa: '25' });
  for (const tag of ['', '25', '25:', '25:x-y', ':0-4', '25:3-9']) {
    eq(chatEmotes(parseLine('@emotes=' + tag + ' :v!v@v PRIVMSG #c :ab cd ef gh')), {}, tag);
  }
});

test('чат: что убрать с экрана после модерации', () => {
  const one = parseLine('@login=lisa;target-msg-id=abc-123;tmi-sent-ts=1 :tmi.twitch.tv CLEARMSG #channel :привет');
  eq(chatClear(one), { msgId: 'abc-123' });
  const ban = parseLine('@ban-duration=600;target-user-id=42;tmi-sent-ts=1 :tmi.twitch.tv CLEARCHAT #channel :Lisa');
  eq(chatClear(ban), { user: 'lisa' });
  eq(chatClear(parseLine('@room-id=1;tmi-sent-ts=1 :tmi.twitch.tv CLEARCHAT #channel')), { everything: true });
  eq(chatClear(parseLine(':tmi.twitch.tv CLEARMSG #channel :привет')), null);
  eq(chatClear(parseLine(PRIVMSG)), null);
  eq(chatClear(null), null);
});

function setup(channel = 'Channel') {
  const sockets = [];
  class FakeSocket {
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

    open() {
      this.onopen();
    }

    receive(data) {
      this.onmessage({ data });
    }

    drop() {
      this.onclose();
    }
  }
  const jobs = [];
  const later = (fn, sec) => {
    const job = { fn, sec, cancelled: false, done: false };
    jobs.push(job);
    return () => { job.cancelled = true; };
  };
  const pending = (sec) => jobs.filter((j) => !j.cancelled && !j.done && (sec === undefined || j.sec === sec));
  const fire = (job) => {
    job.done = true;
    job.fn();
  };
  const got = [], cleared = [], statuses = [];
  const clock = fakeClock();
  const chat = new TwitchChat({ channel, Socket: FakeSocket, later, clock,
    onMessage: (name, text, mod, meta) => got.push([name, text, mod, meta]),
    onClear: (what) => cleared.push(what),
    onStatus: (st) => statuses.push(st.state) });
  return { chat, sockets, jobs, pending, fire, got, cleared, statuses, clock };
}
const lastOf = (list) => list[list.length - 1];

test('читатель: входит в канал и читает сообщения', () => {
  const { chat, sockets, got } = setup();
  eq(chat.status.state, 'off');
  chat.start();
  eq(sockets.length, 1);
  eq(sockets[0].url, CHAT_URL);
  eq(chat.status.state, 'connecting');
  sockets[0].open();
  const sent = sockets[0].sent;
  ok(sent.includes('JOIN #channel'), sent);
  ok(sent.some((line) => /^NICK justinfan\d{5}$/.test(line)), sent);
  ok(sent[0].startsWith('CAP REQ'));
  eq(chat.status.state, 'connecting');
  sockets[0].receive(JOINED + '\r\n');
  eq([chat.status.state, chat.status.text], ['connected', 'читаю чат channel']);
  sockets[0].receive(PRIVMSG + 'PING :tmi.twitch.tv\r\n');
  eq(got, [['Лиса Алиса', 'привет: кот', true, { msgId: 'abc-123', login: 'lisa', color: '#FF69B4', emotes: {} }]]);
  ok(sockets[0].sent.includes('PONG :tmi.twitch.tv'));
  eq(chat.status.messages, 1);
});

test('читатель: узнаёт номер канала — по нему оверлей находит смайлики канала', () => {
  const { chat, sockets, statuses, pending, fire } = setup();
  chat.start();
  sockets[0].open();
  eq(chat.status.roomId, '');
  sockets[0].receive(JOINED + '\r\n');
  eq([chat.status.state, chat.status.roomId], ['connected', '']);
  const before = statuses.length;
  sockets[0].receive('@emote-only=0;room-id=12345;slow=0 :tmi.twitch.tv ROOMSTATE #channel\r\n');
  eq([chat.status.state, chat.status.roomId], ['connected', '12345']);
  eq(statuses.length, before + 1);
  sockets[0].receive('@room-id=12345;slow=3 :tmi.twitch.tv ROOMSTATE #channel\r\n');
  eq(statuses.length, before + 1);
  sockets[0].drop();
  fire(pending(2)[0]);
  eq([chat.status.state, chat.status.roomId], ['connecting', '12345']);
});

test('читатель: передаёт дальше модерацию', () => {
  const { chat, sockets, cleared } = setup();
  chat.start();
  sockets[0].open();
  sockets[0].receive(JOINED + '\r\n');
  sockets[0].receive('@login=lisa;target-msg-id=abc-123 :tmi.twitch.tv CLEARMSG #channel :привет: кот\r\n');
  sockets[0].receive('@target-user-id=42 :tmi.twitch.tv CLEARCHAT #channel :lisa\r\n');
  sockets[0].receive(':tmi.twitch.tv CLEARCHAT #channel\r\n');
  eq(cleared, [{ msgId: 'abc-123' }, { user: 'lisa' }, { everything: true }]);
  eq(chat.status.messages, 0);
});

test('читатель: работает и без слушателя модерации, ошибка в игре его не роняет', () => {
  const sockets = [];
  class FakeSocket {
    constructor() {
      sockets.push(this);
    }

    send() {}

    close() {}
  }
  let calls = 0;
  const chat = new TwitchChat({ channel: 'channel', Socket: FakeSocket, later: () => () => {},
    onMessage: () => {
      calls++;
      throw new Error('игра сломалась');
    } });
  chat.start();
  sockets[0].onopen();
  sockets[0].onmessage({ data: '@target-user-id=42 :tmi.twitch.tv CLEARCHAT #channel :lisa\r\n' + PRIVMSG + PRIVMSG });
  eq(calls, 2);
});

test('читатель: после обрыва приходит снова сам', () => {
  const { chat, sockets, pending, fire } = setup();
  chat.start();
  sockets[0].open();
  sockets[0].receive(JOINED + '\r\n');
  sockets[0].drop();
  eq(chat.status.state, 'error');
  ok(chat.status.text.includes('повтор через 2 с'), chat.status.text);
  eq(sockets.length, 1);
  fire(pending(2)[0]);
  eq(sockets.length, 2);
  eq(chat.status.state, 'connecting');
  sockets[1].drop();
  ok(chat.status.text.includes('повтор через 4 с'), chat.status.text);
  fire(pending(4)[0]);
  sockets[2].open();
  sockets[2].receive(JOINED + '\r\n');
  eq(chat.status.state, 'connected');
  sockets[2].drop();
  ok(chat.status.text.includes('повтор через 2 с'), chat.status.text);
});

test('читатель: Twitch просит переподключиться или молчит слишком долго', () => {
  const { chat, sockets, pending, fire, clock } = setup();
  chat.start();
  sockets[0].open();
  sockets[0].receive(JOINED + '\r\n');
  sockets[0].receive(':tmi.twitch.tv RECONNECT\r\n');
  ok(sockets[0].closed);
  eq(chat.status.state, 'error');
  fire(pending(2)[0]);
  sockets[1].open();
  sockets[1].receive(JOINED + '\r\n');
  clock.t += 100;
  fire(pending(30)[0]);
  eq(chat.status.state, 'connected');
  clock.t += 400;
  fire(pending(30)[0]);
  ok(sockets[1].closed);
  eq(chat.status.state, 'error');
  ok(chat.status.text.includes('молчит'), chat.status.text);
});

test('читатель: «стоп» закрывает соединение и больше не пробует', () => {
  const { chat, sockets, pending } = setup();
  chat.start();
  sockets[0].open();
  chat.stop();
  ok(sockets[0].closed);
  eq(chat.status.state, 'off');
  eq(pending().length, 0);
  sockets[0].drop();
  eq(sockets.length, 1);
  eq(pending().length, 0);
});

test('читатель: без канала не подключается', () => {
  const { chat, sockets, statuses } = setup('');
  chat.start();
  eq(sockets.length, 0);
  eq([chat.status.state, chat.status.text], ['off', 'канал не указан']);
  eq(lastOf(statuses), 'off');
});
