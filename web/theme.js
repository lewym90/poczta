// Motyw ustawiany przed pierwszym malowaniem, żeby nie mrugało. Domyślnie „Złoto”, „Noc” na życzenie (Konto → Wygląd).
(function () {
  var t = 'gold';
  try { t = localStorage.getItem('poczta.theme') === 'noc' ? 'noc' : 'gold'; } catch (e) { /* brak dostępu do pamięci */ }
  if (t === 'gold') document.documentElement.classList.add('gold');
  var m = document.querySelector('meta[name="theme-color"]');
  if (m) m.setAttribute('content', t === 'gold' ? '#080706' : '#05070D');
})();
