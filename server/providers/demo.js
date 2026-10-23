// Konto demonstracyjne: te same wiadomości co w projekcie, z datami liczonymi od dziś. Do prób bez prawdziwej poczty.
const day = (n, h = 9, m = 0) => { const d = new Date(); d.setDate(d.getDate() + n); d.setHours(h, m, 0, 0); return d; };
const dm = (d) => `${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`;
const hm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

// minimalny, poprawny PDF jednej strony do prób pobierania załączników
const DEMO_PDF = Buffer.from('%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 120]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n4 0 obj<</Length 52>>stream\nBT /F1 18 Tf 20 60 Td (Faktura FV/10/2026) Tj ET\nendstream endobj\n5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R/Size 6>>\n%%EOF\n');

export const demo = {
  id: 'demo',
  async test() {},
  async sync(cfg, pass, { lastUid = 0 } = {}) {
    if (lastUid) return { messages: [], lastUid };
    const visit = day(5, 17, 30), inv = day(12), meet = day(6, 10, 0);
    const ago = (h) => Date.now() - h * 3600e3;
    const messages = [
      { uid: 1, fromName: 'Kurier Express', fromAddr: 'powiadomienia@kurier-express.pl', subject: 'Twoja paczka dotrze dziś', date: ago(1.5), unread: true,
        body: 'Dzień dobry,\n\nTwoja przesyłka nr 48291 zostanie doręczona dziś w godzinach 14–16. Prosimy, aby ktoś był pod adresem dostawy.\n\nŚledź paczkę w aplikacji.\n\nKurier Express' },
      { uid: 2, fromName: 'Przychodnia Lipowa', fromAddr: 'rejestracja@przychodnia-lipowa.pl', subject: 'Potwierdzenie wizyty – kardiolog', date: ago(0.6), unread: true,
        body: `Dzień dobry,\n\npotwierdzamy wizytę u kardiologa w dniu ${dm(visit)} o godz. ${hm(visit)}. Prosimy o przybycie 10 minut wcześniej i zabranie dotychczasowych wyników badań.\n\nW razie potrzeby zmiany terminu prosimy o kontakt telefoniczny.\n\nRejestracja Przychodni Lipowa` },
      { uid: 3, fromName: 'Biuro Rachunkowe Dąbrowski', fromAddr: 'biuro@dabrowski-ksiegowosc.pl', subject: 'Faktura FV/10/2026 do opłaty', date: ago(1), unread: true,
        body: `Dzień dobry,\n\nw załączeniu faktura FV/10/2026 za usługi księgowe w październiku. Kwota do zapłaty: 1 240,00 zł. Termin płatności: ${dm(inv)}.\n\nNumer konta: 12 3456 7890 1234 5678 9012 3456.\n\nPozdrawiam\nAnna Dąbrowska` },
      { uid: 4, fromName: 'Zespół Produktu', fromAddr: 'zespol@firma.example', subject: 'Spotkanie przeniesione na czwartek', date: ago(20), unread: false,
        body: `Cześć,\n\nplanowanie sprintu przenosimy na ${dm(meet)}, godz. ${hm(meet)}. Sala 3, zaproszenie poniżej.\n\nDo zobaczenia!` },
      { uid: 5, fromName: 'Marta Kowalska', fromAddr: 'marta@example.com', subject: 'Re: Pomysł na weekend', date: ago(30), unread: false,
        body: 'Hej, świetny pomysł! Daj znać, czy w sobotę pasuje Ci wcześniej, bo muszę zaplanować dojazd. Pozdrawiam, Marta' },
      { uid: 6, fromName: 'Nowy Bank', fromAddr: 'security@nowy-bank-alert.xyz', subject: 'Pilne: potwierdź dane konta w ciągu 24 godzin', date: ago(40), unread: true,
        body: 'Twoje konto zostanie zablokowane. Kliknij tutaj i podaj dane logowania, aby uniknąć blokady: http://nowy-bank-alert.xyz/login' },
      { uid: 7, fromName: 'Sklep Moda', fromAddr: 'news@sklep-moda.example', subject: '🔥 -30% na całą kolekcję, tylko do niedzieli!', date: ago(3), unread: true, bulk: true, unsub: true,
        body: `Nie przegap! Kod rabatowy JESIEN30 daje -30% na nową kolekcję. Promocja trwa do ${dm(day(3))} 23:59, darmowa dostawa od 199 zł.\n\nZobacz więcej w sklepie.\n\nWypisz się z newslettera: http://sklep-moda.example/unsub` },
      { uid: 9, fromName: 'Netflix', fromAddr: 'info@members.netflix.example', subject: 'Czeka na Ciebie kolejny tytuł', date: ago(2), unread: true, bulk: true, unsub: true,
        body: 'Czeka na Ciebie kolejny tytuł. Odkryj spersonalizowaną listę filmów. Wypisz się.',
        html: '<html><head><style>.hero{background:linear-gradient(135deg,#0b3d2e,#0b1220);color:#fff;padding:28px 24px}.btn{display:inline-block;border:1px solid #fff;border-radius:22px;padding:10px 22px;color:#fff;text-decoration:none}</style></head><body style="margin:0;background:#f4f4f4"><table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center"><table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%"><tr><td class="hero"><div style="color:#e50914;font-weight:800;font-size:22px">N</div><h1 style="font-size:32px;line-height:38px;margin:18px 0 8px">Czeka na Ciebie kolejny tytuł</h1><p style="opacity:.8;margin:0 0 18px">Odkryj spersonalizowaną listę filmów, seriali i programów, których nie możesz przegapić.</p><a class="btn" href="https://netflix.example/browse">Przeglądaj wszystko</a></td></tr><tr><td style="background:#fff;padding:20px 24px;color:#333">Wybrane dla: Michał<br><div style="width:200px;height:80px;margin-top:8px;border-radius:8px;background:linear-gradient(135deg,#b5171e,#4a0b10)"></div></td></tr></table></td></tr></table></body></html>' },
      { uid: 8, fromName: 'Szybkie Pożyczki', fromAddr: 'kontakt@pozyczki-online.example', subject: 'Pożyczka bez BIK od ręki, gratulujemy wygranej!', date: ago(5), unread: true,
        body: 'Gratulujemy wygranej! Pożyczka bez BIK czeka na Ciebie, zainwestuj i zarabiaj z domu dziennie. Kliknij tutaj.' },
    ].map((m) => ({ ...m, messageId: `<demo-${m.uid}@poczta.local>`, toAddr: 'ty@example.com', snippet: m.body.replace(/\s+/g, ' ').slice(0, 160), hasAttach: m.uid === 3, atts: m.uid === 3 ? [{ idx: 0, filename: 'FV-10-2026.pdf', ctype: 'application/pdf', size: DEMO_PDF.length, cid: null, inline: false, data: DEMO_PDF }] : [], ics: [] }));
    return { messages, lastUid: 9 };
  },
  async setSeen() {},
  async send() { return { messageId: '<demo-sent>' }; },
};
