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
  more: '<circle cx="6" cy="12" r="1.600"/><circle cx="12" cy="12" r="1.600"/><circle cx="18" cy="12" r="1.600"/>', ban: '<circle cx="12" cy="12" r="8.500"/><path d="m6 6 12 12"/>', tag: '<path d="M3.500 12.500V5.500a2 2 0 0 1 2-2h7l8 8-8.500 8.500zM8 8h.01"/>', inbox2: '<path d="M4 13.500 6.500 5h11L20 13.500V18a1.500 1.500 0 0 1-1.500 1.500h-13A1.500 1.500 0 0 1 4 18zM4 13.500h4.500l1 2h5l1-2H20"/>',
  clock: '<circle cx="12" cy="12" r="8.500"/><path d="M12 7.500V12l3 2"/>', wallet: '<path d="M4 8.500A2.500 2.500 0 0 1 6.500 6H18v3M4 8.500V17a2 2 0 0 0 2 2h12a1 1 0 0 0 1-1V9H6.500A2.500 2.500 0 0 1 4 8.500zM15.500 14h1.500"/>',
  bell: '<path d="M6 17.500V11a6 6 0 0 1 12 0v6.500l1.500 1.500h-15zM10 21h4"/>', bellOff: '<path d="M6 17.500V11a6 6 0 0 1 9-5.200M18 11v6.500l1.500 1.500h-15M10 21h4M4 4l16 16"/>',
  star: '<path d="m12 3.800 2.600 5.300 5.800.800-4.200 4.100 1 5.800L12 17.100 6.800 19.800l1-5.800-4.200-4.100 5.800-.800z"/>',
  clip: '<path d="m19 11.500-7.200 7.200a4.500 4.500 0 0 1-6.400-6.400l8-8a3 3 0 0 1 4.200 4.200l-8 8a1.500 1.500 0 0 1-2.100-2.100l7-7"/>', file: '<path d="M7 3.500h6.500L18.500 8.500v11a1 1 0 0 1-1 1h-10.500a1 1 0 0 1-1-1v-15a1 1 0 0 1 1-1z"/><path d="M13.500 3.500v5h5"/>',
  book: '<rect class="f" x="5" y="3.500" width="14" height="17" rx="2.500"/><rect x="5" y="3.500" width="14" height="17" rx="2.500"/><circle cx="12" cy="10" r="2.200"/><path d="M8.500 16.500c.5-1.800 1.900-2.700 3.500-2.700s3 .9 3.500 2.700M3 8h2M3 12h2M3 16h2"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.500-4M4 4v3.500h3.500M4 13a8 8 0 0 0 14.500 4M20 20v-3.500h-3.500"/>', trash: '<path d="M4.500 7h15M9.500 7V4.500h5V7M6.500 7l.8 12a2 2 0 0 0 2 1.900h5.400a2 2 0 0 0 2-1.900L17.500 7"/>',
};
const ic = (n, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true">${P[n]}</svg>`;
const KIND_ICON = { event: 'cal', deadline: 'coin', parcel: 'box' };
const KIND_LABEL = { event: 'Wydarzenie', deadline: 'Termin płatności', parcel: 'Przesyłka' };

// ---- API ----
// cienki pasek postępu u góry, widoczny tylko gdy żądanie trwa dłużej niż 250 ms
let inflight = 0, progT = 0;
const progress = (d) => {
  inflight += d; const el = document.getElementById('prog'); if (!el) return;
  clearTimeout(progT);
  if (inflight > 0) progT = setTimeout(() => el.classList.add('on'), 250); else el.classList.remove('on');
};
async function api(method, url, body) {
  progress(1);
  try { return await api0(method, url, body); } finally { progress(-1); }
}
async function api0(method, url, body) {
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
const initials = (n) => String(n || '?').split(/[\s@.]+/).map((x) => x.replace(/^[^\p{L}\p{N}]+/u, '')).filter(Boolean).slice(0, 2).map((x) => x[0].toUpperCase()).join('') || '?';
const hue = (s) => 'g' + ([...String(s)].reduce((a, c) => a + c.charCodeAt(0), 0) % 5);
const ago = (ts) => { if (!ts) return 'jeszcze nie synchronizowano'; const m = Math.round((Date.now() - ts) / 60000); return m < 1 ? 'przed chwilą' : m < 60 ? `${m} min temu` : m < 1440 ? `${Math.round(m / 60)} godz. temu` : `${Math.round(m / 1440)} dni temu`; };

// ---- UI pomocnicze ----
let toastT;
function toast(msg, action, ms) {
  const t = $('#toast'); t.textContent = msg; t.classList.toggle('act', !!action);
  if (action) { const b = document.createElement('button'); b.type = 'button'; b.className = 'tact'; b.textContent = action.label; b.onclick = async () => { t.classList.remove('on'); try { await action.fn(); } catch (e) { toast(e.message || 'Błąd'); } }; t.appendChild(b); }
  t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), ms || (action ? 9000 : 2800));
}
function sheet(html, onMount) {
  closeSheet(true);
  const root = $('#sheet-root');
  root.innerHTML = `<div class="scrim"></div><div class="sheet" role="dialog" aria-modal="true"><div class="grab"></div><button class="sx" type="button" aria-label="Zamknij">${ic('x', 'i18')}</button>${html}</div>`;
  const sc = $('.scrim', root), sh = $('.sheet', root);
  requestAnimationFrame(() => { sc.classList.add('on'); sh.classList.add('on'); });
  sc.onclick = () => requestClose();
  $('.sx', sh).onclick = () => requestClose();
  dragClose(sh, sc);
  onMount?.(sh);
  return sh;
}
// zamknięcie "z pytaniem": okno może mieć strażnika (np. kompozytor z niezapisaną treścią)
function requestClose() { if (S.sheetGuard && !S.sheetGuard()) return; closeSheet(); }
// przeciągnięcie okna w dół (od uchwytu, nagłówka albo z góry listy) zamyka je
function dragClose(sh, sc) {
  let y0 = 0, dy = 0, t0 = 0, on = false, ok = false;
  const isCtl = (el) => el.closest('input,textarea,select,button:not(.sx),a,label,[contenteditable]');
  sh.addEventListener('touchstart', (e) => {
    const t = e.touches[0]; y0 = t.clientY; dy = 0; t0 = Date.now(); on = false;
    ok = e.target.closest('.grab,.sx,h2') || (sh.scrollTop <= 0 && !isCtl(e.target));
  }, { passive: true });
  sh.addEventListener('touchmove', (e) => {
    if (!ok) return;
    dy = e.touches[0].clientY - y0;
    if (!on && dy > 8 && sh.scrollTop <= 0) { on = true; sh.style.transition = 'none'; }
    if (on) { e.preventDefault(); const d = Math.max(0, dy); sh.style.transform = `translate(-50%,${d}px)`; sc.style.opacity = String(Math.max(0, 1 - d / 500)); }
  }, { passive: false });
  const end = () => {
    if (!on) return; on = false; sh.style.transition = '';
    const v = dy / Math.max(1, Date.now() - t0);
    if (dy > 110 || v > 0.6) { sh.style.transform = ''; sc.style.opacity = ''; requestClose(); }
    else { sh.style.transform = ''; sc.style.opacity = ''; }
  };
  sh.addEventListener('touchend', end); sh.addEventListener('touchcancel', end);
}
function closeSheet(now) {
  const root = $('#sheet-root'); S.sheetGuard = null; if (!root.firstChild) return;
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

// znacznik skrzynki przy wiadomości (tylko gdy skrzynek jest więcej i nie filtrujemy po jednej)
function accTag(m) {
  if ((S.accounts || []).length < 2 || S.account) return '';
  const i = S.accounts.findIndex((a) => a.id === m.account_id); if (i < 0) return '';
  return `<div class="at mono"><span class="ad g${i % 5}"></span>${esc(S.accounts[i].label || S.accounts[i].email)}</div>`;
}
function msgRow(m, i) {
  const it = m.items.find((x) => x.status === 'new') || m.items[0];
  const snz = m.snoozed_until > Date.now() ? `<span class="cp snz">${ic('clock', 'i14')}Wraca ${esc(snzLabel(new Date(m.snoozed_until)))}</span>` : '';
  const why = !snz && m.cat && m.cat !== 'inbox' && m.cat_why && m.risk < 2 ? `<span class="cp snz">${ic('tag', 'i14')}${esc(m.cat_why)}</span>` : '';
  const chip = snz || why || (m.risk >= 2 ? `<span class="cp bad">${ic('shield', 'i14')}Podejrzana wiadomość</span>` : it ? `<span class="cp">${ic(KIND_ICON[it.kind], 'i14')}${esc(whenText(it))}</span>` : '');
  return `<button class="row gl ${m.unread ? 'unread' : ''}" style="--i:${i}" data-open="${m.id}" aria-label="${esc(m.from_name)}: ${esc(m.subject)}">
    <div class="av">${ringSvg('u-' + (m.risk >= 2 ? 'hi' : m.urgency))}<div class="a ${hue(m.cat === 'sent' || m.cat === 'drafts' ? m.to_addr : m.from_addr)}">${esc(initials(m.cat === 'sent' || m.cat === 'drafts' ? (addrList(m.to_addr).map((a) => cn(a))[0] || m.to_addr) : dispName(m.from_addr, m.from_name)))}</div></div>
    <div class="rb"><div class="h"><span class="nm">${m.unread ? '<span class="ud"></span>' : ''}<span>${m.cat === 'sent' || m.cat === 'drafts' ? `${m.cat === 'drafts' ? 'Szkic · ' : ''}Do: ${esc(toNames(m.to_addr) || '(brak adresata)')}` : esc(dispName(m.from_addr, m.from_name))}</span></span><span class="tm mono">${m.starred ? ic('star', 'i14 stl') : ''}${m.has_attach ? ic('clip', 'i14 clp') : ''}${fmtTime(m.date)}</span></div>
    <div class="sj">${m.thread_n > 1 ? `<span class="thn mono">${m.thread_n}</span>` : ''}${esc(m.subject)}</div>${accTag(m)}${chip ? `<div class="chiprow">${chip}</div>` : ''}</div></button>`;
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
  let msgs, today, pay = null;
  try {
    const q = new URLSearchParams({ tab: S.seg === 'msg' ? S.filter : 'all', limit: '60' }); if (S.account) q.set('account', S.account);
    if (S.filter === 'other' && S.otherFolder) { q.set('folder', S.otherFolder.key); q.set('account', S.otherFolder.acc); }
    [msgs, today, pay] = await Promise.all([get('/api/messages?' + q), get('/api/today'), S.seg === 'pay' ? get('/api/obligations') : null]);
    cacheSet('inbox', { msgs, today }); S.offline = false;
  } catch (e) { if (e.status) throw e; const c = cacheGet('inbox'); if (!c) throw e; ({ msgs, today } = c); S.offline = true; }
  S.unread = msgs.unread; S.counts = msgs.counts || {}; badge(); await loadAccounts(true);
  const pend = today.items.filter((i) => i.status === 'new');
  const ev = pend.filter((i) => i.kind !== 'deadline').length, dl = pend.length - ev;
  const accLabel = S.account ? (S.accounts.find((a) => a.id === S.account)?.label || 'Konto') : 'Wszystkie konta';
  const stackDots = S.accounts.slice(0, 3).map((a) => `<i class="${hue(a.email)}"></i>`).join('') || '<i class="g0"></i>';
  let body = '';
  if (!S.accounts.length) body = emptyNoAccount();
  else if (S.seg === 'cases') body = casesHtml(pend);
  else if (S.seg === 'pay') body = pay ? payHtml(pay) : '<div class="empty">Płatności są dostępne online.</div>';
  else body = `<div class="chips" role="group" aria-label="Foldery i filtry">${chipsHtml(msgs.counts)}</div>
    ${bulkHtml(msgs)}<div class="list">${msgs.messages.length ? msgs.messages.map(msgRow).join('') : emptyFolderHtml()}</div>${moreHtml(msgs)}`;
  const found = pend.length && S.seg === 'msg' ? `<button class="found" data-seg="cases" style="--i:2" aria-label="Przejrzyj wykryte sprawy"><span class="spin"></span><span class="in"><span class="ico">${ic('spark', 'i18')}</span><span class="tx">Poczta znalazła ${ev ? `${ev} ${ev === 1 ? 'wydarzenie' : ev < 5 ? 'wydarzenia' : 'wydarzeń'}` : ''}${ev && dl ? ' i ' : ''}${dl ? `${dl} ${dl === 1 ? 'termin' : 'terminy'}` : ''}<small>Dodaj do Kalendarza jednym dotknięciem</small></span>${ic('chev', 'i14')}</span></button>` : '';
  paint(`${S.offline ? '<div class="off">Tryb offline · dane z pamięci</div>' : ''}
    <div class="top"><button class="pill gl" data-act="accmenu" aria-label="Wybierz konto: ${esc(accLabel)}"><span class="stack">${stackDots}</span>${esc(accLabel)}${ic('down', 'i14')}</button><button class="round gl" data-go="#/search" aria-label="Szukaj">${ic('search')}</button></div>
    ${S.accounts.length ? heroHtml(today) : ''}
    ${S.accounts.length ? `<div class="seg gl"><button data-seg="msg" aria-pressed="${S.seg === 'msg'}">Wiadomości</button><button data-seg="cases" aria-pressed="${S.seg === 'cases'}">Sprawy<b>${pend.length}</b></button><button data-seg="pay" aria-pressed="${S.seg === 'pay'}">Płatności</button></div>` : ''}
    ${S.seg === 'msg' && ['snoozed', 'offers', 'spam', 'trash', 'sent', 'drafts', 'archive', 'starred', 'other'].includes(S.filter) ? '' : found}${body}`, { fab: !!S.accounts.length });
  nav('inbox');
  S.oldest = msgs.messages.length ? Math.min(...msgs.messages.map((m) => m.date)) : 0;
  // wiadomości na górze listy pobieramy z góry, więc otwierają się natychmiast
  S.pre ||= new Map();
  (async () => { for (const m of msgs.messages.slice(0, 8)) { if (S.pre.has(m.id) || !location.hash.match(/^#\/?$/)) continue; try { S.pre.set(m.id, { t: Date.now(), r: await get(`/api/messages/${m.id}`) }); } catch {} } })();
  const ch = $('.chips .chip[aria-pressed=true]'); if (ch) ch.parentElement.scrollLeft = Math.max(0, ch.offsetLeft - 40);
}

const FOLDER_NAME = { offers: 'Oferty', spam: 'Spam', trash: 'Kosz', sent: 'Wysłane', drafts: 'Szkice', archive: 'Archiwum', starred: 'Oznaczone', other: 'Folder' };
function moreHtml(m) {
  if (!m.messages.length || S.filter === 'snoozed') return '';
  return `<div class="morew" id="morew"><button class="btn" data-act="more">${ic('down', 'i18')}Wczytaj starsze</button></div>`;
}
async function loadMore(btn) {
  const list = $('.list'); if (!list) return; btn.disabled = true; btn.lastChild.textContent = 'Wczytuję…';
  const q = new URLSearchParams({ tab: S.seg === 'msg' ? S.filter : 'all', limit: '60' }); if (S.account) q.set('account', S.account);
  if (S.filter === 'other' && S.otherFolder) { q.set('folder', S.otherFolder.key); q.set('account', S.otherFolder.acc); }
  const fetchPage = async (before) => { const p = new URLSearchParams(q); if (before) p.set('before', before); return get('/api/messages?' + p); };
  let r = await fetchPage(S.oldest);
  if (!r.messages.length && ['all', 'unread', 'offers', 'spam'].includes(S.filter)) { const h = await post('/api/history', { account_id: S.account || 0 }); if (h.added) r = await fetchPage(S.oldest); else if (!h.left) { toast('To wszystkie wiadomości'); btn.parentElement.remove(); return; } }
  if (!r.messages.length) { toast('To wszystkie wiadomości'); btn.parentElement.remove(); return; }
  list.insertAdjacentHTML('beforeend', r.messages.map((m, i) => msgRow(m, i)).join(''));
  S.oldest = Math.min(...r.messages.map((m) => m.date)); btn.disabled = false; btn.lastChild.textContent = 'Wczytaj starsze';
}
function chipsHtml(c = {}) {
  const k = (id, l, n, cls = '') => `<button class="chip ${cls}" data-filter="${id}" aria-pressed="${S.filter === id}">${l}${n ? `<b class="cn mono" id="cnt-${id}">${n}</b>` : ''}</button>`;
  return k('all', 'Skrzynka') + k('unread', 'Nieprzeczytane') + k('action', 'Do działania') + k('dates', 'Terminy') + k('offers', 'Oferty', c.offers) + k('spam', 'Spam', c.spam) + k('snoozed', 'Odłożone', c.snoozed) + (c.starred ? k('starred', 'Oznaczone', c.starred) : '') + k('sent', 'Wysłane') + (c.drafts ? k('drafts', 'Szkice', c.drafts) : '') + (c.archive ? k('archive', 'Archiwum', c.archive) : '') + (c.trash ? k('trash', 'Kosz', c.trash) : '') + (S.otherFolder ? k('other', esc(S.otherFolder.name)) : '') + ((S.accounts || []).some((a) => a.provider === 'imap') ? `<button class="chip" data-act="folders">Foldery…</button>` : '');
}
function bulkHtml(m) {
  const f = S.filter, n = (m.counts || {})[f];
  if (!['offers', 'spam', 'trash'].includes(f) || !m.messages.length) return '';
  const txt = { offers: 'Reklamy i newslettery. Nie powiadamiają i nie tworzą spraw.', spam: 'Wiadomości podejrzane i oznaczone przez Ciebie.', trash: 'Przechowywane 30 dni, potem znikają.' }[f];
  return `<div class="bulk gl"><div><div class="bt mono">${FOLDER_NAME[f]} · ${n}</div><div class="bs">${txt}</div></div><button class="btn warn" data-act="empty" data-cat="${f}">${ic('trash', 'i18')}${f === 'trash' ? 'Opróżnij' : 'Usuń wszystkie'}</button></div>`;
}
function emptyFolderHtml() {
  const f = S.filter;
  if (f === 'offers') return `<div class="empty"><div class="big ser">Brak ofert</div>Reklamy i newslettery trafiają tu same.</div>`;
  if (f === 'spam') return `<div class="empty"><div class="big ser">Czysto</div>Spam i podejrzane wiadomości trafiają tu same.</div>`;
  if (f === 'trash') return `<div class="empty"><div class="big ser">Kosz jest pusty</div></div>`;
  if (f === 'sent') return `<div class="empty"><div class="big ser">Brak wysłanych</div>Tu zobaczysz wiadomości wysłane z Twoich skrzynek.</div>`;
  if (f === 'drafts') return `<div class="empty"><div class="big ser">Brak szkiców</div></div>`;
  return `<div class="empty"><div class="big ser">Pusto</div>Brak wiadomości w tym widoku.</div>`;
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

const payRow = (it, i, overdue) => `<div class="card gl ${overdue ? 'od' : ''}" style="--i:${i}"><div class="k mono">${ic('coin', 'i14')}${overdue ? 'Po terminie' : 'Termin płatności'}</div><div class="ti">${esc(it.title.replace(/^Do zapłaty [^:]*:\s*/i, ''))}</div><div class="wh">${it.amount ? `<b class="amt">${esc(money(it))}</b> · ` : ''}${esc(whenText({ ...it, amount: null }).replace(/^Zapłać /, '').replace(/^dziś$/, 'dziś'))}</div>
  <div class="actions"><button class="btn pri grow" data-paid="${it.id}">${ic('check', 'i18')}Opłacone</button><button class="btn" data-cal="${it.id}" aria-label="Dodaj do Kalendarza">${ic('cal', 'i18')}</button><button class="btn" data-open="${it.mid}" aria-label="Otwórz wiadomość">${ic('chev', 'i18')}</button></div></div>`;
function payHtml(o) {
  if (!o.open.length && !o.paid.length) return `<div class="empty"><div class="big ser">Brak płatności</div>Gdy w mailu pojawi się faktura lub rachunek z terminem, zobaczysz go tutaj.</div>`;
  const today = new Date(); const ymd = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  const late = o.open.filter((i) => i.starts_at.slice(0, 10) < ymd), soon = o.open.filter((i) => i.starts_at.slice(0, 10) >= ymd && dayDiff(parseLocal(i.starts_at), today) < 8), later = o.open.filter((i) => dayDiff(parseLocal(i.starts_at), today) >= 8);
  const sum = (a) => a.reduce((t, i) => t + (i.amount || 0), 0), fmt = (n) => `${n.toLocaleString('pl-PL', { maximumFractionDigits: 2 })} zł`;
  let i = 1;
  const grp = (t, a, od) => a.length ? `<div class="sec">${t}${sum(a) ? ` · ${fmt(sum(a))}` : ''}</div>${a.map((x) => payRow(x, i++, od)).join('')}` : '';
  return `<section class="hero gl pay" style="--i:0"><div style="display:flex;flex-direction:column;gap:6px"><span class="eyebrow mono">Do zapłaty</span><span class="t">${o.total ? fmt(o.total) : '0 zł'}</span><span class="s">${o.open.length} ${o.open.length === 1 ? 'płatność' : 'płatności'}${o.overdue ? ` · <b style="color:var(--er)">po terminie: ${o.overdue}${o.overdue_total ? ` (${fmt(o.overdue_total)})` : ''}</b>` : ''}${o.unknown ? ` · ${o.unknown} bez kwoty` : ''}</span></div></section>
  ${grp('Po terminie', late, true)}${grp('W tym tygodniu', soon)}${grp('Później', later)}
  ${o.paid.length ? `<div class="sec">Opłacone w tym miesiącu · ${fmt(o.paid_total)}</div>${o.paid.map((x) => `<div class="kv paid"><span>${esc(x.title)}</span><span>${x.amount ? esc(money(x)) : ''} <button class="link" data-unpaid="${x.id}">cofnij</button></span></div>`).join('')}` : ''}`;
}

async function actMsgs(ids, action, scope) { return post('/api/messages/act', { ids, action, scope }); }
const freemail = /^(gmail\.com|wp\.pl|o2\.pl|onet\.pl|op\.pl|interia\.pl|poczta\.fm|icloud\.com|me\.com|outlook\.com|hotmail\.com|yahoo\.com|gmx\.(com|net)|proton\.me|protonmail\.com|live\.com|tlen\.pl)$/i;
function orgSheet(m) {
  const dom = String(m.from_addr || '').split('@')[1] || '';
  const row = (act, ico, t, sub, scope = '') => `<button class="org" data-orgact="${act}" data-orgid="${m.id}" ${scope ? `data-scope="${scope}"` : ''}><span class="oi">${ic(ico, 'i18')}</span><span><b>${t}</b><small>${sub}</small></span></button>`;
  sheet(`<div class="sheet-b"><h2 class="ser" style="font-size:28px;margin:6px 0 2px">Co zrobić z tym nadawcą?</h2><p style="color:var(--ink2);margin:0 0 8px;font-size:14px;word-break:break-all">${esc(m.from_name || '')} · ${esc(m.from_addr)}</p>
    ${row('delete', 'trash', 'Usuń', 'Tylko ta wiadomość. Możesz cofnąć.')}
    ${m.cat !== 'archive' && (m.folder || 'INBOX') === 'INBOX' ? row('archive', 'inbox2', 'Archiwizuj', 'Znika ze skrzynki, zostaje w Archiwum. Możesz cofnąć.') : ''}
    ${m.cat !== 'spam' ? row('spam', 'shield', 'To spam', 'Ta i każda kolejna od tego nadawcy trafi do Spamu.') : ''}
    ${m.cat !== 'offers' ? row('offers', 'tag', 'To oferta lub newsletter', 'Kolejne wiadomości trafią do Ofert, bez powiadomień.') : ''}
    ${m.cat !== 'inbox' ? row('inbox', 'inbox2', 'Zostaw w skrzynce', 'Ten nadawca będzie już zawsze w skrzynce.') : ''}
    ${row('block', 'ban', 'Zablokuj nadawcę', 'Nigdy więcej nie pokaże się w żadnej zakładce.')}
    ${dom && !freemail.test(dom) ? row('block', 'ban', `Zablokuj całą domenę @${esc(dom)}`, 'Wszystkie adresy tej firmy znikają na stałe.', 'domain') : ''}
    <div class="actions"><button class="btn grow" data-snooze="${m.id}" data-until="${m.snoozed_until || ''}">${ic('clock', 'i18')}Odłóż na później</button><button class="btn" data-act="close">Anuluj</button></div></div>`);
}
const ORG_MSG = { archive: 'Zarchiwizowano', unrule: 'Przywrócono', unarchive: 'Wróciło do skrzynki', star: 'Oznaczono', unstar: 'Usunięto oznaczenie', delete: 'Usunięto', spam: 'Przeniesiono do Spamu · nadawca już zawsze tam trafi', offers: 'Przeniesiono do Ofert', inbox: 'Wróciło do skrzynki', block: 'Nadawca zablokowany · nie pokaże się nigdzie' };
async function orgDo(ids, action, scope, { after } = {}) {
  const r = await actMsgs(ids, action, scope); closeSheet();
  const undo = action === 'delete' || action === 'archive' || action === 'spam' || action === 'offers' || action === 'block' ? { label: 'Cofnij', fn: async () => { await restoreMsgs(r.ids, action); toast('Przywrócono'); route(); } } : null;
  toast(`${ORG_MSG[action]}${r.count > 1 ? ` (${r.count})` : ''}`, undo);
  return r;
}
// Cofnięcie: usunięte wracają z kosza, spam/oferty/blokada wracają do skrzynki razem z usunięciem reguły
async function restoreMsgs(ids, action) {
  if (action === 'delete') return actMsgs(ids, 'restore');
  if (action === 'archive') return actMsgs(ids, 'unarchive');
  const r = await actMsgs(ids, 'unrule'); // usuwa regułę nadawcy i oddaje wiadomości do skrzynki
  return r;
}

function snoozeOpts() {
  const n = new Date(), at = (d, h) => { const x = new Date(d); x.setHours(h, 0, 0, 0); return x; }, plus = (d) => { const x = new Date(n); x.setDate(x.getDate() + d); return x; };
  const o = [];
  if (n.getHours() < 17) o.push(['Dziś wieczorem', at(n, 18)]);
  o.push(['Jutro rano', at(plus(1), 8)]);
  const dow = n.getDay(); if (dow >= 1 && dow <= 5) o.push(['W weekend', at(plus(6 - dow), 9)]);
  o.push(['Za tydzień', at(plus(7), 8)]);
  return o;
}
const snzLabel = (d) => `${dayDiff(d, new Date()) === 0 ? 'dziś' : dayDiff(d, new Date()) === 1 ? 'jutro' : `${WD[d.getDay()]} ${d.getDate()}.${pad(d.getMonth() + 1)}`} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
function snoozeSheet(id, current) {
  S.snoozeId = +id;
  const soon = new Date(Date.now() + 3600e3); const val = `${soon.getFullYear()}-${pad(soon.getMonth() + 1)}-${pad(soon.getDate())}T${pad(soon.getHours())}:00`;
  sheet(`<div class="sheet-b"><h2 class="ser" style="font-size:30px;margin:6px 0 4px">Odłóż na później</h2><p style="color:var(--ink2);margin:0 0 10px;font-size:14.5px">Wiadomość zniknie ze skrzynki i wróci jako nowa, z powiadomieniem.${current ? ` Teraz wraca ${esc(snzLabel(new Date(current)))}.` : ''}</p>
    ${snoozeOpts().map(([l, d]) => `<button class="btn snz" data-snz="${d.getTime()}"><span>${l}</span><small class="mono">${esc(snzLabel(d))}</small></button>`).join('')}
    <div class="fld"><label for="snzc">Własny termin</label><input class="in" id="snzc" type="datetime-local" value="${val}"></div>
    <div class="actions"><button class="btn pri grow" data-act="snzcustom">${ic('clock', 'i18')}Odłóż</button>${current ? '<button class="btn" data-snz="now">Wróć teraz</button>' : ''}<button class="btn" data-act="close">Anuluj</button></div></div>`);
}
async function doSnooze(until) {
  await post(`/api/messages/${S.snoozeId}/snooze`, { until });
  closeSheet(); toast(until ? 'Odłożone · wróci ' + snzLabel(new Date(until)) : 'Wiadomość wróciła');
  if (/^#\/m\//.test(location.hash)) go('#/'); else route();
}

// Ramka z oryginalnym HTML: piaskownica bez skryptów, wysokość dopasowana do treści, szerokie maile zmniejszone do ekranu.
function mountFrame(doc) {
  const f = $('#mf'); if (!f) return;
  let last = '', raf = 0;
  const fit = () => {
    const d = f.contentDocument; if (!d || !d.documentElement) return;
    const de = d.documentElement, w = f.clientWidth || 360;
    de.style.zoom = '';
    const sw = Math.max(de.scrollWidth, d.body ? d.body.scrollWidth : 0);
    if (sw > w + 2) de.style.zoom = (w / sw).toFixed(4);
    const h = Math.ceil(Math.max(de.scrollHeight, d.body ? d.body.scrollHeight : 0, de.getBoundingClientRect().height)) + 2;
    const key = `${w}x${h}x${de.style.zoom}`; if (key === last) return; last = key; f.style.height = h + 'px';
  };
  const later = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(fit); };
  const reveal = () => { if (!f.isConnected) return; fit(); $('#body')?.classList.remove('pend'); $('#ptext')?.remove(); $('#ldg')?.remove(); };
  f.onload = () => { hookFrameMail(f.contentDocument); fit(); const imgs = [...f.contentDocument.images].filter((i) => !i.complete); Promise.race([Promise.all(imgs.map((i) => new Promise((r) => { i.onload = i.onerror = r; }))), new Promise((r) => setTimeout(r, 700))]).then(reveal); try { new ResizeObserver(later).observe(f.contentDocument.body); } catch { /* starsze przeglądarki */ } f.contentDocument.addEventListener('load', later, true); setTimeout(fit, 600); setTimeout(fit, 2000); };
  f.srcdoc = doc;
  window.addEventListener('resize', later, { passive: true });
}

async function viewMessage(id) {
  const pre = S.pre?.get(+id); S.pre?.delete(+id);
  const { message: m, items } = pre && Date.now() - pre.t < 120000 && S.forceImg !== +id ? pre.r : await get(`/api/messages/${id}${S.forceImg === +id ? '?images=1' : ''}`);
  if (m.unread) post(`/api/messages/${id}/read`).then(() => { S.unread = Math.max(0, S.unread - 1); badge(); }).catch(() => {});
  const risky = m.risk >= 2, own = m.cat === 'sent' || m.cat === 'drafts';
  const framed = !!m.frame, html = framed && (cacheGet('mode') || 'html') !== 'text';
  const d = new Date(m.date);
  const clean = (t) => String(t || '').replace(/^[ \t]*\[https?:\/\/[^\]\s]+\][ \t]*$/gm, '').replace(/\[(https?:\/\/[^\]\s]+)\]/g, '$1').replace(/\n{3,}/g, '\n\n').trim();
  const linkify = (t) => esc(clean(t)).replace(/(https?:\/\/[^\s<]+)/g, (u) => { const h = u.replace(/&amp;/g, '&'); let host = ''; try { host = new URL(h).host; } catch { return u; } return `<a href="${esc(h)}" target="_blank" rel="noopener noreferrer nofollow" title="${esc(host)}">${esc(host)}${esc(h.length > host.length + 8 ? '/…' : '')}</a>`; });
  const rich = (t) => withMail(linkify(t));
  paint(`<div class="thread-h"><button class="back" data-go="#/" aria-label="Wróć do skrzynki">${ic('back')}Skrzynka</button>${own ? `<span style="display:flex;gap:8px"><button class="round gl" data-orgact="delete" data-orgid="${m.id}" aria-label="Usuń">${ic('trash')}</button><button class="round gl" data-reply="${m.id}" aria-label="${m.cat === 'drafts' ? 'Edytuj i wyślij' : 'Napisz ponownie'}">${ic(m.cat === 'drafts' ? 'pen' : 'send')}</button></span>` : `<span style="display:flex;gap:8px"><button class="round gl" data-org="${m.id}" aria-label="Porządkowanie: usuń, spam, zablokuj">${ic('more')}</button><button class="round gl" data-snooze="${m.id}" data-until="${m.snoozed_until || ''}" aria-label="Odłóż na później">${ic('clock')}</button><button class="round gl" data-reply="${m.id}" aria-label="Odpowiedz">${ic('send')}</button></span>`}</div>
    <h1 class="subject">${esc(m.subject)}</h1>
    <div class="meta"><div class="a ${hue(own ? m.to_addr : m.from_addr)}">${esc(initials(own ? (addrList(m.to_addr).map((a) => cn(a))[0] || m.to_addr) : dispName(m.from_addr, m.from_name)))}</div><div class="w"><div class="n">${own ? `Do: ${esc(toNames(m.to_addr) || '(brak adresata)')}` : `<button type="button" class="ea nb" data-ea="${esc(m.from_addr)}" data-ean="${esc(m.from_name || '')}">${esc(dispName(m.from_addr, m.from_name))}</button>`}</div><div class="d mono">${own ? `z ${esc(m.account_email)}` : eaBtn(m.from_addr, m.from_name)} · ${d.getDate()}.${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}</div></div><button class="round gl star" data-star="${m.id}" aria-pressed="${!!m.starred}" aria-label="Oznacz gwiazdką">${ic('star', m.starred ? 'on' : '')}</button></div>
    ${own ? '' : recipLine('Do', m.to_addr)}${recipLine('Dw', m.cc_addr)}${own ? recipLine('Do', m.to_addr) : ''}
    ${m.cat && m.cat !== 'inbox' && !risky ? `<div class="fbanner gl"><div><b>${FOLDER_NAME[m.cat] || 'Poza skrzynką'}</b>${m.cat_why ? ` · ${esc(m.cat_why)}` : ''}</div><button class="btn" data-orgact="inbox" data-orgid="${m.id}">To nie ${m.cat === 'spam' ? 'spam' : 'oferta'}</button></div>` : ''}
    ${risky ? `<div class="risk"><h3>${ic('shield')}Prawdopodobne oszustwo</h3><ul>${m.risk_reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul><div class="actions"><button class="btn warn grow" data-act="back">Wróć do skrzynki</button><button class="btn" data-act="reveal">Pokaż mimo to</button></div></div>` : ''}
    ${items.filter((i) => i.status !== 'dismissed').map((it, k) => `<div class="card gl" style="--i:${k + 1}"><div class="k mono">${ic('spark', 'i14')}Wykryto · ${KIND_LABEL[it.kind]}${it.status === 'added' ? ' · dodane' : ''}</div><div class="ti">${esc(it.title)}</div><div class="wh">${esc(whenText(it))}</div>${it.evidence ? `<div class="ev">„${esc(it.evidence)}"</div>` : ''}<div class="actions">${it.status === 'added' ? `<button class="btn grow" data-cal="${it.id}">${ic('check', 'i18')}Dodane · pokaż ponownie</button>` : `<button class="btn pri grow" data-cal="${it.id}">${ic('cal', 'i18')}Dodaj do Kalendarza</button><button class="btn" data-dismiss="${it.id}" aria-label="To nie jest sprawa">${ic('x', 'i18')}</button>`}</div></div>`).join('')}
    ${attHtml(m)}
    ${framed ? `<div class="mseg gl" role="group" aria-label="Widok wiadomości"><button data-mode="html" aria-pressed="${html}">Oryginał</button><button data-mode="text" aria-pressed="${!html}">Tekst</button></div>` : ''}
    ${html && m.images_blocked ? `<div class="fbanner gl"><div>Obrazki są wyłączone.</div><button class="btn" data-act="showimg" data-id="${m.id}">Pokaż obrazki</button></div>` : ''}
    ${html ? `<div class="mailhost"><div class="body ${risky ? 'dim' : ''}" id="ptext">${rich(m.body)}</div><div class="ldg mono" id="ldg">Wczytuję oryginał…</div><div class="mailwrap pend ${risky ? 'dim' : ''}" id="body"><iframe id="mf" class="mailframe" title="Treść wiadomości" sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" referrerpolicy="no-referrer" scrolling="no"></iframe></div></div>`
      : `<div class="body ${risky ? 'dim' : ''}" id="body">${rich(m.body)}</div>`}
    <div class="actions racts">${own ? '' : `<button class="btn" data-cmp="reply">${ic('send', 'i18')}Odpowiedz</button>`}${!own && (m.cc_addr || String(m.to_addr || '').includes(',')) ? `<button class="btn" data-cmp="replyall">Odpowiedz wszystkim</button>` : ''}<button class="btn" data-cmp="forward">Przekaż dalej</button></div>
    ${m.thread?.length ? `<div class="sec">W tej rozmowie · ${m.thread.length + 1}</div><div class="thr">${m.thread.map((t) => `<button class="thi gl ${t.unread ? 'unread' : ''}" data-thr="${t.id}"><span class="mono">${t.cat === 'sent' ? 'Ty → ' + esc(toNames(String(t.to_addr || '').split(',')[0])) : esc(dispName(t.from_addr, t.from_name))} · ${fmtTime(t.date)}</span><span class="tsn">${esc(t.snippet || '')}</span></button>`).join('')}</div>` : ''}`, { tabs: false });
  S.cur = { m, items };
  if (html) mountFrame(m.frame);
  else if (m.html_pending && (cacheGet('mode') || 'html') !== 'text') {
    let n = 0; const again = async () => { if (!location.hash.endsWith(`/m/${id}`) || n++ > 4) return; try { const r = await get(`/api/messages/${id}`); if (r.message.frame) return viewMessage(id); } catch {} setTimeout(again, 2500); }; setTimeout(again, 2000);
  }
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
    ${S.accounts.map((a) => `<div class="acc gl"><span class="dot ${a.status === 'error' ? 'er' : ''}"></span><div class="w"><div class="n">${esc(a.label)}</div><div class="s">${esc(a.email)} · ${a.count} wiad. · ${a.status === 'error' ? esc(a.last_error || 'błąd') : ago(a.last_sync)}</div></div><button class="round gl" data-bell="${a.id}" data-on="${a.notify ? 1 : 0}" aria-pressed="${a.notify}" aria-label="Powiadomienia z ${esc(a.label)}" style="${a.notify ? '' : 'opacity:.55'}">${ic(a.notify ? 'bell' : 'bellOff', 'i18')}</button><button class="round gl" data-sync="${a.id}" aria-label="Synchronizuj ${esc(a.label)}">${ic('refresh', 'i18')}</button><button class="round gl" data-rm="${a.id}" aria-label="Usuń konto ${esc(a.label)}">${ic('trash', 'i18')}</button></div>`).join('') || '<div class="empty">Nie masz jeszcze żadnej skrzynki.</div>'}
    <div class="actions" style="margin-top:14px"><button class="btn pri grow" data-act="addacc">${ic('plus', 'i18')}Dodaj skrzynkę</button>${S.demoAllowed && !S.accounts.some((a) => a.provider === 'demo') ? '<button class="btn" data-act="demo">Tryb demo</button>' : ''}</div>
    <div class="sec">Powiadomienia</div><div id="pushcard" class="card gl" style="margin-top:6px"></div>
    <div class="sec">Porządek w poczcie</div><div id="orgcard" class="card gl" style="margin-top:6px"></div>
    <div class="sec">Prywatność</div><div class="card gl" style="margin-top:6px"><div class="k mono" style="color:var(--ok)">${ic('shield', 'i14')}Twoje dane zostają u Ciebie</div><div class="wh" style="line-height:21px;margin-top:8px">Wiadomości i hasła aplikacji leżą na Twoim serwerze (hasła zaszyfrowane AES-256). Fonty i skrypty są lokalne, bez śledzenia. Wykrywanie terminów działa na serwerze, bez wysyłania treści do żadnej firmy.</div></div>
    <div class="sec">Podpis w wiadomościach</div><div class="card gl" style="margin-top:6px"><textarea class="in" id="sigtxt" rows="3" maxlength="600" placeholder="np. Pozdrawiam, Michał"></textarea><div class="actions"><button class="btn grow" data-act="savesig">Zapisz podpis</button></div></div>
    ${S.user.plan === 'owner' ? '<div class="sec">Osoby</div><div id="peoplecard" class="card gl" style="margin-top:6px"></div>' : ''}<div class="sec">Konto</div><div class="card gl" style="margin-top:6px"><div class="kv"><span>Zalogowano jako</span><span>${esc(S.user.email)}</span></div><div class="actions"><button class="btn warn grow" data-act="logout">Wyloguj</button></div></div>`);
  nav('accounts'); renderPushCard(); renderOrgCard(); renderPeople();
  get('/api/compose').then((r) => { S.sig = r.signature || ''; const t = $('#sigtxt'); if (t) t.value = S.sig; }).catch(() => {});
}

async function foldersSheet() {
  const imaps = S.accounts.filter((a) => a.provider === 'imap');
  if (!imaps.length) { toast('Foldery są dostępne dla skrzynek IMAP'); return; }
  const acc = (S.account && imaps.find((a) => a.id === S.account)) || imaps[0];
  const sh = sheet(`<h2>Foldery · ${esc(acc.label)}</h2><div id="fl" class="wh" style="margin:6px 0">Wczytuję listę…</div>${imaps.length > 1 ? `<div class="actions" style="flex-wrap:wrap">${imaps.map((a) => `<button class="btn ${a.id === acc.id ? 'pri' : ''}" data-fswitch="${a.id}">${esc(a.label)}</button>`).join('')}</div>` : ''}`);
  sh.addEventListener('click', (e) => { const b = e.target.closest('[data-fswitch]'); if (b) { S.account = +b.dataset.fswitch; foldersSheet(); } });
  try {
    const r = await get(`/api/provider-folders?account=${acc.id}`);
    if (!$('#fl')) return;
    $('#fl').outerHTML = `<div class="flist">${r.folders.map((f) => `<button class="org" data-fopen="${esc(f.path)}" data-facc="${acc.id}"><span class="oi">${ic('inbox2', 'i18')}</span><span><b>${esc(f.name)}</b><small>${esc(f.path)}</small></span></button>`).join('')}</div>`;
  } catch (e) { if ($('#fl')) $('#fl').textContent = e.message; }
}
async function openProviderFolder(accId, path) {
  closeSheet(); toast('Otwieram folder…');
  try { const r = await post('/api/provider-folders/open', { account_id: accId, path }); S.otherFolder = { key: r.folder, acc: accId, name: path.split('/').pop() }; S.filter = 'other'; S.seg = 'msg'; go('#/'); route(); }
  catch (e) { toast(e.message); }
}
const fmtSize = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`);
function attHtml(m) {
  if (!m.attachments?.length) return '';
  return `<div class="atts">${m.attachments.map((a) => { const view = /^(image\/(png|jpe?g|gif|webp|avif)|application\/pdf)$/i.test(a.ctype);
    return `<a class="att gl" href="api/messages/${m.id}/att/${a.idx}${view ? '?view=1' : ''}" ${view ? 'target="_blank" rel="noopener"' : `download="${esc(a.filename)}"`}>${ic(view ? 'file' : 'clip', 'i18')}<span class="an"><b>${esc(a.filename)}</b><i class="mono">${fmtSize(a.size)}</i></span></a>`; }).join('')}</div>`;
}

function viewAuth() {
  const jm = location.hash.match(/^#\/join\/([\w-]+)/), join = jm && jm[1], setup = !join && S.setupNeeded;
  paint(`<div class="auth"><h1 class="ser">${setup || join ? 'Witaj w <i>Poczcie</i>' : 'Poczta'}</h1><p style="color:var(--ink2);margin:0 0 18px;font-size:16px;line-height:23px">${join ? 'Dostałaś zaproszenie. Załóż własne konto: Twoja poczta będzie widoczna tylko dla Ciebie.' : setup ? 'Załóż konto właściciela. To hasło chroni dostęp do Twojej poczty.' : 'Zaloguj się, aby wejść do skrzynki.'}</p>
  <form id="auth" class="gl" style="border-radius:28px;padding:8px 18px 18px"><div class="fld"><label for="e">E-mail</label><input class="in" id="e" type="email" autocomplete="username" required autocapitalize="off"></div><div class="fld"><label for="p">Hasło${setup || join ? ' (min. 10 znaków)' : ''}</label><input class="in" id="p" type="password" autocomplete="${setup || join ? 'new-password' : 'current-password'}" required minlength="${setup || join ? 10 : 1}"></div>${setup ? '<div class="fld"><label for="c">Kod instalacji</label><input class="in" id="c" autocomplete="off" placeholder="z instalatora serwera"></div>' : ''}<div class="err" id="err" role="alert"></div><button class="btn pri" style="width:100%;margin-top:14px" type="submit">${setup || join ? 'Utwórz konto' : 'Zaloguj'}</button></form>${join ? '<p style="color:var(--ink2);font-size:13px;line-height:19px;margin:14px 6px 0">To hasło dotyczy tylko Poczty, nie Twojej skrzynki. Skrzynkę dodasz za chwilę.</p>' : ''}</div>`, { tabs: false });
  $('#auth').onsubmit = async (ev) => {
    ev.preventDefault(); const b = ev.submitter; b.disabled = true;
    try { const r = await post(join ? '/api/join' : setup ? '/api/setup' : '/api/login', { email: $('#e').value, password: $('#p').value, code: join || $('#c')?.value }); S.user = r.user; S.animate = true; go('#/'); }
    catch (e) { $('#err').textContent = e.message; b.disabled = false; }
  };
}

// ---- porządek: reguły nadawców, kosz, sortowanie ----
const RULE_LABEL = { spam: 'spam', block: 'blokada', offers: 'oferty', inbox: 'skrzynka' };
async function renderOrgCard() {
  const el = $('#orgcard'); if (!el) return;
  const r = await get('/api/rules').catch(() => null); if (!r || !$('#orgcard')) return;
  const c = r.counts || {};
  el.innerHTML = `<div class="k mono" style="color:var(--acc2)">${ic('tag', 'i14')}Poczta sortuje sama</div>
    <div class="wh" style="line-height:21px;margin-top:8px">Oferty i spam trafiają do osobnych zakładek bez powiadomień. Gdy oznaczysz nadawcę, pamiętam to na zawsze.</div>
    <div class="kv"><span>Oferty</span><span>${c.offers || 0}</span></div><div class="kv"><span>Spam</span><span>${c.spam || 0}</span></div><div class="kv"><span>Kosz (30 dni)</span><span>${c.trash || 0}</span></div>
    <div class="kv" style="align-items:center"><span>Pokazuj obrazki w wiadomościach (pobiera je serwer, Twój telefon zostaje anonimowy)</span>${sw(r.images, 'imgtoggle', 'Obrazki w wiadomościach')}</div>
    <div class="kv" style="align-items:center"><span>Usuwaj też u dostawcy (do jego kosza)</span>${sw(r.serverDelete, 'srvdel', 'Usuwaj u dostawcy')}</div>
    <div class="actions"><button class="btn grow" data-act="resort">${ic('refresh', 'i18')}Posortuj ponownie</button></div>
    ${r.rules.length ? `<div class="sec" style="margin-top:14px">Zapamiętani nadawcy</div>${r.rules.map((x) => `<div class="rule"><span class="rb ${x.action}">${RULE_LABEL[x.action]}</span><span class="rv">${x.kind === 'domain' ? '@' : ''}${esc(x.value)}</span><button class="round gl" style="width:36px;height:36px" data-rmrule="${x.id}" aria-label="Usuń regułę">${ic('x', 'i14')}</button></div>`).join('')}` : ''}`;
  S.srvdel = r.serverDelete; S.imgs = r.images;
}

// ---- osoby: zaproszenia (tylko właściciel) ----
async function renderPeople(link) {
  const el = $('#peoplecard'); if (!el) return;
  const r = await get('/api/people').catch(() => null); if (!r || !$('#peoplecard')) return;
  const guests = r.users.filter((u) => u.plan !== 'owner');
  el.innerHTML = `<div class="k mono" style="color:var(--acc2)">${ic('shield', 'i14')}Dostęp dla bliskich</div>
    <div class="wh" style="line-height:21px;margin-top:8px">Każda zaproszona osoba ma własne konto i własne skrzynki. Nie widzisz jej poczty, a ona Twojej.</div>
    ${guests.map((u) => `<div class="rule"><span class="rv">${esc(u.email)} · ${u.accounts} skrz.</span><button class="round gl" style="width:36px;height:36px" data-rmuser="${u.id}" aria-label="Usuń osobę">${ic('x', 'i14')}</button></div>`).join('')}
    ${r.invites.map((i) => `<div class="rule"><span class="rb inbox">zaproszenie</span><span class="rv">ważne do ${new Date(i.expires).toLocaleDateString('pl-PL')}</span><button class="round gl" style="width:36px;height:36px" data-rminv="${i.id}" aria-label="Unieważnij">${ic('x', 'i14')}</button></div>`).join('')}
    ${link ? `<div class="wh" style="margin-top:12px;word-break:break-all;user-select:all">${esc(link)}</div><div class="actions"><button class="btn pri grow" data-sharelink="${esc(link)}">Wyślij link</button></div><div class="wh" style="font-size:12px;margin-top:6px">Link pokazuje się tylko teraz i działa raz, przez 7 dni.</div>` : `<div class="actions"><button class="btn pri grow" data-act="invite" ${guests.length + r.invites.length >= r.maxGuests ? 'disabled' : ''}>${ic('plus', 'i18')}Zaproś osobę</button></div>`}`;
}

// ---- powiadomienia push ----
const b64 = (k) => { const p = '='.repeat((4 - (k.length % 4)) % 4), r = atob((k + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from([...r].map((c) => c.charCodeAt(0))); };
async function pushState() {
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (!('serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window))
    return { ok: false, why: standalone ? 'Ta przeglądarka nie obsługuje powiadomień.' : 'Na iPhonie powiadomienia działają po dodaniu aplikacji do ekranu początkowego: Udostępnij → Do ekranu początkowego, potem otwórz ją stamtąd.' };
  const reg = await Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(() => r(null), 3000))]);
  if (!reg) return { ok: false, why: 'Aplikacja jeszcze się przygotowuje (tryb offline). Odśwież za chwilę.' };
  const sub = await reg.pushManager.getSubscription();
  return { ok: true, perm: Notification.permission, on: !!sub && Notification.permission === 'granted', reg, sub };
}
const QUIET = [['', 'Wyłączone'], ['22:00-07:00', '22:00–07:00'], ['23:00-06:00', '23:00–06:00'], ['00:00-08:00', '00:00–08:00']];
const DIGEST_AM = [['', 'Wyłączony'], ['06:30', '6:30'], ['07:30', '7:30'], ['08:30', '8:30']], DIGEST_PM = [['', 'Wyłączony'], ['18:00', '18:00'], ['19:00', '19:00'], ['20:00', '20:00'], ['21:00', '21:00']];
const sw = (on, act, label) => `<button class="sw ${on ? 'on' : ''}" role="switch" aria-checked="${on}" aria-label="${label}" data-act="${act}"><i></i></button>`;
async function renderPushCard() {
  const el = $('#pushcard'); if (!el) return;
  const st = await pushState().catch(() => ({ ok: false, why: 'Nie udało się sprawdzić powiadomień.' }));
  if (!$('#pushcard')) return;
  const live = S.accounts.some((a) => a.live);
  const head = `<div class="k mono" style="color:${live ? 'var(--ok)' : 'var(--ink2)'}">${ic('spark', 'i14')}${live ? 'Nowe wiadomości na żywo' : 'Sprawdzanie co kilka minut'}</div>`;
  const row = (on) => `<div class="kv" style="align-items:center"><span>Powiadamiaj na tym iPhonie</span>${sw(on, on ? 'pushoff' : 'pushon', 'Powiadomienia')}</div>`;
  if (!st.ok) { el.innerHTML = head + `<div class="wh" style="line-height:21px;margin-top:8px">${esc(st.why)}</div>`; return; }
  if (st.perm === 'denied') { el.innerHTML = head + `<div class="wh" style="line-height:21px;margin-top:8px">Powiadomienia są zablokowane. Włącz je w Ustawienia iPhone'a → Poczta → Powiadomienia.</div>`; return; }
  if (!st.on) { el.innerHTML = head + row(false) + `<div class="wh" style="line-height:21px;margin-top:4px">Dostaniesz powiadomienie o nowej wiadomości, także gdy aplikacja jest zamknięta, a telefon uśpiony. Treść idzie przez serwery Apple tylko jako zaszyfrowany sygnał.</div>`; return; }
  const pr = await get('/api/push/prefs').catch(() => ({ mode: 'all', quiet: '' }));
  el.innerHTML = head + row(true) + `<div class="fld"><label for="pmode">Które wiadomości</label><select class="in" id="pmode"><option value="all"${pr.mode === 'all' ? ' selected' : ''}>Wszystkie nowe</option><option value="important"${pr.mode === 'important' ? ' selected' : ''}>Tylko z terminem, paczką lub płatnością</option></select></div>`
    + `<div class="fld"><label for="pquiet">Ciche godziny (bez powiadomień)</label><select class="in" id="pquiet">${QUIET.map(([v, t]) => `<option value="${v}"${pr.quiet === v ? ' selected' : ''}>${t}</option>`).join('')}</select></div>`
    + `<div class="fld"><label for="pmorning">Poranny przegląd</label><select class="in" id="pmorning">${DIGEST_AM.map(([v, t]) => `<option value="${v}"${(pr.morning || '') === v ? ' selected' : ''}>${t}</option>`).join('')}</select></div><div class="fld"><label for="pevening">Wieczorny przegląd</label><select class="in" id="pevening">${DIGEST_PM.map(([v, t]) => `<option value="${v}"${(pr.evening || '') === v ? ' selected' : ''}>${t}</option>`).join('')}</select></div>`
    + `<div class="wh" style="line-height:21px;margin-top:8px">Przegląd to jedno powiadomienie z tym, co czeka: sprawy na dziś i płatności rano, plan na jutro wieczorem. Gdy nic nie czeka, nie przychodzi. Ustawienia dotyczą wszystkich Twoich urządzeń. Dzwonek przy skrzynce wycisza tylko tę skrzynkę.</div><div class="actions"><button class="btn grow" data-act="pushtest">Wyślij testowe</button></div>`;
}
async function pushOn() {
  const st = await pushState(); if (!st.ok) throw new Error(st.why);
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Nie przyznano zgody na powiadomienia');
  const { key } = await get('/api/push/key');
  const sub = st.sub || await st.reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(key) });
  await post('/api/push/subscribe', { subscription: sub.toJSON() });
  try { localStorage.setItem('pushwanted', '1'); } catch {}
}
async function pushOff() { try { localStorage.removeItem('pushwanted'); } catch {} const st = await pushState(); if (st.sub) { await post('/api/push/unsubscribe', { endpoint: st.sub.endpoint }).catch(() => {}); await st.sub.unsubscribe(); } }

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
// Kompozytor: nowa / odpowiedź / odpowiedź wszystkim / przekaż dalej / edycja szkicu / ponowna wysyłka.
const fmtDT = (d) => new Date(d).toLocaleString('pl-PL', { dateStyle: 'medium', timeStyle: 'short' });
async function composeSheet(opts = {}) {
  const { mode = 'new', m } = opts;
  if (!S.accounts?.length) await loadAccounts(true);
  const accs = S.accounts || [];
  if (!accs.length) { toast('Najpierw dodaj skrzynkę'); return; }
  if (S.sig === undefined) { try { S.sig = (await get('/api/compose')).signature || ''; } catch { S.sig = ''; } }
  const mine = new Set(accs.map((a) => a.email.toLowerCase()));
  const uniq = (l) => [...new Set(l.map((x) => x.trim()).filter(Boolean))];
  const split = (v) => String(v || '').split(/[,;]\s*/);
  let to = opts.to || '', cc = '', subject = '', text = '', inReply = '', refs = '', fwd = 0, draftId = 0, accId = m?.account_id || S.account || accs[0].id;
  const sig = S.sig ? `\n\n-- \n${S.sig}` : '';
  if (mode === 'reply' || mode === 'replyall') {
    to = m.from_addr; subject = /^re:/i.test(m.subject) ? m.subject : `Re: ${m.subject}`; inReply = m.message_id || ''; refs = uniq([m.refs, m.message_id].filter(Boolean)).join(' ');
    if (mode === 'replyall') cc = uniq([...split(m.to_addr), ...split(m.cc_addr)]).filter((x) => !mine.has(x.toLowerCase()) && x.toLowerCase() !== String(m.from_addr).toLowerCase()).join(', ');
    text = `${sig}\n\nW dniu ${fmtDT(m.date)} ${m.from_name || m.from_addr} napisał(a):\n${String(m.body || '').split('\n').slice(0, 40).map((l) => '> ' + l).join('\n')}`;
  } else if (mode === 'forward') {
    subject = /^(fwd?|pd):/i.test(m.subject) ? m.subject : `Fwd: ${m.subject}`; fwd = m.id;
    text = `${sig}\n\n---------- Przekazana wiadomość ----------\nOd: ${m.from_name ? m.from_name + ' ' : ''}<${m.from_addr}>\nData: ${fmtDT(m.date)}\nTemat: ${m.subject}\nDo: ${m.to_addr}\n\n${m.body || ''}`;
  } else if (mode === 'draft') {
    to = m.to_addr || ''; cc = m.cc_addr || ''; subject = m.subject || ''; text = m.body || ''; draftId = m.id;
  } else if (mode === 'again') { to = m.to_addr || ''; cc = m.cc_addr || ''; subject = m.subject || ''; text = m.body || ''; }
  else text = sig;
  const files = [];
  const title = { new: 'Nowa wiadomość', reply: 'Odpowiedz', replyall: 'Odpowiedz wszystkim', forward: 'Przekaż dalej', draft: 'Szkic', again: 'Nowa wiadomość' }[mode];
  const total = () => files.reduce((n, f) => n + f.size, 0);
  sheet(`<h2>${title}</h2><form id="cf"><div class="fld"><label for="cfr">Z konta</label><select class="in" id="cfr">${accs.map((a) => `<option value="${a.id}" ${accId === a.id ? 'selected' : ''}>${esc(a.email)}</option>`).join('')}</select></div>
    ${rcptHtml('cto', 'Do')}
    <div id="ccbox" ${cc ? '' : 'hidden'}>${rcptHtml('ccc', 'Dw')}${rcptHtml('cbc', 'UDW')}</div>
    ${cc ? '' : '<button class="lnk" type="button" id="showcc">Dw / UDW</button>'}
    <div class="fld"><label for="csu">Temat</label><input class="in" id="csu" value="${esc(subject)}"></div>
    <div class="fld"><label for="ctx">Treść</label><textarea class="in" id="ctx" rows="9">${esc(text)}</textarea></div>
    <div class="cfiles" id="cfiles"></div>
    <div class="err" id="err" role="alert"></div>
    <div class="actions cact" style="margin-top:12px"><label class="btn" style="cursor:pointer">${ic('clip', 'i18')}Załącznik<input type="file" id="cfile" multiple hidden></label><button class="btn" type="button" id="cdraft">Szkic</button><button class="btn pri grow" type="submit">${ic('send', 'i18')}Wyślij</button></div></form>`, (sh) => {
    const R = { to: mountRcpt(sh, 'cto', to), cc: mountRcpt(sh, 'ccc', cc), bcc: mountRcpt(sh, 'cbc', '') };
    if (!S.people) get('/api/contacts/people').then((r) => { S.people = r.people; }).catch(() => { S.people = []; });
    const ta = $('#ctx', sh); ta.setSelectionRange(0, 0); setTimeout(() => (mode === 'new' || mode === 'draft' || mode === 'again' ? $('#cto', sh) : ta).focus(), 450);
    const paintFiles = () => { $('#cfiles', sh).innerHTML = files.map((f, i) => `<span class="cfile gl">${ic('clip', 'i14')}<span>${esc(f.name)} · ${fmtSize(f.size)}</span><button type="button" data-rmf="${i}" aria-label="Usuń załącznik">${ic('x', 'i14')}</button></span>`).join(''); };
    $('#showcc', sh)?.addEventListener('click', (e) => { $('#ccbox', sh).hidden = false; e.currentTarget.remove(); $('#ccc', sh).focus(); });
    $('#cfiles', sh).addEventListener('click', (e) => { const b = e.target.closest('[data-rmf]'); if (b) { files.splice(+b.dataset.rmf, 1); paintFiles(); } });
    const readFile = (f) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.onerror = rej; r.readAsDataURL(f); });
    $('#cfile', sh).onchange = async (e) => {
      for (const f of e.target.files) {
        if (total() + f.size > 10 * 1024 * 1024) { $('#err', sh).textContent = 'Załączniki mogą mieć razem do 10 MB'; break; }
        files.push({ name: f.name, type: f.type, size: f.size, data: await readFile(f) });
      }
      e.target.value = ''; paintFiles();
    };
    // przy przekazywaniu serwer dołącza załączniki oryginału sam; pokazujemy to użytkownikowi
    if (fwd && m.attachments?.length) $('#cfiles', sh).insertAdjacentHTML('beforebegin', `<div class="wh" style="font-size:12px;margin-top:6px">Zostaną dołączone załączniki oryginału (${m.attachments.length}).</div>`);
    const payload = () => ({ account_id: +$('#cfr', sh).value, to: R.to.get(), cc: R.cc.get(), bcc: R.bcc.get(), subject: $('#csu', sh).value, text: ta.value, in_reply_to: inReply || undefined, references: refs || undefined, forward_of: fwd || undefined, attachments: files.map(({ name, type, data }) => ({ name, type, data })) });
    const snap = () => JSON.stringify([R.to.get(), R.cc.get(), R.bcc.get(), $('#csu', sh).value, ta.value]);
    const initial = snap();
    const dirty = () => snap() !== initial || files.length > 0;
    S.sheetGuard = () => {
      if (!dirty()) return true;
      if ($('#cguard')) return false;
      $('#sheet-root').insertAdjacentHTML('beforeend', `<div id="cguard" class="cguard"><div class="cg gl"><b>Zapisać szkic?</b><span>Wiadomość nie została wysłana.</span><div class="actions"><button class="btn pri grow" type="button" data-g="save">Zapisz szkic</button><button class="btn warn" type="button" data-g="drop">Odrzuć</button><button class="btn" type="button" data-g="back">Wróć</button></div></div></div>`);
      $('#cguard').onclick = (e) => {
        const g = e.target.closest('[data-g]')?.dataset.g; if (!g) return;
        if (g === 'back') $('#cguard').remove(); else if (g === 'drop') closeSheet(); else { $('#cguard').remove(); $('#cdraft', sh).click(); }
      };
      return false;
    };
    $('#cdraft', sh).onclick = async (ev) => {
      const b = ev.currentTarget; b.disabled = true; $('#err', sh).textContent = '';
      try { await post('/api/drafts', { ...payload(), replace_id: draftId || undefined }); closeSheet(); toast('Zapisano szkic'); if (location.hash.startsWith('#/m/') && draftId) go('#/'); else if (S.filter === 'drafts') route(); }
      catch (e) { $('#err', sh).textContent = e.message; b.disabled = false; }
    };
    $('#cf', sh).onsubmit = async (ev) => {
      ev.preventDefault(); const b = ev.submitter; b.disabled = true; $('#err', sh).textContent = '';
      if (!R.to.get() && !R.cc.get() && !R.bcc.get()) { $('#err', sh).textContent = 'Podaj adresata'; b.disabled = false; return; }
      try { await post('/api/send', { ...payload(), draft_id: draftId || undefined }); closeSheet(); toast('Wysłano'); if (draftId) go('#/'); }
      catch (e) { $('#err', sh).textContent = e.message; b.disabled = false; }
    };
  });
}

// ---- kontakty (własna książka adresowa; nic nie jest importowane z telefonu) ----
S.contacts = []; S.cmap = new Map(); S.people = null;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const addrList = (s) => [...new Set((String(s || '').match(EMAIL_RE) || []).map((x) => x.toLowerCase()))];
const cn = (a) => S.cmap.get(String(a || '').toLowerCase())?.name || '';
const dispName = (a, n) => cn(a) || n || a || '';
const toNames = (s) => addrList(s).map((a) => cn(a) || a).join(', ');
async function loadContacts(quiet) {
  try { S.contacts = (await get('/api/contacts')).contacts; } catch (e) { if (!quiet) throw e; }
  S.cmap = new Map(); for (const c of S.contacts) for (const e of c.emails) S.cmap.set(e.email, c);
}
const eaBtn = (a, n = '') => `<button type="button" class="ea" data-ea="${esc(a)}" data-ean="${esc(n)}">${esc(a)}</button>`;
const withMail = (h) => h.split(/(<a [^>]*>[^<]*<\/a>)/).map((p, i) => (i % 2 ? p : p.replace(EMAIL_RE, (a) => eaBtn(a)))).join('');
const copyText = async (t) => { try { await navigator.clipboard.writeText(t); } catch { const x = document.createElement('textarea'); x.value = t; document.body.appendChild(x); x.select(); try { document.execCommand('copy'); } catch { /* brak */ } x.remove(); } toast('Skopiowano'); };
function recipLine(label, s) {
  const l = addrList(s); if (!l.length) return '';
  return `<div class="rcl"><span class="mono">${label}</span>${l.map((a) => `<button type="button" class="ea rce" data-ea="${esc(a)}">${cn(a) ? `<b>${esc(cn(a))}</b><small>${esc(a)}</small>` : esc(a)}</button>`).join('')}</div>`;
}

// menu adresu e-mail: napisz / odpowiedz / dodaj lub edytuj kontakt / kopiuj / zablokuj
function emailSheet(addr, { name = '', msg = null } = {}) {
  addr = String(addr).trim().toLowerCase(); const c = S.cmap.get(addr);
  const row = (act, ico, t, sub = '') => `<button class="org" data-eact="${act}"><span class="oi">${ic(ico, 'i18')}</span><span><b>${t}</b>${sub ? `<small>${sub}</small>` : ''}</span></button>`;
  const fromHere = msg && String(msg.from_addr).toLowerCase() === addr && msg.cat !== 'sent' && msg.cat !== 'drafts';
  sheet(`<div class="sheet-b"><h2 class="ser" style="font-size:28px;margin:6px 0 2px">${esc(c?.name || name || addr)}</h2><p style="color:var(--ink2);margin:0 0 8px;font-size:14px;word-break:break-all">${esc(addr)}${c ? ' · w kontaktach' : ''}</p>
    ${fromHere ? row('reply', 'send', 'Odpowiedz', 'Na tę wiadomość') : ''}
    ${row('new', 'pen', 'Napisz nową wiadomość')}
    ${c ? row('edit', 'user', 'Edytuj kontakt', 'Zmień nazwę, adresy lub notatkę') : row('add', 'plus', 'Dodaj do kontaktów', 'Z własną nazwą')}
    ${row('copy', 'clip', 'Kopiuj adres')}
    ${fromHere ? row('block', 'ban', 'Zablokuj nadawcę', 'Nigdy więcej nie pokaże się w żadnej zakładce.') : ''}</div>`, (sh) => {
    sh.addEventListener('click', async (e) => {
      const a = e.target.closest('[data-eact]')?.dataset.eact; if (!a) return;
      if (a === 'reply') composeSheet({ mode: 'reply', m: msg });
      else if (a === 'new') composeSheet({ mode: 'new', to: addr });
      else if (a === 'add') contactSheet(null, { email: addr, name: name && name !== addr ? name : '' });
      else if (a === 'edit') contactSheet(c);
      else if (a === 'copy') { closeSheet(); copyText(addr); }
      else if (a === 'block') { await orgDo([msg.id], 'block'); go('#/'); }
    });
  });
}

function contactSheet(c, pre = {}) {
  const emails = c ? c.emails.map((e) => e.email) : [pre.email || ''];
  const erow = (v) => `<div class="kerow"><input class="in ke" type="email" inputmode="email" autocomplete="off" autocapitalize="off" autocorrect="off" placeholder="adres@poczta.pl" value="${esc(v)}"><button type="button" class="kx" data-kx aria-label="Usuń adres">${ic('x', 'i14')}</button></div>`;
  sheet(`<h2>${c ? 'Edytuj kontakt' : 'Nowy kontakt'}</h2><form id="kf"><div class="fld"><label for="kn">Nazwa</label><input class="in" id="kn" autocomplete="off" autocapitalize="words" placeholder="np. Michał Lewandowski" value="${esc(c?.name || pre.name || '')}"></div>
    <div class="fld"><label>Adresy e-mail</label><div id="kem">${emails.map(erow).join('')}</div></div>
    <button class="lnk" type="button" id="kadd" style="margin-top:6px">+ Dodaj kolejny adres</button>
    <div class="fld"><label for="knote">Notatka</label><input class="in" id="knote" autocomplete="off" placeholder="opcjonalnie" value="${esc(c?.note || '')}"></div>
    <div class="err" id="err" role="alert"></div>
    <div class="actions" style="margin-top:12px">${c ? `<button class="btn warn" type="button" id="kdel">Usuń</button><button class="btn" type="button" id="kmail">${ic('send', 'i18')}Napisz</button>` : ''}<button class="btn pri grow" type="submit">Zapisz</button></div></form>`, (sh) => {
    const box = $('#kem', sh);
    const sync = () => box.querySelectorAll('.kx').forEach((b) => { b.hidden = box.children.length < 2; });
    sync();
    box.addEventListener('click', (e) => { const b = e.target.closest('[data-kx]'); if (b && box.children.length > 1) { b.parentElement.remove(); sync(); } });
    $('#kadd', sh).onclick = () => { box.insertAdjacentHTML('beforeend', erow('')); sync(); box.lastElementChild.querySelector('input').focus(); };
    if (!c) setTimeout(() => (pre.name || !pre.email ? $('#kn', sh) : $('#kn', sh)).focus(), 450);
    $('#kmail', sh)?.addEventListener('click', () => composeSheet({ mode: 'new', to: c.emails[0].email }));
    let armed = false;
    $('#kdel', sh)?.addEventListener('click', async (e) => {
      const b = e.currentTarget; if (!armed) { armed = true; b.textContent = 'Na pewno usunąć?'; setTimeout(() => { armed = false; b.textContent = 'Usuń'; }, 3000); return; }
      try { await api('DELETE', `/api/contacts/${c.id}`); await loadContacts(true); closeSheet(); toast('Usunięto kontakt'); route(); } catch (er) { $('#err', sh).textContent = er.message; }
    });
    $('#kf', sh).onsubmit = async (ev) => {
      ev.preventDefault(); const b = ev.submitter; b.disabled = true; $('#err', sh).textContent = '';
      const list = [...box.querySelectorAll('.ke')].map((i) => i.value.trim()).filter(Boolean);
      const labels = new Map((c?.emails || []).map((e) => [e.email, e.label]));
      const body = { name: $('#kn', sh).value, note: $('#knote', sh).value, emails: list.map((email) => ({ email, label: labels.get(email.toLowerCase()) || '' })) };
      try { await (c ? api('PUT', `/api/contacts/${c.id}`, body) : post('/api/contacts', body)); await loadContacts(true); closeSheet(); toast('Zapisano kontakt'); route(); }
      catch (er) { $('#err', sh).textContent = er.message; b.disabled = false; }
    };
  });
}

async function viewContacts() {
  await loadContacts();
  const pplP = get('/api/contacts/people').then((r) => r.people).catch(() => []);
  paint(`<div class="top" style="display:flex;align-items:center;justify-content:space-between"><span class="eyebrow mono" style="padding-left:8px">Kontakty</span><button class="round gl" data-kadd aria-label="Nowy kontakt">${ic('plus')}</button></div>
    <label class="srch gl">${ic('search', 'i18')}<input id="kq" type="search" autocomplete="off" autocapitalize="off" placeholder="Szukaj w kontaktach"></label>
    <div id="klist"></div>`);
  nav('contacts');
  let people = null, all = false, q = '';
  const match = (s) => !q || s.toLowerCase().includes(q);
  const draw = () => {
    const cs = S.contacts.filter((c) => match(c.name) || match(c.note || '') || c.emails.some((e) => match(e.email)));
    let out = '', last = '';
    for (const c of cs) {
      const L = (c.name[0] || '#').toLocaleUpperCase('pl'), g = /\p{L}/u.test(L) ? L : '#';
      if (g !== last) { out += `<div class="sec">${esc(g)}</div>`; last = g; }
      out += `<button class="crow gl" data-kc="${c.id}"><div class="a ${hue(c.emails[0]?.email || c.name)}">${esc(initials(c.name))}</div><div class="rb"><div class="nm"><span>${esc(c.name)}</span></div><div class="sn">${esc(c.emails.map((e) => e.email).join(' · '))}</div></div></button>`;
    }
    if (!cs.length) out = S.contacts.length ? `<div class="empty"><div class="big ser">Nic nie znaleziono</div>Spróbuj innego imienia lub adresu.</div>` : `<div class="empty"><div class="big ser">Brak kontaktów</div>Dodaj kogoś przyciskiem + u góry albo wybierz osobę z korespondencji poniżej.</div>`;
    const ps = (people || []).filter((p) => match(p.email) || match(p.name || ''));
    if (ps.length) {
      out += `<div class="sec">Z korespondencji · jeszcze nie w kontaktach</div>` + (all || q ? ps : ps.slice(0, 6)).map((p) => `<button class="crow gl" data-kp="${esc(p.email)}" data-kpn="${esc(p.name || '')}"><div class="a ${hue(p.email)}">${esc(initials(p.name || p.email))}</div><div class="rb"><div class="nm"><span>${esc(p.name || p.email)}</span></div><div class="sn">${esc(p.name ? p.email : 'Dodaj i podpisz własną nazwą')}</div></div><span class="kplus">${ic('plus', 'i18')}</span></button>`).join('')
        + (!all && !q && ps.length > 6 ? `<button class="btn" data-kmore style="margin:10px auto 0;display:flex">Pokaż więcej (${ps.length - 6})</button>` : '');
    }
    $('#klist').innerHTML = out;
  };
  draw();
  pplP.then((p) => { people = p; if ($('#klist')) draw(); });
  S.khide = (r) => {
    if (r.dataset.kp) { const e = r.dataset.kp, nm = r.dataset.kpn; people = (people || []).filter((p) => p.email !== e); S.people = null; post('/api/contacts/hide', { email: e }).catch(() => {}); toast('Ukryto z podpowiedzi', { label: 'Cofnij', fn: async () => { await post('/api/contacts/unhide', { email: e }); people = [...(people || []), { email: e, name: nm, count: 1, last: 0 }]; if ($('#klist')) draw(); } }); }
    else { const c = S.contacts.find((x) => x.id === +r.dataset.kc); if (!c) return; S.contacts = S.contacts.filter((x) => x !== c); for (const e of c.emails) S.cmap.delete(e.email); S.people = null; api('DELETE', `/api/contacts/${c.id}`).catch(() => {}); toast('Usunięto kontakt', { label: 'Cofnij', fn: async () => { await post('/api/contacts', { name: c.name, note: c.note, emails: c.emails }); for (const e of c.emails) await post('/api/contacts/unhide', { email: e.email }); await loadContacts(true); if ($('#klist')) draw(); } }); }
    draw();
  };
  $('#kq').oninput = (e) => { q = e.target.value.trim().toLowerCase(); draw(); };
  S.kmore = () => { all = true; draw(); };
}

// gest: przeciągnięcie wiersza w lewo ukrywa podpowiedź albo usuwa kontakt
(() => {
  let row = null, sx = 0, sy = 0, dx = 0, lock = null;
  const v = $('#view');
  v.addEventListener('touchstart', (e) => { row = e.target.closest('.crow'); if (!row || e.touches.length > 1) { row = null; return; } const t = e.touches[0]; sx = t.clientX; sy = t.clientY; dx = 0; lock = null; row.dataset.rl = row.dataset.kp ? 'Ukryj' : 'Usuń'; }, { passive: true });
  v.addEventListener('touchmove', (e) => {
    if (!row) return; const t = e.touches[0], ax = t.clientX - sx, ay = t.clientY - sy;
    if (!lock && (Math.abs(ax) > 10 || Math.abs(ay) > 10)) lock = Math.abs(ax) > Math.abs(ay) * 1.4 ? 'x' : 'y';
    if (lock === 'y') { row = null; return; }
    if (lock === 'x') { dx = Math.min(0, ax); row.style.transition = 'none'; row.style.transform = `translateX(${dx * 0.55}px)`; row.classList.toggle('swl', dx < -8); row.classList.toggle('arm', dx < -90); }
  }, { passive: true });
  const end = () => {
    if (!row) return; const r = row; row = null; r.style.transition = ''; r.style.transform = ''; r.classList.remove('swl', 'arm');
    if (lock !== 'x' || dx > -90) return; S.swiped = Date.now(); S.khide?.(r);
  };
  v.addEventListener('touchend', end); v.addEventListener('touchcancel', end);
})();
// pole adresatów: kafelki (nazwa + adres) i autouzupełnianie z kontaktów oraz z korespondencji
function rcptHtml(id, label, hidden) {
  return `<div class="fld"><label for="${id}">${label}</label><div class="rf in" data-rf="${id}"><span class="rchips"></span><input id="${id}" class="ri" type="text" inputmode="email" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false"></div><div class="sug gl" hidden></div></div>`;
}
function mountRcpt(sh, id, initial) {
  const box = $(`[data-rf="${id}"]`, sh), inp = $('input', box), sug = box.parentElement.querySelector('.sug'), chips = [];
  const chipHtml = (a) => `<span class="rc" data-e="${esc(a)}">${cn(a) ? `<span class="rn"><b>${esc(cn(a))}</b><small>${esc(a)}</small></span>` : `<span class="rn">${esc(a)}</span>`}<button type="button" class="rx" data-rx="${esc(a)}" aria-label="Usuń adresata">${ic('x', 'i14')}</button></span>`;
  const draw = () => { $('.rchips', box).innerHTML = chips.map(chipHtml).join(''); };
  const add = (a) => { a = a.trim().toLowerCase(); if (a && !chips.includes(a)) { chips.push(a); draw(); } };
  const hide = () => { sug.hidden = true; sug.innerHTML = ''; };
  const take = () => { const m = inp.value.match(EMAIL_RE); if (m) { m.forEach(add); inp.value = ''; } hide(); return !!m; };
  const cand = () => {
    const out = []; for (const c of S.contacts) for (const e of c.emails) out.push({ name: c.name, email: e.email, own: true });
    for (const p of S.people || []) out.push({ name: p.name || '', email: p.email, own: false }); return out;
  };
  const suggest = () => {
    const q = inp.value.trim().toLowerCase(); if (!q) return hide();
    const sc = (x) => { const n = x.name.toLowerCase(), e = x.email.toLowerCase(); if (n.split(/\s+/).some((w) => w.startsWith(q)) || n.startsWith(q)) return 0; if (e.startsWith(q)) return 1; if (n.includes(q) || e.includes(q)) return 2; return 9; };
    const l = cand().filter((x) => !chips.includes(x.email) && sc(x) < 9).sort((a, b) => sc(a) - sc(b) || (b.own - a.own)).slice(0, 6);
    if (!l.length) return hide();
    sug.innerHTML = l.map((x) => `<button type="button" class="sg" data-e="${esc(x.email)}"><b>${esc(x.name || x.email)}</b><small>${x.name ? esc(x.email) : 'z korespondencji'}${x.name && !x.own ? ' · z korespondencji' : ''}</small></button>`).join(''); sug.hidden = false;
  };
  sug.addEventListener('pointerdown', (e) => { const b = e.target.closest('.sg'); if (!b) return; e.preventDefault(); add(b.dataset.e); inp.value = ''; hide(); inp.focus(); });
  box.addEventListener('click', (e) => { const x = e.target.closest('[data-rx]'); if (x) { const i = chips.indexOf(x.dataset.rx); if (i >= 0) { chips.splice(i, 1); draw(); } inp.focus(); } else inp.focus(); });
  inp.addEventListener('input', () => {
    const v = inp.value;
    if (/[,;]/.test(v)) { const parts = v.split(/[,;]/); const last = parts.pop(); parts.forEach((p) => (p.match(EMAIL_RE) || []).forEach(add)); inp.value = last.trimStart(); }
    else if (/^\S+@\S+\.\S+\s$/.test(v)) take();
    suggest();
  });
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); const f = sug.querySelector('.sg'); if (!sug.hidden && f && !inp.value.includes('@')) { add(f.dataset.e); inp.value = ''; hide(); } else take(); }
    else if (e.key === 'Backspace' && !inp.value && chips.length) { chips.pop(); draw(); }
  });
  inp.addEventListener('blur', () => setTimeout(() => { take(); }, 120));
  addrList(initial).forEach(add);
  return { get: () => [...chips, ...(inp.value.trim() ? [inp.value.trim()] : [])].join(', '), focus: () => inp.focus() };
}
// w treści oryginału: adresy e-mail i linki mailto: otwierają menu adresu
function hookFrameMail(d) {
  try {
    d.addEventListener('click', (e) => {
      const a = e.target.closest?.('a[href^="mailto:" i]'); if (!a) return;
      e.preventDefault(); const ad = decodeURIComponent(a.getAttribute('href').slice(7).split('?')[0]).split(',')[0].trim(); if (ad) emailSheet(ad, { msg: S.cur?.m });
    }, true);
    const w = d.createTreeWalker(d.body, 4, null); const nodes = []; let n, k = 0;
    while ((n = w.nextNode()) && k++ < 3000) { const p = n.parentElement; if (p && !/^(A|SCRIPT|STYLE|TEXTAREA|TITLE)$/i.test(p.tagName) && n.nodeValue.includes('@') && /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}/.test(n.nodeValue)) nodes.push(n); if (nodes.length > 300) break; }
    for (const t of nodes) {
      const s = t.nodeValue, frag = d.createDocumentFragment(); let i = 0, m; EMAIL_RE.lastIndex = 0;
      while ((m = EMAIL_RE.exec(s))) { if (m.index > i) frag.append(s.slice(i, m.index)); const a = d.createElement('a'); a.href = 'mailto:' + m[0]; a.textContent = m[0]; frag.append(a); i = m.index + m[0].length; }
      if (i < s.length) frag.append(s.slice(i)); t.replaceWith(frag);
    }
  } catch { /* iframe niedostępny */ }
}

// ---- nawigacja, zdarzenia ----
function nav(cur) { document.querySelectorAll('.tab').forEach((t) => t.toggleAttribute('aria-current', false) || (t.dataset.tab === cur && t.setAttribute('aria-current', 'page'))); const bd = $('#bd-inbox'); bd.textContent = S.unread > 99 ? '99+' : S.unread; bd.hidden = !S.unread; }
function badge() { try { S.unread ? navigator.setAppBadge?.(S.unread) : navigator.clearAppBadge?.(); } catch { /* brak wsparcia */ } }
async function loadAccounts(quiet) { try { S.accounts = (await get('/api/accounts')).accounts; } catch (e) { if (!quiet) throw e; } }

let routing = 0;
async function route() {
  const my = ++routing; const h = location.hash || '#/';
  if (!S.user) { if (!h.startsWith('#/join/') && h !== '#/login') { history.replaceState(null, '', '#/login'); } return viewAuth(); }
  try {
    const mm = h.match(/^#\/m\/(\d+)/);
    if (mm) await viewMessage(+mm[1]); else if (h === '#/today') await viewToday(); else if (h === '#/search') await viewSearch(); else if (h === '#/contacts') await viewContacts(); else if (h === '#/accounts') await viewAccounts(); else if (h === '#/login') go('#/'); else await viewInbox();
  } catch (e) { if (my === routing && e.status !== 401) paint(`<div class="empty"><div class="big ser">Coś poszło nie tak</div>${esc(e.message)}<div class="actions" style="justify-content:center"><button class="btn" data-act="retry">Spróbuj ponownie</button></div></div>`); }
  view().scrollTo?.(0, 0);
}
window.addEventListener('hashchange', () => { S.animate = true; closeSheet(true); route(); });

document.addEventListener('click', async (ev) => {
  if (Date.now() - (S.swiped || 0) < 450) return;
  const el = ev.target.closest('[data-open],[data-go],[data-seg],[data-filter],[data-cal],[data-dismiss],[data-act],[data-sync],[data-rm],[data-pick],[data-bell],[data-snooze],[data-snz],[data-org],[data-orgact],[data-rmrule],[data-rmuser],[data-rminv],[data-sharelink],[data-mode],[data-paid],[data-unpaid],[data-reply],[data-cmp],[data-star],[data-thr],[data-fopen],[data-done],[data-tab],[data-ea],[data-kc],[data-kp],[data-kadd],[data-kmore]');
  if (!el) return; const d = el.dataset;
  try {
    if (d.open) go(`#/m/${d.open}`);
    else if (d.go) go(d.go);
    else if (d.ea) emailSheet(d.ea, { name: d.ean || '', msg: /^#\/m\//.test(location.hash) ? S.cur?.m : null });
    else if (d.kc) contactSheet(S.contacts.find((c) => c.id === +d.kc));
    else if (d.kp) contactSheet(null, { email: d.kp, name: d.kpn });
    else if (d.kadd !== undefined) contactSheet(null);
    else if (d.kmore !== undefined) S.kmore?.();
    else if (d.tab) go(d.tab === 'inbox' ? '#/' : `#/${d.tab}`);
    else if (d.seg) { S.seg = d.seg; S.animate = false; route(); }
    else if (d.filter) { S.filter = d.filter; route(); }
    else if (d.cal) { const it = await findItem(+d.cal); calSheet(it); }
    else if (d.done) { post(`/api/items/${d.done}`, { status: 'added' }).then(() => setTimeout(route, 600)); closeSheet(); }
    else if (d.dismiss) { await post(`/api/items/${d.dismiss}`, { status: 'dismissed' }); toast('Pominięto'); route(); }
    else if (d.reply) composeSheet({ mode: S.cur.m.cat === 'drafts' ? 'draft' : S.cur.m.cat === 'sent' ? 'again' : 'reply', m: S.cur.m });
    else if (d.cmp) composeSheet({ mode: d.cmp, m: S.cur.m });
    else if (d.star) { const on = !S.cur.m.starred; await actMsgs([+d.star], on ? 'star' : 'unstar'); S.cur.m.starred = on; el.setAttribute('aria-pressed', on); el.innerHTML = ic('star', on ? 'on' : ''); }
    else if (d.thr) go(`#/m/${d.thr}`);
    else if (d.fopen) await openProviderFolder(+d.facc, d.fopen);
    else if (d.act === 'folders') foldersSheet();
    else if (d.act === 'savesig') { const r = await post('/api/compose', { signature: $('#sigtxt').value }); S.sig = r.signature; toast('Podpis zapisany'); }
    else if (d.sync) { el.disabled = true; toast('Synchronizuję…'); await post(`/api/accounts/${d.sync}/sync`); toast('Gotowe'); route(); }
    else if (d.rm) { if (confirm('Usunąć to konto i pobrane z niego wiadomości z Poczty? Skrzynka u dostawcy zostaje nietknięta.')) { await api('DELETE', `/api/accounts/${d.rm}`); route(); } }
    else if (d.mode) { try { localStorage.setItem('poczta.mode', JSON.stringify(d.mode)); } catch {} route(); }
    else if (d.act === 'showimg') { S.forceImg = +d.id; route(); }
    else if (d.act === 'imgtoggle') { await post('/api/organize', { images: !S.imgs }); renderOrgCard(); }
    else if (d.act === 'invite') { const r = await post('/api/invites', {}); renderPeople(new URL(`#/join/${r.code}`, location.href.split('#')[0]).href); }
    else if (d.sharelink) { if (navigator.share) { try { await navigator.share({ title: 'Poczta', text: 'Zaproszenie do Poczty:', url: d.sharelink }); } catch {} } else { await navigator.clipboard?.writeText(d.sharelink); toast('Link skopiowany'); } }
    else if (d.rminv) { await api('DELETE', `/api/invites/${d.rminv}`); renderPeople(); }
    else if (d.rmuser) { if (confirm('Usunąć tę osobę razem z jej pocztą na serwerze?')) { await api('DELETE', `/api/people/${d.rmuser}`); toast('Osoba usunięta'); renderPeople(); } }
    else if (d.rmrule) { await api('DELETE', `/api/rules/${d.rmrule}`); toast('Reguła usunięta'); renderOrgCard(); }
    else if (d.act === 'srvdel') { await post('/api/organize', { serverDelete: !S.srvdel }); renderOrgCard(); }
    else if (d.act === 'resort') { const r = await post('/api/organize', { reclassify: true }); toast(r.changed ? `Przeniesiono ${r.changed}` : 'Wszystko już na swoim miejscu'); renderOrgCard(); }
    else if (d.org) orgSheet(S.cur.m);
    else if (d.orgact) { const goBack = /^#\/m\//.test(location.hash); await orgDo([+d.orgid], d.orgact, d.scope); if (goBack) go('#/'); else route(); }
    else if (d.act === 'empty') {
      const cat = d.cat, r = await post(`/api/folders/${cat}/empty`);
      if (cat === 'trash') { toast('Kosz opróżniony'); route(); }
      else { toast(`Usunięto ${r.count}`, { label: 'Cofnij', fn: async () => { await actMsgs(r.ids, 'restore'); toast('Przywrócono'); route(); } }); route(); }
    }
    else if (d.snooze) snoozeSheet(d.snooze, +d.until || 0);
    else if (d.snz) await doSnooze(d.snz === 'now' ? null : +d.snz);
    else if (d.act === 'snzcustom') { const t = new Date($('#snzc').value).getTime(); if (!t) throw new Error('Wybierz datę i godzinę'); await doSnooze(t); }
    else if (d.paid) { await post(`/api/items/${d.paid}`, { status: 'paid' }); toast('Oznaczono jako opłacone'); route(); }
    else if (d.unpaid) { await post(`/api/items/${d.unpaid}`, { status: 'new' }); route(); }
    else if (d.bell) { await post(`/api/accounts/${d.bell}/notify`, { on: d.on !== '1' }); toast(d.on === '1' ? 'Skrzynka wyciszona' : 'Powiadomienia z tej skrzynki włączone'); viewAccounts(); }
    else if (d.pick !== undefined) { S.account = +d.pick; closeSheet(); route(); }
    else if (d.act === 'more') await loadMore(el);
    else if (d.act === 'accmenu') accMenu();
    else if (d.act === 'addacc') addAccSheet();
    else if (d.act === 'demo') { await post('/api/accounts/demo'); toast('Dodano konto demo'); route(); }
    else if (d.act === 'logout') { await post('/api/logout'); S.user = null; location.hash = '#/login'; route(); }
    else if (d.act === 'pushon') { await pushOn(); toast('Powiadomienia włączone'); renderPushCard(); }
    else if (d.act === 'pushoff') { await pushOff(); toast('Wyłączono'); renderPushCard(); }
    else if (d.act === 'pushtest') { await post('/api/push/test'); toast('Wysłano testowe'); }
    else if (d.act === 'close') closeSheet();
    else if (d.act === 'back') go('#/');
    else if (d.act === 'reveal') { $('#body')?.classList.remove('dim'); el.closest('.risk').remove(); }
    else if (d.act === 'retry') route();
  } catch (e) { toast(e.message || 'Błąd'); el.disabled = false; }
});
document.addEventListener('change', async (ev) => {
  const t = ev.target;
  try {
    if (t.id === 'pmode') await post('/api/push/prefs', { mode: t.value });
    else if (t.id === 'pquiet') await post('/api/push/prefs', { quiet: t.value });
    else if (t.id === 'pmorning') await post('/api/push/prefs', { morning: t.value });
    else if (t.id === 'pevening') await post('/api/push/prefs', { evening: t.value });
    else return;
    toast('Zapisano');
  } catch (e) { toast(e.message || 'Błąd'); }
});
// Gesty na liście: w lewo = usuń, w prawo = spam (w Spamie i Ofertach: "do skrzynki", w koszu: "przywróć").
(() => {
  let row = null, sx = 0, sy = 0, dx = 0, lock = null;
  const v = $('#view');
  const rightAct = () => (S.filter === 'trash' ? 'restore' : ['spam', 'offers'].includes(S.filter) ? 'inbox' : 'spam');
  v.addEventListener('touchstart', (e) => {
    row = e.target.closest('.row[data-open]'); if (!row || e.touches.length > 1) { row = null; return; }
    v.classList.remove('enter'); const t = e.touches[0]; sx = t.clientX; sy = t.clientY; dx = 0; lock = null;
    row.dataset.rl = S.filter === 'trash' ? '' : 'Usuń'; row.dataset.rr = { spam: 'Spam', inbox: 'Do skrzynki', restore: 'Przywróć' }[rightAct()];
  }, { passive: true });
  v.addEventListener('touchmove', (e) => {
    if (!row) return; const t = e.touches[0], ax = t.clientX - sx, ay = t.clientY - sy;
    if (!lock && (Math.abs(ax) > 10 || Math.abs(ay) > 10)) lock = Math.abs(ax) > Math.abs(ay) * 1.4 ? 'x' : 'y';
    if (lock === 'y') { row = null; return; }
    if (lock === 'x') { dx = (!row.dataset.rl && ax < 0) ? 0 : ax; row.style.transition = 'none'; row.style.transform = `translateX(${dx * 0.55}px)`; row.classList.toggle('swl', dx < -8); row.classList.toggle('swr', dx > 8); row.classList.toggle('arm', Math.abs(dx) > 90); }
  }, { passive: true });
  const collapse = (r) => {
    r.style.height = r.offsetHeight + 'px'; r.style.overflow = 'hidden';
    requestAnimationFrame(() => { r.style.transition = 'height .32s ease, opacity .25s, margin .32s, padding .32s'; r.style.height = '0'; r.style.opacity = '0'; r.style.marginTop = '-8px'; r.style.paddingTop = '0'; r.style.paddingBottom = '0'; setTimeout(() => r.remove(), 340); });
  };
  const end = () => {
    if (!row) return; const r = row; row = null;
    r.style.transition = ''; r.style.transform = ''; r.classList.remove('swl', 'swr', 'arm');
    if (lock !== 'x' || Math.abs(dx) < 90) return;
    S.swiped = Date.now();
    const id = +r.dataset.open, wasUnread = r.classList.contains('unread'), action = dx < 0 ? 'delete' : rightAct();
    (async () => {
      try {
        if (action === 'restore') { await actMsgs([id], 'restore'); toast('Przywrócono'); }
        else await orgDo([id], action);
        if (wasUnread && !['spam', 'offers', 'trash'].includes(S.filter)) { S.unread = Math.max(0, S.unread - 1); badge(); }
        collapse(r); setTimeout(refreshCounts, 380);
      } catch (e) { toast(e.message || 'Błąd'); }
    })();
  };
  v.addEventListener('touchend', end); v.addEventListener('touchcancel', end);
})();
// Odświeża tylko liczniki przy folderach, bez przerysowania listy.
async function refreshCounts() {
  try { const m = await get('/api/messages?limit=1'); S.counts = m.counts; const c = m.counts || {};
    const bt = $('.bulk .bt'); if (bt) { if (c[S.filter]) bt.textContent = `${FOLDER_NAME[S.filter]} · ${c[S.filter]}`; else $('.bulk').remove(); }
    for (const k of ['offers', 'spam', 'snoozed', 'trash']) { const el = $('#cnt-' + k); if (el) { if (c[k]) el.textContent = c[k]; else el.remove(); } }
  } catch { /* cicho */ }
}
$('#fab').onclick = () => composeSheet();
// Samonaprawa: iOS bywa, że gubi subskrypcję, a serwer zna tylko starą. Przy starcie odnawiamy ją po cichu.
async function pushHeal() {
  try {
    if (!S.user || S.offline || !('PushManager' in window) || Notification.permission !== 'granted') return;
    let wanted = false; try { wanted = !!localStorage.getItem('pushwanted'); } catch {}
    const st = await pushState(); if (!st.ok) return;
    let sub = st.sub;
    if (!sub && wanted) { const { key } = await get('/api/push/key'); sub = await st.reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(key) }); }
    if (sub) await post('/api/push/subscribe', { subscription: sub.toJSON() });
  } catch { /* cicho */ }
}
async function findItem(id) {
  const loc = S.cur?.items.find((i) => i.id === id); if (loc) return loc;
  const r = await get('/api/today'); return r.items.find((i) => i.id === id) || (await get('/api/items?status=new')).items.find((i) => i.id === id);
}

// ---- start ----
async function boot() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  try { const s = await get('/api/state'); S.user = s.user; S.setupNeeded = s.setupNeeded; S.demoAllowed = s.demoAllowed; }
  catch { S.user = cacheGet('inbox') ? { email: 'offline' } : null; S.offline = true; }
  if (S.user && !S.offline) await Promise.race([loadContacts(true), new Promise((r) => setTimeout(r, 800))]);
  route(); pushHeal();
  if (S.user && 'EventSource' in window) {
    const es = new EventSource('api/events');
    es.addEventListener('sync', (e) => { const d = JSON.parse(e.data); toast(d.woke ? 'Odłożona wiadomość wróciła' : `Nowe wiadomości: ${d.added}`); if (/^(#\/?|#\/today)?$/.test(location.hash)) { S.animate = false; route(); } });
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.user && /^(#\/?|#\/today)?$/.test(location.hash) && !$('#sheet-root').firstChild) { S.animate = false; route(); } });
}
boot();

document.addEventListener('keydown', (e) => { if (e.key === 'Escape') requestClose(); });
