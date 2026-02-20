function s(v) {
  try { return v == null ? '' : String(v); } catch (_) { return ''; }
}

function trimTo(raw, maxLen) {
  var out = s(raw).trim();
  if (!out) return '';
  if (maxLen && out.length > maxLen) return out.slice(0, maxLen);
  return out;
}

function looksLikeUrl(raw) {
  var v = trimTo(raw, 4096);
  if (!v) return false;
  if (v[0] === '/') return true;
  return /^https?:\/\//i.test(v);
}

function extractFirstSvgMarkup(value) {
  var raw = s(value);
  if (!raw) return '';
  var m = raw.match(/<svg[\s\S]*?<\/svg>/i);
  return m && m[0] ? String(m[0]) : '';
}

function sanitizeSvgMarkup(value) {
  var svg = extractFirstSvgMarkup(value);
  if (!svg) return '';
  svg = svg.replace(/<\?xml[\s\S]*?\?>/gi, '');
  svg = svg.replace(/<!--[\s\S]*?-->/g, '');
  svg = svg.replace(/<script[\s\S]*?<\/script>/gi, '');
  svg = svg.replace(/\son[a-z]+\s*=\s*(".*?"|'.*?'|[^\s>]+)/gi, '');
  svg = svg.replace(/\s(?:href|xlink:href)\s*=\s*("javascript:[^"]*"|'javascript:[^']*'|javascript:[^\s>]+)/gi, '');
  return svg.trim();
}

function parseSvgSize(val) {
  if (val == null || typeof val !== 'string') return null;
  var n = parseFloat(val.replace(/px|em|rem|%$/i, '').trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function stripSvgSizing(value) {
  var raw = trimTo(value, 1000000);
  if (!raw) return '';
  if (!/^<svg[\s>]/i.test(raw)) return raw;
  raw = raw.replace(/^<svg\b([^>]*)>/i, function (_m, attrs) {
    var a = String(attrs || '');
    var hasViewBox = /\sviewBox\s*=/i.test(a);
    var widthMatch = a.match(/\swidth\s*=\s*(["'])([^"']*)\1/i);
    var heightMatch = a.match(/\sheight\s*=\s*(["'])([^"']*)\1/i);
    var w = widthMatch ? parseSvgSize(widthMatch[2]) : null;
    var h = heightMatch ? parseSvgSize(heightMatch[2]) : null;
    if (!hasViewBox && w != null && h != null && w > 0 && h > 0) {
      a = (a.trim() ? a + ' ' : '') + 'viewBox="0 0 ' + String(w) + ' ' + String(h) + '"';
    }
    if (hasViewBox || (w != null && h != null)) {
      a = a.replace(/\s(width|height)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
      a = a.replace(/\sstyle\s*=\s*(["'])([\s\S]*?)\1/i, function (_m2, q, style) {
        var st = String(style || '');
        var cleaned = st
          .replace(/(^|;)\s*width\s*:\s*[^;]+/gi, '$1')
          .replace(/(^|;)\s*height\s*:\s*[^;]+/gi, '$1')
          .replace(/;;+/g, ';')
          .replace(/^\s*;\s*|\s*;\s*$/g, '')
          .trim();
        if (!cleaned) return '';
        return ' style=' + q + cleaned + q;
      });
    }
    return '<svg' + a + '>';
  });
  return raw;
}

function normalizeInlineSvg(value) {
  var safe = sanitizeSvgMarkup(value);
  if (!safe) return '';
  return stripSvgSizing(safe).trim();
}

function sanitizeIconClassString(value) {
  var raw = trimTo(value, 512);
  if (!raw) return '';
  var cleaned = raw.replace(/[^a-z0-9 \t\r\n_-]+/gi, ' ').trim().replace(/\s+/g, ' ');
  var tokens = cleaned
    .split(' ')
    .map(function (t) { return t.trim(); })
    .filter(Boolean)
    .filter(function (t) { return /^fa[a-z0-9-]*$/i.test(t); });
  return tokens.join(' ').slice(0, 256);
}

function looksLikeSvgUrl(url) {
  var raw = trimTo(url, 4096);
  if (!raw || !/^https?:\/\//i.test(raw)) return false;
  var lc = raw.toLowerCase();
  if (/\.svg(?:[?#]|$)/i.test(lc)) return true;
  if (lc.indexOf('cdn.brandfetch.io') >= 0) return true;
  return false;
}

async function fetchSvgMarkup(url, opts) {
  var raw = trimTo(url, 4096);
  if (!raw || !/^https?:\/\//i.test(raw)) return '';
  if (!looksLikeSvgUrl(raw)) return '';
  var timeoutMs = opts && Number.isFinite(opts.timeoutMs) ? Math.max(300, Math.trunc(opts.timeoutMs)) : 4500;
  var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  var timeout = null;
  if (controller) {
    timeout = setTimeout(function () {
      try { controller.abort(); } catch (_) {}
    }, timeoutMs);
  }
  try {
    var res = await fetch(raw, {
      method: 'GET',
      redirect: 'follow',
      signal: controller ? controller.signal : undefined,
      headers: {
        Accept: 'image/svg+xml,text/plain;q=0.9,text/html;q=0.7,*/*;q=0.5',
      },
    });
    if (!res || !res.ok) return '';
    var text = await res.text();
    if (!text || text.length > 1000000) return '';
    return normalizeInlineSvg(text);
  } catch (_) {
    return '';
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function normalizeIconSpecSync(value) {
  var raw = trimTo(value, 4096);
  if (!raw) return null;
  var svg = normalizeInlineSvg(raw);
  if (svg) return svg;
  if (looksLikeUrl(raw)) return raw.slice(0, 2048);
  var cls = sanitizeIconClassString(raw);
  return cls || null;
}

async function normalizeIconSpec(value, opts) {
  var raw = trimTo(value, 4096);
  if (!raw) return null;
  var svg = normalizeInlineSvg(raw);
  if (svg) return svg;
  var shouldFetch = !!(opts && opts.fetchRemoteSvg);
  if (shouldFetch && /^https?:\/\//i.test(raw)) {
    var fetched = await fetchSvgMarkup(raw, opts);
    if (fetched) return fetched;
  }
  if (looksLikeUrl(raw)) return raw.slice(0, 2048);
  var cls = sanitizeIconClassString(raw);
  return cls || null;
}

module.exports = {
  extractFirstSvgMarkup,
  sanitizeSvgMarkup,
  stripSvgSizing,
  normalizeInlineSvg,
  looksLikeSvgUrl,
  fetchSvgMarkup,
  normalizeIconSpecSync,
  normalizeIconSpec,
};

