// Wyciąganie dat i godzin z polskiego tekstu (reguły, bez AI, w pełni lokalnie).
const MAP = { ą: 'a', ć: 'c', ę: 'e', ł: 'l', ń: 'n', ó: 'o', ś: 's', ź: 'z', ż: 'z' };
export const norm = (s) => String(s || '').toLowerCase().replace(/[ąćęłńóśźż]/g, (c) => MAP[c]); // 1:1, indeksy zostają

const MONTHS = 'stycznia|styczen|lutego|luty|marca|marzec|kwietnia|kwiecien|maja|maj|czerwca|czerwiec|lipca|lipiec|sierpnia|sierpien|wrzesnia|wrzesien|pazdziernika|pazdziernik|listopada|listopad|grudnia|grudzien';
const MONTH_STEMS = ['styczn', 'lut', 'marc', 'kwiet', 'maj', 'czerw', 'lip', 'sierp', 'wrzes', 'pazdz', 'listop', 'grudn'];
const monthIdx = (w) => MONTH_STEMS.findIndex((s) => w.startsWith(s));
const WEEKDAYS = 'poniedzialek|wtorek|srode|sroda|czwartek|piatek|sobote|niedziele';
const wdIdx = (w) => (w.startsWith('pon') ? 1 : w.startsWith('wt') ? 2 : w.startsWith('sr') ? 3 : w.startsWith('cz') ? 4 : w.startsWith('pi') ? 5 : w.startsWith('so') ? 6 : 0);

const sod = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const pad = (n) => String(n).padStart(2, '0');
export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function parseTime(win) {
  let m;
  if ((m = win.match(/(\d{1,2}):(\d{2})\s*(?:-|–|—|do|a)\s*(\d{1,2}):(\d{2})/)) && +m[1] < 24 && +m[3] <= 24) return { sh: +m[1], sm: +m[2], eh: +m[3] % 24, em: +m[4], at: m.index };
  if ((m = win.match(/\b(?:od|miedzy)\s+(\d{1,2})(?::(\d{2}))?\s+(?:do|a)\s+(\d{1,2})(?::(\d{2}))?/)) && +m[1] < 24 && +m[3] <= 24) return { sh: +m[1], sm: +(m[2] || 0), eh: +m[3] % 24, em: +(m[4] || 0), at: m.index };
  if ((m = win.match(/(?<![\d.:/])(\d{1,2})\s*(?:-|–|—)\s*(\d{1,2})(?![\d:/]|\.\d)/)) && +m[1] < 24 && +m[2] <= 24 && +m[2] > +m[1]) return { sh: +m[1], sm: 0, eh: +m[2] % 24, em: 0, at: m.index };
  if ((m = win.match(/\b(?:godz\.?|godzinie|godzina|o|g\.)\s*(\d{1,2})(?:[:.](\d{2}))?(?![\d/])/)) && +m[1] < 24) return { sh: +m[1], sm: +(m[2] || 0), at: m.index };
  if ((m = win.match(/(?<![\d.])([01]?\d|2[0-3]):([0-5]\d)(?![\d])/))) return { sh: +m[1], sm: +m[2], at: m.index };
  return null;
}

export function extractDates(raw, now = new Date()) {
  const t = norm(raw);
  const today = sod(now);
  const found = [];
  const add = (y, m, d, index, len, rel = false) => {
    const dt = new Date(y, m, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== m || dt.getDate() !== d) return;
    found.push({ date: dt, index, end: index + len, rel });
  };
  const inferYear = (m, d) => { let y = today.getFullYear(); if (new Date(y, m, d) < addDays(today, -7)) y++; return y; };

  for (const x of t.matchAll(/\b(20\d{2})-(\d{2})-(\d{2})\b/g)) add(+x[1], +x[2] - 1, +x[3], x.index, x[0].length);
  for (const x of t.matchAll(/(?<![\d.,:\-/])(\d{1,2})[.\-/](\d{1,2})(?:[.\-/](\d{4}|\d{2}))?(?![\d:])(?!\s?(?:zl|pln|eur|usd|%|\.\d|,\d))/g)) {
    const d = +x[1], mo = +x[2];
    if (mo < 1 || mo > 12 || d < 1 || d > 31) continue;
    const y = x[3] ? (x[3].length === 2 ? 2000 + +x[3] : +x[3]) : inferYear(mo - 1, d);
    add(y, mo - 1, d, x.index, x[0].length);
  }
  for (const x of t.matchAll(new RegExp(`(?<!\\d)(\\d{1,2})\\s+(${MONTHS})(?:\\s+(20\\d{2}))?`, 'g'))) {
    const mo = monthIdx(x[2]);
    add(x[3] ? +x[3] : inferYear(mo, +x[1]), mo, +x[1], x.index, x[0].length);
  }
  for (const x of t.matchAll(/\b(dzisiaj|dzis|jutro|pojutrze)\b/g)) {
    const n = x[1].startsWith('dzis') ? 0 : x[1] === 'jutro' ? 1 : 2;
    const d = addDays(today, n); add(d.getFullYear(), d.getMonth(), d.getDate(), x.index, x[0].length, true);
  }
  for (const x of t.matchAll(new RegExp(`\\b(?:w|we|na|do|od)\\s+(${WEEKDAYS})\\b`, 'g'))) {
    let delta = (wdIdx(x[1]) - today.getDay() + 7) % 7; if (delta === 0) delta = 7;
    const d = addDays(today, delta); add(d.getFullYear(), d.getMonth(), d.getDate(), x.index, x[0].length, true);
  }
  found.sort((a, b) => a.index - b.index);
  // „w środę 28.10": dzień tygodnia tuż przed konkretną datą nie tworzy drugiej
  const kept = found.filter((f, i) => !(f.rel && found[i + 1] && !found[i + 1].rel && found[i + 1].index - f.end <= 16));

  return kept.map((f, i) => {
    const nextStart = kept[i + 1] ? kept[i + 1].index : t.length;
    const after = t.slice(f.end, Math.min(f.end + 34, nextStart));
    const before = t.slice(Math.max(i ? kept[i - 1].end : 0, f.index - 26), f.index);
    const tm = parseTime(after) || parseTime(before);
    const out = { date: f.date, ymd: ymd(f.date), index: f.index, end: f.end, raw: raw.slice(f.index, f.end), hasTime: !!tm };
    if (tm) Object.assign(out, { sh: tm.sh, sm: tm.sm, eh: tm.eh, em: tm.em });
    return out;
  });
}
