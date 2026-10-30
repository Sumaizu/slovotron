import { wordgunDifficulties } from './backends.js';
import { clean, fromQuery, toQuery } from './config.js';

const STORAGE_KEY = 'slovotron.settings';
const NUMBERS = ['pause', 'hint_every', 'reset_hour', 'reset_hours', 'volume'];
const TEXTS = ['backend', 'difficulty', 'reset_mode'];
const FLAGS = ['chat_commands', 'sound', 'mini'];
const DATE_MODES = ['day', 'week', 'month'];
const BACKEND_HINTS = {
  kontekstno: 'Слово загадывает и сравнивает сайт контекстно.рф.',
  wordgun: 'Слово загадывает и сравнивает сайт wordgun.ru. Из России он открывается не всегда: если игра не ' +
    'начинается, выбери контекстно.рф.',
};
const CONFIRMED = { skip: 'Новое слово', reset: 'Сброс' };
const SYNC_MS = 500;
const CONFIRM_MS = 4000;

const $ = (id) => document.getElementById(id);
const frame = $('game'), form = $('settings'), channelField = $('s-channel'), linkPanel = $('link-panel');
const TAGLINE = $('status').textContent;

let settings = restore();
let playing = false;
let connected = false;
let notice = '';
let difficultiesAsked = false;
const armedUntil = { skip: 0, reset: 0 };

function restore() {
  if (location.search.length > 1) return fromQuery(location.search);
  try {
    return clean(JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'));
  } catch (error) {
    return clean({});
  }
}

function remember() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (error) {
    return;
  }
}

function overlayLink(query) {
  return new URL('overlay.html', location.href).href + (query ? '?' + query : '');
}

function overlay() {
  return (frame.contentWindow && frame.contentWindow.slovotron) || null;
}

function offerDifficulty(name, label) {
  const select = $('s-difficulty');
  let option = Array.from(select.options).find((known) => known.value === name);
  if (!option) {
    option = new Option(label, name);
    select.add(option);
  }
  option.textContent = label;
}

async function loadDifficulties() {
  if (difficultiesAsked) return;
  difficultiesAsked = true;
  try {
    for (const tier of await wordgunDifficulties()) offerDifficulty(tier.name, tier.label.toLowerCase());
    $('s-difficulty').value = settings.difficulty;
  } catch (error) {
    difficultiesAsked = false;
  }
}

function fillForm() {
  channelField.value = settings.channel;
  if (settings.difficulty) offerDifficulty(settings.difficulty, settings.difficulty);
  for (const key of NUMBERS.concat(TEXTS)) $('s-' + key).value = settings[key];
  for (const key of FLAGS) $('s-' + key).checked = settings[key];
  showDependentFields(settings);
}

function readForm() {
  const raw = { channel: settings.channel, webcam: settings.webcam };
  for (const key of NUMBERS) raw[key] = $('s-' + key).value === '' ? null : Number($('s-' + key).value);
  for (const key of TEXTS) raw[key] = $('s-' + key).value;
  for (const key of FLAGS) raw[key] = $('s-' + key).checked;
  return clean(raw);
}

function showDependentFields(shown) {
  $('backend-hint').textContent = BACKEND_HINTS[shown.backend];
  $('difficulty-field').hidden = shown.backend !== 'wordgun';
  $('reset-hour-field').hidden = !DATE_MODES.includes(shown.reset_mode);
  $('reset-hours-field').hidden = shown.reset_mode !== 'timer';
  $('volume-text').textContent = shown.volume + '%';
  for (const button of document.querySelectorAll('[data-webcam]')) {
    button.classList.toggle('on', button.dataset.webcam === shown.webcam);
  }
  $('webcam-field').hidden = shown.mini;
  frame.parentNode.classList.toggle('mini', shown.mini);
  if (shown.backend === 'wordgun') loadDifficulties();
}

function showStatus(id, kind, text) {
  const node = $(id);
  node.classList.remove('ok', 'warn');
  if (kind) node.classList.add(kind);
  node.textContent = text;
  node.title = text;
}

function showLink() {
  $('link').value = overlayLink(toQuery(settings));
  showStatus('link-status', 'warn', settings.channel ? '' : 'Впиши канал Twitch — без него оверлей не увидит чат.');
}

function adopt(candidate, refill) {
  settings = candidate;
  remember();
  if (refill) fillForm();
  else showDependentFields(settings);
  showLink();
  const api = overlay();
  if (api) api.apply(settings);
}

function commitChannel() {
  const channel = clean({ channel: channelField.value }).channel;
  if (channel !== settings.channel) adopt(clean(Object.assign({}, settings, { channel })), false);
  channelField.value = settings.channel;
}

function toggleGame() {
  const api = overlay();
  if (!api) return;
  commitChannel();
  if (playing) {
    api.stop();
    playing = false;
    armedUntil.skip = armedUntil.reset = 0;
  } else if (!settings.channel) {
    notice = 'Впиши канал Twitch — без него игра не увидит чат.';
    channelField.focus();
  } else {
    api.start();
    playing = true;
    showLinkPanel(false);
  }
  sync();
}

function togglePause() {
  const api = overlay();
  if (!api || !playing) return;
  if (!api.game.resume()) api.game.pause();
  sync();
}

function openHint() {
  const api = overlay();
  if (api && playing) api.game.hint();
  sync();
}

function confirmed(name, action) {
  const api = overlay();
  if (!api || !playing) return;
  if (Date.now() < armedUntil[name]) {
    action(api.game);
    armedUntil[name] = 0;
  } else {
    armedUntil[name] = Date.now() + CONFIRM_MS;
  }
  sync();
}

function sync() {
  const api = overlay();
  $('play').disabled = !api;
  if (!api) {
    showStatus('status', '', 'Загружаю игру…');
    return;
  }
  if (!connected) {
    connected = true;
    api.apply(settings);
  }
  const state = api.game.state, paused = playing && state === 'paused';
  $('play').textContent = playing ? 'Остановить' : 'Начать';
  $('pause').disabled = $('reset').disabled = !playing;
  $('pause').textContent = paused ? 'Продолжить' : 'Пауза';
  $('hint').disabled = !playing || !api.game.canHint();
  $('skip').disabled = !playing || (state !== 'playing' && state !== 'results');
  for (const name of Object.keys(CONFIRMED)) {
    const asking = playing && !$(name).disabled && Date.now() < armedUntil[name];
    $(name).textContent = asking ? 'Точно?' : CONFIRMED[name];
    $(name).classList.toggle('armed', asking);
  }
  $('example-note').hidden = playing;
  if (paused) {
    notice = '';
    showStatus('status', 'warn', 'Пауза');
  } else if (playing && api.game.trouble) {
    notice = '';
    showStatus('status', 'warn', 'Нет связи с сервером слов — пробую ещё раз');
  } else if (playing) {
    notice = '';
    const chat = api.chat.status;
    const text = chat.text.charAt(0).toUpperCase() + chat.text.slice(1);
    showStatus('status', chat.state === 'connected' ? 'ok' : 'warn', text);
  } else if (notice) {
    showStatus('status', 'warn', notice);
  } else {
    showStatus('status', '', TAGLINE);
  }
}

function toggleSettings() {
  const open = form.hidden;
  form.hidden = !open;
  $('layout').classList.toggle('with-settings', open);
  $('toggle-settings').setAttribute('aria-expanded', String(open));
}

function showLinkPanel(open) {
  linkPanel.hidden = !open;
  $('toggle-link').setAttribute('aria-expanded', String(open));
}

async function copyLink() {
  const link = $('link'), button = $('copy');
  try {
    await navigator.clipboard.writeText(link.value);
  } catch (error) {
    link.select();
    document.execCommand('copy');
  }
  button.textContent = 'Скопировано';
  setTimeout(() => { button.textContent = 'Копировать'; }, 1500);
}

form.addEventListener('input', () => adopt(readForm(), false));
form.addEventListener('change', () => adopt(readForm(), true));
form.addEventListener('submit', (event) => event.preventDefault());
for (const button of document.querySelectorAll('[data-webcam]')) {
  button.addEventListener('click', () => {
    adopt(clean(Object.assign(readForm(), { webcam: button.dataset.webcam })), true);
  });
}
$('defaults').addEventListener('click', () => adopt(clean({ channel: settings.channel }), true));
$('listen').addEventListener('click', () => {
  const api = overlay();
  if (api) api.playSounds(settings.volume);
});
$('start').addEventListener('submit', (event) => {
  event.preventDefault();
  toggleGame();
});
$('pause').addEventListener('click', togglePause);
$('hint').addEventListener('click', openHint);
$('skip').addEventListener('click', () => confirmed('skip', (game) => game.skip()));
$('reset').addEventListener('click', () => confirmed('reset', (game) => game.resetScores()));
channelField.addEventListener('change', commitChannel);
channelField.addEventListener('input', () => { notice = ''; });
$('toggle-settings').addEventListener('click', toggleSettings);
$('toggle-link').addEventListener('click', () => showLinkPanel(linkPanel.hidden));
$('copy').addEventListener('click', copyLink);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') showLinkPanel(false);
});
document.addEventListener('click', (event) => {
  if (!linkPanel.contains(event.target) && event.target !== $('toggle-link')) showLinkPanel(false);
});

fillForm();
showLink();
frame.src = overlayLink(['embed=1', toQuery(settings)].filter(Boolean).join('&'));
sync();
setInterval(sync, SYNC_MS);
