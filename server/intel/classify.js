// Sortowanie poczty: Skrzynka (ważne) / Oferty (marketing, newslettery) / Spam (oszustwa, śmieci) / Zablokowane.
// Reguły użytkownika zawsze wygrywają z heurystyką. Wszystko lokalnie, bez wysyłania treści gdziekolwiek.
import { norm } from './dates.js';

const FREEMAIL = new Set(['gmail.com', 'wp.pl', 'o2.pl', 'onet.pl', 'op.pl', 'interia.pl', 'poczta.fm', 'icloud.com', 'me.com', 'outlook.com', 'hotmail.com', 'yahoo.com', 'gmx.com', 'gmx.net', 'proton.me', 'protonmail.com', 'live.com', 'tlen.pl', 'buziaczek.pl', 'vp.pl', 'onet.eu', 'autograf.pl', 'go2.pl']);
export const isFreemail = (d) => FREEMAIL.has(String(d || '').toLowerCase());
export const addrDomain = (a) => String(a || '').split('@')[1]?.toLowerCase() || '';

// Marketing: każdy trafiony wzorzec to 1 punkt (z limitem), wyraźne sygnały po 2.
const PROMO_STRONG = [
  /wypisz si[eę]/i, /zrezygnuj z (otrzymywania|subskrypcji)/i, /unsubscribe/i, /view (this )?(email )?in (your )?browser/i, /zobacz (ten )?(e-?mail|wiadomo[śs][ćc]) w przegl[aą]darce/i,
  /kod rabatowy/i, /-\s?\d{1,2}\s?%/, /\d{1,2}\s?%\s?(rabat|taniej|zni[żz]k)/i, /black friday|cyber monday|wyprzeda[żz]/i,
  /nie przegap/i, /tylko (dzi[śs]|do|przez)/i, /ostatnie (godziny|sztuki|dni)/i, /oferta (specjalna|ograniczona|limitowana)/i,
];
const PROMO_WEAK = [
  /promocj/i, /rabat/i, /zni[żz]k/i, /gratis/i, /darmow\w+ (dostaw|przesy[łl]k)/i, /bezp[łl]atn\w+ (dostaw|przesy[łl]k)/i, /kup (teraz|ju[żz])/i, /zam[óo]w (teraz|ju[żz]|online)/i,
  /sprawd[źz] (nasz|jak|co|nowo)/i, /nowo[śs][ćc]i|nowa kolekcja|kolekcj/i, /odkryj|poznaj|zajrzyj|zobacz wi[eę]cej|dowiedz si[eę] wi[eę]cej/i, /wygraj|konkurs|losowanie/i,
  /newsletter/i, /twoja (ulubiona|wymarzona)/i, /dla ciebie|specjalnie dla/i, /kupon|voucher/i, /polecamy|inspiracj/i, /sezon|okazj/i,
];
const MARKETING_SENDER = /^(news|newsletter|info|marketing|promo|promocje|oferty|oferta|hello|hi|kontakt|mailing|mail|team|noreply|no-reply|donotreply|do-not-reply|sklep|shop|store|biuletyn|powiadomienia)\b/i;
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B50}\u{2705}]/u;

// Wiadomości, które wyglądają na ważne: obniżają wynik marketingowy.
const TRANSACTIONAL = [
  /faktur[aey] (nr|numer|vat|fv)|nr faktury|numer faktury/i, /do zap[łl]aty|termin p[łl]atno[śs]ci|zaleg[łl]o/i, /kod (weryfikacyjn|jednorazow|autoryzacyjn|logowania)|jednorazowy kod/i,
  /numer (zam[óo]wienia|przesy[łl]ki|rezerwacji|zg[łl]oszenia|reklamacji)/i, /potwierdzenie (wizyty|rezerwacji|zam[óo]wienia|p[łl]atno[śs]ci|przelewu)/i, /(twoja|twoje) (paczka|przesy[łl]ka|zam[óo]wienie) (jest|zosta[łl]|czeka|dotrze|w drodze)/i,
  /alert bezpiecze[ńn]stwa|nowe logowanie|reset(owanie)? has[łl]a|zmiana has[łl]a/i, /wizyt[aey] (zosta[łl]a|jest)|umówion/i, /reklamacj/i, /umowa|aneks|wypowiedzenie/i, /zaproszenie (na|do) (spotkani|rozmow|wizyt)/i,
];
const SPAM = [
  /kasyn|casino|bukmacher|zak[łl]ady sportowe|jackpot|gry hazardowe/i, /viagra|cialis|potencj[ai]|powi[ęe]kszen/i, /po[żz]yczk\w+ (bez|od r[ąa]ki|online|chwil[oó]wk)|chwil[oó]wk|kredyt (bez|dla zad[łl]u)/i,
  /wygra[łl]e[śs]|gratulujemy wygran|zosta[łl]e[śs] wylosowan|wygrana (czeka|do odebrania)/i, /bitcoin|kryptowalut\w+|zainwestuj .{0,30}zarob|zarabiaj .{0,25}(z domu|dziennie)|pasywny doch[óo]d/i,
  /dziedzictw|spadek po|przelew zagraniczn|transfer of funds|beneficiary|inheritance/i, /18\+|dla doros[łl]ych|randk\w+ z|samotn\w+ (kobiet|panie)/i, /schudnij|spalacz t[łl]uszczu|cud[a-z]* (kuracj|preparat)/i,
];

const count = (list, t) => list.reduce((n, r) => n + (r.test(t) ? 1 : 0), 0);

// m: { fromAddr, fromName, subject, body, bulk?, unsub?, risk? }; rules: [{kind:'sender'|'domain', value, action}]
export function matchRule(rules, fromAddr) {
  const a = String(fromAddr || '').toLowerCase(), d = addrDomain(a);
  return rules.find((r) => r.kind === 'sender' && r.value === a) || rules.find((r) => r.kind === 'domain' && r.value === d) || null;
}

export function classify(m, rules = []) {
  const rule = matchRule(rules, m.fromAddr);
  if (rule) return { cat: { block: 'blocked', spam: 'spam', offers: 'offers', inbox: 'inbox' }[rule.action] || 'inbox', by: 'rule', why: `Reguła: ${rule.kind === 'domain' ? '@' : ''}${rule.value}` };
  if ((m.risk || 0) >= 2) return { cat: 'spam', by: 'auto', why: 'Podejrzenie oszustwa' };

  const subj = String(m.subject || ''), text = `${subj}\n${String(m.body || '').slice(0, 12000)}`;
  const spam = count(SPAM, text);
  if (spam >= 2 || (spam >= 1 && (m.bulk || m.unsub))) return { cat: 'spam', by: 'auto', why: 'Typowe treści spamu' };

  const local = String(m.fromAddr || '').split('@')[0];
  let promo = 0; const why = [];
  const strong = count(PROMO_STRONG, text), weak = count(PROMO_WEAK, text);
  promo += Math.min(strong, 3) * 2 + Math.min(weak, 4);
  if (m.bulk) { promo += 3; why.push('masowa wysyłka'); }
  if (m.unsub) { promo += 2; why.push('link do wypisania się'); }
  if (MARKETING_SENDER.test(local)) { promo += 1; }
  if (EMOJI.test(subj)) { promo += 2; why.push('emoji w temacie'); }
  const letters = subj.replace(/[^A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż]/g, '');
  if (letters.length > 8 && (subj.match(/[A-ZĄĆĘŁŃÓŚŹŻ]/g) || []).length / letters.length > 0.6) { promo += 1; }
  if (strong) why.push('język promocji');
  const trans = count(TRANSACTIONAL, text);
  promo -= Math.min(trans, 2) * 3;
  if (promo >= 4) return { cat: 'offers', by: 'auto', why: why.join(', ') || 'Wygląda na ofertę' };
  return { cat: 'inbox', by: 'auto', why: '' };
}

// Reklamy w treści: nie traktujemy ich dat jak spraw (ocena kontekstu wokół daty, tekst znormalizowany).
export const PROMO_CTX = /(promocj|rabat|znizk|wygraj|konkurs|wyprzedaz|gratis|kup |zamow |kod rabatowy|darmow\w* dostaw|bezplatn\w* dostaw|oferta|nie przegap|tylko do|-\d+%|\d+%)/;
export const hasPromoCtx = (s) => PROMO_CTX.test(norm(s));
