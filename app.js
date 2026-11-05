// Hallucination Hunter — Claim extraction, verification, and Supabase sync

const SUPABASE_URL = 'https://jdvafpwancenabxbnxbh.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpkdmFmcHdhbmNlbmFieGJueGJoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYxMDMwNjgsImV4cCI6MjEwMTY3OTA2OH0.xVZOUOiO_uDzRLHbZ9jjCjV8bZ8cUpZaQINzIgn6QlA';

// Direct PostgREST fallback when the CDN UMD bundle is blocked or slow to initialize.
function createRestFallbackDb(baseUrl, apiKey) {
  function from(table) {
    let method = 'GET';
    let selectCols = '*';
    let opts = {};
    let filters = [];
    let orderParam = null;
    let limitParam = null;
    let isSingle = false;
    let bodyPayload = null;

    const builder = {
      select(cols = '*', options = {}) {
        selectCols = cols;
        opts = options || {};
        return builder;
      },
      insert(payload) {
        method = 'POST';
        bodyPayload = payload;
        return builder;
      },
      delete() {
        method = 'DELETE';
        return builder;
      },
      eq(col, val) {
        if (val !== undefined && val !== null) filters.push(`${encodeURIComponent(col)}=eq.${encodeURIComponent(val)}`);
        return builder;
      },
      order(col, { ascending = true } = {}) {
        orderParam = `${encodeURIComponent(col)}.${ascending ? 'asc' : 'desc'}`;
        return builder;
      },
      limit(n) {
        limitParam = n;
        return builder;
      },
      single() {
        isSingle = true;
        return builder;
      },
      then(resolve, reject) {
        return execute().then(resolve, reject);
      }
    };

    async function execute() {
      try {
        const params = [];
        if (method === 'GET' || selectCols) params.push(`select=${encodeURIComponent(selectCols)}`);
        filters.forEach(f => params.push(f));
        if (orderParam) params.push(`order=${orderParam}`);
        if (limitParam != null) params.push(`limit=${limitParam}`);
        const url = `${baseUrl}/rest/v1/${table}${params.length ? '?' + params.join('&') : ''}`;
        const prefer = [];
        if (opts.count === 'exact') prefer.push('count=exact');
        if (method === 'POST') prefer.push('return=representation');
        const headers = {
          apikey: apiKey,
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        };
        if (prefer.length) headers.Prefer = prefer.join(',');
        if (isSingle) headers.Accept = 'application/vnd.pgrst.object+json';

        const res = await fetch(url, {
          method: opts.head ? 'HEAD' : method,
          headers,
          body: bodyPayload ? JSON.stringify(bodyPayload) : undefined
        });
        let count = null;
        const cr = res.headers.get('content-range');
        if (cr && cr.includes('/')) {
          const totalStr = cr.split('/')[1];
          if (totalStr && totalStr !== '*') count = parseInt(totalStr, 10);
        }
        if (!res.ok) {
          const errText = await res.text().catch(() => res.statusText);
          return { data: null, error: { message: errText || `HTTP ${res.status}` }, count };
        }
        if (opts.head || method === 'DELETE' || res.status === 204) {
          return { data: null, error: null, count };
        }
        const data = await res.json();
        return { data, error: null, count: count ?? (Array.isArray(data) ? data.length : null) };
      } catch (err) {
        return { data: null, error: { message: err.message || 'Network error' }, count: null };
      }
    }

    return builder;
  }
  return { from, unavailable: false };
}

const db = window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY) : createRestFallbackDb(SUPABASE_URL, SUPABASE_KEY);

function getUserId() {
  let id = localStorage.getItem('hh_user_id');
  if (!id) {
    id = crypto.randomUUID ? crypto.randomUUID() : 'u-' + Date.now() + '-' + Math.random().toString(36).slice(2);
    localStorage.setItem('hh_user_id', id);
  }
  return id;
}
const userId = getUserId();

const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);
const delay = ms => new Promise(r => setTimeout(r, ms));

// DOM refs
const input = $('#llm-input');
const charCount = $('#char-count');
const wordCount = $('#word-count');
const btnClear = $('#btn-clear');
const btnAnalyze = $('#btn-analyze');
const processing = $('#processing');
const results = $('#results');
const annotatedText = $('#annotated-text');
const claimsGrid = $('#claims-grid');
const tip = $('#tip');
const toastContainer = $('#toast-container');

let currentClaims = [];
let currentText = '';
let activeController = null;
const REDUCED_MOTION = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
const DRAFT_KEY = 'hh_draft';
const THEME_KEY = 'hh_theme';

const VERDICT_ICONS = {
  verified: '<svg class="verdict-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8.4 6.3 11.7 13 4.6"/></svg>',
  unverifiable: '<svg class="verdict-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><circle cx="8" cy="8" r="6"/><path d="M6.5 6.3a1.6 1.6 0 1 1 2.1 1.5c-.4.2-.6.5-.6 1v.3"/><circle cx="8" cy="11.4" r="0.75" fill="currentColor" stroke="none"/></svg>',
  false: '<svg class="verdict-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/></svg>'
};
const VERDICT_LABELS = { verified: 'Verified', unverifiable: 'Unverifiable', false: 'False' };
const LINK_ICON = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11.5 4.5h4v4M15.2 4.8 8.8 11.2"/><path d="M13.5 10.8v3.5a1.2 1.2 0 0 1-1.2 1.2H5.7a1.2 1.2 0 0 1-1.2-1.2V7.7a1.2 1.2 0 0 1 1.2-1.2h3.5"/></svg>';
const STEP_CHECK_ICON = '<svg class="ps-check" width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.5 10.5l3.5 3.5 7.5-8"/></svg>';

const TOAST_ICONS = {
  success: '<svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="#69cb95" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 10.5l3.5 3.5 7.5-8"/></svg>',
  error: '<svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="#f0836e" stroke-width="1.8" stroke-linecap="round"><path d="M10 6v5M10 14.2h.01"/><circle cx="10" cy="10" r="7.2"/></svg>',
  info: '<svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="#a9a49b" stroke-width="1.8" stroke-linecap="round"><circle cx="10" cy="10" r="7.2"/><path d="M10 9.2v4M10 6.5h.01"/></svg>'
};

function showToast(message, type = 'info', action = null) {
  while (toastContainer.children.length >= 3) toastContainer.firstElementChild.remove();
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
  toast.innerHTML = `<span class="toast-icon">${TOAST_ICONS[type] || TOAST_ICONS.info}</span><span class="toast-msg"></span>`;
  toast.querySelector('.toast-msg').textContent = message;
  if (action) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'toast-action';
    btn.textContent = action.label;
    btn.addEventListener('click', () => { dismiss(); action.run(); });
    toast.appendChild(btn);
  }
  toastContainer.appendChild(toast);
  let gone = false;
  function dismiss() {
    if (gone) return;
    gone = true;
    toast.classList.add('leaving');
    setTimeout(() => toast.remove(), REDUCED_MOTION ? 0 : 200);
  }
  setTimeout(dismiss, action ? 6000 : type === 'error' ? 4600 : 3000);
  return dismiss;
}

// Active nav underline
function moveInk(bar) {
  if (!bar) return;
  const ink = bar.querySelector('.nav-ink');
  const active = bar.querySelector('.active');
  if (!ink || !active) return;
  ink.style.width = active.offsetWidth + 'px';
  ink.style.transform = `translateX(${active.offsetLeft}px)`;
  ink.classList.add('ready');
}
function refreshInks() { $$('.mast-nav').forEach(moveInk); }
window.addEventListener('resize', refreshInks);
if (document.fonts && document.fonts.ready) document.fonts.ready.then(refreshInks);

let activeVT = null;
function withTransition(update) {
  if (REDUCED_MOTION || !document.startViewTransition || document.hidden || activeVT) {
    update();
    return;
  }
  try {
    const vt = document.startViewTransition(update);
    activeVT = vt;
    const clear = () => { if (activeVT === vt) activeVT = null; };
    vt.finished?.then(clear, clear);
    vt.ready?.catch(() => {});
  } catch {
    activeVT = null;
    update();
  }
}

// Navigation
const ROUTES = { check: 'analyzer', history: 'history', sources: 'sources', skill: 'skill', settings: 'settings', about: 'info' };
const VIEW_TO_ROUTE = { analyzer: 'check', history: 'history', sources: 'sources', skill: 'skill', settings: 'settings', info: 'about' };
let currentView = 'analyzer';

function applyView(viewName) {
  if (!VIEW_TO_ROUTE[viewName]) viewName = 'analyzer';
  $$('.view').forEach(v => v.classList.toggle('active', v.id === `view-${viewName}`));
  $$('.sidebar-link').forEach(l => {
    const on = l.dataset.view === viewName;
    l.classList.toggle('active', on);
    if (on) l.setAttribute('aria-current', 'page');
    else l.removeAttribute('aria-current');
  });
  $$('.mobile-nav-link').forEach(m => m.classList.toggle('active', m.dataset.view === viewName));
  currentView = viewName;
  refreshInks();
  const titles = { analyzer: 'Check', history: 'History', sources: 'Sources', skill: 'Skill & API', settings: 'Settings', info: 'About' };
  document.title = viewName === 'analyzer'
    ? 'Hallucination Hunter \u2014 Fact-check AI answers'
    : `${titles[viewName]} \u2014 Hallucination Hunter`;
}

function switchView(viewName, { updateHash = true } = {}) {
  if (!VIEW_TO_ROUTE[viewName]) viewName = 'analyzer';
  const changed = viewName !== currentView;
  if (changed) withTransition(() => applyView(viewName));
  else applyView(viewName);
  if (changed) window.scrollTo({ top: 0, behavior: REDUCED_MOTION ? 'auto' : 'smooth' });

  if (viewName === 'history') loadHistory();
  if (viewName === 'sources') loadSources();
  if (viewName === 'settings') { loadSettings(); checkDbStatus(); }

  if (updateHash) {
    const hash = viewName === 'analyzer' ? '' : `#/${VIEW_TO_ROUTE[viewName]}`;
    if (location.hash !== hash) history.pushState(null, '', hash || location.pathname + location.search);
  }
}

function routeFromHash() {
  const m = location.hash.match(/^#\/([a-z]+)/);
  return m && ROUTES[m[1]] ? ROUTES[m[1]] : 'analyzer';
}
window.addEventListener('popstate', () => switchView(routeFromHash(), { updateHash: false }));

$$('.sidebar-link, .mobile-nav-link').forEach(link => {
  link.addEventListener('click', e => {
    if (!link.dataset.view) return;
    e.preventDefault();
    switchView(link.dataset.view);
  });
});

$('#mast-db-pill')?.addEventListener('click', () => switchView('settings'));

// Input & example chips
const MAX_CHARS = 20000;
const EXAMPLES = [
  `The Great Wall of China is the only man-made structure visible from space with the naked eye. Construction began during the Qin Dynasty around 221 BC under Emperor Qin Shi Huang. The wall stretches approximately 13,171 miles and took over 2,000 years to complete. It was primarily built to protect against Mongolian invasions. An estimated 400,000 workers died during its construction. The wall is made entirely of stone and brick throughout its entire length.`,
  `Python was created by Guido van Rossum and first released in 1991. It is the fastest programming language available today. Python uses indentation for code blocks instead of curly braces. The language is named after the British comedy group Monty Python. Python 2 and Python 3 are fully backward compatible. It is the most popular language according to the TIOBE Index 2024.`,
  `The Eiffel Tower was built in 1889 for the World's Fair in Paris. It was designed by Gustave Eiffel and stands 1,063 feet tall including its antenna. The tower was originally intended to be temporary and was planned for demolition after 20 years. It weighs approximately 10,100 tons. The Eiffel Tower is the tallest structure in Europe. It receives about 7 million visitors per year.`
];

let draftTimer = null;
function syncSpecimenActive(text) {
  const trimmed = (text || '').trim();
  $$('.specimen-chip').forEach(chip => {
    const idx = parseInt(chip.dataset.sample || '-1', 10);
    chip.classList.toggle('active', EXAMPLES[idx] === trimmed);
  });
}

function updateCharCount() {
  const val = input.value;
  const n = val.length;
  charCount.textContent = n.toLocaleString();
  charCount.parentElement.classList.toggle('over', n > MAX_CHARS);
  if (wordCount) {
    const words = val.trim() ? val.trim().split(/\s+/).length : 0;
    wordCount.textContent = words.toLocaleString();
  }
  syncSpecimenActive(val);
}

input.addEventListener('input', () => {
  updateCharCount();
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => {
    try { input.value ? localStorage.setItem(DRAFT_KEY, input.value) : localStorage.removeItem(DRAFT_KEY); } catch {}
  }, 400);
});

input.addEventListener('keydown', e => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); btnAnalyze.click(); }
});

function setInputText(text) {
  input.value = text;
  updateCharCount();
  try { text ? localStorage.setItem(DRAFT_KEY, text) : localStorage.removeItem(DRAFT_KEY); } catch {}
}

let recentWireRows = [];
function syncWireVisibility() {
  const busyOrShowing = !processing.classList.contains('hidden') || !results.classList.contains('hidden');
  $('#recent-wire')?.classList.toggle('hidden', busyOrShowing || recentWireRows.length === 0);
  $('#idle-how')?.classList.toggle('hidden', busyOrShowing);
}

btnClear.addEventListener('click', () => {
  setInputText('');
  hideResults();
  processing.classList.add('hidden');
  syncWireVisibility();
  input.focus();
});

$('#btn-paste')?.addEventListener('click', async () => {
  try {
    const text = await navigator.clipboard.readText();
    if (!text.trim()) { showToast('Clipboard is empty', 'info'); return; }
    setInputText(text.trim());
    input.focus();
  } catch {
    showToast('Use Ctrl+V to paste directly.', 'info');
    input.focus();
  }
});
if (!navigator.clipboard || !navigator.clipboard.readText) $('#btn-paste')?.remove();

function hideResults() {
  if (!results.classList.contains('hidden')) results.classList.add('hidden');
  syncWireVisibility();
}

$$('.specimen-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    const idx = parseInt(chip.dataset.sample || '0', 10);
    if (EXAMPLES[idx]) {
      setInputText(EXAMPLES[idx]);
      input.focus();
    }
  });
});

function validateInput(text) {
  if (!text) return 'Paste a passage to check first.';
  if (text.length < 20) return 'Enter at least one complete factual sentence.';
  if (text.length > MAX_CHARS) return `Text is ${text.length.toLocaleString()} characters; limit is ${MAX_CHARS.toLocaleString()}.`;
  return null;
}

btnAnalyze.addEventListener('click', () => {
  const text = input.value.trim();
  const problem = validateInput(text);
  if (problem) { showToast(problem, 'error'); input.focus(); return; }
  runAnalysis(text);
});

$('#btn-cancel')?.addEventListener('click', () => {
  if (activeController) activeController.abort();
});

$$('.ftab').forEach(btn => {
  btn.addEventListener('click', () => {
    $$('.ftab').forEach(b => {
      b.classList.toggle('active', b === btn);
      b.setAttribute('aria-pressed', b === btn ? 'true' : 'false');
    });
    filterClaims(btn.dataset.filter);
  });
});

function positionTip(x, y) {
  const w = tip.offsetWidth || 320;
  const h = tip.offsetHeight || 110;
  tip.style.left = Math.max(8, Math.min(x + 14, window.innerWidth - w - 12)) + 'px';
  tip.style.top = Math.max(8, Math.min(y + 14, window.innerHeight - h - 12)) + 'px';
}
document.addEventListener('mousemove', e => {
  if (tip.classList.contains('visible')) positionTip(e.clientX, e.clientY);
});

// Groq API & source lookup
const PROD_ORIGIN = 'https://hallucination-hunter-five.vercel.app';
const IS_VERCEL = /\.vercel\.app$/.test(location.hostname);
const IS_LOCAL = location.protocol === 'file:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
const API_URL = (IS_VERCEL ? '' : PROD_ORIGIN) + '/api/groq';
const SEARCH_URL = (IS_VERCEL ? '' : PROD_ORIGIN) + '/api/search';
const GROQ_MODEL = 'openai/gpt-oss-120b';
const CALL_TIMEOUT_MS = 70000;
const VERIFY_BATCH = 14;

class CheckError extends Error {
  constructor(message, { retryable = false, cancelled = false } = {}) {
    super(message);
    this.retryable = retryable;
    this.cancelled = cancelled;
  }
}

function friendlyError(status, payload) {
  const msg = (payload && (payload.error || payload.message)) || '';
  if (status === 429) return 'Rate limit reached. Wait a few seconds and try again.';
  if (status === 413) return 'That passage is too long to check in one pass.';
  if (status === 400 && /json/i.test(msg)) return 'The model returned malformed JSON. Retrying usually fixes it.';
  if (status === 400) return msg || 'The request was rejected.';
  if (status >= 500) return 'Verification service is temporarily unavailable.';
  return msg || `Request failed (${status}).`;
}

function parseModelJson(content) {
  if (content && typeof content === 'object') return content;
  const text = String(content || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(text); } catch {}
  const m = text.match(/[\[{][\s\S]*[\]}]/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  throw new CheckError('The model returned unreadable output. Try again.', { retryable: true });
}

async function callGroq(messages, { temperature = 0.1, maxTokens = 4096, effort = 'low', signal } = {}) {
  const body = { model: GROQ_MODEL, messages, temperature, max_tokens: maxTokens, reasoning_effort: effort, response_format: { type: 'json_object' } };
  const direct = IS_LOCAL && window.GROQ_API_KEY;
  const url = direct ? 'https://api.groq.com/openai/v1/chat/completions' : API_URL;
  const headers = { 'Content-Type': 'application/json' };
  if (direct) headers.Authorization = `Bearer ${window.GROQ_API_KEY}`;

  for (let attempt = 0; ; attempt++) {
    if (signal && signal.aborted) throw new CheckError('Check cancelled.', { cancelled: true });
    const ctrl = new AbortController();
    const onAbort = () => ctrl.abort();
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => ctrl.abort(), CALL_TIMEOUT_MS);
    let res, payload;
    try {
      res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: ctrl.signal });
      payload = await res.json().catch(() => null);
    } catch {
      if (signal && signal.aborted) throw new CheckError('Check cancelled.', { cancelled: true });
      const msg = navigator.onLine === false ? 'You are offline. Reconnect and try again.' : 'Could not reach the verification service.';
      if (attempt < 1) { await delay(1200); continue; }
      throw new CheckError(msg, { retryable: true });
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
    }

    if (res.ok) {
      const content = payload && payload.choices && payload.choices[0] && payload.choices[0].message && payload.choices[0].message.content;
      try { return parseModelJson(content); }
      catch (e) { if (attempt < 1) continue; throw e; }
    }

    const retryAfter = Math.min(parseInt(res.headers.get('retry-after') || '0', 10) || 0, 20);
    const transient = res.status === 429 || res.status >= 500 || (res.status === 400 && /json/i.test(JSON.stringify(payload || '')));
    if (transient && attempt < 1) {
      await delay(retryAfter ? retryAfter * 1000 : 1500);
      continue;
    }
    throw new CheckError(friendlyError(res.status, payload), { retryable: transient });
  }
}

async function extractClaimsFromLLM(text, signal) {
  const result = await callGroq([
    {
      role: 'system',
      content: `Extract every standalone, checkable factual claim from the user's text.

Rules:
- Extract ONLY objective factual claims (skip personal preferences like "I'd pick X over Y", opinions, advice, greetings, or questions).
- Make each claim atomic — one verifiable fact per item — while keeping exact names, version numbers, prices, dates, and figures intact.
- "originalSentence" must be copied character-for-character from the user's input so it can be highlighted inline.
- Extract at most 40 claims.

Respond in JSON:
{
  "claims": [
    { "id": 1, "text": "Self-contained factual statement", "originalSentence": "Exact substring from input" }
  ]
}`
    },
    { role: 'user', content: text }
  ], { maxTokens: 4096, effort: 'low', signal });
  const list = Array.isArray(result) ? result : (result.claims || []);
  return list
    .filter(c => c && (c.text || c.claim))
    .slice(0, 40)
    .map((c, i) => ({
      id: i + 1,
      text: String(c.text || c.claim).trim(),
      originalSentence: String(c.originalSentence || c.text || c.claim).trim()
    }));
}

const VERIFY_PROMPT = `You are a rigorous fact-checking engine. Verify each claim against well-established, reliable knowledge. Never guess or invent facts.

STRICT RULES:
1. Mark "verified" ONLY if you are certain every detail (numbers, dates, names, versions) is factually accurate based on established pre-cutoff knowledge.
2. Mark "false" if ANY part of the claim contradicts established facts. State the true fact clearly and provide a one-sentence "correction".
3. Mark "unverifiable" whenever you are not 100% certain — including events from 2025 or later, unfamiliar or post-cutoff AI/software model versions (e.g. unconfirmed model numbers, release specs, or token pricing), live rankings, or statements attributed as "Company X claims/states..." whose underlying product or release you cannot independently confirm. NEVER mark an unfamiliar version or recent event "verified" just because it sounds plausible.
4. Keep "explanation" concise and direct (1-2 plain sentences).
5. Confidence must be an honest integer 0-100 reflecting your actual certainty.

For each claim return:
- "id": claim id
- "status": "verified" | "false" | "unverifiable"
- "confidence": integer 0-100
- "explanation": 1-2 plain sentences with the real facts
- "correction": for "false" claims only, one corrected sentence; otherwise null
- "source": authoritative organization name (e.g. "Encyclopaedia Britannica", "NASA", "Python Software Foundation")
- "sourceUrl": specific real URL you are certain exists, or null if unsure
- "category": one of "Science", "History", "Geography", "Technology", "Health", "Mathematics", "Politics", "Culture", "Economics", "Sports", "General"

Respond in JSON:
{ "results": [ { "id": 1, "status": "verified", "confidence": 92, "explanation": "...", "correction": null, "source": "...", "sourceUrl": "https://...", "category": "History" } ] }`;

async function verifyClaimsWithLLM(claims, signal, onBatch) {
  if (claims.length === 0) return [];
  const out = [];
  for (let i = 0; i < claims.length; i += VERIFY_BATCH) {
    const batch = claims.slice(i, i + VERIFY_BATCH);
    const claimList = batch.map(c => `[Claim ${c.id}]: "${c.text}"`).join('\n');
    const result = await callGroq([
      { role: 'system', content: VERIFY_PROMPT },
      { role: 'user', content: `Fact-check each claim below:\n\n${claimList}` }
    ], { maxTokens: 8192, effort: 'medium', signal });
    const rows = Array.isArray(result) ? result : (result.results || result.claims || []);
    batch.forEach((c, j) => {
      const hit = rows.find(r => r && String(r.id) === String(c.id)) || rows[j] || {};
      out.push({ ...hit, id: c.id });
    });
    if (onBatch) onBatch(Math.min(i + VERIFY_BATCH, claims.length), claims.length);
  }
  return out;
}

function normalizeStatus(s) {
  const v = String(s || '').toLowerCase().trim();
  if (v === 'verified' || v === 'true' || v === 'correct') return 'verified';
  if (v === 'false' || v === 'incorrect' || v === 'wrong' || v === 'inaccurate') return 'false';
  return 'unverifiable';
}

function normalizeConfidence(n) {
  let v = Number(n);
  if (!isFinite(v)) return 40;
  if (v > 0 && v <= 1) v *= 100;
  return Math.round(Math.max(0, Math.min(100, v)));
}

function safeUrl(u) {
  try {
    const url = new URL(String(u || '').trim());
    if (!/^https?:$/.test(url.protocol)) return null;
    if (/(^|\.)example\.(com|org)$/.test(url.hostname)) return null;
    return url.href;
  } catch { return null; }
}

function domainOf(u) {
  try {
    const url = new URL(String(u || '').trim());
    const host = url.hostname.replace(/^www\./i, '');
    if (/^google\./i.test(host) && url.pathname.startsWith('/search')) return '';
    return host;
  } catch { return ''; }
}

function finalizeClaims(rawClaims, verifyResults, idOffset = 0) {
  return rawClaims.map((c, i) => {
    const v = verifyResults.find(r => r.id === c.id) || {};
    const status = normalizeStatus(v.status);
    const source = (v.source && !/^(unknown|no source|none|n\/a)/i.test(v.source)) ? String(v.source) : 'Web search';
    const url = safeUrl(v.sourceUrl) || ('https://www.google.com/search?q=' + encodeURIComponent(c.text.slice(0, 120)));
    return {
      id: idOffset + i + 1,
      text: c.text,
      originalText: c.originalSentence || c.text,
      status,
      confidence: normalizeConfidence(v.confidence),
      explanation: String(v.explanation || 'No explanation returned for this claim.'),
      correction: v.correction && status === 'false' && String(v.correction).toLowerCase() !== 'null' ? String(v.correction) : null,
      source,
      sourceUrl: url,
      category: String(v.category || 'General')
    };
  });
}

async function findRealSources(claims, signal) {
  const targets = claims.filter(c => /google\.com\/search/i.test(c.sourceUrl || '')).slice(0, 6);
  if (!targets.length) return claims;
  await Promise.allSettled(targets.map(async c => {
    if (signal && signal.aborted) return;
    const ctrl = new AbortController();
    const onAbort = () => ctrl.abort();
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => ctrl.abort(), 3200);
    try {
      const res = await fetch(SEARCH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: c.text.slice(0, 140) }),
        signal: ctrl.signal
      });
      if (!res.ok) return;
      const data = await res.json().catch(() => null);
      const hit = (data && Array.isArray(data.results) ? data.results : [])
        .map(r => safeUrl(r && r.url))
        .find(u => u && !/google\.com\/search/i.test(u));
      if (hit) {
        c.sourceUrl = hit;
        if (c.source === 'Web search') c.source = domainOf(hit) || c.source;
      }
    } catch {
      /* keep fallback URL */
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
    }
  }));
  return claims;
}

// Progress bar
const progress = (() => {
  let shown = 0, floor = 0, ceil = 0, raf = 0, last = 0;
  const thumb = () => $('#progress-thumb');
  const label = () => $('#progress-pct');
  function frame(now) {
    const dt = Math.min(64, now - (last || now));
    last = now;
    const target = ceil - (ceil - floor) * 0.08;
    shown += (target - shown) * (1 - Math.exp(-dt / 900));
    paint();
    raf = requestAnimationFrame(frame);
  }
  function paint() {
    const pct = Math.round(shown);
    const t = thumb();
    const l = label();
    if (t) t.style.transform = `scaleX(${shown / 100})`;
    if (l) l.textContent = pct + '%';
  }
  return {
    reset() { cancelAnimationFrame(raf); shown = floor = ceil = 0; last = 0; paint(); },
    span(from, to) { floor = Math.max(shown, from); ceil = to; cancelAnimationFrame(raf); last = 0; raf = requestAnimationFrame(frame); },
    jump(to) { floor = ceil = shown = to; paint(); },
    stop() { cancelAnimationFrame(raf); }
  };
})();

function setStep(stepId, state) {
  const step = $(`#${stepId}`);
  if (!step) return;
  step.classList.toggle('active', state === 'active');
  step.classList.toggle('done', state === 'done');
  step.querySelector('.ps-status').innerHTML = state === 'active'
    ? '<div class="loader"></div>'
    : state === 'done'
      ? STEP_CHECK_ICON
      : '';
}

function setStepNote(stepId, text) {
  const desc = $(`#${stepId} .ps-desc`);
  if (desc) desc.textContent = text;
}

const STEP_COPY = {
  'ps-extract': 'Splitting the passage into individual factual statements',
  'ps-search': 'Testing each statement against established records',
  'ps-verify': 'Resolving reference links for each verdict'
};

function setBusy(busy) {
  btnAnalyze.disabled = busy;
  btnAnalyze.classList.toggle('is-busy', busy);
  btnAnalyze.setAttribute('aria-busy', busy ? 'true' : 'false');
  input.readOnly = busy;
  $('#btn-cancel')?.classList.toggle('hidden', !busy);
}

function splitBatch(text) {
  if (!$('#batch-mode')?.checked) return [text];
  return text.split(/\n\s*---+\s*\n/).map(t => t.trim()).filter(t => t.length >= 20);
}

async function runAnalysis(text) {
  if (activeController) return;
  const parts = splitBatch(text);
  if ($('#batch-mode')?.checked && parts.length < 2) {
    showToast('Batch mode needs at least two passages separated by --- on its own line.', 'error');
    return;
  }

  const controller = new AbortController();
  activeController = controller;
  const signal = controller.signal;

  hideResults();
  hideTip();
  processing.classList.remove('hidden');
  syncWireVisibility();
  Object.entries(STEP_COPY).forEach(([id, copy]) => { setStep(id, 'idle'); setStepNote(id, copy); });
  progress.reset();
  setBusy(true);
  requestAnimationFrame(() => processing.scrollIntoView({ behavior: REDUCED_MOTION ? 'auto' : 'smooth', block: 'nearest' }));

  try {
    setStep('ps-extract', 'active');
    progress.span(0, 30);
    const extracted = [];
    for (let i = 0; i < parts.length; i++) {
      if (parts.length > 1) setStepNote('ps-extract', `Passage ${i + 1} of ${parts.length}`);
      const claims = await extractClaimsFromLLM(parts[i], signal);
      extracted.push(claims);
    }
    const totalClaims = extracted.reduce((n, c) => n + c.length, 0);
    setStep('ps-extract', 'done');
    setStepNote('ps-extract', `${totalClaims} factual claim${totalClaims === 1 ? '' : 's'} found`);
    progress.jump(30);

    if (totalClaims === 0) {
      showToast('No checkable factual claims found. Try a passage with concrete dates, numbers, or names.', 'info');
      processing.classList.add('hidden');
      syncWireVisibility();
      return;
    }

    setStep('ps-search', 'active');
    progress.span(30, 90);
    let all = [];
    let done = 0;
    for (let i = 0; i < parts.length; i++) {
      if (!extracted[i].length) continue;
      const verdicts = await verifyClaimsWithLLM(extracted[i], signal, n => {
        setStepNote('ps-search', `${Math.min(done + n, totalClaims)} of ${totalClaims} claims checked`);
      });
      all = all.concat(finalizeClaims(extracted[i], verdicts, all.length));
      done += extracted[i].length;
    }
    setStep('ps-search', 'done');
    setStepNote('ps-search', `${totalClaims} of ${totalClaims} claims checked`);
    progress.jump(90);

    setStep('ps-verify', 'active');
    progress.span(90, 100);
    all = await findRealSources(all, signal);
    currentClaims = all;
    currentText = parts.join('\n\n---\n\n');
    await delay(REDUCED_MOTION ? 0 : 140);
    setStep('ps-verify', 'done');
    progress.jump(100);
    await delay(REDUCED_MOTION ? 0 : 150);

    processing.classList.add('hidden');
    displayResults(currentText, all);

    saveAnalysis(currentText, all)
      .then(() => { loadDashboardStats(); loadSources(); })
      .catch(err => {
        console.warn('Save failed:', err);
        showToast('Results ready, though database sync did not complete.', 'info');
      });
  } catch (err) {
    progress.stop();
    processing.classList.add('hidden');
    syncWireVisibility();
    if (err.cancelled) {
      showToast('Check cancelled', 'info');
    } else {
      console.error('Analysis error:', err);
      showToast(err.message || 'Verification failed.', 'error', { label: 'Retry', run: () => runAnalysis(text) });
    }
  } finally {
    progress.stop();
    activeController = null;
    setBusy(false);
  }
}

// Verdict math — avoids calling purely unverifiable/post-cutoff passages "0% / inaccurate"
function scoreOf(claims) {
  const total = claims.length;
  const v = claims.filter(c => c.status === 'verified').length;
  return total ? Math.round((v / total) * 100) : 0;
}

function verdictMeta(vCount, uCount, fCount, total) {
  const v = Number(vCount) || 0;
  const u = Number(uCount) || 0;
  const f = Number(fCount) || 0;
  const t = Number(total) || (v + u + f);
  if (t === 0 || (v === 0 && f === 0 && u > 0)) {
    return {
      unverifiedOnly: true,
      score: 0,
      band: 'mid',
      rowBand: 'unverified',
      rowLabel: 'Unverified',
      title: 'Needs outside verification'
    };
  }
  const score = Math.round((v / t) * 100);
  const band = score >= 70 ? 'good' : score >= 40 ? 'mid' : 'bad';
  const title = score >= 70
    ? 'Mostly accurate'
    : score >= 40
      ? 'Mixed \u2014 check flagged lines'
      : 'Mostly inaccurate';
  return {
    unverifiedOnly: false,
    score,
    band,
    rowBand: band,
    rowLabel: `${score}%`,
    title
  };
}

function summaryPartsText(vCount, uCount, fCount) {
  const parts = [];
  if (vCount > 0) parts.push(`${vCount} verified`);
  if (uCount > 0) parts.push(`${uCount} unverifiable`);
  if (fCount > 0) parts.push(`${fCount} false`);
  return parts.join(' \u00b7 ') || 'No claims';
}

function displayResults(originalText, claims) {
  const total = claims.length;
  const vCount = claims.filter(c => c.status === 'verified').length;
  const uCount = claims.filter(c => c.status === 'unverifiable').length;
  const fCount = claims.filter(c => c.status === 'false').length;
  const meta = verdictMeta(vCount, uCount, fCount, total);

  results.classList.remove('hidden');
  syncWireVisibility();
  results.classList.remove('is-in');
  void results.offsetWidth;
  results.classList.add('is-in');

  animateNum('s-total', total);
  animateNum('s-verified-inline', vCount);
  animateNum('s-verified', vCount);
  animateNum('s-unverifiable', uCount);
  animateNum('s-false', fCount);

  const readout = $('#score-donut');
  const scoreVal = $('#score-val');
  const scoreUnit = $('#score-unit');
  const verdictEl = $('#score-verdict');

  if (readout) {
    readout.dataset.band = meta.band;
    readout.classList.toggle('is-text', meta.unverifiedOnly);
  }
  if (meta.unverifiedOnly) {
    if (scoreVal) scoreVal.textContent = 'Unverified';
    if (scoreUnit) scoreUnit.textContent = '';
  } else {
    if (scoreUnit) scoreUnit.textContent = '%';
    animateNum('score-val', meta.score);
  }
  if (verdictEl) verdictEl.textContent = meta.title;

  const bVer = $('#breakdown-verified');
  const bUnv = $('#breakdown-unverifiable');
  const bFal = $('#breakdown-false');
  if (bVer && bUnv && bFal) {
    bVer.style.width = total ? `${(vCount / total) * 100}%` : '0%';
    bUnv.style.width = total ? `${(uCount / total) * 100}%` : '0%';
    bFal.style.width = total ? `${(fCount / total) * 100}%` : '0%';
  }

  $$('.ftab').forEach(b => {
    const on = b.dataset.filter === 'all';
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    const n = b.dataset.filter === 'all' ? total : claims.filter(c => c.status === b.dataset.filter).length;
    let badge = b.querySelector('.ftab-n');
    if (!badge) { badge = document.createElement('span'); badge.className = 'ftab-n'; b.appendChild(badge); }
    badge.textContent = n;
  });

  buildAnnotated(originalText, claims);
  buildCards(claims);
  setTimeout(() => results.scrollIntoView({ behavior: REDUCED_MOTION ? 'auto' : 'smooth', block: 'start' }), 100);
}

function animateNum(id, target) {
  const el = typeof id === 'string' ? $(`#${id}`) : id;
  if (!el) return;
  if (REDUCED_MOTION) { el.textContent = target; return; }
  const from = parseInt(el.textContent, 10) || 0;
  const dur = 500;
  const t0 = performance.now();
  if (el._raf) cancelAnimationFrame(el._raf);
  function tick(now) {
    const t = Math.min((now - t0) / dur, 1);
    el.textContent = Math.round(from + (target - from) * (1 - Math.pow(1 - t, 3)));
    if (t < 1) el._raf = requestAnimationFrame(tick);
  }
  el._raf = requestAnimationFrame(tick);
}

// Inline highlight builder
function renderAnnotatedHtml(originalText, claims) {
  const lower = originalText.toLowerCase();
  const ranges = [];
  [...claims]
    .sort((a, b) => (b.originalText || '').length - (a.originalText || '').length)
    .forEach(c => {
      const needles = [c.originalText, c.text].filter(Boolean).map(s => s.trim().replace(/[.\s]+$/, ''));
      for (const n of needles) {
        if (n.length < 6) continue;
        let from = 0, idx;
        while ((idx = lower.indexOf(n.toLowerCase(), from)) !== -1) {
          const end = idx + n.length;
          if (!ranges.some(r => idx < r.end && end > r.start)) { ranges.push({ start: idx, end, c }); return; }
          from = idx + 1;
        }
      }
    });
  ranges.sort((a, b) => a.start - b.start);

  let html = '', pos = 0;
  ranges.forEach(r => {
    const num = String(r.c.id || 1).padStart(2, '0');
    html += escapeHtml(originalText.slice(pos, r.start));
    html += `<mark class="claim-hl ${r.c.status}" tabindex="0" data-id="${r.c.id}">${escapeHtml(originalText.slice(r.start, r.end))}<sup class="claim-sup" aria-hidden="true">${num}</sup></mark>`;
    pos = r.end;
  });
  html += escapeHtml(originalText.slice(pos));
  return { html, marked: ranges.length };
}

function wireAnnotatedContainer(container, claims, onJump) {
  const byId = new Map(claims.map(c => [String(c.id), c]));
  container.querySelectorAll('.claim-hl').forEach(el => {
    const c = byId.get(el.dataset.id);
    if (!c) return;
    el.setAttribute('aria-label', `${VERDICT_LABELS[c.status]}: ${c.text}`);
    el.addEventListener('mouseenter', e => showTip(c, e.clientX, e.clientY));
    el.addEventListener('mouseleave', hideTip);
    el.addEventListener('focus', () => { const r = el.getBoundingClientRect(); showTip(c, r.left, r.bottom); });
    el.addEventListener('blur', hideTip);
    if (onJump) {
      el.addEventListener('click', () => onJump(c.id));
      el.addEventListener('keydown', e => { if (e.key === 'Enter') onJump(c.id); });
    }
  });
}

function buildAnnotated(originalText, claims) {
  const { html, marked } = renderAnnotatedHtml(originalText, claims);
  annotatedText.innerHTML = html;
  wireAnnotatedContainer(annotatedText, claims, id => focusCard(id));
  const note = $('#annotated-note');
  if (note) {
    note.textContent = marked < claims.length
      ? `${marked} of ${claims.length} claims matched directly in your text. Click any underline to jump to its row.`
      : 'Hover an underlined phrase to preview the finding, or click it to jump to its row below.';
  }
}

function showTip(c, x, y) {
  const colors = { verified: 'var(--tip-green)', unverifiable: 'var(--tip-amber)', false: 'var(--tip-red)' };
  tip.querySelector('.tip-status').textContent = VERDICT_LABELS[c.status];
  tip.querySelector('.tip-status').style.color = colors[c.status];
  tip.querySelector('.tip-conf').textContent = c.confidence + '% confidence';
  tip.querySelector('.tip-body').textContent = c.correction ? `Correction: ${c.correction}` : c.explanation;
  tip.querySelector('.tip-source').textContent = 'Source: ' + c.source;
  tip.classList.remove('hidden');
  positionTip(x, y);
  tip.classList.add('visible');
}
function hideTip() { tip.classList.remove('visible'); }

function focusCard(id, rootGrid = claimsGrid) {
  const card = rootGrid.querySelector(`.claim-card[data-id="${id}"]`);
  if (!card) return;
  if (rootGrid === claimsGrid && card.style.display === 'none') { $('.ftab[data-filter="all"]')?.click(); }
  card.scrollIntoView({ behavior: REDUCED_MOTION ? 'auto' : 'smooth', block: 'center' });
  card.classList.remove('flash');
  void card.offsetWidth;
  card.classList.add('flash');
  card.focus({ preventScroll: true });
}

function claimCardHTML(c, threshold) {
  const num = String(c.id || 1).padStart(2, '0');
  const below = c.confidence < threshold;
  const href = safeUrl(c.sourceUrl);
  const host = domainOf(href);
  const srcLink = href
    ? `<a href="${escapeAttr(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(c.source)}</a>`
    : `<span>${escapeHtml(c.source || 'No source')}</span>`;
  const cat = c.category && c.category !== 'General' ? `<span class="claim-tag">${escapeHtml(c.category)}</span>` : '';

  return `
    <div class="claim-card-top">
      <span class="claim-idx">${num}</span>
      <span class="verdict-stamp ${c.status}">${VERDICT_ICONS[c.status]}<span>${VERDICT_LABELS[c.status]}</span></span>
      ${cat}
      <div class="claim-meta-right">
        <span class="threshold-badge"${below ? '' : ' hidden'}>Below ${threshold}%</span>
        <span class="claim-conf" title="Model confidence">${c.confidence}%</span>
        <button type="button" class="icon-btn claim-copy" title="Copy claim" aria-label="Copy this claim">
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linejoin="round" aria-hidden="true"><rect x="7" y="7" width="9.5" height="9.5" rx="1.4"/><path d="M13 7V5a1.4 1.4 0 0 0-1.4-1.4H5.4A1.4 1.4 0 0 0 4 5v6.2a1.4 1.4 0 0 0 1.4 1.4H7"/></svg>
        </button>
      </div>
    </div>
    <p class="claim-desc">${escapeHtml(c.text)}</p>
    ${c.correction ? `<div class="claim-correction"><strong>Correction:</strong>${escapeHtml(c.correction)}</div>` : ''}
    ${c.explanation ? `<p class="claim-explain">${escapeHtml(c.explanation)}</p>` : ''}
    <div class="claim-foot-row">
      <div class="claim-source-direct">${LINK_ICON}${srcLink}${host ? `<span class="src-domain">${escapeHtml(host)}</span>` : ''}</div>
    </div>`;
}

function wireClaimCard(card, c) {
  const copy = card.querySelector('.claim-copy');
  if (copy) {
    copy.addEventListener('click', async () => {
      const text = `${VERDICT_LABELS[c.status]} (${c.confidence}%): ${c.text}\n${c.correction ? 'Correction: ' + c.correction + '\n' : ''}${c.explanation || ''}\nSource: ${c.source}${safeUrl(c.sourceUrl) ? ' ' + c.sourceUrl : ''}`;
      if (await copyText(text)) {
        copy.classList.add('done');
        setTimeout(() => copy.classList.remove('done'), 1200);
      }
    });
  }
}

function buildCards(claims) {
  claimsGrid.innerHTML = '';
  const threshold = parseInt($('#s-conf-range')?.value || '75', 10);
  claims.forEach(c => {
    const card = document.createElement('article');
    card.className = 'claim-card';
    card.tabIndex = -1;
    card.dataset.id = c.id;
    card.dataset.status = c.status;
    card.dataset.confidence = c.confidence;
    if (c.confidence < threshold) card.classList.add('below-threshold');
    card.innerHTML = claimCardHTML(c, threshold);
    wireClaimCard(card, c);
    claimsGrid.appendChild(card);
  });
  updateEmptyFilter('all');
}

function filterClaims(filter) {
  const cards = [...claimsGrid.querySelectorAll('.claim-card')];
  const apply = () => cards.forEach(card => {
    card.style.display = (filter === 'all' || card.dataset.status === filter) ? '' : 'none';
  });
  withTransition(apply);
  updateEmptyFilter(filter);
}

function updateEmptyFilter(filter) {
  let empty = $('#claims-empty');
  const any = filter === 'all' ? currentClaims.length > 0 : currentClaims.some(c => c.status === filter);
  if (any) { if (empty) empty.remove(); return; }
  if (!empty) {
    empty = document.createElement('p');
    empty.id = 'claims-empty';
    empty.className = 'claims-empty';
    claimsGrid.after(empty);
  }
  empty.textContent = `No ${VERDICT_LABELS[filter]?.toLowerCase() || ''} claims in this check.`;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch {}
    ta.remove();
    if (!ok) showToast('Copy failed in this browser.', 'error');
    return ok;
  }
}

// Supabase save
async function saveAnalysis(text, claims) {
  if (db.unavailable) throw new Error('Storage unavailable');
  const vCount = claims.filter(c => c.status === 'verified').length;
  const uCount = claims.filter(c => c.status === 'unverifiable').length;
  const fCount = claims.filter(c => c.status === 'false').length;

  const { data: analysis, error: aErr } = await db.from('analyses').insert({
    input_text: text,
    trust_score: scoreOf(claims),
    total_claims: claims.length,
    verified_count: vCount,
    unverifiable_count: uCount,
    false_count: fCount,
    user_id: userId,
    model_used: GROQ_MODEL
  }).select().single();
  if (aErr) throw aErr;

  const claimRows = claims.map(c => ({
    analysis_id: analysis.id,
    claim_text: c.text,
    status: c.status,
    confidence: c.confidence,
    explanation: c.correction ? `${c.explanation}\n\nActually: ${c.correction}` : c.explanation,
    source_name: c.source,
    source_url: c.sourceUrl,
    user_id: userId
  }));
  const { error: cErr } = await db.from('claims').insert(claimRows);
  if (cErr) throw cErr;
  historyCache = null;
  return analysis;
}

// History view
let historyCache = null;
const pendingDeletes = new Map();

function skeletonRows(n) {
  return Array.from({ length: n }, () => '<div class="history-row skeleton" aria-hidden="true"><div class="sk sk-score"></div><div class="history-info"><div class="sk sk-line"></div><div class="sk sk-line short"></div></div></div>').join('');
}

function relativeDate(iso) {
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

async function loadHistory() {
  const list = $('#history-list');
  const detail = $('#history-detail');
  detail.classList.add('hidden');
  list.classList.remove('hidden');
  $('#history-tools')?.classList.remove('hidden');

  if (!historyCache) list.innerHTML = skeletonRows(4);
  const { data, error } = await db.from('analyses').select('*').order('created_at', { ascending: false }).limit(100);
  if (error) {
    list.innerHTML = `<div class="empty-state"><h3>History unavailable</h3><p>${db.unavailable ? 'Storage is blocked in this browser. Checks still run normally.' : 'Could not reach Supabase Postgres. Check your connection.'}</p></div>`;
    return;
  }
  historyCache = (data || []).filter(a => !pendingDeletes.has(a.id));
  renderHistory();
}

function originTagHtml(uid) {
  const s = String(uid || '');
  if (!s.startsWith('skill:')) return '';
  const name = s.slice(6).trim();
  if (!name) return '';
  return `<span>&middot;</span><span class="origin-tag">via ${escapeHtml(name)}</span>`;
}

function renderHistory() {
  const list = $('#history-list');
  const q = ($('#history-filter')?.value || '').trim().toLowerCase();
  const rows = (historyCache || []).filter(a => !q || (a.input_text || '').toLowerCase().includes(q));
  const count = $('#history-count');
  if (count) count.textContent = historyCache && historyCache.length ? `(${historyCache.length})` : '';
  $('#btn-clear-history').disabled = !(historyCache && historyCache.length);
  $('#btn-export-history').disabled = !(historyCache && historyCache.length);

  if (!historyCache || historyCache.length === 0) {
    list.innerHTML = `<div class="empty-state"><h3>No checks saved yet</h3><p>Run a check from the Check tab and it will appear here.</p><button type="button" class="action-btn" data-goto="analyzer">Go to Check</button></div>`;
    list.querySelector('[data-goto]')?.addEventListener('click', () => switchView('analyzer'));
    return;
  }
  if (rows.length === 0) {
    list.innerHTML = `<div class="empty-state small-empty"><h3>No matches</h3><p>Nothing in history contains &ldquo;${escapeHtml(q)}&rdquo;.</p></div>`;
    return;
  }

  list.innerHTML = '';
  rows.forEach(a => {
    const meta = verdictMeta(a.verified_count, a.unverifiable_count, a.false_count, a.total_claims);
    const text = String(a.input_text || '').replace(/\s+/g, ' ').trim();
    const preview = text.length > 140 ? text.slice(0, 140) + '\u2026' : (text || 'Untitled passage');
    const summary = summaryPartsText(a.verified_count || 0, a.unverifiable_count || 0, a.false_count || 0);
    const row = document.createElement('div');
    row.className = 'history-row';
    row.innerHTML = `
      <button type="button" class="history-open" aria-label="Open this check">
        <span class="row-verdict ${meta.rowBand}"><span class="row-dot" aria-hidden="true"></span><span>${meta.rowLabel}</span></span>
        <span class="history-info">
          <span class="history-preview">${escapeHtml(preview)}</span>
          <span class="history-meta"><span title="${escapeAttr(new Date(a.created_at).toLocaleString())}">${relativeDate(a.created_at)}</span><span>&middot;</span><span>${a.total_claims || 0} ${(a.total_claims || 0) === 1 ? 'claim' : 'claims'}</span>${originTagHtml(a.user_id)}</span>
        </span>
        <span class="history-summary-text">${escapeHtml(summary)}</span>
      </button>
      <button type="button" class="history-delete" title="Delete entry" aria-label="Delete this check">
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round"><path d="M4.2 6h11.6M8 6V4.4c0-.5.4-.9.9-.9h2.2c.5 0 .9.4.9.9V6M5.8 6l.6 9.8c0 .7.6 1.2 1.3 1.2h4.6c.7 0 1.3-.5 1.3-1.2L14.2 6"/></svg>
      </button>`;
    row.querySelector('.history-open').addEventListener('click', () => viewHistoryDetail(a.id));
    row.querySelector('.history-delete').addEventListener('click', () => deleteWithUndo(a, row));
    list.appendChild(row);
  });
}

$('#history-filter')?.addEventListener('input', () => renderHistory());

function collapseRow(row) {
  return new Promise(resolve => {
    if (REDUCED_MOTION) { row.remove(); resolve(); return; }
    row.style.height = row.offsetHeight + 'px';
    row.classList.add('removing');
    requestAnimationFrame(() => { row.style.height = '0px'; });
    setTimeout(() => { row.remove(); resolve(); }, 250);
  });
}

async function commitDelete(id) {
  pendingDeletes.delete(id);
  const { error } = await db.from('analyses').delete().eq('id', id).eq('user_id', userId);
  if (error) { showToast('Delete could not be synced.', 'error'); return; }
  loadDashboardStats();
}

async function deleteWithUndo(a, row) {
  await collapseRow(row);
  historyCache = (historyCache || []).filter(x => x.id !== a.id);
  if (!historyCache.length || !$('#history-list .history-row')) renderHistory();
  const timer = setTimeout(() => commitDelete(a.id), 6000);
  pendingDeletes.set(a.id, timer);
  showToast('Check removed', 'info', {
    label: 'Undo',
    run: () => {
      clearTimeout(pendingDeletes.get(a.id));
      pendingDeletes.delete(a.id);
      historyCache = [a, ...(historyCache || [])].sort((x, y) => new Date(y.created_at) - new Date(x.created_at));
      renderHistory();
    }
  });
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'hidden') return;
  for (const [id, timer] of pendingDeletes) { clearTimeout(timer); commitDelete(id); }
});

function rowToClaim(c, i) {
  const parts = String(c.explanation || '').split('\n\nActually: ');
  return {
    id: i + 1,
    text: c.claim_text,
    originalText: c.claim_text,
    status: normalizeStatus(c.status),
    confidence: normalizeConfidence(c.confidence),
    explanation: parts[0],
    correction: parts[1] || null,
    source: c.source_name || 'No source',
    sourceUrl: c.source_url,
    category: c.category || 'General'
  };
}

async function viewHistoryDetail(analysisId) {
  const detail = $('#history-detail');
  const content = $('#history-detail-content');
  const list = $('#history-list');

  const [{ data: analysis }, { data: rows }] = await Promise.all([
    db.from('analyses').select('*').eq('id', analysisId).single(),
    db.from('claims').select('*').eq('analysis_id', analysisId).order('created_at', { ascending: true })
  ]);
  if (!analysis || !rows) { showToast('Could not open that saved check', 'error'); return; }

  const claims = rows.map(rowToClaim);
  const meta = verdictMeta(analysis.verified_count, analysis.unverifiable_count, analysis.false_count, analysis.total_claims || claims.length);
  const date = new Date(analysis.created_at).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const threshold = parseInt($('#s-conf-range')?.value || '75', 10);
  const { html: annotatedHtml } = renderAnnotatedHtml(analysis.input_text || '', claims);
  const tot = Math.max(1, analysis.total_claims || claims.length || 1);

  withTransition(() => {
    list.classList.add('hidden');
    $('#history-tools')?.classList.add('hidden');
    detail.classList.remove('hidden');
    content.innerHTML = `
      <div class="results-dossier">
        <div class="results-head">
          <div class="score-block">
            <div class="score-readout${meta.unverifiedOnly ? ' is-text' : ''}" data-band="${meta.band}">
              <span class="score-number">${meta.unverifiedOnly ? 'Unverified' : meta.score}</span><span class="score-pct">${meta.unverifiedOnly ? '' : '%'}</span>
            </div>
            <div class="score-copy">
              <span class="score-title">${escapeHtml(meta.title)}</span>
              <span class="score-note">Checked ${escapeHtml(date)} &middot; <strong>${analysis.total_claims || claims.length}</strong> claims</span>
            </div>
          </div>
          <div class="summary-meter-col">
            <ul class="summary-row">
              <li class="summary-pill pill-verified"><span class="pill-dot" aria-hidden="true"></span><span class="pill-num">${analysis.verified_count || 0}</span><span class="pill-label">verified</span></li>
              <li class="summary-pill pill-unverifiable"><span class="pill-dot" aria-hidden="true"></span><span class="pill-num">${analysis.unverifiable_count || 0}</span><span class="pill-label">unverifiable</span></li>
              <li class="summary-pill pill-false"><span class="pill-dot" aria-hidden="true"></span><span class="pill-num">${analysis.false_count || 0}</span><span class="pill-label">false</span></li>
            </ul>
            <div class="breakdown-bar" aria-hidden="true">
              <span class="bd-seg bd-verified" style="width:${((analysis.verified_count || 0) / tot) * 100}%"></span>
              <span class="bd-seg bd-unverifiable" style="width:${((analysis.unverifiable_count || 0) / tot) * 100}%"></span>
              <span class="bd-seg bd-false" style="width:${((analysis.false_count || 0) / tot) * 100}%"></span>
            </div>
          </div>
          <div class="results-actions">
            <button type="button" class="action-btn" id="btn-open-in-checker">Open in Check</button>
          </div>
        </div>
      </div>
      <section class="content-section">
        <div class="section-label"><h2>Marked-up text</h2></div>
        <div class="annotated-card" id="history-annotated">${annotatedHtml}</div>
      </section>
      <section class="content-section">
        <div class="section-label"><h2>Claims</h2></div>
        <div class="claims-list" id="history-claims"></div>
      </section>`;

    const grid = $('#history-claims');
    claims.forEach(c => {
      const card = document.createElement('article');
      card.className = 'claim-card' + (c.confidence < threshold ? ' below-threshold' : '');
      card.tabIndex = -1;
      card.dataset.id = c.id;
      card.dataset.status = c.status;
      card.dataset.confidence = c.confidence;
      card.innerHTML = claimCardHTML(c, threshold);
      wireClaimCard(card, c);
      grid.appendChild(card);
    });
    const histAnn = $('#history-annotated');
    if (histAnn) wireAnnotatedContainer(histAnn, claims, id => focusCard(id, grid));
    $('#btn-open-in-checker').addEventListener('click', () => {
      currentClaims = claims;
      currentText = analysis.input_text;
      setInputText(analysis.input_text);
      switchView('analyzer');
      displayResults(analysis.input_text, claims);
    });
  });
  window.scrollTo({ top: 0, behavior: REDUCED_MOTION ? 'auto' : 'smooth' });
}

$('#btn-back-history').addEventListener('click', () => {
  withTransition(() => {
    $('#history-detail').classList.add('hidden');
    $('#history-list').classList.remove('hidden');
    $('#history-tools')?.classList.remove('hidden');
  });
});

$('#btn-clear-history').addEventListener('click', async () => {
  if (!historyCache || !historyCache.length) return;
  if (!(await confirmDialog({ title: 'Clear your saved checks?', body: 'This deletes checks created from this browser. It cannot be undone.', confirm: 'Delete checks', danger: true }))) return;
  const { error } = await db.from('analyses').delete().eq('user_id', userId);
  if (error) { showToast('Could not clear history', 'error'); return; }
  showToast('Saved checks cleared', 'success');
  historyCache = null;
  loadHistory();
  loadDashboardStats();
});

$('#btn-export-history')?.addEventListener('click', async () => {
  const [{ data: analyses }, { data: claims }] = await Promise.all([
    db.from('analyses').select('*').order('created_at', { ascending: false }).limit(100),
    db.from('claims').select('*').limit(1000)
  ]);
  if (!analyses) { showToast('Could not export history', 'error'); return; }
  const byAnalysis = {};
  (claims || []).forEach(c => { (byAnalysis[c.analysis_id] = byAnalysis[c.analysis_id] || []).push(c); });
  const payload = {
    exported_at: new Date().toISOString(),
    app: 'Hallucination Hunter',
    checks: analyses.map(a => ({
      created_at: a.created_at,
      trust_score: a.trust_score,
      text: a.input_text,
      claims: (byAnalysis[a.id] || []).map(c => ({
        claim: c.claim_text,
        status: c.status,
        confidence: c.confidence,
        explanation: c.explanation,
        source: c.source_name,
        url: c.source_url
      }))
    }))
  };
  downloadFile(`hallucination-hunter-history-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(payload, null, 2), 'application/json');
});

// Sources view
async function loadSources() {
  const list = $('#sources-list');
  if (!list) return;
  const { data, error } = await db.from('claims').select('source_name, source_url, status').limit(1000);
  if (error) {
    list.innerHTML = `<div class="empty-state small-empty"><h3>Unavailable</h3><p>Could not load cited sources right now.</p></div>`;
    return;
  }
  if (!data || data.length === 0) {
    list.innerHTML = `<div class="empty-state small-empty"><h3>Nothing cited yet</h3><p>Sources appear here automatically once checks are run.</p></div>`;
    return;
  }

  const sourceMap = {};
  data.forEach(c => {
    const name = c.source_name || 'Unknown source';
    if (!sourceMap[name]) sourceMap[name] = { name, url: safeUrl(c.source_url), count: 0, v: 0, f: 0 };
    const s = sourceMap[name];
    s.count++;
    if (c.status === 'verified') s.v++;
    if (c.status === 'false') s.f++;
    if (s.url && /google\.com\/search/.test(s.url) && c.source_url && !/google\.com\/search/.test(c.source_url)) {
      s.url = safeUrl(c.source_url);
    }
  });

  const sources = Object.values(sourceMap).sort((a, b) => b.count - a.count);
  const max = sources[0].count;
  list.innerHTML = sources.slice(0, 40).map((s, idx) => {
    const host = domainOf(s.url);
    return `
      <div class="source-row">
        <div class="source-rank">${String(idx + 1).padStart(2, '0')}</div>
        <div class="source-info">
          <div class="source-name-row">
            <span class="source-name">${s.url ? `<a href="${escapeAttr(s.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(s.name)}</a>` : escapeHtml(s.name)}</span>
            ${host ? `<span class="src-domain">${escapeHtml(host)}</span>` : ''}
          </div>
          <div class="source-meta">${s.v} verified &middot; ${s.f} false</div>
        </div>
        <div class="source-bar" aria-hidden="true"><span style="--w:${s.count / max}"></span></div>
        <div class="source-count">${s.count} ${s.count === 1 ? 'citation' : 'citations'}</div>
      </div>`;
  }).join('');
}

// Settings
const SETTINGS_KEY = 'hh_settings';
function readLocalSettings() {
  try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'); } catch { return {}; }
}
function writeLocalSettings(patch) {
  const next = { ...readLocalSettings(), ...patch };
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(next)); } catch {}
  return next;
}

function applyThreshold(threshold) {
  $('#s-conf-range').value = threshold;
  $('#s-conf-val').textContent = threshold + '%';
  $$('.claim-card').forEach(card => {
    const conf = parseInt(card.dataset.confidence || '0', 10);
    const below = conf < threshold;
    card.classList.toggle('below-threshold', below);
    const badge = card.querySelector('.threshold-badge');
    if (badge) { badge.hidden = !below; badge.textContent = `Below ${threshold}%`; }
  });
}

let settingsDirty = false;
function markSettingsDirty(dirty) {
  settingsDirty = dirty;
  const btn = $('#btn-save-settings');
  btn.disabled = !dirty;
  btn.textContent = dirty ? 'Save changes' : 'Saved';
}

async function loadSettings() {
  const local = readLocalSettings();
  if (local.confidence_threshold) applyThreshold(parseInt(local.confidence_threshold, 10));
  markSettingsDirty(false);
  const { data, error } = await db.from('settings').select('*').eq('user_id', userId);
  if (error || !data || settingsDirty) return;
  data.forEach(s => {
    if (s.key === 'api_provider') $('#s-api-provider').value = s.value;
    if (s.key === 'confidence_threshold') {
      applyThreshold(parseInt(s.value, 10));
      writeLocalSettings({ confidence_threshold: s.value });
    }
  });
}

$('#s-conf-range').addEventListener('input', e => {
  applyThreshold(parseInt(e.target.value, 10));
  markSettingsDirty(true);
});
$('#s-api-provider').addEventListener('change', () => markSettingsDirty(true));

$('#btn-save-settings').addEventListener('click', async () => {
  const btn = $('#btn-save-settings');
  const settings = [
    { key: 'api_provider', value: $('#s-api-provider').value },
    { key: 'confidence_threshold', value: $('#s-conf-range').value }
  ];
  writeLocalSettings({ confidence_threshold: settings[1].value });
  btn.disabled = true;
  btn.textContent = 'Saving\u2026';
  let failed = false;
  for (const s of settings) {
    await db.from('settings').delete().eq('key', s.key).eq('user_id', userId);
    const { error } = await db.from('settings').insert({ key: s.key, value: s.value, user_id: userId, updated_at: new Date().toISOString() });
    if (error) failed = true;
  }
  markSettingsDirty(false);
  showToast(failed ? 'Saved locally. Cloud sync could not complete.' : 'Settings saved', failed ? 'info' : 'success');
});

function setMastheadSyncState(connected, count = null) {
  const pill = $('#mast-db-pill');
  const txt = $('#mast-db-text');
  if (pill) {
    pill.classList.toggle('connected', connected === true);
    pill.classList.toggle('disconnected', connected === false);
  }
  if (txt) {
    txt.textContent = connected === true
      ? (count != null ? `Synced \u00b7 ${count}` : 'Synced')
      : connected === false
        ? 'Local'
        : 'Connecting';
  }
}

async function checkDbStatus() {
  const statusEl = $('#db-status');
  const analysesCountEl = $('#db-analyses-count');
  const claimsCountEl = $('#db-claims-count');
  statusEl.textContent = 'Checking\u2026';
  statusEl.className = 'db-status';
  const [a, c] = await Promise.all([
    db.from('analyses').select('*', { count: 'exact', head: true }),
    db.from('claims').select('*', { count: 'exact', head: true })
  ]);
  if (a.error || c.error) {
    statusEl.textContent = 'Disconnected';
    statusEl.className = 'db-status disconnected';
    analysesCountEl.textContent = '\u2013';
    claimsCountEl.textContent = '\u2013';
    setMastheadSyncState(false);
    return;
  }
  statusEl.textContent = 'Connected';
  statusEl.className = 'db-status connected';
  analysesCountEl.textContent = (a.count ?? 0).toLocaleString();
  claimsCountEl.textContent = (c.count ?? 0).toLocaleString();
  setMastheadSyncState(true, a.count ?? 0);
}

// Inline stats + deduplicated Recent checks list
async function loadDashboardStats() {
  const { data: analyses, error, count } = await db
    .from('analyses')
    .select('id, input_text, trust_score, verified_count, unverifiable_count, false_count, total_claims, user_id, created_at', { count: 'exact' })
    .order('created_at', { ascending: false })
    .limit(200);
  if (error || !analyses) {
    setMastheadSyncState(false);
    return;
  }
  const visible = analyses.filter(a => !pendingDeletes.has(a.id));
  if (!historyCache) historyCache = visible.slice(0, 100);
  const totalAnalyses = count ?? visible.length;
  const totalClaims = visible.reduce((s, a) => s + (a.total_claims || 0), 0);
  const totalVerified = visible.reduce((s, a) => s + (a.verified_count || 0), 0);
  const accuracy = totalClaims ? Math.round((totalVerified / totalClaims) * 100) : 0;

  animateNum('dash-total', totalAnalyses);
  animateNum('dash-claims', totalClaims);
  animateNumWithSuffix($('#dash-accuracy'), accuracy, '%');
  setMastheadSyncState(true, totalAnalyses);

  // Deduplicate repeated test inputs and skip empty runs on the front page
  const seen = new Set();
  const deduped = [];
  for (const a of visible) {
    if (!(a.total_claims > 0)) continue;
    const key = String(a.input_text || '').toLowerCase().replace(/\s+/g, ' ').trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(a);
    if (deduped.length >= 4) break;
  }
  renderRecentWire(deduped, totalAnalyses);
}

function renderRecentWire(rows, totalCount) {
  recentWireRows = rows || [];
  const wireList = $('#wire-list');
  const wireAllLabel = $('#wire-all-label');
  if (wireAllLabel) {
    wireAllLabel.textContent = totalCount ? `View all (${totalCount})` : 'View history';
  }
  if (!wireList) return;
  wireList.innerHTML = '';
  recentWireRows.forEach(a => {
    const meta = verdictMeta(a.verified_count, a.unverifiable_count, a.false_count, a.total_claims);
    const raw = String(a.input_text || '').replace(/\s+/g, ' ').trim();
    const excerpt = raw.length > 120 ? raw.slice(0, 120) + '\u2026' : (raw || 'Untitled passage');
    const summary = summaryPartsText(a.verified_count || 0, a.unverifiable_count || 0, a.false_count || 0);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'wire-row';
    btn.innerHTML = `
      <span class="row-verdict ${meta.rowBand}"><span class="row-dot" aria-hidden="true"></span><span>${meta.rowLabel}</span></span>
      <span class="wire-excerpt">${escapeHtml(excerpt)}</span>
      <span class="wire-summary">${escapeHtml(summary)}</span>
      <span class="wire-time">${relativeDate(a.created_at)}</span>`;
    btn.addEventListener('click', () => openWireEntry(a));
    wireList.appendChild(btn);
  });
  syncWireVisibility();
}

async function openWireEntry(analysis) {
  const { data: rows, error } = await db
    .from('claims')
    .select('*')
    .eq('analysis_id', analysis.id)
    .order('created_at', { ascending: true });
  if (error || !rows || !rows.length) {
    showToast('Could not load claims for that check', 'error');
    return;
  }
  const claims = rows.map(rowToClaim);
  const text = analysis.input_text || '';
  currentClaims = claims;
  currentText = text;
  setInputText(text);
  displayResults(text, claims);
}

$('#btn-wire-all')?.addEventListener('click', () => switchView('history'));

function animateNumWithSuffix(el, target, suffix) {
  if (!el) return;
  let num = el.querySelector('.stat-num');
  if (!num) {
    el.innerHTML = `<span class="stat-num">0</span><span class="stat-unit">${suffix}</span>`;
    num = el.querySelector('.stat-num');
  }
  animateNum(num, target);
}

// Dialog helper
function confirmDialog({ title, body, confirm = 'Confirm', danger = false }) {
  const dlg = $('#confirm-dialog');
  if (!dlg || !dlg.showModal) return Promise.resolve(window.confirm(`${title}\n\n${body}`));
  dlg.querySelector('.dialog-title').textContent = title;
  dlg.querySelector('.dialog-body').textContent = body;
  const ok = dlg.querySelector('.dialog-confirm');
  ok.textContent = confirm;
  ok.classList.toggle('btn-solid-danger', danger);
  return new Promise(resolve => {
    dlg.addEventListener('close', () => resolve(dlg.returnValue === 'confirm'), { once: true });
    dlg.returnValue = '';
    dlg.showModal();
    dlg.querySelector('.dialog-cancel').focus();
  });
}
$('#confirm-dialog')?.addEventListener('click', e => {
  if (e.target === e.currentTarget) e.currentTarget.close('cancel');
});

function downloadFile(name, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Voice input
(() => {
  const micBtn = $('#btn-mic');
  if (!micBtn) return;

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) { micBtn.remove(); return; }

  let recognition = null;
  let isRecording = false;

  micBtn.addEventListener('click', () => {
    if (isRecording) { recognition.stop(); return; }

    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = navigator.language || 'en-US';

    const startText = input.value;
    let newSpeech = '';

    recognition.onstart = () => {
      isRecording = true;
      micBtn.classList.add('recording');
      micBtn.setAttribute('aria-pressed', 'true');
      showToast('Listening\u2026 click microphone again to stop.', 'info');
    };

    recognition.onresult = e => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) {
          newSpeech += (newSpeech ? ' ' : '') + e.results[i][0].transcript.trim();
        }
      }
      setInputText(startText + (startText && newSpeech ? ' ' : '') + newSpeech);
    };

    recognition.onend = () => {
      isRecording = false;
      micBtn.classList.remove('recording');
      micBtn.setAttribute('aria-pressed', 'false');
    };

    recognition.onerror = e => {
      isRecording = false;
      micBtn.classList.remove('recording');
      micBtn.setAttribute('aria-pressed', 'false');
      const why = { 'not-allowed': 'Microphone permission denied.', 'no-speech': 'No speech detected.', network: 'Voice input requires an active connection.' };
      if (e.error !== 'aborted') showToast(why[e.error] || 'Voice input stopped.', 'error');
    };

    recognition.start();
  });
})();

// Export, copy, share
function reportText() {
  const total = currentClaims.length;
  const count = s => currentClaims.filter(c => c.status === s).length;
  const meta = verdictMeta(count('verified'), count('unverifiable'), count('false'), total);
  let text = `Hallucination Hunter Fact-Check\n${new Date().toLocaleString()}\n\n`;
  text += `Result: ${meta.rowLabel} (${meta.title}) across ${total} claims\n`;
  text += `Verified: ${count('verified')} | Unverifiable: ${count('unverifiable')} | False: ${count('false')}\n\n`;
  currentClaims.forEach((c, i) => {
    text += `${String(i + 1).padStart(2, '0')}. ${VERDICT_LABELS[c.status]} (${c.confidence}%)\n`;
    text += `    "${c.text}"\n`;
    if (c.correction) text += `    Correction: ${c.correction}\n`;
    text += `    ${c.explanation}\n`;
    text += `    Source: ${c.source}${safeUrl(c.sourceUrl) ? ' - ' + c.sourceUrl : ''}\n\n`;
  });
  return text;
}

function reportMarkdown() {
  const count = s => currentClaims.filter(c => c.status === s).length;
  const meta = verdictMeta(count('verified'), count('unverifiable'), count('false'), currentClaims.length);
  const lines = [
    '# Hallucination Hunter Fact-Check',
    '',
    `Result: **${meta.rowLabel}** (${meta.title}) across ${currentClaims.length} claims. Checked ${new Date().toLocaleString()}.`,
    '',
    '| # | Verdict | Confidence | Claim | Source |',
    '|---|---|---|---|---|'
  ];
  const cell = s => String(s || '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
  currentClaims.forEach((c, i) => {
    const src = safeUrl(c.sourceUrl) ? `[${cell(c.source)}](${c.sourceUrl})` : cell(c.source);
    lines.push(`| ${String(i + 1).padStart(2, '0')} | ${VERDICT_LABELS[c.status]} | ${c.confidence}% | ${cell(c.text)}${c.correction ? '<br>*Correction:* ' + cell(c.correction) : ''} | ${src} |`);
  });
  lines.push('', '## Checked text', '', currentText.split('\n').map(l => '> ' + l).join('\n'));
  return lines.join('\n');
}

$('#btn-export')?.addEventListener('click', () => {
  if (!currentClaims.length) { showToast('Nothing to print yet', 'error'); return; }
  window.print();
});

$('#btn-copy')?.addEventListener('click', async () => {
  if (!currentClaims.length) { showToast('Nothing to copy yet', 'error'); return; }
  if (await copyText(reportText())) showToast('Report copied to clipboard', 'success');
});

$('#btn-markdown')?.addEventListener('click', () => {
  if (!currentClaims.length) { showToast('Nothing to export yet', 'error'); return; }
  downloadFile(`fact-check-${new Date().toISOString().slice(0, 10)}.md`, reportMarkdown(), 'text/markdown');
});

function encodeShare() {
  const data = {
    v: 2,
    x: currentText.length <= 3000 ? currentText : '',
    c: currentClaims.map(c => [
      c.text,
      c.status[0],
      c.confidence,
      c.explanation,
      c.source,
      safeUrl(c.sourceUrl) && !/google\.com\/search/.test(c.sourceUrl) ? c.sourceUrl : '',
      c.correction || '',
      c.originalText !== c.text ? c.originalText : ''
    ])
  };
  const bytes = new TextEncoder().encode(JSON.stringify(data));
  let bin = '';
  bytes.forEach(b => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeShare(str) {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - b64.length % 4) % 4));
  const data = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, ch => ch.charCodeAt(0))));
  const letter = { v: 'verified', u: 'unverifiable', f: 'false' };
  if (data.v === 2) {
    const claims = data.c.map((r, i) => ({
      id: i + 1,
      text: r[0],
      originalText: r[7] || r[0],
      status: letter[r[1]] || 'unverifiable',
      confidence: normalizeConfidence(r[2]),
      explanation: r[3],
      source: r[4],
      sourceUrl: r[5] || ('https://www.google.com/search?q=' + encodeURIComponent(r[0].slice(0, 120))),
      correction: r[6] || null,
      category: 'General'
    }));
    return { text: data.x || claims.map(c => c.text).join(' '), claims };
  }
  const claims = (data.claims || []).map((c, i) => ({
    id: i + 1,
    text: c.t,
    originalText: c.t,
    status: normalizeStatus(c.s),
    confidence: normalizeConfidence(c.c),
    explanation: c.e,
    source: c.src,
    sourceUrl: null,
    correction: null,
    category: 'General'
  }));
  return { text: claims.map(c => c.text).join(' '), claims };
}

$('#btn-share')?.addEventListener('click', async () => {
  if (!currentClaims.length) { showToast('Nothing to share yet', 'error'); return; }
  let url;
  try {
    url = location.origin + location.pathname + '#share=' + encodeShare();
  } catch {
    showToast('Could not build share link', 'error');
    return;
  }
  if (url.length > 16000) { showToast('Report is too large for a URL. Use Copy instead.', 'error'); return; }
  if (navigator.share && matchMedia('(pointer: coarse)').matches) {
    try {
      await navigator.share({ title: 'Hallucination Hunter Fact-Check', text: `Fact-check across ${currentClaims.length} claims`, url });
      return;
    } catch (e) {
      if (e && e.name === 'AbortError') return;
    }
  }
  if (await copyText(url)) showToast('Share link copied to clipboard', 'success');
});

function loadSharedAnalysis() {
  const m = location.hash.match(/^#share=(.+)$/);
  if (!m) return false;
  try {
    const { text, claims } = decodeShare(m[1]);
    if (!claims.length) return false;
    currentClaims = claims;
    currentText = text;
    if (text) setInputText(text);
    displayResults(text, claims);
    showToast('Loaded shared fact-check', 'info');
  } catch (e) {
    console.warn('Bad share link:', e);
    showToast('That share link is incomplete or invalid', 'error');
  }
  history.replaceState(null, '', location.pathname + location.search);
  return true;
}

$('#batch-mode')?.addEventListener('change', e => {
  if (e.target.checked) showToast('Separate multiple passages with --- on its own line', 'info');
});

function escapeRegExp(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function escapeHtml(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
function escapeAttr(s) { return escapeHtml(s); }

// Theme
function applyTheme(mode) {
  const dark = mode === 'dark' || (mode === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = dark ? '#111110' : '#f7f6f2';
  $$('[data-theme-choice]').forEach(b => b.setAttribute('aria-pressed', b.dataset.themeChoice === mode ? 'true' : 'false'));
}
function currentThemeMode() { try { return localStorage.getItem(THEME_KEY) || 'system'; } catch { return 'system'; } }
$$('[data-theme-choice]').forEach(b => b.addEventListener('click', () => {
  try { localStorage.setItem(THEME_KEY, b.dataset.themeChoice); } catch {}
  withTransition(() => applyTheme(b.dataset.themeChoice));
}));
$('#theme-toggle')?.addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  try { localStorage.setItem(THEME_KEY, next); } catch {}
  withTransition(() => applyTheme(next));
});
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => { if (currentThemeMode() === 'system') applyTheme('system'); });

function updateOnline() {
  const bar = $('#offline-bar');
  if (bar) bar.classList.toggle('show', navigator.onLine === false);
}
window.addEventListener('online', updateOnline);
window.addEventListener('offline', updateOnline);

// Keyboard shortcuts
document.addEventListener('keydown', e => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
  if (e.key === 'Escape' && activeController) { activeController.abort(); return; }
  if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === '/') { e.preventDefault(); switchView('analyzer'); input.focus(); }
  if (e.key === '?') { e.preventDefault(); $('#shortcuts-dialog')?.showModal?.(); }
});
$('#btn-shortcuts')?.addEventListener('click', () => $('#shortcuts-dialog')?.showModal?.());
$$('dialog').forEach(d => d.addEventListener('click', e => { if (e.target === d) d.close('cancel'); }));

// Init
(function init() {
  applyTheme(currentThemeMode());
  updateOnline();

  const local = readLocalSettings();
  if (local.confidence_threshold) applyThreshold(parseInt(local.confidence_threshold, 10));

  const shared = loadSharedAnalysis();
  if (!shared) {
    try { const draft = localStorage.getItem(DRAFT_KEY); if (draft) setInputText(draft); } catch {}
  }

  const params = new URLSearchParams(location.search);
  const handed = params.get('text');
  if (handed && !shared) {
    setInputText(handed.slice(0, MAX_CHARS));
    history.replaceState(null, '', location.pathname + location.hash);
    if (params.get('run') === '1') setTimeout(() => btnAnalyze.click(), 300);
  }

  switchView(shared ? 'analyzer' : routeFromHash(), { updateHash: false });
  requestAnimationFrame(refreshInks);
  document.documentElement.classList.add('is-ready');
  loadDashboardStats();

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
})();

// Global search (Ctrl/Cmd+K)
(() => {
  const toggle = $('#global-search-toggle');
  const overlay = $('#search-overlay');
  const field = $('#search-input');
  const out = $('#search-results');
  if (!toggle || !overlay) return;

  const EMPTY = '<div class="search-empty-state"><p>Type a keyword, claim, or domain.</p></div>';
  let lastFocus = null;
  let timer = null;
  let seq = 0;
  let cache = null;

  function open() {
    if (!overlay.classList.contains('hidden')) return;
    lastFocus = document.activeElement;
    cache = null;
    overlay.classList.remove('hidden', 'closing');
    document.body.classList.add('no-scroll');
    requestAnimationFrame(() => field.focus());
  }

  function close() {
    if (overlay.classList.contains('hidden')) return;
    overlay.classList.add('closing');
    document.body.classList.remove('no-scroll');
    setTimeout(() => {
      overlay.classList.add('hidden');
      overlay.classList.remove('closing');
      field.value = '';
      out.innerHTML = EMPTY;
    }, REDUCED_MOTION ? 0 : 150);
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  toggle.addEventListener('click', open);
  $('#search-close').addEventListener('click', close);
  overlay.addEventListener('mousedown', e => { if (e.target === overlay) close(); });

  document.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      overlay.classList.contains('hidden') ? open() : close();
      return;
    }
    if (overlay.classList.contains('hidden')) return;
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    const items = [...out.querySelectorAll('.search-result-item')];
    if (!items.length) return;
    const idx = items.findIndex(i => i.classList.contains('selected'));
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = e.key === 'ArrowDown' ? Math.min(idx + 1, items.length - 1) : Math.max(idx - 1, 0);
      items.forEach((it, i) => it.classList.toggle('selected', i === next));
      items[next].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter' && idx >= 0) {
      e.preventDefault();
      items[idx].click();
    }
  });

  field.addEventListener('input', () => {
    clearTimeout(timer);
    const q = field.value.trim();
    if (!q) { out.innerHTML = EMPTY; return; }
    timer = setTimeout(() => run(q), 180);
  });

  function highlight(text, q) {
    const safe = escapeHtml(text || '');
    return safe.replace(new RegExp(`(${escapeRegExp(escapeHtml(q))})`, 'gi'), '<mark>$1</mark>');
  }

  async function load() {
    if (cache) return cache;
    const [a, c] = await Promise.all([
      db.from('analyses').select('id, input_text, trust_score, verified_count, unverifiable_count, false_count, total_claims, created_at').order('created_at', { ascending: false }).limit(200),
      db.from('claims').select('id, analysis_id, claim_text, status, confidence, explanation, source_url, source_name, created_at').order('created_at', { ascending: false }).limit(1000)
    ]);
    if (a.error && c.error) throw new Error(db.unavailable ? 'Storage is blocked in this browser.' : 'Could not reach storage.');
    cache = { analyses: a.data || [], claims: c.data || [] };
    return cache;
  }

  async function run(q) {
    const my = ++seq;
    if (!cache) out.innerHTML = '<div class="search-empty-state"><p>Searching\u2026</p></div>';
    let data;
    try { data = await load(); }
    catch (err) { if (my === seq) out.innerHTML = `<div class="search-no-results"><p>${escapeHtml(err.message)}</p></div>`; return; }
    if (my !== seq) return;

    const lq = q.toLowerCase();
    const analyses = data.analyses.filter(a => (a.input_text || '').toLowerCase().includes(lq));
    const claims = data.claims.filter(c => (c.claim_text || '').toLowerCase().includes(lq) || (c.explanation || '').toLowerCase().includes(lq));
    const srcMap = new Map();
    data.claims.forEach(c => {
      const url = safeUrl(c.source_url);
      if (!url || /google\.com\/search/.test(url)) return;
      if (!srcMap.has(url)) srcMap.set(url, { url, name: c.source_name || url, count: 0 });
      srcMap.get(url).count++;
    });
    const sources = [...srcMap.values()].filter(s => s.url.toLowerCase().includes(lq) || s.name.toLowerCase().includes(lq));

    if (!analyses.length && !claims.length && !sources.length) {
      out.innerHTML = `<div class="search-no-results"><p>No saved checks match &ldquo;<strong>${escapeHtml(q)}</strong>&rdquo;.</p></div>`;
      return;
    }

    let html = '';
    if (analyses.length) {
      html += `<div class="search-section-label">Checks (${analyses.length})</div>`;
      analyses.slice(0, 5).forEach(a => {
        const meta = verdictMeta(a.verified_count, a.unverifiable_count, a.false_count, a.total_claims);
        const t = a.input_text || '';
        const at = Math.max(0, t.toLowerCase().indexOf(lq) - 30);
        const snippet = (at ? '\u2026' : '') + t.slice(at, at + 90);
        html += `<div class="search-result-item" role="option" data-action="analysis" data-id="${escapeAttr(a.id)}">
          <div class="search-result-icon band-${meta.band}">${meta.unverifiedOnly ? '\u2013' : meta.score}</div>
          <div class="search-result-info"><div class="search-result-title">${highlight(snippet, q)}</div><div class="search-result-meta">${meta.rowLabel} &middot; ${relativeDate(a.created_at)}</div></div>
        </div>`;
      });
    }
    if (claims.length) {
      html += `<div class="search-section-label">Claims (${claims.length})</div>`;
      claims.slice(0, 6).forEach(c => {
        const st = normalizeStatus(c.status);
        html += `<div class="search-result-item" role="option" data-action="analysis" data-id="${escapeAttr(c.analysis_id)}">
          <div class="search-result-icon">${VERDICT_ICONS[st]}</div>
          <div class="search-result-info"><div class="search-result-title">${highlight((c.claim_text || '').slice(0, 110), q)}</div><div class="search-result-meta">${VERDICT_LABELS[st]} &middot; ${c.confidence}%</div></div>
        </div>`;
      });
    }
    if (sources.length) {
      html += `<div class="search-section-label">Sources (${sources.length})</div>`;
      sources.slice(0, 5).forEach(s => {
        html += `<div class="search-result-item" role="option" data-action="source" data-url="${escapeAttr(s.url)}">
          <div class="search-result-icon">${LINK_ICON}</div>
          <div class="search-result-info"><div class="search-result-title">${highlight(s.name, q)}</div><div class="search-result-meta">${highlight(s.url, q)} &middot; ${s.count}&times;</div></div>
        </div>`;
      });
    }
    out.innerHTML = html;
    const items = out.querySelectorAll('.search-result-item');
    if (items[0]) items[0].classList.add('selected');
    items.forEach(item => {
      item.addEventListener('mousemove', () => items.forEach(i => i.classList.toggle('selected', i === item)));
      item.addEventListener('click', () => {
        close();
        if (item.dataset.action === 'analysis') { switchView('history'); viewHistoryDetail(item.dataset.id); }
        else window.open(item.dataset.url, '_blank', 'noopener');
      });
    });
  }
})();

// Skill & LLM Integrations view
(() => {
  const view = $('#view-skill');
  if (!view) return;

  const tabs = [...view.querySelectorAll('[data-skill-tab]')];
  const panels = [...view.querySelectorAll('[data-skill-panel]')];

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.skillTab;
      tabs.forEach(t => {
        const active = t === tab;
        t.classList.toggle('active', active);
        t.setAttribute('aria-selected', active ? 'true' : 'false');
      });
      panels.forEach(p => {
        const match = p.dataset.skillPanel === target;
        p.classList.toggle('active', match);
        p.hidden = !match;
      });
    });
  });

  view.querySelectorAll('.copy-snip-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const targetId = btn.dataset.copyTarget;
      const text = targetId ? (document.getElementById(targetId)?.textContent || '') : (btn.dataset.copy || '');
      if (!text) return;
      try {
        await navigator.clipboard.writeText(text.trim());
        const prev = btn.dataset.origLabel || btn.textContent;
        btn.dataset.origLabel = prev;
        btn.textContent = 'Copied';
        setTimeout(() => { btn.textContent = prev; }, 1400);
      } catch {
        showToast('Clipboard access blocked in this browser.', 'error');
      }
    });
  });

  const testBtn = $('#btn-skill-test');
  const testInput = $('#skill-test-input');
  const testClient = $('#skill-test-client');
  const outWrap = $('#skill-test-output');
  const outMeta = $('#skill-test-meta');
  const outMd = $('#skill-test-md');

  if (testBtn && testInput) {
    testBtn.addEventListener('click', async () => {
      const passage = testInput.value.trim();
      if (passage.length < 15) {
        showToast('Enter at least one complete factual sentence.', 'info');
        return;
      }
      testBtn.disabled = true;
      testBtn.classList.add('loading');
      const endpoint = (IS_VERCEL ? '' : PROD_ORIGIN) + '/api/verify';
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: passage,
            client: testClient?.value || 'antigravity',
            saveToDatabase: true
          })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data.ok === false) {
          throw new Error(data.error || `API returned HTTP ${res.status}`);
        }
        outMd.textContent = `${passage}\n\n${data.markdownReport || ''}`;
        const dbBadge = data.savedToDatabase ? `Synced to Supabase (${data.counts?.total || 0} claims \u00b7 via ${data.client})` : 'Verified';
        outMeta.textContent = dbBadge;
        outWrap.classList.remove('hidden');
        historyCache = null;
        loadDashboardStats();
      } catch (err) {
        showToast(err.message || 'Live verification request failed.', 'error');
      } finally {
        testBtn.disabled = false;
        testBtn.classList.remove('loading');
      }
    });
  }
})();
