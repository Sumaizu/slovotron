const tests = [];

export function test(name, fn) {
  tests.push({ name, fn });
}

function canon(value) {
  if (value === undefined) return '__undefined__';
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Set) return Array.from(value, canon).sort();
  if (value instanceof Map) return Array.from(value, ([key, item]) => [canon(key), canon(item)]);
  if (Array.isArray(value)) return value.map(canon);
  const sorted = {};
  for (const key of Object.keys(value).sort()) sorted[key] = canon(value[key]);
  return sorted;
}

const show = (value) => JSON.stringify(canon(value));

export function eq(actual, expected, note = '') {
  const a = show(actual), b = show(expected);
  if (a !== b) throw new Error((note ? note + ': ' : '') + 'получили ' + a + ', ждали ' + b);
}

export function ok(value, note = '') {
  if (!value) throw new Error((note ? note + ': ' : '') + 'ждали истину, получили ' + show(value));
}

export function no(value, note = '') {
  if (value) throw new Error((note ? note + ': ' : '') + 'ждали ложь, получили ' + show(value));
}

export async function run(only = '') {
  const started = Date.now(), failed = [];
  const chosen = tests.filter((t) => !only || t.name.toLowerCase().includes(only.toLowerCase()));
  for (const t of chosen) {
    try {
      await t.fn();
    } catch (error) {
      failed.push({ name: t.name, error: String(error && error.stack ? error.stack : error) });
    }
  }
  return { total: chosen.length, passed: chosen.length - failed.length, failed, ms: Date.now() - started };
}
