// Most do Kalendarza. Nic nie trafia do kalendarza bez potwierdzenia użytkownika:
// 1) link do aplikacji Kalendarz (?new=event&text=...), 2) plik .ics, który iPhone otwiera w natywnym kalendarzu.
import { config } from './config.js';

const pad = (n) => String(n).padStart(2, '0');

export function calendarText(it) {
  const [d, t] = it.starts_at.split('T');
  const [y, m, day] = d.split('-');
  let s = `${it.title.replace(/\s+/g, ' ').slice(0, 80)} ${+day}.${+m}.${y}`;
  if (t) s += ` ${t}`;
  if (it.ends_at?.includes('T')) s += ` do ${it.ends_at.split('T')[1]}`;
  if (it.location) s += ` ${it.location}`;
  return s;
}
export const calendarLink = (it) => `${config.kalendarzUrl}?new=event&text=${encodeURIComponent(calendarText(it))}`;

const icsEsc = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const fold = (l) => (l.length <= 74 ? l : l.match(/.{1,73}/g).join('\r\n '));
const stamp = (d) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
const local = (s) => s.replace(/[-:]/g, '').replace('T', 'T').padEnd(15, '0').slice(0, 15);

export function buildIcs(it, uidHost = 'poczta.local') {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Poczta//PL', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'BEGIN:VEVENT',
    `UID:poczta-${it.id}@${uidHost}`, `DTSTAMP:${stamp(new Date())}`, `SUMMARY:${icsEsc(it.title)}`];
  if (it.all_day || !it.starts_at.includes('T')) {
    const d = it.starts_at.slice(0, 10).replace(/-/g, '');
    const next = new Date(+it.starts_at.slice(0, 4), +it.starts_at.slice(5, 7) - 1, +it.starts_at.slice(8, 10) + 1);
    lines.push(`DTSTART;VALUE=DATE:${d}`, `DTEND;VALUE=DATE:${next.getFullYear()}${pad(next.getMonth() + 1)}${pad(next.getDate())}`);
  } else {
    lines.push(`DTSTART:${local(it.starts_at)}`);
    if (it.ends_at?.includes('T')) lines.push(`DTEND:${local(it.ends_at)}`);
    else { const [d, t] = it.starts_at.split('T'); const h = +t.slice(0, 2) + 1; lines.push(`DTEND:${local(`${d}T${pad(Math.min(h, 23))}:${t.slice(3, 5)}`)}`); }
  }
  if (it.location) lines.push(`LOCATION:${icsEsc(it.location)}`);
  if (it.evidence) lines.push(`DESCRIPTION:${icsEsc('Dodane z poczty: ' + it.evidence)}`);
  lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Przypomnienie', 'TRIGGER:-PT1H', 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
