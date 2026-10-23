// Adapter IMAP/SMTP: działa z dowolną skrzynką. Interfejs identyczny dla przyszłych adapterów (Gmail API, Graph, JMAP).
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import nodemailer from 'nodemailer';
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

async function normalize(msg) {
  const p = await simpleParser(msg.source, { skipImageLinks: true });
  const ics = [];
  for (const a of p.attachments || []) if (/calendar/i.test(a.contentType) || /\.ics$/i.test(a.filename || '')) ics.push(a.content.toString('utf8'));
  const body = (p.text || htmlToText(p.html || '')).replace(/\[(?:image|obraz|logo)[^\]\n]{0,80}\]/gi, '').replace(/\r/g, '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, 200000);
  const from = p.from?.value?.[0] || {};
  return {
    uid: msg.uid, messageId: p.messageId || null,
    fromName: from.name || from.address || '', fromAddr: from.address || '', toAddr: (p.to?.value || []).map((x) => x.address).join(', '),
    subject: p.subject || '(bez tematu)', body, snippet: body.replace(/\s+/g, ' ').slice(0, 160),
    date: (p.date || msg.internalDate || new Date()).getTime(), unread: !msg.flags?.has('\\Seen'),
    hasAttach: (p.attachments || []).some((a) => !/calendar/i.test(a.contentType)), ics,
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
  async sync(cfg, pass, { lastUid = 0, first = 60 } = {}) {
    const c = client(cfg, pass); const out = [];
    try {
      await c.connect();
      const lock = await c.getMailboxLock('INBOX');
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
  async setSeen(cfg, pass, uid, seen) {
    const c = client(cfg, pass);
    try {
      await c.connect(); const lock = await c.getMailboxLock('INBOX');
      try { await (seen ? c.messageFlagsAdd(uid, ['\\Seen'], { uid: true }) : c.messageFlagsRemove(uid, ['\\Seen'], { uid: true })); } finally { lock.release(); }
    } finally { await c.logout().catch(() => {}); }
  },
  async send(cfg, pass, msg) {
    const t = transport(cfg, pass);
    return t.sendMail({ from: msg.from, to: msg.to, subject: msg.subject, text: msg.text, inReplyTo: msg.inReplyTo || undefined, references: msg.inReplyTo || undefined });
  },
};

function transport(cfg, pass) {
  return nodemailer.createTransport({ host: cfg.smtp.host, port: cfg.smtp.port, secure: cfg.smtp.secure, auth: { user: cfg.user || cfg.email, pass }, connectionTimeout: 20000 });
}
