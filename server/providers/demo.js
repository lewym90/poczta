// Konto demonstracyjne: te same wiadomości co w projekcie, z datami liczonymi od dziś. Do prób bez prawdziwej poczty.
const day = (n, h = 9, m = 0) => { const d = new Date(); d.setDate(d.getDate() + n); d.setHours(h, m, 0, 0); return d; };
const dm = (d) => `${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`;
const hm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

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
    ].map((m) => ({ ...m, messageId: `<demo-${m.uid}@poczta.local>`, toAddr: 'ty@example.com', snippet: m.body.replace(/\s+/g, ' ').slice(0, 160), hasAttach: m.uid === 3, ics: [] }));
    return { messages, lastUid: 6 };
  },
  async setSeen() {},
  async send() { return { messageId: '<demo-sent>' }; },
};
