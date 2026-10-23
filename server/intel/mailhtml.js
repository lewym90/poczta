// Czyszczenie HTML wiadomości do wyświetlenia "tak jak został nadany". Bezpieczeństwo zapewnia piaskownica iframe + CSP po stronie
// przeglądarki (brak skryptów); tu dodatkowo zostawiamy tylko znane znaczniki i atrybuty oraz kierujemy obrazki przez własne proxy.
import { Parser } from 'htmlparser2';

const TAGS = new Set('a abbr address article aside b bdi bdo big blockquote br caption center cite code col colgroup dd del details dfn div dl dt em figcaption figure font footer h1 h2 h3 h4 h5 h6 header hr i img ins kbd li main mark nav ol p pre q s samp section small span strike strong sub summary sup table tbody td tfoot th thead tr tt u ul var wbr'.split(' '));
const SKIP_CONTENT = new Set(['script', 'iframe', 'object', 'embed', 'noscript', 'title', 'svg', 'math', 'video', 'audio', 'canvas', 'template', 'select', 'textarea', 'button', 'applet', 'frameset', 'noframes']);
const VOID = new Set(['br', 'hr', 'img', 'col', 'wbr']);
const ATTRS = new Set(['style', 'class', 'id', 'align', 'valign', 'width', 'height', 'bgcolor', 'border', 'cellpadding', 'cellspacing', 'colspan', 'rowspan', 'color', 'face', 'size', 'dir', 'lang', 'title', 'nowrap', 'hspace', 'vspace', 'start', 'type', 'summary', 'role', 'alt']);
const TRACKER = /(\/(track|pixel|beacon|open|impression|wf\/open)\b|[?&](open|track|pixel)=|\b(pixel|beacon|tracking)\.|\/o\/[A-Za-z0-9_-]{16,}|\.gif\?.*(uid|rid|email|cid)=)/i;
const MAX_DATA = 400 * 1024;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const px = (v) => { const m = String(v || '').match(/^\s*(\d+)(px)?\s*$/i); return m ? +m[1] : null; };

export function cleanCss(css, imgUrl) {
  return String(css)
    .replace(/@import[^;]*;?/gi, '')
    .replace(/prefers-color-scheme\s*:\s*dark/gi, 'min-width:99999px') // maile mają wyglądać jak w jasnym motywie; styl "ciemny" bez naszego tła dawałby biały tekst na białym
    .replace(/expression\s*\(|behavior\s*:|-moz-binding\s*:|javascript\s*:|vbscript\s*:/gi, 'x')
    .replace(/url\(\s*(['"]?)([\s\S]*?)\1\s*\)/gi, (m, q, u) => { const r = imgUrl(u.trim().replace(/&amp;/g, '&')); return r ? `url("${r.replace(/"/g, '%22')}")` : 'none'; });
}

// opts.images: czy ładować obrazki zdalne (przez proxy). Zwraca { html, remote } albo null, gdy HTML jest pusty lub zbyt duży.
export function cleanHtml(raw, { images = true, proxy = 'api/img?u=', cid = null } = {}) {
  const src = String(raw || '');
  if (!src.trim() || src.length > 3e6) return null;
  let remote = 0;
  const imgUrl = (u) => {
    if (/^data:image\/(png|jpe?g|gif|webp|avif);base64,/i.test(u)) return u.length < MAX_DATA ? u : null;
    if (cid && /^cid:/i.test(u)) return cid(u.slice(4).trim().replace(/^<|>$/g, ''));
    if (!/^https?:\/\//i.test(u)) return null;
    remote++;
    return images ? proxy + encodeURIComponent(u) : null;
  };
  const out = []; let size = 0;
  const w = (s) => { size += s.length; if (size > 2.5e6) throw new Error('za duże'); out.push(s); };
  const skipStack = []; let skipDepth = 0, inStyle = false, styleBuf = '';
  const parser = new Parser({
    onopentag(name, a) {
      if (skipDepth) { if (!VOID.has(name)) skipDepth++; return; }
      if (SKIP_CONTENT.has(name)) { skipDepth = 1; return; }
      if (name === 'style') { inStyle = true; styleBuf = ''; return; }
      if (name === 'body') { // treść body trafia do kontenera z jego tłem i kolorem
        const st = a.style ? cleanCss(a.style, imgUrl) : '';
        const bg = a.bgcolor ? `background-color:${esc(a.bgcolor)};` : '';
        w(`<div class="mbody" style="${esc(bg + st)}">`); skipStack.push('body'); return;
      }
      if (!TAGS.has(name)) return; // nieznane znaczniki znikają, treść zostaje
      let attrs = '';
      if (name === 'img') {
        const wd = px(a.width), ht = px(a.height), st = String(a.style || '');
        const tiny = (wd !== null && wd <= 2) || (ht !== null && ht <= 2) || /(^|;)\s*(width|height)\s*:\s*[0-2]px/i.test(st) || /display\s*:\s*none/i.test(st);
        const s = a.src || a['data-src'] || '';
        if (tiny || TRACKER.test(s)) { skipStack.push('img-skip'); return; } // piksele śledzące nie są pobierane
        const u = imgUrl(s.trim());
        attrs += u ? ` src="${esc(u)}"` : ` data-blocked="1"`;
      }
      for (const [k, v] of Object.entries(a)) {
        if (k === 'style') { attrs += ` style="${esc(cleanCss(v, imgUrl))}"`; continue; }
        if (k === 'background' && /^(td|th|table|tr|div)$/.test(name)) { const u = imgUrl(String(v).trim()); if (u) attrs += ` style="background-image:url(&quot;${esc(u)}&quot;);${esc(a.style ? cleanCss(a.style, imgUrl) : '')}"`; continue; }
        if (ATTRS.has(k)) attrs += ` ${k}="${esc(v)}"`;
        else if (name === 'a' && k === 'href' && /^(https?:|mailto:|tel:)/i.test(String(v).trim())) attrs += ` href="${esc(String(v).trim())}"`;
        else if (name === 'a' && k === 'name') attrs += ` name="${esc(v)}"`;
      }
      if (name === 'a') attrs += ' target="_blank" rel="noopener noreferrer nofollow"';
      w(`<${name}${attrs}>`);
      skipStack.push(VOID.has(name) ? 'void' : name);
    },
    ontext(t) {
      if (skipDepth) return;
      if (inStyle) { styleBuf += t; return; }
      w(esc(t).replace(/&amp;(nbsp|amp|lt|gt|quot|#\d+|#x[0-9a-f]+);/gi, '&$1;'));
    },
    onclosetag(name) {
      if (skipDepth) { if (!VOID.has(name)) skipDepth--; return; }
      if (name === 'style') { if (inStyle) w(`<style>${cleanCss(styleBuf, imgUrl).replace(/<\/style/gi, '')}</style>`); inStyle = false; return; }
      if (name === 'body') { if (skipStack.lastIndexOf('body') >= 0) { skipStack.splice(skipStack.lastIndexOf('body'), 1); w('</div>'); } return; }
      if (!TAGS.has(name)) return;
      if (VOID.has(name)) { const t = skipStack[skipStack.length - 1]; if (t === 'void' || t === 'img-skip') skipStack.pop(); return; }
      const i = skipStack.lastIndexOf(name);
      if (i >= 0) { skipStack.splice(i, 1); w(`</${name}>`); }
    },
  }, { decodeEntities: true, lowerCaseTags: true, lowerCaseAttributeNames: true, recognizeSelfClosing: true });
  try { parser.write(src); parser.end(); } catch { return null; }
  while (skipStack.length) { const t = skipStack.pop(); if (t === 'body') w('</div>'); else if (!['void', 'img-skip'].includes(t) && !VOID.has(t)) w(`</${t}>`); }
  const html = out.join('');
  if (!html.replace(/<[^>]+>/g, '').trim() && !/<img/i.test(html)) return null;
  return { html, remote };
}

// Pełny dokument do iframe: CSP bez skryptów, tylko obrazki z tej samej domeny (proxy) i data:.
export function frameDoc(inner) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="color-scheme" content="only light"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'"><base target="_blank"><style>:root{color-scheme:only light}html,body{margin:0;padding:0}body{background:#fff;color:#1a1a1a;font:15px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;word-wrap:break-word;overflow-wrap:anywhere;-webkit-text-size-adjust:100%}img{max-width:100%;height:auto;border:0}table{border-collapse:collapse}a{color:#1a56db}blockquote{margin:8px 0 8px 4px;padding-left:12px;border-left:3px solid #ccc;color:#555}pre{white-space:pre-wrap}img[data-blocked]{display:inline-block;min-width:40px;min-height:24px;background:#eee;outline:1px dashed #bbb}</style></head><body>${inner}</body></html>`;
}
