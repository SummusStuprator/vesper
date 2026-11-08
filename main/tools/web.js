// Web tools: search (DuckDuckGo HTML, Brave, or Tavily) and fetch (HTML → readable text).
const { httpFetch } = require('../providers');

const UA = 'Vesper/0.1 (coding harness; +https://github.com/vesper-harness)';

const decode = (s) => s
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&#x27;|&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ')
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
const strip = (s) => decode(s.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();

async function ddg(query, n) {
  const res = await httpFetch('https://html.duckduckgo.com/html/', {
    method: 'POST',
    headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `q=${encodeURIComponent(query)}`,
  });
  if (!res.ok) throw new Error(`DuckDuckGo returned ${res.status}`);
  const html = await res.text();
  const out = [];
  const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>)?/g;
  let m;
  while ((m = re.exec(html)) && out.length < n) {
    let url = decode(m[1]);
    const u = url.match(/[?&]uddg=([^&]+)/);
    if (u) url = decodeURIComponent(u[1]);
    if (url.startsWith('//')) url = 'https:' + url;
    if (/duckduckgo\.com\/y\.js/.test(url)) continue; // ads
    out.push({ title: strip(m[2]), url, snippet: strip(m[3] || '') });
  }
  if (!out.length && /anomaly|captcha/i.test(html)) throw new Error('DuckDuckGo asked for a human check. Add a Brave or Tavily key in Settings → Tools for reliable search.');
  return out;
}

async function brave(query, n, key) {
  const res = await httpFetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${n}`, {
    headers: { Accept: 'application/json', 'X-Subscription-Token': key },
  });
  if (!res.ok) throw new Error(`Brave Search returned ${res.status}`);
  const j = await res.json();
  return ((j.web && j.web.results) || []).map((r) => ({ title: r.title, url: r.url, snippet: strip(r.description || '') }));
}

async function tavily(query, n, key) {
  const res = await httpFetch('https://api.tavily.com/search', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ query, max_results: n }),
  });
  if (!res.ok) throw new Error(`Tavily returned ${res.status}`);
  const j = await res.json();
  return (j.results || []).map((r) => ({ title: r.title, url: r.url, snippet: (r.content || '').slice(0, 400) }));
}

const web_search = {
  name: 'web_search', kind: 'net',
  description: 'Search the web. Returns titles, URLs and snippets. Follow up with web_fetch to read a page.',
  parameters: { type: 'object', properties: {
    query: { type: 'string' }, max_results: { type: 'integer', description: 'Default 8' },
  }, required: ['query'] },
  summary: (a) => a.query,
  async run(a, ctx) {
    const n = Math.min(a.max_results || 8, 20);
    const s = ctx.config.search || {};
    let results;
    if (s.engine === 'brave' && s.braveKey) results = await brave(a.query, n, s.braveKey);
    else if (s.engine === 'tavily' && s.tavilyKey) results = await tavily(a.query, n, s.tavilyKey);
    else results = await ddg(a.query, n);
    if (!results.length) return { output: 'No results.' };
    return {
      output: results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`).join('\n\n'),
      display: { results },
    };
  },
};

function htmlToText(html, baseUrl) {
  let title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '';
  let body = html
    .replace(/<(script|style|noscript|svg|iframe|template|head)[\s\S]*?<\/\1>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');
  const main = body.match(/<(main|article)[^>]*>([\s\S]*?)<\/\1>/i);
  if (main && main[2].length > 800) body = main[2];
  body = body
    .replace(/<(nav|footer|aside)[\s\S]*?<\/\1>/gi, '')
    .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, l, t) => `\n\n${'#'.repeat(+l)} ${strip(t)}\n\n`)
    .replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_, t) => `\n\n\`\`\`\n${decode(t.replace(/<[^>]+>/g, ''))}\n\`\`\`\n\n`)
    .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_, t) => `\`${strip(t)}\``)
    .replace(/<a[^>]+href="([^"#][^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, h, t) => {
      const text = strip(t); if (!text) return '';
      let href = decode(h); try { href = new URL(href, baseUrl).href; } catch {}
      return `[${text}](${href})`;
    })
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<(br|hr)\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|section|tr|table|ul|ol|blockquote)>/gi, '\n\n')
    .replace(/<t[dh][^>]*>/gi, ' | ')
    .replace(/<[^>]+>/g, '');
  body = decode(body).replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return { title: strip(title), text: body };
}

const web_fetch = {
  name: 'web_fetch', kind: 'net',
  description: 'Fetch a URL and return its readable content (HTML converted to markdown-like text; JSON and plain text as-is).',
  parameters: { type: 'object', properties: {
    url: { type: 'string' }, max_chars: { type: 'integer', description: 'Default 40000' },
  }, required: ['url'] },
  summary: (a) => a.url,
  async run(a, ctx) {
    let url = a.url;
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    const res = await httpFetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html,application/json,text/plain;q=0.9,*/*;q=0.5' }, signal: ctx.signal, redirect: 'follow' });
    const ct = res.headers.get('content-type') || '';
    const max = a.max_chars || 40000;
    if (/^image\//.test(ct)) {
      const buf = Buffer.from(await res.arrayBuffer());
      const data = `data:${ct.split(';')[0]};base64,${buf.toString('base64')}`;
      return { output: `Fetched image ${url} (${ct}).`, images: [data], display: { image: data } };
    }
    const raw = await res.text();
    let title = '', text = raw;
    if (/html/.test(ct) || /^\s*<(!doctype|html)/i.test(raw)) ({ title, text } = htmlToText(raw, url));
    const clipped = text.length > max ? text.slice(0, max) + `\n\n… [truncated ${text.length - max} chars]` : text;
    return {
      output: `${res.status} ${url}${title ? `\nTitle: ${title}` : ''}\n\n${clipped}`,
      display: { status: res.status, title, chars: text.length },
      isError: !res.ok,
    };
  },
};

module.exports = { web_search, web_fetch, htmlToText };
