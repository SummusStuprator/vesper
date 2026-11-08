// First-run setup. The only place the Refuseless name and logo appear.
import { h, api, icon, vesperMark, toast, fmtUsd, fmtPrice, modelTags, modeLadder } from './lib.js';

const PRESETS = [
  ['openai', 'OpenAI', 'https://api.openai.com/v1'],
  ['anthropic', 'Anthropic', 'https://api.anthropic.com/v1'],
  ['openrouter', 'OpenRouter', 'https://openrouter.ai/api/v1'],
  ['deepseek', 'DeepSeek', 'https://api.deepseek.com/v1'],
  ['groq', 'Groq', 'https://api.groq.com/openai/v1'],
  ['together', 'Together', 'https://api.together.xyz/v1'],
  ['mistral', 'Mistral', 'https://api.mistral.ai/v1'],
  ['ollama', 'Ollama', 'http://localhost:11434/v1'],
  ['lmstudio', 'LM Studio', 'http://localhost:1234/v1'],
  ['custom', 'Custom', ''],
];
const KEY_RE = /^abl_[A-Za-z0-9_\-]{12,}$/;
const PREFERRED = ['glm-5.3-abliterated', 'deepseek-v4.1-flash-abliterated', 'glm-5.3-flash-abliterated'];

export function mountSetup(root, cfg, onDone) {
  const st = { step: 'welcome', key: '', validating: false, valid: null, credits: null, error: '', models: [], provider: null, model: null, effort: null, mode: cfg.permissionMode || 'ask', other: { preset: 'openai', baseUrl: PRESETS[0][2], apiKey: '', name: '', modelId: '' } };
  const dark = () => document.documentElement.dataset.theme === 'dark';
  const logo = () => h('img', { src: `../assets/refuseless-${dark() ? 'dark' : 'light'}.svg`, alt: 'Refuseless' });

  let cleanup = [];
  function go(step) {
    if (st.step === 'signup' && step !== 'signup') api.signup.nav('hide');
    st.step = step; render();
  }

  function frame(inner, wide) {
    return h('div', { class: 'setup' },
      h('div', { class: 'titlebar' },
        h('div', { class: 'brand' }, vesperMark(), h('span', { class: 'word' }, 'VESPER')),
        h('div', { class: 'tb-sep' }),
        h('span', { class: 'label' }, 'Setup'),
        h('div', { class: 'grow' }),
        h('button', { class: 'icon-btn', title: 'Toggle theme', onclick: toggleTheme }, icon('moon'))),
      h('div', { class: 'setup-stage' }, h('div', { class: `setup-inner ${wide ? 'wide' : ''}` }, inner)));
  }
  function toggleTheme() {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    api.config.set({ theme: next }).then(() => { document.documentElement.dataset.theme = next; api.titlebarTheme(next === 'dark'); render(); });
  }

  // Live public lineup (no key needed); falls back to the built-in list.
  if (!st.lineup) api.lineup().then((m) => { st.lineup = m; if (st.step === 'welcome') render(); }).catch(() => {});

  // ---------------------------------------------------------------- steps
  function welcome() {
    const lineup = (st.lineup || []).filter((m) => m.pricing);
    const cheapest = lineup.filter((m) => m.pricing.input > 0).reduce((a, m) => Math.min(a, m.pricing.input), Infinity);
    const maxCtx = lineup.reduce((a, m) => Math.max(a, m.contextLength || 0), 0);
    return frame(h('frag', null,
      h('div', { class: 'powered' }, h('span', { class: 'label' }, 'Runs on'), logo()),
      h('h1', null, 'No refusals.', h('br'), 'Just ', h('em', null, 'code.')),
      h('p', { class: 'lede' }, 'Vesper is a full coding agent for your desktop: files, shell, web, subagents, MCP and computer use. It runs on Refuseless, which hosts open-weight models with the refusal behaviour removed from the weights. Pay per token, use your full context window, and get no lectures.'),
      lineup.length ? h('div', { class: 'facts' },
        h('div', null, h('b', null, lineup.length), h('span', null, 'models')),
        maxCtx ? h('div', null, h('b', null, fmtTokShort(maxCtx)), h('span', null, 'context')) : null,
        Number.isFinite(cheapest) ? h('div', null, h('b', null, `$${cheapest}`), h('span', null, 'cheapest / 1M in')) : null,
        h('div', null, h('b', null, lineup.filter((m) => m.abliterated).length), h('span', null, 'abliterated')),
        h('div', null, h('b', null, 'OpenAI'), h('span', null, 'compatible'))) : null,
      h('div', { class: 'choice-grid' },
        h('button', { class: 'choice hero', onclick: () => go('signup') },
          h('span', { class: 'ribbon' }, 'Recommended'),
          h('div', { class: 'ico' }, icon('user')),
          h('b', null, 'Create a Refuseless account'),
          h('span', null, 'Sign up inside Vesper, in an isolated browser sandbox. Add credits, create a key, and Vesper fills it in for you.'),
          h('div', { class: 'go' }, 'Sign up in Vesper', icon('arrowRight', 'sm'))),
        h('button', { class: 'choice', onclick: () => go('key') },
          h('div', { class: 'ico' }, icon('key')),
          h('b', null, 'I already have a key'),
          h('span', null, 'Paste a Refuseless API key. They start with ', h('code', { class: 'mono' }, 'abl_'), '. It is checked live and your balance is shown.'),
          h('div', { class: 'go' }, 'Use my key', icon('arrowRight', 'sm')))),
      h('div', { class: 'alt-link' },
        h('button', { onclick: () => go('other') }, 'Use a different provider'),
        h('span', null, 'OpenAI, Anthropic, OpenRouter, Ollama, LM Studio or any OpenAI-compatible endpoint')),
      lineup.length ? h('div', { class: 'lineup' },
        h('div', { class: 'label', style: { marginBottom: '10px' } }, 'The lineup · USD per 1M tokens'),
        h('table', { class: 'data' },
          h('thead', null, h('tr', null, ['Model', 'Context', 'Input', 'Cached', 'Output', ''].map((t) => h('th', null, t)))),
          h('tbody', null, lineup.map((m) => h('tr', null,
            h('td', { class: 'nm' }, m.id),
            h('td', { class: 'mono' }, m.contextLength ? fmtTokShort(m.contextLength) : '—'),
            h('td', { class: 'mono' }, m.pricing.input ? `$${m.pricing.input}` : 'free'),
            h('td', { class: 'mono' }, `$${m.pricing.cachedInput ?? m.pricing.input}`),
            h('td', { class: 'mono' }, m.pricing.output ? `$${m.pricing.output}` : 'free'),
            h('td', null, h('div', { class: 'row', style: { gap: '4px' } }, m.abliterated ? h('span', { class: 'tag red' }, 'abliterated') : h('span', { class: 'tag' }, 'standard'), m.vision ? h('span', { class: 'tag' }, 'vision') : null))))))) : null), true);
  }
  function fmtTokShort(n) { return n >= 1e6 ? `${Math.round(n / 1048576 * 10) / 10}M`.replace('.0M', 'M') : `${Math.round(n / 1024)}k`; }

  function keyStatus() {
    if (st.validating) return h('div', { class: 'key-status' }, h('span', { class: 'spinner' }), 'Checking key…');
    if (st.valid) return st.credits
      ? h('div', { class: 'credit-card' }, h('span', { class: 'row' }, icon('check'), 'Key works'), h('span', null, h('b', null, fmtUsd(st.credits.available, 2)), ' available'))
      : h('div', { class: 'key-status ok' }, icon('check', 'sm'), 'Key works');
    if (st.error) return h('div', { class: 'key-status err' }, icon('x', 'sm'), st.error);
    if (st.key && !st.key.startsWith('abl_')) return h('div', { class: 'key-status faint' }, 'Refuseless keys usually start with abl_.');
    return h('div', { class: 'key-status' });
  }

  function keyInput(autofocus) {
    const inp = h('input', {
      class: `input mono ${st.error ? 'bad' : ''}`, placeholder: 'abl_…', value: st.key, spellcheck: false, autocomplete: 'off',
      oninput: (e) => { st.key = e.target.value.trim(); st.valid = null; st.error = ''; schedule(); },
      onkeydown: (e) => { if (e.key === 'Enter') validate(); },
    });
    if (autofocus) setTimeout(() => inp.focus(), 30);
    return inp;
  }
  let vt = null;
  function schedule() { clearTimeout(vt); refreshStatus(); if (KEY_RE.test(st.key)) vt = setTimeout(validate, 450); }
  function refreshStatus() { const el = root.querySelector('.key-status, .credit-card'); if (el) el.replaceWith(keyStatus()); const c = root.querySelector('[data-continue]'); if (c) c.disabled = !st.valid; }

  async function validate() {
    if (!st.key) return;
    st.validating = true; st.error = ''; refreshStatus();
    try {
      const r = await api.provider.validate({ kind: 'refuseless', apiKey: st.key });
      st.valid = true; st.credits = r.credits; st.models = r.models;
    } catch (e) {
      st.valid = false;
      st.error = e.status === 401 ? 'That key was rejected. Check it and try again.' : e.message;
    }
    st.validating = false; refreshStatus();
  }

  async function saveRefuseless() {
    const cfg2 = await api.provider.save({ kind: 'refuseless', name: 'Refuseless', apiKey: st.key });
    st.provider = cfg2.providers.find((p) => p.kind === 'refuseless');
    pickDefaultModel();
    go('model');
  }

  function keyStep() {
    return frame(h('frag', null,
      h('button', { class: 'back-link', onclick: () => go('welcome') }, icon('arrowLeft', 'sm'), 'Back'),
      h('div', { class: 'powered' }, logo()),
      h('h1', { class: 'sm' }, 'Paste your ', h('em', null, 'key.')),
      h('p', { class: 'lede' }, 'Vesper encrypts it with your OS keychain, sends it only to api.refuseless.com, and redacts it from anything the model sees.'),
      h('div', { class: 'key-box' }, keyInput(true), keyStatus()),
      h('div', { class: 'trust' }, h('span', null, icon('lock', 'sm'), 'OS-encrypted'), h('span', null, icon('shield', 'sm'), 'Redacted from tool output'), h('span', null, icon('eye', 'sm'), 'No telemetry')),
      h('div', { class: 'actions' },
        h('button', { class: 'btn ghost', onclick: () => api.open(cfg.referral) }, icon('external', 'sm'), 'Top up credits'),
        h('button', { class: 'btn ghost', onclick: () => go('signup') }, 'Need an account?'),
        h('button', { class: 'btn primary lg', 'data-continue': true, disabled: !st.valid, onclick: saveRefuseless }, 'Continue', icon('arrowRight', 'sm')))));
  }

  function signupStep() {
    const steps = [
      ['Create your account', 'Email or a social login. The page may ask you to confirm you are human.'],
      ['Add credits', 'Usage is pay-as-you-go. Any amount gets you started.'],
      ['Create an API key', 'Open API keys and create one. Vesper detects it on screen and fills it in.'],
    ];
    const urlEl = h('span', null, 'refuseless.com');
    const view = h('div', { class: 'browser-view' }, h('div', { class: 'ph' }, h('span', { class: 'spinner' })));
    const node = frame(h('div', { class: 'signup-layout' },
      h('div', { class: 'signup-side' },
        h('button', { class: 'back-link', style: { marginBottom: 0 }, onclick: () => go('welcome') }, icon('arrowLeft', 'sm'), 'Back'),
        logo(),
        h('h2', null, 'Create your account'),
        h('div', { class: 'steps' }, steps.map(([b, s], i) => h('div', { class: `step ${st.valid && i === 2 ? 'done' : ''}` }, h('div', { class: 'n' }), h('div', null, h('b', null, b), h('span', null, s))))),
        h('div', { class: 'field' }, h('label', null, 'API key'), h('div', { class: 'key-box' }, keyInput(false), keyStatus())),
        h('div', { class: 'trust' }, h('span', null, icon('lock', 'sm'), 'Sandboxed browser'), h('span', null, icon('shield', 'sm'), 'Separate cookie jar')),
        h('p', { class: 'faint', style: { fontSize: '12px', margin: 0 } }, 'Signing up here uses Vesper\'s referral link, which helps fund Vesper\'s development. It costs you nothing extra.'),
        h('div', { class: 'row', style: { marginTop: 'auto' } },
          h('button', { class: 'btn ghost sm', onclick: () => api.signup.nav('external') }, icon('external', 'sm'), 'Open in browser'),
          h('div', { class: 'grow' }),
          h('button', { class: 'btn rl lg', 'data-continue': true, disabled: !st.valid, onclick: saveRefuseless }, 'Continue', icon('arrowRight', 'sm')))),
      h('div', { class: 'browser' },
        h('div', { class: 'browser-bar' },
          h('button', { class: 'icon-btn', title: 'Back', onclick: () => api.signup.nav('back') }, icon('arrowLeft')),
          h('button', { class: 'icon-btn', title: 'Reload', onclick: () => api.signup.nav('reload') }, icon('refresh')),
          h('div', { class: 'browser-url' }, icon('lock', 'sm'), urlEl)),
        view)), true);

    requestAnimationFrame(() => {
      const rect = () => { const r = view.getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height }; };
      api.signup.open(rect()).then(() => api.signup.nav('show'));
      const ro = new ResizeObserver(() => api.signup.bounds(rect()));
      ro.observe(view);
      const onWin = () => api.signup.bounds(rect());
      window.addEventListener('resize', onWin);
      cleanup.push(() => { ro.disconnect(); window.removeEventListener('resize', onWin); });
      cleanup.push(api.on.signupState((s) => {
        try { const u = new URL(s.url); urlEl.textContent = u.host + (u.pathname === '/' ? '' : u.pathname); } catch {}
      }));
    });
    return node;
  }

  function otherStep() {
    const o = st.other;
    const needsKey = !['ollama', 'lmstudio'].includes(o.preset);
    let statusEl = h('div', { class: 'key-status' });
    const connect = async (btn) => {
      btn.disabled = true;
      statusEl.replaceWith(statusEl = h('div', { class: 'key-status' }, h('span', { class: 'spinner' }), 'Connecting…'));
      try {
        const r = await api.provider.validate({ kind: 'openai', preset: o.preset, baseUrl: o.baseUrl, apiKey: o.apiKey });
        let models = r.models;
        if (o.modelId) models = [{ id: o.modelId, pricing: null }, ...models.filter((m) => m.id !== o.modelId)];
        if (!models.length) throw new Error('Connected, but the provider listed no models. Enter a model id below.');
        const name = o.name || (PRESETS.find((p) => p[0] === o.preset) || [])[1] || 'Custom';
        const cfg2 = await api.provider.save({ kind: 'openai', preset: o.preset, name, baseUrl: o.baseUrl, apiKey: o.apiKey, models: o.modelId ? [o.modelId] : [] });
        st.provider = cfg2.providers[cfg2.providers.length - 1];
        st.models = models;
        pickDefaultModel();
        go('model');
      } catch (e) {
        statusEl.replaceWith(statusEl = h('div', { class: 'key-status err' }, icon('x', 'sm'), e.message));
        btn.disabled = false;
      }
    };
    return frame(h('frag', null,
      h('button', { class: 'back-link', onclick: () => go('welcome') }, icon('arrowLeft', 'sm'), 'Back'),
      h('h1', { class: 'sm' }, 'Bring your own ', h('em', null, 'provider.')),
      h('p', { class: 'lede' }, 'Any OpenAI-compatible endpoint works. You can add more providers later in Settings.'),
      h('div', { class: 'stack' },
        h('div', { class: 'preset-grid' }, PRESETS.map(([id, name, url]) => h('button', {
          class: `preset ${o.preset === id ? 'on' : ''}`, onclick: () => { o.preset = id; o.baseUrl = url; render(); },
        }, name))),
        h('div', { class: 'grid2' },
          h('div', { class: 'field' }, h('label', null, 'Base URL'), h('input', { class: 'input mono', value: o.baseUrl, placeholder: 'https://…/v1', oninput: (e) => (o.baseUrl = e.target.value.trim()) })),
          h('div', { class: 'field' }, h('label', null, needsKey ? 'API key' : 'API key (optional)'), h('input', { class: 'input mono', type: 'password', value: o.apiKey, placeholder: needsKey ? 'sk-…' : 'not needed for local servers', oninput: (e) => (o.apiKey = e.target.value.trim()) }))),
        h('div', { class: 'grid2' },
          h('div', { class: 'field' }, h('label', null, 'Display name (optional)'), h('input', { class: 'input', value: o.name, oninput: (e) => (o.name = e.target.value) })),
          h('div', { class: 'field' }, h('label', null, 'Model id (optional)'), h('input', { class: 'input mono', value: o.modelId, placeholder: 'leave empty to choose from the list', oninput: (e) => (o.modelId = e.target.value.trim()) }))),
        statusEl),
      h('div', { class: 'actions' }, h('button', { class: 'btn primary lg', onclick: (e) => connect(e.currentTarget) }, 'Connect', icon('arrowRight', 'sm')))));
  }

  function pickDefaultModel() {
    const ids = st.models.map((m) => m.id);
    st.model = PREFERRED.find((p) => ids.includes(p)) || ids[0] || null;
    const m = st.models.find((x) => x.id === st.model);
    st.effort = m && m.reasoningDefault || null;
  }

  function modelStep() {
    const sel = st.models.find((m) => m.id === st.model);
    const isRl = st.provider && st.provider.kind === 'refuseless';
    return frame(h('frag', null,
      h('button', { class: 'back-link', onclick: () => go(isRl ? 'key' : 'other') }, icon('arrowLeft', 'sm'), 'Back'),
      isRl ? h('div', { class: 'powered' }, logo(), st.credits ? h('span', { class: 'tag ok' }, `${fmtUsd(st.credits.available, 2)} credit`) : null) : null,
      h('h1', { class: 'sm' }, 'Pick your ', h('em', null, 'model.')),
      h('p', { class: 'lede' }, 'You can switch per session from the composer. Prices are USD per million tokens and drive Vesper\'s live cost tracking.'),
      h('div', { class: 'model-grid' }, st.models.map((m) => h('button', {
        class: `model-card ${m.id === st.model ? 'on' : ''}`,
        onclick: () => { st.model = m.id; st.effort = m.reasoningDefault || null; render(); },
      }, h('div', { class: 'nm' }, m.id), h('div', { class: 'pr' }, fmtPrice(m.pricing)), h('div', { class: 'tags' }, modelTags(m))))),
      h('div', { class: 'stack', style: { marginTop: '24px' } },
        sel && sel.reasoningEfforts && sel.reasoningEfforts.length ? h('div', { class: 'set-row' },
          h('div', { class: 'lbl' }, h('b', null, 'Reasoning effort'), h('span', null, 'How long the model thinks before answering.')),
          h('div', { class: 'seg' }, sel.reasoningEfforts.map((e) => h('button', { class: st.effort === e ? 'on' : '', onclick: () => { st.effort = e; render(); } }, e)))) : null,
        h('div', null,
          h('div', { class: 'label', style: { margin: '8px 0 10px' } }, 'Permissions · change any time with Shift+Tab'),
          modeLadder(st.mode, (k) => { st.mode = k; render(); }))),
      h('div', { class: 'actions' }, h('button', {
        class: 'btn primary lg', disabled: !st.model,
        onclick: async () => {
          try {
            await api.setup.complete({ providerId: st.provider.id, model: st.model, effort: st.effort, permissionMode: st.mode });
            teardown(); onDone();
          } catch (e) { toast(e.message, 'err'); }
        },
      }, 'Start building', icon('arrowRight', 'sm')))), true);
  }

  function teardown() { cleanup.forEach((f) => { try { f(); } catch {} }); cleanup = []; }

  function render() {
    teardown();
    cleanup.push(api.on.signupKey((k) => {
      st.key = k; st.valid = null; st.error = '';
      const inp = root.querySelector('.key-box input'); if (inp) inp.value = k;
      toast('API key detected');
      validate();
    }));
    const node = { welcome, key: keyStep, signup: signupStep, other: otherStep, model: modelStep }[st.step]();
    root.replaceChildren(node);
  }
  render();
  return () => { teardown(); api.signup.close(); };
}
