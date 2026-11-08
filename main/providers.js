// Provider layer: presets, model catalogs, pricing, streaming chat completions.
// Every provider speaks the OpenAI Chat Completions dialect; Refuseless is the default.

const REFUSELESS = {
  baseUrl: 'https://api.refuseless.com/v1',
  referral: 'https://refuseless.com/?ref=dwqxpimh',
  keyPrefix: 'abl_',
};

// Fallback lineup (USD per 1M tokens) used when the live catalog is unreachable.
// Source: docs.refuseless.com/api/models + published pricing (Oct 2026).
// The public /v1/models list has ids, context, vision, abliteration and reasoning efforts but no prices,
// so prices live here (USD per 1M tokens: input / cached input / output). Kept current by hand;
// users can override any price in Settings → Models. `blurb` and `role` drive model guidance in the UI.
const REFUSELESS_FALLBACK = [
  { id: 'glm-5.3-abliterated', contextLength: 1048576, maxOutput: 131072, pricing: { input: 1.25, cachedInput: 0.25, output: 2.25 }, reasoningEfforts: ['low', 'high', 'max'], vision: false, abliterated: true,
    role: 'flagship', blurb: 'Strongest abliterated model. Hard, long and agentic tasks.' },
  { id: 'kimi-k3.1-pro', contextLength: 1048576, maxOutput: 131072, pricing: { input: 0.25, cachedInput: 0.15, output: 2.5 }, priceEstimate: true, reasoningEfforts: ['low', 'high', 'max'], vision: true, abliterated: false,
    role: 'frontier', blurb: 'Frontier open model with vision. Original weights (abliterated version in progress).' },
  { id: 'glm-5.3-flash-abliterated', contextLength: 1048576, maxOutput: 131072, pricing: { input: 0.25, cachedInput: 0.15, output: 0.8 }, reasoningEfforts: ['low', 'high', 'max'], vision: true, abliterated: true,
    role: 'everyday', blurb: 'Everyday coding at a fraction of the flagship price. Sees images.' },
  { id: 'deepseek-v4.1-flash-abliterated', contextLength: 1048576, maxOutput: 131072, pricing: { input: 0.22, cachedInput: 0.045, output: 0.75 }, reasoningEfforts: ['off', 'low', 'high', 'max'], vision: true, abliterated: true,
    role: 'agents', blurb: 'Built for coding agents. Very cheap cached input for long sessions.' },
  { id: 'deepseek-v4.1-flash-fast', contextLength: 1048576, maxOutput: 262144, pricing: { input: 0.05, cachedInput: 0.003, output: 0.15 }, reasoningEfforts: ['off', 'low', 'high', 'max'], vision: true, abliterated: false,
    role: 'fast', blurb: 'Fastest and cheapest. Great for subagents and bulk work.' },
  { id: 'minimax-m3.1-flash', contextLength: 1048576, maxOutput: 512000, pricing: { input: 0.05, cachedInput: 0.002, output: 0.25 }, reasoningEfforts: ['low', 'high', 'max'], vision: true, abliterated: false,
    role: 'long', blurb: 'Huge output budget and near-free cached input. Long generations.' },
];

// Presets for "other providers". All OpenAI-compatible.
const PRESETS = {
  openai: { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1' },
  anthropic: { name: 'Anthropic', baseUrl: 'https://api.anthropic.com/v1' },
  openrouter: { name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1' },
  deepseek: { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1' },
  groq: { name: 'Groq', baseUrl: 'https://api.groq.com/openai/v1' },
  together: { name: 'Together', baseUrl: 'https://api.together.xyz/v1' },
  mistral: { name: 'Mistral', baseUrl: 'https://api.mistral.ai/v1' },
  ollama: { name: 'Ollama (local)', baseUrl: 'http://localhost:11434/v1', noKey: true },
  lmstudio: { name: 'LM Studio (local)', baseUrl: 'http://localhost:1234/v1', noKey: true },
  custom: { name: 'Custom', baseUrl: '' },
};

const UA = 'Vesper/0.1 (+coding harness)';

let netFetch = null;
function httpFetch(url, opts) {
  if (!netFetch) {
    try { netFetch = require('electron').net.fetch; } catch { netFetch = globalThis.fetch; }
    if (!netFetch) netFetch = globalThis.fetch;
  }
  return netFetch(url, opts);
}

function headersFor(provider) {
  const h = { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': UA };
  if (provider.apiKey) h.Authorization = `Bearer ${provider.apiKey}`;
  if (provider.preset === 'anthropic' && provider.apiKey) {
    h['x-api-key'] = provider.apiKey;
    h['anthropic-version'] = '2023-06-01';
  }
  if (provider.preset === 'openrouter') {
    h['HTTP-Referer'] = 'https://github.com/vesper-harness';
    h['X-Title'] = 'Vesper';
  }
  return Object.assign(h, provider.headers || {});
}

function trimUrl(u) { return String(u || '').replace(/\/+$/, ''); }

class ApiError extends Error {
  constructor(status, code, message, retryAfter) {
    super(message || `HTTP ${status}`);
    this.status = status; this.code = code; this.retryAfter = retryAfter;
  }
}

async function readError(res) {
  let text = '';
  try { text = await res.text(); } catch {}
  let code = '', message = text.slice(0, 400);
  try {
    const j = JSON.parse(text);
    const e = j.error || j;
    code = e.code || e.type || '';
    message = e.message || message;
  } catch {
    if (/cloudflare|cf-error|Attention Required/i.test(text)) {
      code = 'blocked';
      message = 'The provider\'s edge network blocked this request (Cloudflare). Try again later, from another network, or contact the provider.';
    }
  }
  return new ApiError(res.status, code, message, Number(res.headers.get('retry-after')) || 0);
}

// ---------- Catalog ----------

function normalizeModel(m, provider) {
  const p = m.pricing || {};
  // OpenRouter reports USD per token as strings.
  const perTok = (v) => (v == null ? null : Number(v) * 1e6);
  let pricing = null;
  if (p.prompt != null || p.completion != null) {
    pricing = { input: perTok(p.prompt) || 0, cachedInput: perTok(p.input_cache_read) ?? perTok(p.prompt) ?? 0, output: perTok(p.completion) || 0 };
  } else if (p.input != null) {
    pricing = { input: Number(p.input), cachedInput: Number(p.cachedInput ?? p.cached_input ?? p.input), output: Number(p.output) };
  }
  const modalities = (m.architecture && m.architecture.input_modalities) || [];
  return {
    id: m.id,
    providerId: provider.id,
    name: m.name || m.id,
    contextLength: m.context_length || m.contextLength || (m.top_provider && m.top_provider.context_length) || null,
    maxOutput: m.max_output || m.maxOutput || (m.top_provider && m.top_provider.max_completion_tokens) || null,
    vision: m.vision ?? (modalities.includes('image') ? true : undefined),
    reasoningEfforts: m.reasoning_efforts || m.reasoningEfforts || null,
    reasoningDefault: m.reasoning_default || m.reasoningDefault || null,
    abliterated: m.abliterated,
    pricing,
    priceEstimate: m.priceEstimate || undefined,
    role: m.role || undefined,
    blurb: m.blurb || undefined,
  };
}

async function fetchCatalog(provider) {
  const fallback = provider.kind === 'refuseless'
    ? REFUSELESS_FALLBACK.map((m) => normalizeModel(m, provider)) : [];
  let live = [];
  let error = null;
  try {
    const res = await httpFetch(`${trimUrl(provider.baseUrl)}/models`, { headers: headersFor(provider) });
    if (!res.ok) throw await readError(res);
    const j = await res.json();
    const list = Array.isArray(j) ? j : (j.data || j.models || []);
    live = list.map((m) => normalizeModel(typeof m === 'string' ? { id: m } : m, provider));
  } catch (e) { error = e.message; }

  // Merge: live wins for presence, fallback fills pricing/limits; manual overrides win over all.
  const byId = new Map();
  for (const m of (live.length ? live : fallback)) byId.set(m.id, m);
  for (const f of fallback) {
    const m = byId.get(f.id);
    if (!m) continue;
    for (const k of Object.keys(f)) if (m[k] == null) m[k] = f[k];
  }
  for (const manual of provider.models || []) {
    const id = typeof manual === 'string' ? manual : manual.id;
    const cur = byId.get(id) || { id, providerId: provider.id, name: id };
    byId.set(id, Object.assign(cur, typeof manual === 'string' ? {} : manual));
  }
  // Local servers cost nothing per token.
  if (provider.preset === 'ollama' || provider.preset === 'lmstudio' || /\/\/(localhost|127\.0\.0\.1)[:/]/.test(provider.baseUrl || '')) {
    for (const m of byId.values()) if (!m.pricing) m.pricing = { input: 0, cachedInput: 0, output: 0 };
  }
  for (const [id, ov] of Object.entries(provider.pricingOverrides || {})) {
    if (byId.has(id)) byId.get(id).pricing = ov;
  }
  return { models: [...byId.values()], live: live.length > 0, error };
}

async function fetchCredits(provider) {
  if (provider.kind !== 'refuseless') return null;
  const res = await httpFetch(`${trimUrl(provider.baseUrl)}/credits`, { headers: headersFor(provider) });
  if (!res.ok) throw await readError(res);
  return res.json();
}

async function validateKey(provider) {
  if (provider.kind === 'refuseless') {
    const credits = await fetchCredits(provider);
    return { ok: true, credits };
  }
  const res = await httpFetch(`${trimUrl(provider.baseUrl)}/models`, { headers: headersFor(provider) });
  if (!res.ok) throw await readError(res);
  return { ok: true };
}

// ---------- Pricing ----------

function costOf(usage, pricing) {
  if (!usage || !pricing) return 0;
  const prompt = usage.prompt_tokens || 0;
  const cached = (usage.prompt_tokens_details && usage.prompt_tokens_details.cached_tokens) || usage.cached_tokens || 0;
  const out = usage.completion_tokens || 0;
  return ((prompt - cached) * (pricing.input || 0) + cached * (pricing.cachedInput ?? pricing.input ?? 0) + out * (pricing.output || 0)) / 1e6;
}

// ---------- Streaming chat ----------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Stream one chat completion.
 * handlers: { onText(delta), onReasoning(delta), onToolCall(index, partial) }
 * Returns { message, usage, finishReason }.
 */
async function streamChat(provider, body, handlers = {}, signal) {
  const url = `${trimUrl(provider.baseUrl)}/chat/completions`;
  const payload = Object.assign({ stream: true, stream_options: { include_usage: true } }, body);
  if (provider.preset === 'ollama' || provider.preset === 'lmstudio') delete payload.stream_options;

  let res;
  for (let attempt = 0; ; attempt++) {
    res = await httpFetch(url, { method: 'POST', headers: Object.assign(headersFor(provider), { Accept: 'text/event-stream' }), body: JSON.stringify(payload), signal });
    if (res.ok) break;
    const err = await readError(res);
    const retriable = res.status === 429 || res.status >= 500;
    if (!retriable || attempt >= 3 || err.code === 'blocked') throw err;
    handlers.onRetry && handlers.onRetry(attempt + 1, err);
    await sleep(err.retryAfter ? err.retryAfter * 1000 : 1000 * 2 ** attempt);
  }

  const ctype = res.headers.get('content-type') || '';
  if (!ctype.includes('event-stream')) {
    // Provider ignored stream=true.
    const j = await res.json();
    const msg = (j.choices && j.choices[0] && j.choices[0].message) || {};
    if (msg.content) handlers.onText && handlers.onText(msg.content);
    if (msg.reasoning_content) handlers.onReasoning && handlers.onReasoning(msg.reasoning_content);
    return { message: { role: 'assistant', content: msg.content || '', reasoning: msg.reasoning_content || '', tool_calls: msg.tool_calls }, usage: j.usage, finishReason: j.choices && j.choices[0] && j.choices[0].finish_reason };
  }

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let content = '', reasoning = '', usage = null, finishReason = null;
  const toolCalls = [];
  let inThink = false; // fallback <think> splitting for providers that don't

  const handleText = (t) => {
    // Split inline <think> blocks into the reasoning channel.
    while (t) {
      if (inThink) {
        const end = t.indexOf('</think>');
        if (end === -1) { reasoning += t; handlers.onReasoning && handlers.onReasoning(t); return; }
        const r = t.slice(0, end); reasoning += r; handlers.onReasoning && r && handlers.onReasoning(r);
        inThink = false; t = t.slice(end + 8);
      } else {
        const start = t.indexOf('<think>');
        if (start === -1 || content.trim().length > 0) { content += t; handlers.onText && handlers.onText(t); return; }
        const pre = t.slice(0, start); if (pre) { content += pre; handlers.onText && handlers.onText(pre); }
        inThink = true; t = t.slice(start + 7);
      }
    }
  };

  const processLine = (line) => {
    if (!line.startsWith('data:')) return;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') return;
    let j; try { j = JSON.parse(data); } catch { return; }
    if (j.error) throw new ApiError(402, j.error.code, j.error.message || 'Stream error');
    if (j.usage) usage = j.usage;
    const choice = j.choices && j.choices[0];
    if (!choice) return;
    const d = choice.delta || {};
    const r = d.reasoning_content ?? d.reasoning;
    if (r) { reasoning += r; handlers.onReasoning && handlers.onReasoning(r); }
    if (d.content) handleText(d.content);
    if (d.tool_calls) {
      for (const tc of d.tool_calls) {
        const i = tc.index ?? toolCalls.length;
        if (!toolCalls[i]) toolCalls[i] = { id: tc.id || `call_${Date.now()}_${i}`, type: 'function', function: { name: '', arguments: '' } };
        const cur = toolCalls[i];
        if (tc.id) cur.id = tc.id;
        if (tc.function && tc.function.name) cur.function.name += tc.function.name;
        if (tc.function && tc.function.arguments) cur.function.arguments += tc.function.arguments;
        handlers.onToolCall && handlers.onToolCall(i, cur);
      }
    }
    if (choice.finish_reason) finishReason = choice.finish_reason;
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).replace(/\r$/, '');
      buf = buf.slice(nl + 1);
      processLine(line);
    }
  }
  if (buf.trim()) processLine(buf.trim());

  const calls = toolCalls.filter(Boolean);
  return {
    message: { role: 'assistant', content, reasoning, tool_calls: calls.length ? calls : undefined },
    usage,
    finishReason,
  };
}

/** One-shot (non-tool) completion used for compaction and titles. */
async function complete(provider, body, signal) {
  const r = await streamChat(provider, body, {}, signal);
  return r;
}

module.exports = {
  REFUSELESS, REFUSELESS_FALLBACK, PRESETS, ApiError,
  fetchCatalog, fetchCredits, validateKey, streamChat, complete, costOf, httpFetch, headersFor,
};
