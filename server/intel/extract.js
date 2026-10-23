// Z wiadomości do „spraw": wydarzenie / termin płatności / przesyłka. Reguły → (później) AI na fragmentach.
import { extractDates, norm, ymd } from './dates.js';

const pad = (n) => String(n).padStart(2, '0');
const RX = {
  deadline: /(do zaplaty|termin platnosci|zaplac do|platne do|termin zaplaty|nalezy zaplacic|do oplacenia|oplac do|wymagalne|ostateczny termin)/,
  parcel: /(paczk|przesylk|kurier|doreczen|dostaw|inpost|dpd|dhl|odbior|nadano)/,
  event: /(wizyt|spotkani|zaproszen|webinar|rozmow|konferencj|szkoleni|rezerwacj|badani|lekarz|przychodni|wydarzen|koncert|bilet|odlot|lot |wylot|termin|kolacj|lunch|obiad|urodzin|ślub|slub)/,
  past: /(wyslan|otrzymal|z dnia|data wystawienia|zlozon|wystawion|utworzon|zrealizowan|opublikowan|data zamowienia)/,
};

export function parseIcs(text) {
  const lines = String(text).replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
  const out = []; let ev = null;
  const val = (l) => l.slice(l.indexOf(':') + 1).replace(/\\n/gi, ' ').replace(/\\,/g, ',').replace(/\\;/g, ';').trim();
  const dt = (l) => {
    const v = val(l); const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
    if (!m) return null;
    if (!m[4]) return { allDay: true, str: `${m[1]}-${m[2]}-${m[3]}` };
    if (m[7]) { const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5])); return { str: `${ymd(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}` }; }
    return { str: `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}` };
  };
  for (const l of lines) {
    if (l.startsWith('BEGIN:VEVENT')) ev = {};
    else if (l.startsWith('END:VEVENT')) { if (ev?.start) out.push(ev); ev = null; }
    else if (ev) {
      if (l.startsWith('SUMMARY')) ev.title = val(l);
      else if (l.startsWith('LOCATION')) ev.location = val(l);
      else if (l.startsWith('DTSTART')) { const d = dt(l); if (d) { ev.start = d.str; ev.allDay = !!d.allDay; } }
      else if (l.startsWith('DTEND')) { const d = dt(l); if (d) ev.end = d.str; }
    }
  }
  return out;
}

function amountNear(text) {
  const t = String(text);
  const m = t.match(/(?:do zap[łl]aty|kwota|razem|suma|nale[żz]no[śs][ćc])[^\d]{0,24}(\d[\d\s]*(?:[.,]\d{2})?)\s*(z[łl]|pln|eur)/i) || t.match(/(\d[\d\s]*(?:[.,]\d{2})?)\s*(z[łl]|pln|eur)\b/i);
  if (!m) return null;
  const n = parseFloat(m[1].replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? { amount: n, currency: /eur/i.test(m[2]) ? 'EUR' : 'PLN' } : null;
}
const fmtMoney = (a) => `${a.amount.toLocaleString('pl-PL', { minimumFractionDigits: a.amount % 1 ? 2 : 0 })} ${a.currency === 'PLN' ? 'zł' : a.currency}`;
const cleanSubject = (s) => String(s || '').replace(/^\s*((re|fwd?|odp|pd)\s*:\s*)+/i, '').trim().slice(0, 90);

// Fragment wokół daty, przycięty do granic słów, żeby nie zaczynał się w pół wyrazu.
function snippet(text, a, b, pad = 55) {
  let s = Math.max(0, a - pad), e = Math.min(text.length, b + pad);
  if (s > 0) { const i = text.indexOf(' ', s); if (i > -1 && i < a) s = i + 1; }
  if (e < text.length) { const i = text.lastIndexOf(' ', e); if (i > b) e = i; }
  return `${s > 0 ? '…' : ''}${text.slice(s, e).replace(/\s+/g, ' ').trim()}${e < text.length ? '…' : ''}`;
}

export function extractItems({ subject = '', body = '', fromName = '', ics = [], received = new Date() }, now = new Date()) {
  const items = [];
  const push = (it) => {
    // ta sama sprawa tego samego dnia: zostaje wersja z godziną
    const same = items.findIndex((x) => x.kind === it.kind && x.starts_at.slice(0, 10) === it.starts_at.slice(0, 10));
    if (same >= 0) { if (it.starts_at.length > items[same].starts_at.length) items[same] = { ...it, title: items[same].title }; return; }
    items.push(it);
  };

  for (const text of ics) for (const e of parseIcs(text)) {
    push({ kind: 'event', title: e.title || cleanSubject(subject) || 'Wydarzenie', starts_at: e.start, ends_at: e.end || null, all_day: e.allDay ? 1 : 0, location: e.location || null, confidence: 0.98, source: 'ics', evidence: 'Zaproszenie w załączniku (.ics)' });
  }

  const full = `${subject}\n${body}`.slice(0, 20000);
  const nfull = norm(full);
  const nsubj = norm(subject);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  for (const d of extractDates(full, received).slice(0, 8)) {
    if (d.date < new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1)) continue; // przeszłość
    const ctx = nfull.slice(Math.max(0, d.index - 90), d.end + 90);
    const before = nfull.slice(Math.max(0, d.index - 40), d.index);
    if (RX.past.test(before)) continue;
    let kind = null;
    if (RX.deadline.test(ctx) || (/faktur|rachunek|oplata|platnosc/.test(nsubj) && /(do|termin)/.test(before))) kind = 'deadline';
    else if (RX.parcel.test(ctx) || RX.parcel.test(nsubj)) kind = 'parcel';
    else if (RX.event.test(ctx) || RX.event.test(nsubj)) kind = 'event';
    if (!kind) continue;
    const time = d.hasTime ? `${pad(d.sh)}:${pad(d.sm)}` : null;
    const starts = time ? `${d.ymd}T${time}` : d.ymd;
    const ends = d.hasTime && d.eh != null ? `${d.ymd}T${pad(d.eh)}:${pad(d.em)}` : null;
    let conf = 0.55 + (RX[kind].test(ctx) ? 0.2 : 0) + (d.hasTime ? 0.1 : 0) + (RX[kind].test(nsubj) ? 0.1 : 0);
    const it = { kind, starts_at: starts, ends_at: ends, all_day: d.hasTime ? 0 : 1, confidence: Math.min(0.95, conf), source: 'rule', evidence: snippet(full, d.index, d.end) };
    if (kind === 'deadline') {
      const am = amountNear(full); if (am) Object.assign(it, am);
      it.title = `Do zapłaty${am ? ' ' + fmtMoney(am) : ''}: ${cleanSubject(subject)}`.slice(0, 120);
    } else if (kind === 'parcel') it.title = `Paczka: ${fromName || cleanSubject(subject)}`.slice(0, 120);
    else it.title = cleanSubject(subject) || 'Wydarzenie';
    push(it);
  }
  return items.sort((a, b) => a.starts_at.localeCompare(b.starts_at));
}
