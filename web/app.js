// Poczta · aplikacja PWA (vanilla JS, bez frameworka i bez zewnętrznych zasobów).
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const P = {
  inbox: '<path class="f" d="M4 13.500 6.200 5.800A2 2 0 0 1 8.100 4.500h7.800a2 2 0 0 1 1.900 1.300L20 13.500v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><path d="M4 13.500 6.200 5.800A2 2 0 0 1 8.100 4.500h7.800a2 2 0 0 1 1.900 1.300L20 13.500v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM4 13.500h4.500l1 2.500h5l1-2.500H20"/>',
  sun: '<circle class="f" cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="4"/><path d="M12 2.500v2M12 19.500v2M2.500 12h2M19.500 12h2M5.300 5.300l1.400 1.400M17.300 17.300l1.400 1.400M18.700 5.300l-1.400 1.400M6.700 17.300l-1.400 1.400"/>',
  search: '<circle class="f" cx="11" cy="11" r="6.500"/><circle cx="11" cy="11" r="6.500"/><path d="m16 16 4.500 4.500"/>',
  user: '<circle class="f" cx="12" cy="8.500" r="3.600"/><circle cx="12" cy="8.500" r="3.600"/><path d="M5 20c.8-3.600 3.600-5.500 7-5.500s6.200 1.900 7 5.500"/>',
  pen: '<path d="M4 20h4L19.500 8.500a2.100 2.100 0 0 0-3-3L5 17z"/><path d="m14.500 7.500 3 3"/>',
  cal: '<rect class="f" x="3.500" y="5" width="17" height="15.500" rx="3"/><rect x="3.500" y="5" width="17" height="15.500" rx="3"/><path d="M3.500 10h17M8 3v4M16 3v4"/>',
  coin: '<rect class="f" x="3" y="6.500" width="18" height="11" rx="2.500"/><rect x="3" y="6.500" width="18" height="11" rx="2.500"/><circle cx="12" cy="12" r="2.500"/>',
  box: '<path class="f" d="M3.500 7.500 12 3l8.500 4.500v9L12 21l-8.500-4.500z"/><path d="M3.500 7.500 12 3l8.500 4.500v9L12 21l-8.500-4.500z"/><path d="M3.500 7.500 12 12l8.500-4.500M12 12v9"/>',
  spark: '<path class="f" d="M12 3.500 13.800 9l5.700 1.800-5.700 1.800L12 18l-1.800-5.400L4.500 10.800 10.200 9z"/><path d="M12 3.500 13.800 9l5.700 1.800-5.700 1.800L12 18l-1.800-5.400L4.500 10.800 10.200 9z"/>',
  chev: '<path d="m9.500 5.500 6.500 6.500-6.500 6.500"/>', down: '<path d="m6 9.500 6 6 6-6"/>', back: '<path d="m14.500 5.500-6.500 6.500 6.500 6.500"/>',
  send: '<path d="M4 12 20 4l-4 16-4.500-6.500z"/>', plus: '<path d="M12 5v14M5 12h14"/>', x: '<path d="m6 6 12 12M18 6 6 18"/>', check: '<path d="m5 12.500 4.500 4.500L19 7.500"/>',
  shield: '<path class="f" d="M12 3.500 19 6v5.500c0 4.200-2.900 7-7 9-4.100-2-7-4.800-7-9V6z"/><path d="M12 3.500 19 6v5.500c0 4.200-2.900 7-7 9-4.100-2-7-4.800-7-9V6z"/><path d="M12 8.500v4M12 15.600v.1"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.500-4M4 4v3.500h3.500M4 13a8 8 0 0 0 14.500 4M20 20v-3.500h-3.500"/>', trash: '<path d="M4.500 7h15M9.500 7V4.500h5V7M6.500 7l.8 12a2 2 0 0 0 2 1.900h5.400a2 2 0 0 0 2-1.900L17.500 7"/>',
};
const ic = (n, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true">${P[n]}</svg>`;
const KIND_ICON = { event: 'cal', deadline: 'coin', parcel: 'box' };
const KIND_LABEL = { event: 'Wydarzenie', deadline: 'Termin płatności', parcel: 'Przesyłka' };

// ---- API ----
async function api(method, url, body) {
  const r = await fetch(url.replace(/^\//, ''), { method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Poczta': '1' }, body: body ? JSON.stringify(body) : undefined });
  let j = {}; try { j = await r.json(); } catch { /* brak treści */ }
  if (r.status === 401 && S.user) { S.user = null; go('#/login'); }
  if (!r.ok) throw Object.assign(new Error(j.error || 'Błąd'), { status: r.status });
  return j;
}
const get = (u) => api('GET', u);
const post = (u, b = {}) => api('POST', u, b);

// ---- stan ----
const S = { user: null, accounts: [], seg: 'msg', filter: 'all', account: 0, unread: 0, offline: false, animate: true, setupNeeded: false, demoAllowed: false };
const cacheSet = (k, v) => { try { localStorage.setItem('poczta.' + k, JSON.stringify(v)); } catch { /* pełny storage */ } };
const cacheGet = (k) => { try { return JSON.parse(localStorage.getItem('poczta.' + k)); } catch { return null; } };

// ---- czas ----
const pad = (n) => String(n).padStart(2, '0');
const WD = ['niedz.', 'pon.', 'wt.', 'śr.', 'czw.', 'pt.', 'sob.'];
const WDL = ['niedziela', 'poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek', 'sobota'];
const MON = ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca', 'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia'];
const sod = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const dayDiff = (a, b) => Math.round((sod(a) - sod(b)) / 86400000);
const parseLocal = (s) => { const [d, t = '00:00'] = s.split('T'); const [y, m, dd] = d.split('-').map(Number); const [h, mi] = t.split(':').map(Number); return new Date(y, m - 1, dd, h, mi); };
function fmtTime(ts) {
  const d = new Date(ts), n = new Date(), diff = dayDiff(n, d);
  if (diff === 0) return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (diff === 1) return 'wczoraj';
  if (diff < 7) return WD[d.getDay()];
  return `${d.getDate()}.${pad(d.getMonth() + 1)}`;
}
const money = (it) => `${Number(it.amount).toLocaleString('pl-PL', { minimumFractionDigits: it.amount % 1 ? 2 : 0 })} ${it.currency === 'PLN' || !it.currency ? 'zł' : it.currency}`;
function timeRange(it) {
  if (!it.starts_at.includes('T')) return '';
  const a = it.starts_at.slice(11, 16), b = it.ends_at?.includes('T') ? it.ends_at.slice(11, 16) : '';
  if (!b) return a;
  return a.endsWith(':00') && b.endsWith(':00') ? `${+a.slice(0, 2)}–${+b.slice(0, 2)}` : `${a}–${b}`;
}
function dayLabel(it) {
  const d = parseLocal(it.starts_at), diff = dayDiff(d, new Date());
  if (diff === 0) return 'Dziś';
  if (diff === 1) return 'Jutro';
  return `${WD[d.getDay()]} ${d.getDate()}.${pad(d.getMonth() + 1)}`;
}
function whenText(it) {
  const d = parseLocal(it.starts_at), diff = dayDiff(d, new Date()), tr = timeRange(it);
  if (it.kind === 'deadline') {
    const base = diff === 0 ? 'Zapłać dziś' : diff === 1 ? 'Zapłać jutro' : `Zapłać do ${d.getDate()}.${d.getMonth() + 1}`;
    return it.amount ? `${base} · ${money(it)}` : base;
  }
  const dl = dayLabel(it);
  return tr ? (diff <= 1 ? `${dl} ${tr}` : `${dl} · ${tr}`) : dl;
}
const initials = (n) => String(n || '?').split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((x) => x[0].toUpperCase()).join('') || '?';
const hue = (s) => 'g' + ([...String(s)].reduce((a, c) => a + c.charCodeAt(0), 0) % 5);
const ago = (ts) => { if (!ts) return 'jeszcze nie synchronizowano'; const m = Math.round((Date.now() - ts) / 60000); return m < 1 ? 'przed chwilą' : m < 60 ? `${m} min temu` : m < 1440 ? `${Math.round(m / 60)} godz. temu` : `${Math.round(m / 1440)} dni temu`; };

// ---- UI pomocnicze ----
let toastT;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 2800); }
function sheet(html, onMount) {
  closeSheet(true);
  const root = $('#sheet-root');
  root.innerHTML = `<div class="scrim"></div><div class="sheet" role="dialog" aria-modal="true"><div class="grab"></div>${html}</div>`;
  const sc = $('.scrim', root), sh = $('.sheet', root);
  requestAnimationFrame(() => { sc.classList.add('on'); sh.classList.add('on'); });
  sc.onclick = () => closeSheet();
  onMount?.(sh);
  return sh;
}
function closeSheet(now) {
  const root = $('#sheet-root'); if (!root.firstChild) return;
  if (now) { root.innerHTML = ''; return; }
  $('.scrim', root)?.classList.remove('on'); $('.sheet', root)?.classList.remove('on');
  setTimeout(() => { root.innerHTML = ''; }, 380);
}
const go = (h) => { if (location.hash === h) route(); else location.hash = h; };

// ---- widoki ----
const view = () => $('#view');
function paint(html, { tabs = true, fab = false } = {}) {
  const v = view(); v.className = S.animate ? 'enter' : ''; v.innerHTML = html;
  $('#tabbar').hidden = !tabs; $('#fab').hidden = !fab;
  S.animate = false;
}
const ringSvg = (cls) => `<svg width="52" height="52" viewBox="0 0 52 52" aria-hidden="true"><circle cx="26" cy="26" r="24" fill="none" stroke="rgba(255,255,255,.10)" stroke-width="3"/><circle class="rg ${cls}" cx="26" cy="26" r="24" fill="none" stroke-width="3" stroke-linecap="round" stroke-dasharray="151" transform="rotate(-90 26 26)"/></svg>`;

function msgRow(m, i) {
  const it = m.items.find((x) => x.status === 'new') || m.items[0];
  const chip = m.risk >= 2 ? `<span class="cp bad">${ic('shield', 'i14')}Podejrzana wiadomość</span>` : it ? `<span class="cp">${ic(KIND_ICON[it.kind], 'i14')}${esc(whenText(it))}</span>` : '';
  return `<button class="row gl ${m.unread ? 'unread' : ''}" style="--i:${i}" data-open="${m.id}" aria-label="${esc(m.from_name)}: ${esc(m.subject)}">
    <div class="av">${ringSvg('u-' + (m.risk >= 2 ? 'hi' : m.urgency))}<div class="a ${hue(m.from_addr)}">${esc(initials(m.from_name))}</div></div>
    <div class="rb"><div class="h"><span class="nm">${m.unread ? '<span class="ud"></span>' : ''}<span>${esc(m.from_name || m.from_addr)}</span></span><span class="tm mono">${fmtTime(m.date)}</span></div>
    <div class="sj">${esc(m.subject)}</div>${chip ? `<div class="chiprow">${chip}</div>` : `<div class="sn">${esc(m.snippet)}</div>`}</div></button>`;
}

function heroHtml(t) {
  const total = t.done + t.pending, frac = total ? t.done / total : 0, off = 289 - 289 * frac;
  const next = t.items.filter((i) => i.status === 'new').slice(0, 2);
  const sub = next.length ? `Najbliżej: ${next.map((i) => `${i.kind === 'parcel' ? 'paczka' : i.kind === 'deadline' ? 'płatność' : 'wydarzenie'} ${whenText(i).toLowerCase().replace('zapłać ', '')}`).join(', potem ')}.` : 'Nic pilnego. Możesz odetchnąć.';
  const n = t.pending, w = n === 1 ? 'sprawa czeka' : n >= 2 && n <= 4 ? 'sprawy czekają' : 'spraw czeka';
  const now = new Date();
  return `<section class="hero gl" style="--i:0"><div class="ringbox"><svg width="112" height="112" viewBox="0 0 112 112" aria-hidden="true"><defs><linearGradient id="gA" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6E8BFF"/><stop offset="1" stop-color="#3DD6F5"/></linearGradient></defs><circle cx="56" cy="56" r="46" fill="none" stroke="rgba(255,255,255,.09)" stroke-width="10"/><circle class="rf" cx="56" cy="56" r="46" fill="none" stroke="url(#gA)" stroke-width="10" stroke-linecap="round" stroke-dasharray="289" stroke-dashoffset="${off}" transform="rotate(-90 56 56)"/></svg><div class="c"><span class="n">${t.done}<small>/${total}</small></span><span style="font-size:11px;color:var(--ink2)">zrobione</span></div></div>
    <div style="display:flex;flex-direction:column;gap:6px;min-width:0"><span class="eyebrow mono">${WDL[now.getDay()]} · ${now.getDate()} ${MON[now.getMonth()].slice(0, 3)}</span><span class="t">${n ? `${n} ${w} na Ciebie` : 'Wszystko ogarnięte'}</span><span class="s">${esc(sub)}</span></div></section>`;
}

async function viewInbox() {
  let msgs, today;
  try {
    const q = new URLSearchParams({ tab: S.seg === 'msg' ? S.filter : 'all', limit: '60' }); if (S.account) q.set('account', S.account);
    [msgs, today] = await Promise.all([get('/api/messages?' + q), get('/api/today')]);
    cacheSet('inbox', { msgs, today }); S.offline = false;
  } catch (e) { if (e.status) throw e; const c = cacheGet('inbox'); if (!c) throw e; ({ msgs, today } = c); S.offline = true; }
  S.unread = msgs.unread; badge(); await loadAccounts(true);
  const pend = today.items.filter((i) => i.status === 'new');
  const ev = pend.filter((i) => i.kind !== 'deadline').length, dl = pend.length - ev;
  const accLabel = S.account ? (S.accounts.find((a) => a.id === S.account)?.label || 'Konto') : 'Wszystkie konta';
  const stackDots = S.accounts.slice(0, 3).map((a) => `<i class="${hue(a.email)}"></i>`).join('') || '<i class="g0"></i>';
  let body = '';
  if (!S.accounts.length) body = emptyNoAccount();
  else if (S.seg === 'cases') body = casesHtml(pend);
  else body = `<div class="chips" role="group" aria-label="Filtr">${[['all', 'Wszystko'], ['unread', 'Nieprzeczytane'], ['action', 'Do działania'], ['dates', 'Terminy']].map(([k, l]) => `<button class="chip" data-filter="${k}" aria-pressed="${S.filter === k}">${l}</button>`).join('')}</div>
    <div class="list">${msgs.messages.length ? msgs.messages.map(msgRow).join('') : `<div class="empty"><div class="big ser">Pusto</div>Brak wiadomości w tym widoku.</div>`}</div>`;
  const found = pend.length && S.seg === 'msg' ? `<button class="found" data-seg="cases" style="--i:2" aria-label="Przejrzyj wykryte sprawy"><span class="spin"></span><span class="in"><span class="ico">${ic('spark', 'i18')}</span><span class="tx">Poczta znalazła ${ev ? `${ev} ${ev === 1 ? 'wydarzenie' : ev < 5 ? 'wydarzenia' : 'wydarzeń'}` : ''}${ev && dl ? ' i ' : ''}${dl ? `${dl} ${dl === 1 ? 'termin' : 'terminy'}` : ''}<small>Dodaj do Kalendarza jednym dotknięciem</small></span>${ic('chev', 'i14')}</span></button>` : '';
  paint(`${S.offline ? '<div class="off">Tryb offline · dane z pamięci</div>' : ''}
    <div class="top"><button class="pill gl" data-act="accmenu" aria-label="Wybierz konto: ${esc(accLabel)}"><span class="stack">${stackDots}</span>${esc(accLabel)}${ic('down', 'i14')}</button><button class="round gl" data-go="#/search" aria-label="Szukaj">${ic('search')}</button></div>
    ${S.accounts.length ? heroHtml(today) : ''}
    ${S.accounts.length ? `<div class="seg gl"><button data-seg="msg" aria-pressed="${S.seg === 'msg'}">Wiadomości</button><button data-seg="cases" aria-pressed="${S.seg === 'cases'}">Sprawy<b>${pend.length}</b></button></div>` : ''}
    ${found}${body}`, { fab: !!S.accounts.length });
  nav('inbox');
}

function emptyNoAccount() {
  return `<div class="empty gl" style="border-radius:28px;margin-top:16px;padding:30px 20px"><div class="big ser">Dodaj pierwszą skrzynkę</div>Poczta działa z Gmailem, iCloud, Outlookiem, WP, Onetem, O2 i każdą skrzynką z IMAP.<div class="actions" style="justify-content:center"><button class="btn pri" data-go="#/accounts">${ic('plus', 'i18')}Dodaj konto</button></div></div>`;
}

function casesHtml(items) {
  if (!items.length) return `<div class="empty"><div class="big ser">Czysto</div>Brak nowych spraw. Poczta szuka terminów w każdej nowej wiadomości.</div>`;
  const groups = {};
  for (const it of items) { const d = dayDiff(parseLocal(it.starts_at), new Date()); const g = d <= 0 ? 'Dziś' : d === 1 ? 'Jutro' : d < 8 ? 'W tym tygodniu' : 'Później'; (groups[g] ||= []).push(it); }
  let i = 3;
  return ['Dziś', 'Jutro', 'W tym tygodniu', 'Później'].filter((g) => groups[g]).map((g) => `<div class="sec">${g}</div>${groups[g].map((it) => caseCard(it, i++)).join('')}`).join('');
}
function caseCard(it, i = 0) {
  return `<div class="card gl" style="--i:${i}"><div class="k mono">${ic(KIND_ICON[it.kind], 'i14')}${KIND_LABEL[it.kind]}</div><div class="ti">${esc(it.title)}</div><div class="wh">${esc(whenText(it))}</div>
  <div class="actions"><button class="btn pri grow" data-cal="${it.id}">${ic('cal', 'i18')}Dodaj do Kalendarza</button><button class="btn" data-open="${it.mid ?? it.message_id}" aria-label="Otwórz wiadomość">${ic('chev', 'i18')}</button><button class="btn" data-dismiss="${it.id}" aria-label="To nie jest sprawa">${ic('x', 'i18')}</button></div></div>`;
}

async function viewMessage(id) {
  const { message: m, items } = await get(`/api/messages/${id}`);
  if (m.unread) post(`/api/messages/${id}/read`).then(() => { S.unread = Math.max(0, S.unread - 1); badge(); }).catch(() => {});
  const risky = m.risk >= 2;
  const d = new Date(m.date);
  const linkify = (t) => esc(t).replace(/(https?:\/\/[^\s<]+)/g, (u) => { const h = u.replace(/&amp;/g, '&'); let host = ''; try { host = new URL(h).host; } catch { return u; } return `<a href="${esc(h)}" target="_blank" rel="noopener noreferrer nofollow" title="${esc(host)}">${esc(host)}${esc(h.length > host.length + 8 ? '/…' : '')}</a>`; });
  paint(`<div class="thread-h"><button class="back" data-go="#/" aria-label="Wróć do skrzynki">${ic('back')}Skrzynka</button><button class="round gl" data-reply="${m.id}" aria-label="Odpowiedz">${ic('send')}</button></div>
    <h1 class="subject">${esc(m.subject)}</h1>
    <div class="meta"><div class="a ${hue(m.from_addr)}">${esc(initials(m.from_name))}</div><div class="w"><div class="n">${esc(m.from_name || m.from_addr)}</div><div class="d mono">${esc(m.from_addr)} · ${d.getDate()}.${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}</div></div></div>
    ${risky ? `<div class="risk"><h3>${ic('shield')}Prawdopodobne oszustwo</h3><ul>${m.risk_reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul><div class="actions"><button class="btn warn grow" data-act="back">Wróć do skrzynki</button><button class="btn" data-act="reveal">Pokaż mimo to</button></div></div>` : ''}
    ${items.filter((i) => i.status !== 'dismissed').map((it, k) => `<div class="card gl" style="--i:${k + 1}"><div class="k mono">${ic('spark', 'i14')}Wykryto · ${KIND_LABEL[it.kind]}${it.status === 'added' ? ' · dodane' : ''}</div><div class="ti">${esc(it.title)}</div><div class="wh">${esc(whenText(it))}</div>${it.evidence ? `<div class="ev">„${esc(it.evidence)}"</div>` : ''}<div class="actions">${it.status === 'added' ? `<button class="btn grow" data-cal="${it.id}">${ic('check', 'i18')}Dodane · pokaż ponownie</button>` : `<button class="btn pri grow" data-cal="${it.id}">${ic('cal', 'i18')}Dodaj do Kalendarza</button><button class="btn" data-dismiss="${it.id}" aria-label="To nie jest sprawa">${ic('x', 'i18')}</button>`}</div></div>`).join('')}
    <div class="body ${risky ? 'dim' : ''}" id="body">${linkify(m.body)}</div>`, { tabs: false });
  S.cur = { m, items };
}

async function viewToday() {
  const t = await get('/api/today'); S.unread = t.unread; badge();
  const now = new Date(), h = now.getHours(), hello = h < 5 ? 'Dobranoc' : h < 12 ? 'Dzień dobry' : h < 18 ? 'Miłego popołudnia' : 'Dobry wieczór';
  const groups = {};
  for (const it of t.items) { const d = dayDiff(parseLocal(it.starts_at), now); const g = d <= 0 ? 'Dziś' : d === 1 ? 'Jutro' : d < 8 ? 'W tym tygodniu' : 'Później'; (groups[g] ||= []).push(it); }
  let i = 2;
  paint(`<div class="top"><span class="eyebrow mono" style="padding-left:8px">${WDL[now.getDay()]} · ${now.getDate()} ${MON[now.getMonth()]}</span></div>
    <h1 class="ser" style="margin:14px 8px 4px;font-size:52px;line-height:52px;letter-spacing:-.025em">${hello}.</h1>
    <p style="margin:0 8px 6px;color:var(--ink2);font-size:16px;line-height:23px">${t.unread ? `<b style="color:var(--ink)">${t.unread}</b> nieprzeczytanych, ` : ''}${t.pending ? `<b style="color:var(--ink)">${t.pending}</b> spraw do ogarnięcia.` : 'żadnych spraw na horyzoncie.'}</p>
    ${heroHtml(t)}
    ${['Dziś', 'Jutro', 'W tym tygodniu', 'Później'].filter((g) => groups[g]).map((g) => `<div class="sec">${g}</div>${groups[g].map((it) => caseCard(it, i++)).join('')}`).join('') || '<div class="empty"><div class="big ser">Spokojny dzień</div>Nic nie wymaga uwagi.</div>'}`, { fab: true });
  nav('today');
}

async function viewSearch() {
  paint(`<div class="top"><span class="eyebrow mono" style="padding-left:8px">Szukaj</span></div><label class="srch gl">${ic('search', 'i18')}<input id="q" type="search" enterkeyhint="search" autocomplete="off" autocapitalize="off" placeholder="np. faktura, kardiolog, Marta" aria-label="Szukaj w poczcie"></label><div class="list" id="res"><div class="empty"><div class="big ser">Wpisz coś</div>Szukam w tematach, nadawcach i treści. Działa bez polskich znaków.</div></div>`);
  nav('search');
  const q = $('#q'); let t, seq = 0;
  q.oninput = () => { clearTimeout(t); t = setTimeout(async () => {
    const my = ++seq, v = q.value.trim(); if (v.length < 2) return;
    const r = await get('/api/search?q=' + encodeURIComponent(v)).catch(() => null); if (!r || my !== seq) return;
    $('#res').innerHTML = r.messages.length ? r.messages.map(msgRow).join('') : `<div class="empty"><div class="big ser">Nic nie znaleziono</div>Spróbuj innego słowa.</div>`;
  }, 180); };
  q.focus();
}

async function viewAccounts() {
  await loadAccounts();
  paint(`<div class="top"><span class="eyebrow mono" style="padding-left:8px">Konta i prywatność</span></div>
    ${S.accounts.map((a) => `<div class="acc gl"><span class="dot ${a.status === 'error' ? 'er' : ''}"></span><div class="w"><div class="n">${esc(a.label)}</div><div class="s">${esc(a.email)} · ${a.count} wiad. · ${a.status === 'error' ? esc(a.last_error || 'błąd') : ago(a.last_sync)}</div></div><button class="round gl" data-sync="${a.id}" aria-label="Synchronizuj ${esc(a.label)}">${ic('refresh', 'i18')}</button><button class="round gl" data-rm="${a.id}" aria-label="Usuń konto ${esc(a.label)}">${ic('trash', 'i18')}</button></div>`).join('') || '<div class="empty">Nie masz jeszcze żadnej skrzynki.</div>'}
    <div class="actions" style="margin-top:14px"><button class="btn pri grow" data-act="addacc">${ic('plus', 'i18')}Dodaj skrzynkę</button>${S.demoAllowed && !S.accounts.some((a) => a.provider === 'demo') ? '<button class="btn" data-act="demo">Tryb demo</button>' : ''}</div>
    <div class="sec">Prywatność</div><div class="card gl" style="margin-top:6px"><div class="k mono" style="color:var(--ok)">${ic('shield', 'i14')}Twoje dane zostają u Ciebie</div><div class="wh" style="line-height:21px;margin-top:8px">Wiadomości i hasła aplikacji leżą na Twoim serwerze (hasła zaszyfrowane AES-256). Fonty i skrypty są lokalne, bez śledzenia. Wykrywanie terminów działa na serwerze, bez wysyłania treści do żadnej firmy.</div></div>
    <div class="sec">Konto</div><div class="card gl" style="margin-top:6px"><div class="kv"><span>Zalogowano jako</span><span>${esc(S.user.email)}</span></div><div class="actions"><button class="btn warn grow" data-act="logout">Wyloguj</button></div></div>`);
  nav('accounts');
}

function viewAuth() {
  const setup = S.setupNeeded;
  paint(`<div class="auth"><h1 class="ser">${setup ? 'Witaj w <i>Poczcie</i>' : 'Poczta'}</h1><p style="color:var(--ink2);margin:0 0 18px;font-size:16px;line-height:23px">${setup ? 'Załóż konto właściciela. To hasło chroni dostęp do Twojej poczty.' : 'Zaloguj się, aby wejść do skrzynki.'}</p>
  <form id="auth" class="gl" style="border-radius:28px;padding:8px 18px 18px"><div class="fld"><label for="e">E-mail</label><input class="in" id="e" type="email" autocomplete="username" required autocapitalize="off"></div><div class="fld"><label for="p">Hasło${setup ? ' (min. 10 znaków)' : ''}</label><input class="in" id="p" type="password" autocomplete="${setup ? 'new-password' : 'current-password'}" required minlength="${setup ? 10 : 1}"></div>${setup ? '<div class="fld"><label for="c">Kod instalacji</label><input class="in" id="c" autocomplete="off" placeholder="z instalatora serwera"></div>' : ''}<div class="err" id="err" role="alert"></div><button class="btn pri" style="width:100%;margin-top:14px" type="submit">${setup ? 'Utwórz konto' : 'Zaloguj'}</button></form></div>`, { tabs: false });
  $('#auth').onsubmit = async (ev) => {
    ev.preventDefault(); const b = ev.submitter; b.disabled = true;
    try { const r = await post(setup ? '/api/setup' : '/api/login', { email: $('#e').value, password: $('#p').value, code: $('#c')?.value }); S.user = r.user; S.animate = true; go('#/'); }
    catch (e) { $('#err').textContent = e.message; b.disabled = false; }
  };
}

// ---- arkusze ----
function calSheet(it) {
  const link = it.link;
  sheet(`<h2>Dodać do Kalendarza?</h2><p class="sub">Nic nie zostanie dodane, dopóki nie potwierdzisz w Kalendarzu.</p>
    <div class="kv"><span>${KIND_LABEL[it.kind]}</span><span>${esc(it.title)}</span></div><div class="kv"><span>Kiedy</span><span>${esc(whenText(it))}</span></div>${it.location ? `<div class="kv"><span>Gdzie</span><span>${esc(it.location)}</span></div>` : ''}${it.evidence ? `<div class="note">Znalezione w: „${esc(it.evidence)}"</div>` : ''}
    <div class="actions" style="flex-direction:column"><a class="btn pri" style="text-decoration:none" href="${esc(link)}" target="_blank" rel="noopener" data-done="${it.id}">${ic('cal', 'i18')}Otwórz w moim Kalendarzu</a><a class="btn" style="text-decoration:none" href="api/items/${it.id}/ics" data-done="${it.id}">Plik .ics (kalendarz iPhone)</a><button class="btn" data-act="close">Anuluj</button></div>`);
}
function accMenu() {
  sheet(`<h2>Konta</h2><div class="actions" style="flex-direction:column"><button class="btn ${S.account ? '' : 'pri'}" data-pick="0">Wszystkie konta</button>${S.accounts.map((a) => `<button class="btn ${S.account === a.id ? 'pri' : ''}" data-pick="${a.id}">${esc(a.label)} · ${esc(a.email)}</button>`).join('')}</div>`);
}
async function addAccSheet() {
  sheet(`<h2>Dodaj skrzynkę</h2><p class="sub">Działa z Gmailem, iCloud, Outlookiem, WP, Onetem, O2 i każdą pocztą IMAP.</p>
    <form id="af"><div class="fld"><label for="ae">E-mail</label><input class="in" id="ae" type="email" required autocapitalize="off" autocomplete="off"></div><div class="note" id="pn"></div>
    <div class="fld"><label for="ap">Hasło (Gmail i iCloud: hasło aplikacji)</label><input class="in" id="ap" type="password" required autocomplete="off"></div>
    <details style="margin-top:12px"><summary style="color:var(--acc2);font-size:14px;cursor:pointer">Ustawienia serwera (opcjonalnie)</summary><div class="fld"><label>Serwer IMAP</label><input class="in" id="ih" placeholder="imap.example.com"></div><div class="fld"><label>Port IMAP</label><input class="in" id="ip" inputmode="numeric" placeholder="993"></div><div class="fld"><label>Serwer SMTP</label><input class="in" id="sh" placeholder="smtp.example.com"></div><div class="fld"><label>Port SMTP</label><input class="in" id="sp" inputmode="numeric" placeholder="465"></div></details>
    <div class="err" id="err" role="alert"></div><button class="btn pri" style="width:100%;margin-top:14px" type="submit">Połącz</button></form>`, (sh) => {
    let t; $('#ae', sh).oninput = (e) => { clearTimeout(t); t = setTimeout(async () => { const r = await get('/api/presets?email=' + encodeURIComponent(e.target.value)).catch(() => null); $('#pn', sh).textContent = r?.preset ? `${r.preset.name}: ${r.preset.note || 'ustawienia serwera uzupełnione automatycznie.'}` : ''; }, 250); };
    $('#af', sh).onsubmit = async (ev) => {
      ev.preventDefault(); const b = ev.submitter; b.disabled = true; b.textContent = 'Łączę…'; $('#err', sh).textContent = '';
      try { await post('/api/accounts', { email: $('#ae', sh).value.trim(), password: $('#ap', sh).value, imapHost: $('#ih', sh).value.trim() || undefined, imapPort: $('#ip', sh).value || undefined, smtpHost: $('#sh', sh).value.trim() || undefined, smtpPort: $('#sp', sh).value || undefined }); closeSheet(); toast('Konto połączone. Pobieram wiadomości…'); S.animate = true; go('#/'); setTimeout(route, 4000); }
      catch (e) { $('#err', sh).textContent = e.message; b.disabled = false; b.textContent = 'Połącz'; }
    };
  });
}
function composeSheet(reply) {
  const accs = S.accounts.filter((a) => true);
  const m = reply?.m;
  const quoted = m ? `\n\n\nW dniu ${new Date(m.date).toLocaleDateString('pl-PL')} ${m.from_name || m.from_addr} napisał(a):\n${m.body.split('\n').slice(0, 30).map((l) => '> ' + l).join('\n')}` : '';
  sheet(`<h2>${m ? 'Odpowiedz' : 'Nowa wiadomość'}</h2><form id="cf"><div class="fld"><label for="cfr">Z konta</label><select class="in" id="cfr">${accs.map((a) => `<option value="${a.id}" ${m && m.account_id === a.id ? 'selected' : ''}>${esc(a.email)}</option>`).join('')}</select></div>
    <div class="fld"><label for="cto">Do</label><input class="in" id="cto" type="email" multiple required autocapitalize="off" value="${esc(m ? m.from_addr : '')}"></div><div class="fld"><label for="csu">Temat</label><input class="in" id="csu" value="${esc(m ? (/^re:/i.test(m.subject) ? m.subject : 'Re: ' + m.subject) : '')}"></div>
    <div class="fld"><label for="ctx">Treść</label><textarea class="in" id="ctx" required>${esc(quoted)}</textarea></div><div class="err" id="err" role="alert"></div><button class="btn pri" style="width:100%;margin-top:14px" type="submit">${ic('send', 'i18')}Wyślij</button></form>`, (sh) => {
    const ta = $('#ctx', sh); ta.setSelectionRange(0, 0); setTimeout(() => ta.focus(), 450);
    $('#cf', sh).onsubmit = async (ev) => {
      ev.preventDefault(); const b = ev.submitter; b.disabled = true; $('#err', sh).textContent = '';
      try { await post('/api/send', { account_id: +$('#cfr', sh).value, to: $('#cto', sh).value, subject: $('#csu', sh).value, text: ta.value, in_reply_to: m?.message_id }); closeSheet(); toast('Wysłano'); }
      catch (e) { $('#err', sh).textContent = e.message; b.disabled = false; }
    };
  });
}

// ---- nawigacja, zdarzenia ----
function nav(cur) { document.querySelectorAll('.tab').forEach((t) => t.toggleAttribute('aria-current', false) || (t.dataset.tab === cur && t.setAttribute('aria-current', 'page'))); const bd = $('#bd-inbox'); bd.textContent = S.unread > 99 ? '99+' : S.unread; bd.hidden = !S.unread; }
function badge() { try { S.unread ? navigator.setAppBadge?.(S.unread) : navigator.clearAppBadge?.(); } catch { /* brak wsparcia */ } }
async function loadAccounts(quiet) { try { S.accounts = (await get('/api/accounts')).accounts; } catch (e) { if (!quiet) throw e; } }

let routing = 0;
async function route() {
  const my = ++routing; const h = location.hash || '#/';
  if (!S.user) { if (h !== '#/login') { history.replaceState(null, '', '#/login'); } return viewAuth(); }
  try {
    const mm = h.match(/^#\/m\/(\d+)/);
    if (mm) await viewMessage(+mm[1]); else if (h === '#/today') await viewToday(); else if (h === '#/search') await viewSearch(); else if (h === '#/accounts') await viewAccounts(); else if (h === '#/login') go('#/'); else await viewInbox();
  } catch (e) { if (my === routing && e.status !== 401) paint(`<div class="empty"><div class="big ser">Coś poszło nie tak</div>${esc(e.message)}<div class="actions" style="justify-content:center"><button class="btn" data-act="retry">Spróbuj ponownie</button></div></div>`); }
  view().scrollTo?.(0, 0);
}
window.addEventListener('hashchange', () => { S.animate = true; closeSheet(true); route(); });

document.addEventListener('click', async (ev) => {
  const el = ev.target.closest('[data-open],[data-go],[data-seg],[data-filter],[data-cal],[data-dismiss],[data-act],[data-sync],[data-rm],[data-pick],[data-reply],[data-done],[data-tab]');
  if (!el) return; const d = el.dataset;
  try {
    if (d.open) go(`#/m/${d.open}`);
    else if (d.go) go(d.go);
    else if (d.tab) go(d.tab === 'inbox' ? '#/' : `#/${d.tab}`);
    else if (d.seg) { S.seg = d.seg; S.animate = false; route(); }
    else if (d.filter) { S.filter = d.filter; route(); }
    else if (d.cal) { const it = await findItem(+d.cal); calSheet(it); }
    else if (d.done) { post(`/api/items/${d.done}`, { status: 'added' }).then(() => setTimeout(route, 600)); closeSheet(); }
    else if (d.dismiss) { await post(`/api/items/${d.dismiss}`, { status: 'dismissed' }); toast('Pominięto'); route(); }
    else if (d.reply) composeSheet(S.cur);
    else if (d.sync) { el.disabled = true; toast('Synchronizuję…'); await post(`/api/accounts/${d.sync}/sync`); toast('Gotowe'); route(); }
    else if (d.rm) { if (confirm('Usunąć to konto i pobrane z niego wiadomości z Poczty? Skrzynka u dostawcy zostaje nietknięta.')) { await api('DELETE', `/api/accounts/${d.rm}`); route(); } }
    else if (d.pick !== undefined) { S.account = +d.pick; closeSheet(); route(); }
    else if (d.act === 'accmenu') accMenu();
    else if (d.act === 'addacc') addAccSheet();
    else if (d.act === 'demo') { await post('/api/accounts/demo'); toast('Dodano konto demo'); route(); }
    else if (d.act === 'logout') { await post('/api/logout'); S.user = null; location.hash = '#/login'; route(); }
    else if (d.act === 'close') closeSheet();
    else if (d.act === 'back') go('#/');
    else if (d.act === 'reveal') { $('#body')?.classList.remove('dim'); el.closest('.risk').remove(); }
    else if (d.act === 'retry') route();
  } catch (e) { toast(e.message || 'Błąd'); el.disabled = false; }
});
$('#fab').onclick = () => composeSheet();
async function findItem(id) {
  const loc = S.cur?.items.find((i) => i.id === id); if (loc) return loc;
  const r = await get('/api/today'); return r.items.find((i) => i.id === id) || (await get('/api/items?status=new')).items.find((i) => i.id === id);
}

// ---- start ----
async function boot() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  try { const s = await get('/api/state'); S.user = s.user; S.setupNeeded = s.setupNeeded; S.demoAllowed = s.demoAllowed; }
  catch { S.user = cacheGet('inbox') ? { email: 'offline' } : null; S.offline = true; }
  route();
  if (S.user && 'EventSource' in window) {
    const es = new EventSource('api/events');
    es.addEventListener('sync', (e) => { const d = JSON.parse(e.data); toast(`Nowe wiadomości: ${d.added}`); if (/^(#\/?|#\/today)?$/.test(location.hash)) { S.animate = false; route(); } });
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.user && /^(#\/?|#\/today)?$/.test(location.hash) && !$('#sheet-root').firstChild) { S.animate = false; route(); } });
}
boot();
