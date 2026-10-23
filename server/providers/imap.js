// Adapter IMAP/SMTP: działa z dowolną skrzynką. Interfejs identyczny dla przyszłych adapterów (Gmail API, Graph, JMAP).
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import nodemailer from 'nodemailer';
import MailComposer from 'nodemailer/lib/mail-composer/index.js';
import { assertPublicHost } from '../security.js';

const client = (cfg, pass) => new ImapFlow({
  host: cfg.imap.host, port: cfg.imap.port, secure: cfg.imap.secure,
  auth: { user: cfg.user || cfg.email, pass }, logger: false, socketTimeout: 60000, greetingTimeout: 20000,
});

function htmlToText(html) {
  return String(html || '')
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

const INLINE_MAX = 400 * 1024;
async function normalize(msg) {
  const p = await simpleParser(msg.source);
  const ics = [], atts = [];
  (p.attachments || []).forEach((a, idx) => {
    if (/calendar/i.test(a.contentType) || /\.ics$/i.test(a.filename || '')) { ics.push(a.content.toString('utf8')); return; }
    const inline = !!(a.cid && (a.related || a.contentDisposition === 'inline') && /^image\//i.test(a.contentType));
    atts.push({ idx, filename: a.filename || (inline ? 'obraz' : `załącznik-${idx + 1}`), ctype: a.contentType || 'application/octet-stream', size: a.size || a.content?.length || 0,
      cid: a.cid ? String(a.cid).replace(/^<|>$/g, '') : null, inline, data: inline && a.content && a.content.length <= INLINE_MAX ? a.content : null });
  });
  const body = (p.text || htmlToText(p.html || '')).replace(/\[(?:image|obraz|logo)[^\]\n]{0,80}\]/gi, '').replace(/\r/g, '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, 200000);
  const from = p.from?.value?.[0] || {};
  return {
    uid: msg.uid, messageId: p.messageId || null, refs: [].concat(p.references || []).join(' ').slice(0, 2000) || null, ccAddr: (p.cc?.value || []).map((x) => x.address).filter(Boolean).join(', '), starred: !!msg.flags?.has('\\Flagged'),
    fromName: from.name || from.address || '', fromAddr: from.address || '', toAddr: (p.to?.value || []).map((x) => x.address).join(', '),
    subject: p.subject || '(bez tematu)', body, snippet: body.replace(/\s+/g, ' ').slice(0, 160),
    date: (p.date || msg.internalDate || new Date()).getTime(), unread: !msg.flags?.has('\\Seen'),
    hasAttach: atts.some((a) => !a.inline), atts, ics,
    html: typeof p.html === 'string' ? p.html : '',
    unsub: !!p.headers?.get('list-unsubscribe'),
    bulk: /^(bulk|list|junk)$/i.test(String(p.headers?.get('precedence') || '')) || !!p.headers?.get('list-id') || !!p.headers?.get('x-campaign') || !!p.headers?.get('x-mailchimp-id') || !!p.headers?.get('feedback-id'),
  };
}

export const imap = {
  id: 'imap',
  async test(cfg, pass) {
    await assertPublicHost(cfg.imap.host);
    const c = client(cfg, pass);
    try { await c.connect(); const lock = await c.getMailboxLock('INBOX'); lock.release(); } finally { await c.logout().catch(() => {}); }
    if (cfg.smtp?.host) {
      await assertPublicHost(cfg.smtp.host);
      const t = transport(cfg, pass); await t.verify();
    }
  },
  // Pobiera nowe wiadomości od lastUid (pierwszy raz: ostatnie `first`).
  async sync(cfg, pass, { lastUid = 0, first = 60, path = 'INBOX' } = {}) {
    const c = client(cfg, pass); const out = [];
    try {
      await c.connect();
      const lock = await c.getMailboxLock(path);
      try {
        const total = c.mailbox.exists;
        if (!total) return { messages: [], lastUid };
        const range = lastUid ? `${lastUid + 1}:*` : `${Math.max(1, total - first + 1)}:*`;
        for await (const m of c.fetch(range, { uid: true, flags: true, internalDate: true, source: { maxLength: 3 * 1024 * 1024 } }, { uid: !!lastUid })) {
          if (lastUid && m.uid <= lastUid) continue;
          try { out.push(await normalize(m)); } catch { /* uszkodzona wiadomość pomijamy */ }
        }
      } finally { lock.release(); }
    } finally { await c.logout().catch(() => {}); }
    out.sort((a, b) => a.uid - b.uid);
    return { messages: out, lastUid: out.length ? out[out.length - 1].uid : lastUid };
  },
  // Starsze wiadomości (UID mniejsze niż beforeUid): kolejna porcja `count`. `left` mówi, ile jeszcze zostało na serwerze.
  async history(cfg, pass, { beforeUid, count = 60 }) {
    const c = client(cfg, pass), out = [];
    try {
      await c.connect();
      const lock = await c.getMailboxLock('INBOX');
      try {
        const all = beforeUid > 1 ? await c.search({ uid: `1:${beforeUid - 1}` }, { uid: true }) : [];
        const take = (all || []).sort((a, b) => a - b).slice(-count);
        if (take.length) for await (const m of c.fetch(take.join(','), { uid: true, flags: true, internalDate: true, source: { maxLength: 3 * 1024 * 1024 } }, { uid: true })) {
          try { out.push(await normalize(m)); } catch { /* pomijamy uszkodzoną */ }
        }
        return { messages: out.sort((a, b) => a.uid - b.uid), left: Math.max(0, (all || []).length - take.length) };
      } finally { lock.release(); }
    } finally { await c.logout().catch(() => {}); }
  },
  // Trwałe połączenie z IDLE. Zwraca funkcję zatrzymującą.
  async watch(cfg, pass, { onExists, onClose }) {
    await assertPublicHost(cfg.imap.host);
    const c = client(cfg, pass);
    c.on('error', () => {});
    c.on('exists', () => onExists());
    c.on('close', () => onClose());
    await c.connect();
    await c.mailboxOpen('INBOX'); // ImapFlow wchodzi w IDLE automatycznie, gdy nic innego się nie dzieje
    return () => c.logout().catch(() => {});
  },
  // Dociąga oryginalny HTML jednej wiadomości (dla starszych, pobranych zanim zaczęliśmy go zapisywać).
  async fetchHtml(cfg, pass, uid, path = 'INBOX') {
    const c = client(cfg, pass);
    try {
      await c.connect();
      const lock = await c.getMailboxLock(path);
      try {
        const m = await c.fetchOne(String(uid), { uid: true, source: { maxLength: 6 * 1024 * 1024 } }, { uid: true });
        if (!m?.source) return '';
        const n = await normalize({ ...m, flags: new Set() });
        return n.html || '';
      } finally { lock.release(); }
    } finally { await c.logout().catch(() => {}); }
  },
  // Pobiera jeden załącznik (po indeksie w strukturze wiadomości) wprost z serwera poczty.
  async fetchAttachment(cfg, pass, uid, idx, folderPath = 'INBOX') {
    const c = client(cfg, pass);
    try {
      await c.connect();
      const lock = await c.getMailboxLock(folderPath);
      try {
        const m = await c.fetchOne(String(uid), { uid: true, source: { maxLength: 40 * 1024 * 1024 } }, { uid: true });
        if (!m?.source) return null;
        const a = (await simpleParser(m.source)).attachments?.[idx];
        return a ? { filename: a.filename, ctype: a.contentType, content: a.content } : null;
      } finally { lock.release(); }
    } finally { await c.logout().catch(() => {}); }
  },
  // Dociąga HTML wielu wiadomości jednym połączeniem (uzupełnianie w tle). Zwraca [{uid, html}].
  async fetchHtmlBatch(cfg, pass, uids) {
    const c = client(cfg, pass), out = [];
    try {
      await c.connect();
      const lock = await c.getMailboxLock('INBOX');
      try {
        for await (const m of c.fetch(uids.join(','), { uid: true, source: { maxLength: 6 * 1024 * 1024 } }, { uid: true })) {
          try { const n = await normalize({ ...m, flags: new Set() }); out.push({ uid: m.uid, html: n.html || '', atts: n.atts }); } catch { out.push({ uid: m.uid, html: '', atts: null }); }
        }
      } finally { lock.release(); }
    } finally { await c.logout().catch(() => {}); }
    return out;
  },
  // Przenosi wiadomości do kosza u dostawcy (odwracalne u niego przez ok. 30 dni). Zwraca liczbę przeniesionych.
  // Znajduje foldery specjalne (Wysłane, Szkice) po atrybucie \\Sent / \\Drafts, a gdy go brak, po typowych nazwach.
  async listSpecial(cfg, pass) {
    const c = client(cfg, pass);
    try {
      await c.connect();
      const boxes = await c.list();
      const find = (use, re) => (boxes.find((b) => b.specialUse === use) || boxes.find((b) => re.test(b.path) || re.test(b.name)))?.path || '';
      return { sent: find('\\Sent', /^(\[gmail\]\/)?(sent( mail| items| messages)?|wys[łl]ane|elementy wys[łl]ane)$/i), drafts: find('\\Drafts', /^(\[gmail\]\/)?(drafts?|szkice|wersje robocze)$/i) };
    } finally { await c.logout().catch(() => {}); }
  },
  async trash(cfg, pass, uids, path = 'INBOX') {
    const c = client(cfg, pass);
    try {
      await c.connect();
      const boxes = await c.list();
      const t = boxes.find((b) => b.specialUse === '\\Trash') || boxes.find((b) => /^(trash|kosz|deleted( items| messages)?|elementy usuni[ęe]te|\[gmail\]\/(trash|kosz))$/i.test(b.path) || /^(trash|kosz)$/i.test(b.name));
      if (!t) throw new Error('Nie znaleziono kosza u dostawcy');
      const lock = await c.getMailboxLock(path);
      try { await c.messageMove(uids.join(','), t.path, { uid: true }); } finally { lock.release(); }
      return uids.length;
    } finally { await c.logout().catch(() => {}); }
  },
  async setSeen(cfg, pass, uid, seen, path = 'INBOX') {
    const c = client(cfg, pass);
    try {
      await c.connect(); const lock = await c.getMailboxLock(path);
      try { await (seen ? c.messageFlagsAdd(uid, ['\\Seen'], { uid: true }) : c.messageFlagsRemove(uid, ['\\Seen'], { uid: true })); } finally { lock.release(); }
    } finally { await c.logout().catch(() => {}); }
  },
  async send(cfg, pass, msg) {
    const t = transport(cfg, pass);
    return t.sendMail(mailOpts(msg));
  },
  // Zapisuje szkic w folderze Szkice u dostawcy (flaga \\Draft), wraz z załącznikami.
  async saveDraft(cfg, pass, msg, path) {
    const raw = await new Promise((res, rej) => new MailComposer(mailOpts(msg)).compile().build((e, b) => (e ? rej(e) : res(b))));
    const c = client(cfg, pass);
    try { await c.connect(); await c.append(path, raw, ['\\Draft', '\\Seen']); } finally { await c.logout().catch(() => {}); }
  },
  // Gwiazdka (\\Flagged) po stronie dostawcy.
  async setFlagged(cfg, pass, uid, on, path = 'INBOX') {
    const c = client(cfg, pass);
    try {
      await c.connect(); const lock = await c.getMailboxLock(path);
      try { await (on ? c.messageFlagsAdd(uid, ['\\Flagged'], { uid: true }) : c.messageFlagsRemove(uid, ['\\Flagged'], { uid: true })); } finally { lock.release(); }
    } finally { await c.logout().catch(() => {}); }
  },
  // Archiwizacja: przeniesienie do folderu \\Archive (u Gmaila: Cała poczta), a gdy go brak, zwykłe pozostawienie w skrzynce.
  async archive(cfg, pass, uids) {
    const c = client(cfg, pass);
    try {
      await c.connect();
      const boxes = await c.list();
      const t = boxes.find((b) => b.specialUse === '\\Archive') || boxes.find((b) => b.specialUse === '\\All') || boxes.find((b) => /^(archive|archiwum|\[gmail\]\/(all mail|cała poczta|wszystkie))$/i.test(b.path));
      if (!t) throw new Error('Nie znaleziono archiwum u dostawcy');
      const lock = await c.getMailboxLock('INBOX');
      try { await c.messageMove(uids.join(','), t.path, { uid: true }); } finally { lock.release(); }
      return uids.length;
    } finally { await c.logout().catch(() => {}); }
  },
  // Lista wszystkich folderów u dostawcy (do przeglądania).
  async folders(cfg, pass) {
    const c = client(cfg, pass);
    try {
      await c.connect();
      return (await c.list()).filter((b) => !b.flags?.has('\\Noselect') && !b.flags?.has('\\NonExistent')).map((b) => ({ path: b.path, name: b.name, use: b.specialUse || '' }));
    } finally { await c.logout().catch(() => {}); }
  },
};

function mailOpts(msg) {
  return {
    from: msg.from, to: msg.to || undefined, cc: msg.cc || undefined, bcc: msg.bcc || undefined, subject: msg.subject || '', text: msg.text || '',
    inReplyTo: msg.inReplyTo || undefined, references: msg.references || msg.inReplyTo || undefined,
    attachments: (msg.attachments || []).map((a) => ({ filename: a.name, contentType: a.type || undefined, content: a.content })),
  };
}
function transport(cfg, pass) {
  return nodemailer.createTransport({ host: cfg.smtp.host, port: cfg.smtp.port, secure: cfg.smtp.secure, auth: { user: cfg.user || cfg.email, pass }, connectionTimeout: 20000 });
}
