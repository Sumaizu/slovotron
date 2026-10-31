const STATS_URL = 'https://gos-stats.smayztv.workers.dev/hit';
const SITE = 'gamesonstream.ru';

export function playNote(game, settings, embedded) {
  if (!settings.channel) return null;
  return { game, channel: settings.channel, mode: settings.mini ? 'mini' : settings.webcam, place: embedded ? 'browser' : 'obs' };
}

export function reportPlay(note, host = location.hostname) {
  if (!note || (host !== SITE && host !== 'www.' + SITE)) return false;
  fetch(STATS_URL, { method: 'POST', keepalive: true, body: JSON.stringify(note) }).catch(() => {});
  return true;
}
