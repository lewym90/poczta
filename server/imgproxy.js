// Proxy obrazków z wiadomości: serwer pobiera obrazek za Ciebie, więc nadawca widzi adres serwera, a nie Twój telefon.
// Zabezpieczenia: tylko http/https na portach 80/443, adres sprawdzany w chwili łączenia (ochrona przed SSRF i DNS rebinding),
// tylko obrazy rastrowe (bez SVG), limit rozmiaru i czasu, maksymalnie 3 przekierowania.
import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import net from 'node:net';

const PRIVATE = /^(10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|192\.0\.0\.|198\.1[89]\.|22[4-9]\.|2[3-5]\d\.)/;
export function isPrivateAddr(a) {
  const x = String(a).toLowerCase();
  if (x.startsWith('::ffff:')) return isPrivateAddr(x.slice(7));
  return PRIVATE.test(x) || x === '::1' || x === '::' || /^f[cd]/.test(x) || /^fe[89ab]/.test(x);
}
function safeLookup(host, opts, cb) {
  dns.lookup(host, { all: true }, (err, addrs) => {
    if (err) return cb(err);
    const ok = addrs.filter((a) => !isPrivateAddr(a.address));
    if (!ok.length) return cb(Object.assign(new Error('Adres prywatny'), { code: 'EPRIVATE' }));
    if (opts && opts.all) cb(null, ok); else cb(null, ok[0].address, ok[0].family);
  });
}

const MAX = 6 * 1024 * 1024, LIMIT_CACHE = 24 * 1024 * 1024;
const cache = new Map(); let cacheBytes = 0;
const remember = (k, v) => {
  if (v.buf.length > 1.5 * 1024 * 1024) return;
  cache.set(k, v); cacheBytes += v.buf.length;
  while (cacheBytes > LIMIT_CACHE) { const [kk, vv] = cache.entries().next().value; cache.delete(kk); cacheBytes -= vv.buf.length; }
};

function once(url, hop, getImpl) {
  return new Promise((resolve, reject) => {
    let u; try { u = new URL(url); } catch { return reject(new Error('Zły adres')); }
    if (!/^https?:$/.test(u.protocol) || (u.port && !['80', '443'].includes(u.port)) || u.username || u.password) return reject(new Error('Niedozwolony adres'));
    if (net.isIP(u.hostname) && isPrivateAddr(u.hostname)) return reject(new Error('Adres prywatny'));
    const lib = u.protocol === 'https:' ? https : http;
    const req = (getImpl || lib.get)(u, { lookup: safeLookup, timeout: 8000, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PocztaImageProxy)', Accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif,*/*;q=0.5', 'Accept-Encoding': 'identity' } }, (res) => {
      const sc = res.statusCode || 0;
      if ([301, 302, 303, 307, 308].includes(sc) && res.headers.location) {
        res.resume();
        if (hop >= 3) return reject(new Error('Za dużo przekierowań'));
        let next; try { next = new URL(res.headers.location, u).href; } catch { return reject(new Error('Zły adres')); }
        return once(next, hop + 1, getImpl).then(resolve, reject);
      }
      const type = String(res.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      if (sc !== 200 || !/^image\/(png|jpe?g|gif|webp|avif|bmp|x-icon|vnd\.microsoft\.icon)$/.test(type)) { res.resume(); return reject(new Error('To nie obrazek')); }
      if (+res.headers['content-length'] > MAX) { res.resume(); return reject(new Error('Za duży')); }
      const chunks = []; let n = 0;
      res.on('data', (c) => { n += c.length; if (n > MAX) { req.destroy(new Error('Za duży')); } else chunks.push(c); });
      res.on('end', () => resolve({ type, buf: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('Przekroczono czas')));
    req.on('error', reject);
  });
}

export async function fetchImage(url, getImpl) {
  const hit = cache.get(url); if (hit) return hit;
  const r = await once(url, 0, getImpl);
  remember(url, r);
  return r;
}
