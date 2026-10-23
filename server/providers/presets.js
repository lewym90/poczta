// Ustawienia popularnych skrzynek. Reszta: użytkownik wpisuje serwery ręcznie.
export const PRESETS = {
  'gmail.com': { name: 'Gmail', imap: ['imap.gmail.com', 993, true], smtp: ['smtp.gmail.com', 465, true], note: 'Wymaga hasła aplikacji (weryfikacja dwuetapowa).' },
  'googlemail.com': { name: 'Gmail', imap: ['imap.gmail.com', 993, true], smtp: ['smtp.gmail.com', 465, true], note: 'Wymaga hasła aplikacji.' },
  'icloud.com': { name: 'iCloud', imap: ['imap.mail.me.com', 993, true], smtp: ['smtp.mail.me.com', 587, false], note: 'Hasło aplikacji z appleid.apple.com.' },
  'me.com': { name: 'iCloud', imap: ['imap.mail.me.com', 993, true], smtp: ['smtp.mail.me.com', 587, false], note: 'Hasło aplikacji z appleid.apple.com.' },
  'outlook.com': { name: 'Outlook', imap: ['outlook.office365.com', 993, true], smtp: ['smtp.office365.com', 587, false], note: 'Microsoft wyłącza hasła w wielu kontach: wtedy potrzebne będzie logowanie OAuth (etap 2).' },
  'hotmail.com': { name: 'Outlook', imap: ['outlook.office365.com', 993, true], smtp: ['smtp.office365.com', 587, false], note: 'Jak wyżej.' },
  'wp.pl': { name: 'WP', imap: ['imap.wp.pl', 993, true], smtp: ['smtp.wp.pl', 465, true], note: 'Włącz dostęp przez IMAP w ustawieniach WP.' },
  'o2.pl': { name: 'O2', imap: ['poczta.o2.pl', 993, true], smtp: ['poczta.o2.pl', 465, true], note: '' },
  'tlen.pl': { name: 'Tlen', imap: ['poczta.o2.pl', 993, true], smtp: ['poczta.o2.pl', 465, true], note: '' },
  'onet.pl': { name: 'Onet', imap: ['imap.poczta.onet.pl', 993, true], smtp: ['smtp.poczta.onet.pl', 465, true], note: '' },
  'op.pl': { name: 'Onet', imap: ['imap.poczta.onet.pl', 993, true], smtp: ['smtp.poczta.onet.pl', 465, true], note: '' },
  'interia.pl': { name: 'Interia', imap: ['poczta.interia.pl', 993, true], smtp: ['poczta.interia.pl', 465, true], note: '' },
  'gmx.com': { name: 'GMX', imap: ['imap.gmx.com', 993, true], smtp: ['mail.gmx.com', 587, false], note: '' },
  'proton.me': { name: 'Proton', imap: ['127.0.0.1', 1143, false], smtp: ['127.0.0.1', 1025, false], note: 'Wymaga Proton Bridge (nie działa z serwera zdalnego).' },
};
export const presetFor = (email) => PRESETS[String(email).split('@')[1]?.toLowerCase()] || null;
