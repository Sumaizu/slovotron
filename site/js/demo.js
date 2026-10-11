const NOW = 1000;
const ROUND_SECONDS = 312;
const CHAMPION = 'Борщ';

const LINES = [
  { user: 'pelmen', word: 'дом', rank: 2380 },
  { user: 'ya_tut', word: 'телефон', rank: 7802 },
  { user: 'Mishka_Gamer', word: 'солнце', rank: 2950 },
  { user: 'valera', word: 'река', rank: 1730 },
  { user: 'Соня', word: 'лампа', rank: 1204 },
  { user: 'neko_chan', word: 'ночь', rank: 367 },
  { user: 'kotofey', text: 'теплее, теплее' },
  { user: 'Mishka_Gamer', word: 'лес', rank: 210 },
  { user: 'Борщ', word: 'тепло', rank: 512 },
  { user: 'ya_tut', word: 'печь', rank: 640 },
  { user: 'valera', word: 'поход', rank: 68 },
  { user: 'Соня', word: 'палатка', rank: 95 },
  { user: 'neko_chan', text: 'это что-то про природу?' },
  { user: 'kotofey', word: 'дым', rank: 41 },
  { user: 'tiny_frog', word: 'спичка', rank: 284 },
  { user: 'tiny_frog', word: 'огонь', rank: 7 },
  { user: 'kotofey', word: 'гитара', rank: 890 },
  { user: 'pelmen', word: 'уголь', rank: 133 },
  { user: 'ya_tut', text: 'горячо!' },
  { hint: true, word: 'дрова', rank: 12 },
  { user: 'valera', word: 'бежать', rank: 0 },
  { user: 'Борщ', word: 'пламя', rank: 3 },
  { user: 'neko_chan', word: 'огонь', rank: 7 },
  { user: 'ЛисаАлиса', word: 'искра', rank: 26 },
  { user: 'pelmen', text: 'ну почти же' },
];

const WINNERS = [
  ['tiny_frog', 6], ['Борщ', 5], ['ЛисаАлиса', 4], ['kotofey', 3], ['pelmen', 3], ['Соня', 2], ['valera', 2],
  ['Mishka_Gamer', 1], ['neko_chan', 1], ['ya_tut', 1], ['pingvin', 1], ['Тимофей', 1], ['sova_noch', 1],
];

export function demoState(settings) {
  const words = new Map(), guessers = new Set(), feed = [];
  let repeats = 0, hints = 0;
  for (const line of LINES.filter((entry) => settings.hint_every || !entry.hint)) {
    const known = line.word ? words.get(line.word) : null;
    const kind = line.hint ? 'hint' : !line.word ? '' : known ? 'repeat' : line.rank ? 'new' : 'unknown';
    if (line.user) {
      feed.push({ id: feed.length + 1, user: line.user, text: line.word || line.text, color: '', star: '',
        crown: line.user === CHAMPION, rank: line.rank || 0, repeat: kind === 'repeat', unknown: kind === 'unknown',
        failed: false });
    }
    if (!kind) continue;
    if (kind === 'new' || kind === 'hint') {
      words.set(line.word, { word: line.word, rank: line.rank, user: line.user || '', color: '', star: '',
        crown: line.user === CHAMPION, hint: kind === 'hint', rude: false });
    }
    if (kind === 'repeat') repeats += 1;
    if (kind === 'hint') hints += 1;
    else if (kind !== 'unknown') guessers.add(line.user);
  }
  const best = Array.from(words.values()).sort((a, b) => a.rank - b.rank);
  return {
    version: 1,
    now: NOW,
    state: 'playing',
    held: null,
    round: 4,
    starts_at: null,
    trouble: false,
    top: WINNERS.slice(0, 10).map(([name, score]) => ({ name, score, crown: name === CHAMPION })),
    players: WINNERS.length,
    stars: [],
    feed,
    started: NOW - ROUND_SECONDS,
    idle: 0,
    best,
    words: best.length - hints,
    repeats,
    guessers: guessers.size,
    hints,
    closest: best[0].rank,
    hint_at: settings.hint_every ? NOW + Math.round(settings.hint_every * 0.7) : null,
    hint_every: settings.hint_every,
    hinting: false,
  };
}
