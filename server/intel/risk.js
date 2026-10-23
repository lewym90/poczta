// Ochrona przed oszustwem: lokalne sygnały (bez wysyłania treści gdziekolwiek).
const SUSPICIOUS_TLD = /\.(xyz|top|click|work|buzz|rest|icu|cfd|sbs|monster|zip|mov)$/i;
const URGENT = /(pilne|natychmiast|w ciągu \d+ godzin|w ciagu \d+ godzin|ostatnie ostrze|konto zostanie zablokowane|zablokowan|zawieszon|ostatni dzień)/i;
const CRED = /(podaj dane|zaloguj|potwierdź dane|potwierdz dane|hasło|haslo|kod blik|numer karty|dane logowania|zweryfikuj konto)/i;
const PAYMENT = /(dopłat|doplat|opłać|oplac|zapłać|zaplac)/i;
const domain = (a) => String(a || '').split('@')[1]?.toLowerCase() || '';

export function assessRisk({ fromAddr, fromName, subject, body }) {
  const reasons = []; let score = 0;
  const d = domain(fromAddr);
  const text = `${subject}\n${body}`;
  if (SUSPICIOUS_TLD.test(d)) { reasons.push(`Nadawca używa podejrzanej domeny (${d})`); score += 2; }
  const links = [...text.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map((m) => m[1].toLowerCase());
  const foreign = links.filter((h) => d && !h.endsWith(d) && !d.endsWith(h));
  if (links.some((h) => SUSPICIOUS_TLD.test(h))) { reasons.push('Link prowadzi do podejrzanej domeny'); score += 2; }
  else if (foreign.length && CRED.test(text)) { reasons.push('Link prowadzi do innej domeny niż nadawca'); score += 1; }
  if (URGENT.test(text)) { reasons.push('Presja czasu i groźba blokady'); score += 1; }
  if (CRED.test(text)) { reasons.push('Prośba o dane logowania lub potwierdzenie danych'); score += 2; }
  if (PAYMENT.test(subject) && links.length && SUSPICIOUS_TLD.test(d)) { reasons.push('Prośba o drobną dopłatę: znany schemat'); score += 1; }
  const brand = /(bank|kurier|inpost|dpd|dhl|allegro|paypal|poczta polska|urząd|urzad)/i.exec(`${fromName} ${subject}`);
  if (brand && d && !d.includes(brand[1].toLowerCase().replace(/\s/g, '')) && score >= 2) { reasons.push(`Podszywa się pod markę (${brand[1]}), ale adres należy do innej domeny`); score += 1; }
  return { risk: score >= 4 ? 2 : score >= 2 ? 1 : 0, reasons: score >= 2 ? reasons : [] };
}
