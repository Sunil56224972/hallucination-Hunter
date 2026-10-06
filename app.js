// HALLUCINATION HUNTER - Full App with Supabase

const SUPABASE_URL = 'https://jdvafpwancenabxbnxbh.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpkdmFmcHdhbmNlbmFieGJueGJoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYxMDMwNjgsImV4cCI6MjEwMTY3OTA2OH0.xVZOUOiO_uDzRLHbZ9jjCjV8bZ8cUpZaQINzIgn6QlA';

// If the Supabase script is blocked (ad blocker, offline) the checker still works;
// storage calls resolve with an error instead of throwing at load time.
function unavailableDb() {
  const result = Promise.resolve({ data: null, error: { message: 'Storage is unavailable' }, count: null });
  const chain = new Proxy(function () {}, {
    get: (_t, prop) => (prop === 'then' ? result.then.bind(result) : () => chain),
    apply: () => chain
  });
  return { from: () => chain, unavailable: true };
}
const db = window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY) : unavailableDb();

// Anonymous User Isolation
// Each browser gets a unique ID - users only see their own data
function getUserId() {
  let id = localStorage.getItem('hh_user_id');
  if (!id) {
    id = crypto.randomUUID ? crypto.randomUUID() : 'u-' + Date.now() + '-' + Math.random().toString(36).slice(2);
    localStorage.setItem('hh_user_id', id);
  }
  return id;
}
const userId = getUserId();

// Helpers
const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);
const delay = ms => new Promise(r => setTimeout(r, ms));

// DOM refs
const input = $('#llm-input');
const charCount = $('#char-count');
const btnClear = $('#btn-clear');
const btnExample = $('#btn-example');
const btnAnalyze = $('#btn-analyze');
const processing = $('#processing');
const results = $('#results');
const annotatedText = $('#annotated-text');
const claimsGrid = $('#claims-grid');
const tip = $('#tip');
const toastContainer = $('#toast-container');

let currentClaims = [];
let currentText = '';
let activeController = null; // AbortController for the check in progress
const REDUCED_MOTION = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
const DRAFT_KEY = 'hh_draft';
const THEME_KEY = 'hh_theme';
const STATUSES = ['verified', 'unverifiable', 'false'];

// Inline SVG verdict marks (styled by .mark in style.css)
const MARKS = {
  verified: '<svg class="mark mark-verified" viewBox="0 0 20 20" role="img" aria-label="Verified"><path d="M4.5 10.5l3.5 3.5 7.5-8"/></svg>',
  unverifiable: '<svg class="mark mark-unverifiable" viewBox="0 0 20 20" role="img" aria-label="Unverifiable"><path d="M7.3 7.6a2.8 2.8 0 1 1 3.8 2.6c-.7.3-1.1.9-1.1 1.6v.5"/><circle class="dot" cx="10" cy="15.4" r="1.1"/></svg>',
  false: '<svg class="mark mark-false" viewBox="0 0 20 20" role="img" aria-label="Wrong"><path d="M5.5 5.5l9 9M14.5 5.5l-9 9"/></svg>'
};
const VERDICT_LABELS = { verified: 'Verified', unverifiable: 'Unverifiable', false: 'Wrong' };
const LINK_ICON = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M8.5 11.5a3 3 0 0 0 4.2 0l2.6-2.6a3 3 0 0 0-4.2-4.2l-.9.9"/><path d="M11.5 8.5a3 3 0 0 0-4.2 0l-2.6 2.6a3 3 0 0 0 4.2 4.2l.9-.9"/></svg>';

// TOAST NOTIFICATIONS

const TOAST_ICONS = {
  success: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#7fb08a" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20,6 9,17 4,12"/></svg>',
  error: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#e0846f" stroke-width="2.2" stroke-linecap="round"><line x1="12" y1="7" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  info: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#a59c8d" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="3"/></svg>'
};

// Toasts are plain text; an optional action renders as a button (e.g. Retry).
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
    setTimeout(() => toast.remove(), REDUCED_MOTION ? 0 : 220);
  }
  setTimeout(dismiss, action ? 6000 : type === 'error' ? 4800 : 3200);
  return dismiss;
}

// Animated underline that slides between the active items of a nav or tab bar.
function moveInk(bar) {
  if (!bar) return;
  const ink = bar.querySelector('.nav-ink');
  const active = bar.querySelector('.active');
  if (!ink || !active) return;
  ink.style.width = active.offsetWidth + 'px';
  ink.style.transform = `translateX(${active.offsetLeft}px)`;
  ink.classList.add('ready');
}
function refreshInks() { $$('.mast-nav, .tabs-bar').forEach(moveInk); }
window.addEventListener('resize', refreshInks);
if (document.fonts && document.fonts.ready) document.fonts.ready.then(refreshInks);

// Run a DOM update inside a view transition when the browser supports it.
function withTransition(update) {
  if (REDUCED_MOTION || !document.startViewTransition || document.hidden) { update(); return; }
  document.startViewTransition(update);
}

// NAVIGATION - hash routes so Back/Forward and deep links work (#/history, #/settings, #/about)

const ROUTES = { check: 'analyzer', history: 'history', settings: 'settings', about: 'info', sources: 'sources' };
const VIEW_TO_ROUTE = { analyzer: 'check', history: 'history', settings: 'settings', info: 'about', sources: 'sources' };
let currentView = 'analyzer';

function activateSubtab(barId, attr, name) {
  const bar = $(`#${barId}`);
  if (!bar) return;
  bar.querySelectorAll('.tab').forEach(t => {
    const on = t.dataset[attr] === name;
    t.classList.toggle('active', on);
    t.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  const prefix = attr === 'subtab' ? 'subtab' : 'settab';
  $$(`.${prefix}-content`).forEach(c => c.classList.toggle('active', c.id === `${prefix}-${name}`));
  moveInk(bar);
}

function applyView(viewName) {
  const target = viewName === 'sources' ? 'analyzer' : viewName;
  $$('.view').forEach(v => v.classList.toggle('active', v.id === `view-${target}`));
  $$('.sidebar-link').forEach(l => {
    const on = l.dataset.view === target;
    l.classList.toggle('active', on);
    if (on) l.setAttribute('aria-current', 'page'); else l.removeAttribute('aria-current');
  });
  $$('.mobile-nav-link').forEach(m => m.classList.toggle('active', m.dataset.view === viewName || (viewName === 'analyzer' && m.dataset.view === 'analyzer')));
  if (viewName === 'sources') activateSubtab('analyzer-tabs', 'subtab', 'sources');
  else if (target === 'analyzer' && currentView === 'sources') activateSubtab('analyzer-tabs', 'subtab', 'verify');
  currentView = viewName;
  refreshInks();
  const titles = { analyzer: 'Check', sources: 'Sources', history: 'History', settings: 'Settings', info: 'About' };
  document.title = `${titles[viewName] || 'Check'} \u00b7 Hallucination Hunter`;
}

function switchView(viewName, { updateHash = true } = {}) {
  if (!ROUTES[VIEW_TO_ROUTE[viewName]]) viewName = 'analyzer';
  const changed = viewName !== currentView;
  if (changed) withTransition(() => applyView(viewName)); else applyView(viewName);
  if (changed) window.scrollTo({ top: 0, behavior: REDUCED_MOTION ? 'auto' : 'smooth' });

  if (viewName === 'history') loadHistory();
  if (viewName === 'settings') { loadSettings(); checkDbStatus(); }
  if (viewName === 'sources') loadSources();

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

// Kept for anything still calling it from markup.
function updateMobileNav() {}

// ANALYZER SUB-TABS (Check text / How it works / Sources)

$('#analyzer-tabs').addEventListener('click', e => {
  const btn = e.target.closest('[data-subtab]');
  if (!btn) return;
  withTransition(() => activateSubtab('analyzer-tabs', 'subtab', btn.dataset.subtab));
  if (btn.dataset.subtab === 'sources') loadSources();
});

// SETTINGS SUB-TABS (General / Storage)

$('#settings-tabs').addEventListener('click', e => {
  const btn = e.target.closest('[data-settab]');
  if (!btn) return;
  withTransition(() => activateSubtab('settings-tabs', 'settab', btn.dataset.settab));
  if (btn.dataset.settab === 'database') checkDbStatus();
});

// INPUT HANDLERS

const MAX_CHARS = 20000;
let draftTimer = null;
function updateCharCount() {
  const n = input.value.length;
  charCount.textContent = n.toLocaleString();
  charCount.parentElement.classList.toggle('over', n > MAX_CHARS);
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

btnClear.addEventListener('click', () => {
  setInputText('');
  hideResults();
  processing.classList.add('hidden');
  input.focus();
});

$('#btn-paste')?.addEventListener('click', async () => {
  try {
    const text = await navigator.clipboard.readText();
    if (!text.trim()) { showToast('Your clipboard is empty', 'info'); return; }
    setInputText(text.trim());
    input.focus();
  } catch {
    showToast('Paste with Ctrl+V. The browser blocked clipboard access.', 'info');
    input.focus();
  }
});
if (!navigator.clipboard || !navigator.clipboard.readText) $('#btn-paste')?.remove();

function hideResults() {
  if (results.classList.contains('hidden')) return;
  results.classList.add('hidden');
}

const EXAMPLES = [
  `The Great Wall of China is the only man-made structure visible from space with the naked eye. Construction began during the Qin Dynasty around 221 BC under Emperor Qin Shi Huang. The wall stretches approximately 13,171 miles and took over 2,000 years to complete. It was primarily built to protect against Mongolian invasions. An estimated 400,000 workers died during its construction. The wall is made entirely of stone and brick throughout its entire length.`,
  `Python was created by Guido van Rossum and first released in 1991. It is the fastest programming language available today. Python uses indentation for code blocks instead of curly braces. The language is named after the British comedy group Monty Python. Python 2 and Python 3 are fully backward compatible. It is the most popular language according to the TIOBE Index 2024.`,
  `The Eiffel Tower was built in 1889 for the World's Fair in Paris. It was designed by Gustave Eiffel and stands 1,063 feet tall including its antenna. The tower was originally intended to be temporary and was planned for demolition after 20 years. It weighs approximately 10,100 tons. The Eiffel Tower is the tallest structure in Europe. It receives about 7 million visitors per year.`
];

let exampleIdx = 0;
btnExample.addEventListener('click', () => {
  setInputText(EXAMPLES[exampleIdx % EXAMPLES.length]);
  exampleIdx++;
  input.focus();
});

function validateInput(text) {
  if (!text) return 'Paste some text first.';
  if (text.length < 30) return 'That is a bit short. Give it at least a sentence or two.';
  if (text.length > MAX_CHARS) return `That is ${text.length.toLocaleString()} characters. The limit is ${MAX_CHARS.toLocaleString()}.`;
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

// Filter tabs
$$('.ftab').forEach(btn => {
  btn.addEventListener('click', () => {
    $$('.ftab').forEach(b => { b.classList.toggle('active', b === btn); b.setAttribute('aria-pressed', b === btn ? 'true' : 'false'); });
    filterClaims(btn.dataset.filter);
  });
});

// Tooltip follows the pointer; keyboard focus positions it under the passage instead.
function positionTip(x, y) {
  const w = tip.offsetWidth || 340;
  const h = tip.offsetHeight || 120;
  tip.style.left = Math.max(8, Math.min(x + 14, window.innerWidth - w - 12)) + 'px';
  tip.style.top = Math.max(8, Math.min(y + 14, window.innerHeight - h - 12)) + 'px';
}
document.addEventListener('mousemove', e => {
  if (tip.classList.contains('visible')) positionTip(e.clientX, e.clientY);
});

// GROQ API

// Where the serverless proxy lives. On the Vercel site it is same-origin; the
// Android shell (https://localhost), local dev servers and file:// previews
// all talk to the hosted proxy so no API key ever ships in the client.
const PROD_ORIGIN = 'https://hallucination-hunter-five.vercel.app';
const IS_VERCEL = /\.vercel\.app$/.test(location.hostname);
const IS_LOCAL = location.protocol === 'file:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
const API_URL = (IS_VERCEL ? '' : PROD_ORIGIN) + '/api/groq';
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
  if (status === 429) return 'Too many checks in a short time. Wait a few seconds and try again.';
  if (status === 413) return 'That text is too long to check in one go.';
  if (status === 400 && /json/i.test(msg)) return 'The checker returned something unreadable. Trying again usually works.';
  if (status === 400) return msg || 'The request was rejected.';
  if (status >= 500) return 'The checking service is having trouble right now. Try again in a minute.';
  return msg || `Request failed (${status}).`;
}

// Pull the first JSON object/array out of a model reply, tolerating code fences.
function parseModelJson(content) {
  if (content && typeof content === 'object') return content;
  const text = String(content || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(text); } catch {}
  const m = text.match(/[\[{][\s\S]*[\]}]/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  throw new CheckError('The checker returned something unreadable. Trying again usually works.', { retryable: true });
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
    } catch (err) {
      if (signal && signal.aborted) throw new CheckError('Check cancelled.', { cancelled: true });
      const msg = navigator.onLine === false ? 'You are offline. Reconnect and try again.' : 'Could not reach the checking service.';
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

// Step 1: Extract individual factual claims from the text
async function extractClaimsFromLLM(text, signal) {
  const result = await callGroq([
    {
      role: 'system',
      content: `You are a precise claim extraction engine. Given a text, extract every individual factual claim that can be independently verified. Each claim should be a self-contained statement.

Rules:
- Extract ONLY factual claims (not opinions, questions, or subjective statements)
- Each claim should be atomic - one verifiable fact per claim
- Keep the original wording as close as possible
- Include numbers, dates, names, and specific details
- "originalSentence" must be copied character for character from the input so it can be highlighted
- At most 40 claims

Respond in JSON format:
{
  "claims": [
    { "id": 1, "text": "The exact claim text", "originalSentence": "The full original sentence it came from" }
  ]
}`
    },
    { role: 'user', content: text }
  ], { maxTokens: 4096, effort: 'low', signal });
  const list = Array.isArray(result) ? result : (result.claims || []);
  return list
    .filter(c => c && (c.text || c.claim))
    .slice(0, 40)
    .map((c, i) => ({ id: i + 1, text: String(c.text || c.claim).trim(), originalSentence: String(c.originalSentence || c.text || c.claim).trim() }));
}

const VERIFY_PROMPT = `You are a world-class fact-checking engine used by journalists and researchers. Your job is to verify factual claims with ABSOLUTE accuracy. Users depend on you for truthful, real information - never guess, never fabricate.

STRICT RULES:
1. Only mark a claim as "verified" if you are certain it is factually correct based on well-established, widely-known facts.
2. Mark as "false" if the claim contains ANY factual error - even partially wrong claims are "false". Always provide the CORRECT real information in your explanation (the actual number, date, name, etc.).
3. Mark as "unverifiable" if you are not fully certain, if the claim is subjective, or if it requires very recent data you may not have.
4. NEVER guess or make up facts. If you don't know the exact answer, say "unverifiable".
5. In your explanation, always cite the REAL, CORRECT fact.
6. Confidence must reflect your ACTUAL certainty as an integer from 0 to 100 - don't inflate scores.

For each claim provide:
- "id": the claim number you were given
- "status": "verified" | "false" | "unverifiable"
- "confidence": integer 0-100
- "explanation": 2-3 sentences with the real facts. When a claim is false, state what the truth actually is.
- "correction": for false claims only, one corrected sentence; otherwise null
- "source": the most authoritative real organization (e.g. "Wikipedia", "WHO", "NASA", "NIH")
- "sourceUrl": the most specific real page URL you are certain exists (e.g. "https://en.wikipedia.org/wiki/Solar_System"). If unsure of the page use the homepage; if completely unsure use null.
- "category": one of "Science", "History", "Geography", "Technology", "Health", "Mathematics", "Politics", "Culture", "Economics", "General"

Respond in JSON:
{ "results": [ { "id": 1, "status": "verified", "confidence": 85, "explanation": "...", "correction": null, "source": "...", "sourceUrl": "https://...", "category": "History" } ] }`;

// Step 2: Verify claims in batches so long answers stay within the output budget
async function verifyClaimsWithLLM(claims, signal, onBatch) {
  if (claims.length === 0) return [];
  const out = [];
  for (let i = 0; i < claims.length; i += VERIFY_BATCH) {
    const batch = claims.slice(i, i + VERIFY_BATCH);
    const claimList = batch.map(c => `[Claim ${c.id}]: "${c.text}"`).join('\n');
    const result = await callGroq([
      { role: 'system', content: VERIFY_PROMPT },
      { role: 'user', content: `Fact-check each of these claims. Provide the real correct information for any false claims:\n\n${claimList}` }
    ], { maxTokens: 8192, effort: 'medium', signal });
    const rows = Array.isArray(result) ? result : (result.results || result.claims || []);
    // Match by id, falling back to position when the model renumbers.
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
  if (v > 0 && v <= 1) v *= 100; // some replies use 0-1
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

function finalizeClaims(rawClaims, verifyResults, idOffset = 0) {
  return rawClaims.map((c, i) => {
    const v = verifyResults.find(r => r.id === c.id) || {};
    const source = (v.source && !/^(unknown|no source|none|n\/a)/i.test(v.source)) ? String(v.source) : 'Search the web';
    const url = safeUrl(v.sourceUrl) || ('https://www.google.com/search?q=' + encodeURIComponent(c.text.slice(0, 120)));
    return {
      id: idOffset + i + 1,
      text: c.text,
      originalText: c.originalSentence || c.text,
      status: normalizeStatus(v.status),
      confidence: normalizeConfidence(v.confidence),
      explanation: String(v.explanation || 'No explanation came back for this claim.'),
      correction: v.correction && normalizeStatus(v.status) === 'false' ? String(v.correction) : null,
      source,
      sourceUrl: url,
      category: String(v.category || 'General')
    };
  });
}

// Kept for older callers; finalizeClaims already resolves URLs.
async function findRealSources(claims) { return claims; }

// PROGRESS - the bar eases toward each step's ceiling while the network call runs,
// so it never sits frozen and never claims to be finished early.

const progress = (() => {
  let shown = 0, floor = 0, ceil = 0, raf = 0, last = 0;
  const thumb = () => $('#progress-thumb');
  const label = () => $('#progress-pct');
  function frame(now) {
    const dt = Math.min(64, now - (last || now)); last = now;
    const target = ceil - (ceil - floor) * 0.08;
    shown += (target - shown) * (1 - Math.exp(-dt / 900));
    paint();
    raf = requestAnimationFrame(frame);
  }
  function paint() {
    const pct = Math.round(shown);
    thumb().style.transform = `scaleX(${shown / 100})`;
    label().textContent = pct + '%';
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
  step.querySelector('.ps-status').innerHTML = state === 'active' ? '<div class="loader"></div>' : '';
}
async function animateStepStart(stepId) { setStep(stepId, 'active'); }
async function animateStepDone(stepId, _from, to) { setStep(stepId, 'done'); progress.jump(to); }

function setStepNote(stepId, text) {
  const desc = $(`#${stepId} .ps-desc`);
  if (desc) desc.textContent = text;
}

// ANALYSIS PIPELINE

const STEP_COPY = {
  'ps-extract': 'Splitting the text into single statements that can be checked',
  'ps-search': 'Checking every claim against well-established facts',
  'ps-verify': 'Scoring each verdict and attaching a source to read'
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
  return text.split(/\n\s*---+\s*\n/).map(t => t.trim()).filter(t => t.length >= 30);
}

async function runAnalysis(text) {
  if (activeController) return;
  const parts = splitBatch(text);
  if ($('#batch-mode')?.checked && parts.length < 2) {
    showToast('Batch mode needs at least two texts separated by a line with ---', 'error');
    return;
  }

  const controller = new AbortController();
  activeController = controller;
  const signal = controller.signal;

  hideResults();
  hideTip();
  processing.classList.remove('hidden');
  Object.entries(STEP_COPY).forEach(([id, copy]) => { setStep(id, 'idle'); setStepNote(id, copy); });
  progress.reset();
  setBusy(true);
  requestAnimationFrame(() => processing.scrollIntoView({ behavior: REDUCED_MOTION ? 'auto' : 'smooth', block: 'nearest' }));

  try {
    // Step 1: extract (0-30%)
    setStep('ps-extract', 'active');
    progress.span(0, 30);
    const extracted = [];
    for (let i = 0; i < parts.length; i++) {
      if (parts.length > 1) setStepNote('ps-extract', `Text ${i + 1} of ${parts.length}`);
      const claims = await extractClaimsFromLLM(parts[i], signal);
      extracted.push(claims);
    }
    const totalClaims = extracted.reduce((n, c) => n + c.length, 0);
    setStep('ps-extract', 'done');
    setStepNote('ps-extract', `${totalClaims} claim${totalClaims === 1 ? '' : 's'} found`);
    progress.jump(30);

    if (totalClaims === 0) {
      showToast('No checkable facts in this text. Try something with names, dates or numbers.', 'info');
      processing.classList.add('hidden');
      return;
    }

    // Step 2: verify (30-92%)
    setStep('ps-search', 'active');
    progress.span(30, 92);
    let all = [];
    let done = 0;
    for (let i = 0; i < parts.length; i++) {
      if (!extracted[i].length) continue;
      const verdicts = await verifyClaimsWithLLM(extracted[i], signal, n => {
        setStepNote('ps-search', `${Math.min(done + n, totalClaims)} of ${totalClaims} checked`);
      });
      all = all.concat(finalizeClaims(extracted[i], verdicts, all.length));
      done += extracted[i].length;
    }
    setStep('ps-search', 'done');
    setStepNote('ps-search', `${totalClaims} of ${totalClaims} checked`);
    progress.jump(92);

    // Step 3: score (92-100%)
    setStep('ps-verify', 'active');
    progress.span(92, 100);
    currentClaims = all;
    currentText = parts.join('\n\n---\n\n');
    await delay(REDUCED_MOTION ? 0 : 220);
    setStep('ps-verify', 'done');
    progress.jump(100);
    await delay(REDUCED_MOTION ? 0 : 260);

    processing.classList.add('hidden');
    displayResults(currentText, all);
    updateAccuracyTab(all);

    // Saving is best effort: a storage outage must not throw away a finished check.
    saveAnalysis(currentText, all)
      .then(() => { loadDashboardStats(); loadSources(); })
      .catch(err => {
        console.warn('Save failed:', err);
        showToast('Checked, but it could not be saved to history.', 'info');
      });
  } catch (err) {
    progress.stop();
    processing.classList.add('hidden');
    if (err.cancelled) {
      showToast('Check cancelled', 'info');
    } else {
      console.error('Analysis error:', err);
      showToast(err.message || 'The check failed.', 'error', { label: 'Try again', run: () => runAnalysis(text) });
    }
  } finally {
    progress.stop();
    activeController = null;
    setBusy(false);
  }
}
// DISPLAY RESULTS

function scoreOf(claims) {
  const total = claims.length;
  const v = claims.filter(c => c.status === 'verified').length;
  return total ? Math.round((v / total) * 100) : 0;
}
function bandOf(score) { return score >= 70 ? 'good' : score >= 40 ? 'mid' : 'bad'; }

function displayResults(originalText, claims) {
  const total = claims.length;
  const vCount = claims.filter(c => c.status === 'verified').length;
  const uCount = claims.filter(c => c.status === 'unverifiable').length;
  const fCount = claims.filter(c => c.status === 'false').length;
  const trustScore = scoreOf(claims);

  results.classList.remove('hidden');
  results.classList.remove('is-in');
  // force a reflow so the entrance runs again on a second check
  void results.offsetWidth;
  results.classList.add('is-in');

  animateNum('s-total', total);
  animateNum('s-verified', vCount);
  animateNum('s-unverifiable', uCount);
  animateNum('s-false', fCount);
  animateNum('score-val', trustScore);

  const circ = 2 * Math.PI * 18;
  const arc = $('#score-arc');
  arc.style.strokeDashoffset = circ;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    arc.style.strokeDashoffset = circ - (trustScore / 100) * circ;
  }));
  const donut = $('#score-donut');
  if (donut) donut.dataset.band = bandOf(trustScore);
  const verdict = $('#score-verdict');
  if (verdict) {
    verdict.textContent = trustScore >= 70 ? 'Mostly holds up' : trustScore >= 40 ? 'Read with care' : 'Largely unreliable';
    verdict.dataset.band = bandOf(trustScore);
  }

  $$('.ftab').forEach(b => { const on = b.dataset.filter === 'all'; b.classList.toggle('active', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
  $$('.ftab').forEach(b => {
    const n = b.dataset.filter === 'all' ? total : claims.filter(c => c.status === b.dataset.filter).length;
    let badge = b.querySelector('.ftab-n');
    if (!badge) { badge = document.createElement('span'); badge.className = 'ftab-n'; b.appendChild(badge); }
    badge.textContent = n;
  });

  buildAnnotated(originalText, claims);
  buildCards(claims);
  setTimeout(() => results.scrollIntoView({ behavior: REDUCED_MOTION ? 'auto' : 'smooth', block: 'start' }), 120);
}

function animateNum(id, target) {
  const el = typeof id === 'string' ? $(`#${id}`) : id;
  if (!el) return;
  if (REDUCED_MOTION) { el.textContent = target; return; }
  const from = parseInt(el.textContent, 10) || 0;
  const dur = 650;
  const t0 = performance.now();
  if (el._raf) cancelAnimationFrame(el._raf);
  function tick(now) {
    const t = Math.min((now - t0) / dur, 1);
    el.textContent = Math.round(from + (target - from) * (1 - Math.pow(1 - t, 3)));
    if (t < 1) el._raf = requestAnimationFrame(tick);
  }
  el._raf = requestAnimationFrame(tick);
}

// Find each claim's sentence in the raw text and build the marked-up HTML from
// ranges, so one highlight can never land inside another's markup.
function buildAnnotated(originalText, claims) {
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
    html += escapeHtml(originalText.slice(pos, r.start));
    html += `<mark class="claim-hl ${r.c.status}" tabindex="0" data-id="${r.c.id}">${escapeHtml(originalText.slice(r.start, r.end))}</mark>`;
    pos = r.end;
  });
  html += escapeHtml(originalText.slice(pos));
  annotatedText.innerHTML = html;

  const byId = new Map(claims.map(c => [String(c.id), c]));
  annotatedText.querySelectorAll('.claim-hl').forEach(el => {
    const c = byId.get(el.dataset.id);
    el.setAttribute('aria-label', `${VERDICT_LABELS[c.status]}: ${c.text}`);
    el.addEventListener('mouseenter', e => showTip(c, e.clientX, e.clientY));
    el.addEventListener('mouseleave', hideTip);
    el.addEventListener('focus', () => { const r = el.getBoundingClientRect(); showTip(c, r.left, r.bottom); });
    el.addEventListener('blur', hideTip);
    el.addEventListener('click', () => focusCard(c.id));
    el.addEventListener('keydown', e => { if (e.key === 'Enter') focusCard(c.id); });
  });
  const marked = ranges.length;
  const note = $('#annotated-note');
  if (note) note.textContent = marked < claims.length
    ? `${marked} of ${claims.length} claims could be pinned to the text. Click one to jump to its card.`
    : 'Hover or tab to a marked passage to see what we found. Click to jump to its card.';
}

function showTip(c, x, y) {
  const colors = { verified: 'var(--green)', unverifiable: 'var(--amber)', false: 'var(--red)' };
  tip.querySelector('.tip-status').textContent = VERDICT_LABELS[c.status];
  tip.querySelector('.tip-status').style.color = colors[c.status];
  tip.querySelector('.tip-conf').textContent = c.confidence + '% confidence';
  tip.querySelector('.tip-body').textContent = c.correction ? `Actually: ${c.correction}` : c.explanation;
  tip.querySelector('.tip-source').textContent = 'Source: ' + c.source;
  tip.classList.remove('hidden');
  positionTip(x, y);
  tip.classList.add('visible');
}
function hideTip() { tip.classList.remove('visible'); }

function focusCard(id) {
  const card = claimsGrid.querySelector(`.claim-card[data-id="${id}"]`);
  if (!card) return;
  if (card.style.display === 'none') { $('.ftab[data-filter="all"]').click(); }
  card.scrollIntoView({ behavior: REDUCED_MOTION ? 'auto' : 'smooth', block: 'center' });
  card.classList.remove('flash');
  void card.offsetWidth;
  card.classList.add('flash');
  card.focus({ preventScroll: true });
}

function claimCardHTML(c, threshold) {
  const below = c.confidence < threshold;
  const confColor = c.confidence >= 80 ? 'var(--green)' : c.confidence >= 60 ? 'var(--amber)' : 'var(--red)';
  const href = safeUrl(c.sourceUrl);
  const srcLink = href
    ? `<a href="${escapeAttr(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(c.source)}</a>`
    : `<span>${escapeHtml(c.source || 'No source')}</span>`;
  return `
    <div class="claim-card-top">
      <div class="claim-icon">${MARKS[c.status]}</div>
      <div class="claim-card-info">
        <div class="claim-card-name">${VERDICT_LABELS[c.status]}</div>
        <div class="claim-card-sub">${c.confidence}% confidence</div>
      </div>
      <button type="button" class="icon-btn claim-copy" title="Copy this claim" aria-label="Copy this claim">
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true"><rect x="7" y="7" width="9.5" height="9.5" rx="1.5"/><path d="M13 7V5a1.5 1.5 0 0 0-1.5-1.5h-6A1.5 1.5 0 0 0 4 5v6a1.5 1.5 0 0 0 1.5 1.5H7"/></svg>
      </button>
    </div>
    <div class="threshold-badge"${below ? '' : ' hidden'}>Below ${threshold}% threshold</div>
    <div class="conf-bar-wrap">
      <div class="conf-bar-track">
        <div class="conf-bar-fill" style="--w:${c.confidence / 100};background:${confColor}"></div>
        <div class="conf-bar-threshold" style="left:${threshold}%" title="Threshold: ${threshold}%"></div>
      </div>
      <span class="conf-bar-label" style="color:${confColor}">${c.confidence}%</span>
    </div>
    <p class="claim-desc">${escapeHtml(c.text)}</p>
    ${c.correction ? `<p class="claim-correction"><strong>Actually:</strong> ${escapeHtml(c.correction)}</p>` : ''}
    <div class="claim-source-direct">${LINK_ICON}${srcLink}</div>
    <div class="claim-tags"><span class="claim-tag">${escapeHtml(c.category || 'General')}</span></div>
    <div class="claim-card-bottom">
      <button type="button" class="view-detail-btn" aria-expanded="false">View details</button>
      <div class="claim-detail" hidden>
        <div class="claim-detail-inner">
          <div class="claim-explain">${escapeHtml(c.explanation || '')}</div>
          <div class="claim-src">${LINK_ICON}${srcLink}</div>
        </div>
      </div>
    </div>`;
}

// Details expand by animating grid rows 0fr -> 1fr; no fixed heights to guess.
function wireClaimCard(card, c) {
  const btn = card.querySelector('.view-detail-btn');
  const detail = card.querySelector('.claim-detail');
  btn.addEventListener('click', () => {
    const open = btn.getAttribute('aria-expanded') !== 'true';
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    btn.textContent = open ? 'Hide details' : 'View details';
    if (open) {
      detail.hidden = false;
      requestAnimationFrame(() => detail.classList.add('open'));
    } else {
      detail.classList.remove('open');
      setTimeout(() => { if (!detail.classList.contains('open')) detail.hidden = true; }, REDUCED_MOTION ? 0 : 260);
    }
  });
  const copy = card.querySelector('.claim-copy');
  if (copy) copy.addEventListener('click', async () => {
    const text = `${VERDICT_LABELS[c.status]} (${c.confidence}%): ${c.text}\n${c.correction ? 'Actually: ' + c.correction + '\n' : ''}${c.explanation || ''}\nSource: ${c.source}${safeUrl(c.sourceUrl) ? ' ' + c.sourceUrl : ''}`;
    if (await copyText(text)) { copy.classList.add('done'); setTimeout(() => copy.classList.remove('done'), 1200); }
  });
}

function buildCards(claims) {
  claimsGrid.innerHTML = '';
  const threshold = parseInt($('#s-conf-range')?.value || '75', 10);
  claims.forEach((c, i) => {
    const card = document.createElement('article');
    card.className = 'claim-card';
    card.tabIndex = -1;
    card.dataset.id = c.id;
    card.dataset.status = c.status;
    card.dataset.confidence = c.confidence;
    card.style.setProperty('--i', Math.min(i, 12));
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
  empty.textContent = `No ${VERDICT_LABELS[filter].toLowerCase()} claims in this check.`;
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
    if (!ok) showToast('Copy failed. Your browser blocked clipboard access.', 'error');
    return ok;
  }
}
// SUPABASE - Save Analysis

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
    user_id: userId
  }).select().single();
  if (aErr) throw aErr;

  const claimRows = claims.map(c => ({
    analysis_id: analysis.id,
    claim_text: c.text,
    status: c.status,
    confidence: c.confidence,
    // there is no correction column, so keep it with the explanation
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

// HISTORY VIEW

let historyCache = null;          // rows from the last load
const pendingDeletes = new Map(); // id -> timer, for undo

function skeletonRows(n) {
  return Array.from({ length: n }, () => '<div class="history-row skeleton" aria-hidden="true"><div class="sk sk-score"></div><div class="history-info"><div class="sk sk-line"></div><div class="sk sk-line short"></div></div></div>').join('');
}

function relativeDate(iso) {
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)} d ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

async function loadHistory() {
  const list = $('#history-list');
  const detail = $('#history-detail');
  detail.classList.add('hidden');
  list.classList.remove('hidden');
  $('#history-tools')?.classList.remove('hidden');

  if (!historyCache) list.innerHTML = skeletonRows(4);
  const { data, error } = await db.from('analyses').select('*').eq('user_id', userId).order('created_at', { ascending: false });
  if (error) {
    list.innerHTML = `<div class="empty-state"><h3>History is unavailable</h3><p>${db.unavailable ? 'Storage is blocked in this browser. Checks still work, they just are not saved.' : 'Could not reach storage. Check your connection and try again.'}</p></div>`;
    return;
  }
  historyCache = (data || []).filter(a => !pendingDeletes.has(a.id));
  renderHistory();
}

function renderHistory() {
  const list = $('#history-list');
  const q = ($('#history-filter')?.value || '').trim().toLowerCase();
  const rows = (historyCache || []).filter(a => !q || (a.input_text || '').toLowerCase().includes(q));
  const count = $('#history-count');
  if (count) count.textContent = historyCache && historyCache.length ? `${historyCache.length} saved` : '';
  $('#btn-clear-history').disabled = !(historyCache && historyCache.length);
  $('#btn-export-history').disabled = !(historyCache && historyCache.length);

  if (!historyCache || historyCache.length === 0) {
    list.innerHTML = `<div class="empty-state"><h3>No checks yet</h3><p>Run one from the Check tab and it will be listed here.</p><button type="button" class="btn-text" data-goto="analyzer">Start a check</button></div>`;
    list.querySelector('[data-goto]').addEventListener('click', () => switchView('analyzer'));
    return;
  }
  if (rows.length === 0) {
    list.innerHTML = `<div class="empty-state small-empty"><h3>No matches</h3><p>Nothing in your history mentions "${escapeHtml(q)}".</p></div>`;
    return;
  }

  list.innerHTML = '';
  rows.forEach((a, i) => {
    const band = bandOf(a.trust_score);
    const text = a.input_text || '';
    const preview = text.length > 140 ? text.slice(0, 140) + '...' : text;
    const row = document.createElement('div');
    row.className = 'history-row';
    row.style.setProperty('--i', Math.min(i, 10));
    row.innerHTML = `
      <button type="button" class="history-open" aria-label="Open this check">
        <span class="history-score ${band}">${a.trust_score}</span>
        <span class="history-info">
          <span class="history-preview">${escapeHtml(preview)}</span>
          <span class="history-meta"><span title="${escapeAttr(new Date(a.created_at).toLocaleString())}">${relativeDate(a.created_at)}</span><span>${a.total_claims} claims</span></span>
        </span>
      </button>
      <div class="history-stats">
        <span class="history-stat v" title="Verified">${a.verified_count}</span>
        <span class="history-stat u" title="Unverifiable">${a.unverifiable_count}</span>
        <span class="history-stat f" title="Wrong">${a.false_count}</span>
      </div>
      <button type="button" class="history-delete" title="Delete" aria-label="Delete this check">
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M4 6h12M8 6V4.5h4V6M5.5 6l.7 10h7.6l.7-10"/></svg>
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
    setTimeout(() => { row.remove(); resolve(); }, 280);
  });
}

async function commitDelete(id) {
  pendingDeletes.delete(id);
  const { error } = await db.from('analyses').delete().eq('id', id).eq('user_id', userId);
  if (error) { showToast('Delete failed. It will show up again on reload.', 'error'); return; }
  loadDashboardStats();
}

async function deleteWithUndo(a, row) {
  await collapseRow(row);
  historyCache = (historyCache || []).filter(x => x.id !== a.id);
  if (!historyCache.length || !$('#history-list .history-row')) renderHistory();
  const timer = setTimeout(() => commitDelete(a.id), 6000);
  pendingDeletes.set(a.id, timer);
  showToast('Check deleted', 'info', {
    label: 'Undo',
    run: () => {
      clearTimeout(pendingDeletes.get(a.id));
      pendingDeletes.delete(a.id);
      historyCache = [a, ...(historyCache || [])].sort((x, y) => new Date(y.created_at) - new Date(x.created_at));
      renderHistory();
    }
  });
}

// Finish any pending deletes if the tab is closed mid-undo.
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
    category: 'General'
  };
}

async function viewHistoryDetail(analysisId) {
  const detail = $('#history-detail');
  const content = $('#history-detail-content');
  const list = $('#history-list');

  const [{ data: analysis }, { data: rows }] = await Promise.all([
    db.from('analyses').select('*').eq('id', analysisId).eq('user_id', userId).single(),
    db.from('claims').select('*').eq('analysis_id', analysisId).eq('user_id', userId).order('created_at', { ascending: true })
  ]);
  if (!analysis || !rows) { showToast('Could not open that check', 'error'); return; }

  const claims = rows.map(rowToClaim);
  const band = bandOf(analysis.trust_score);
  const date = new Date(analysis.created_at).toLocaleString(undefined, { month: 'long', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const threshold = parseInt($('#s-conf-range')?.value || '75', 10);

  withTransition(() => {
    list.classList.add('hidden');
    $('#history-tools')?.classList.add('hidden');
    detail.classList.remove('hidden');
    content.innerHTML = `
      <div class="section-label section-label-row">
        <div>
          <h2>Check from ${escapeHtml(date)}</h2>
          <p>Trust score <strong class="band-${band}">${analysis.trust_score}%</strong> across ${analysis.total_claims} claims</p>
        </div>
        <button type="button" class="action-btn" id="btn-open-in-checker">Open in checker</button>
      </div>
      <ul class="summary-row">
        <li class="summary-pill pill-verified"><span class="pill-num">${analysis.verified_count}</span><span class="pill-label">verified</span></li>
        <li class="summary-pill pill-unverifiable"><span class="pill-num">${analysis.unverifiable_count}</span><span class="pill-label">unverifiable</span></li>
        <li class="summary-pill pill-false"><span class="pill-num">${analysis.false_count}</span><span class="pill-label">wrong</span></li>
      </ul>
      <div class="annotated-card">${escapeHtml(analysis.input_text)}</div>
      <h3>Claim by claim</h3>
      <div class="claims-grid" id="history-claims"></div>`;
    const grid = $('#history-claims');
    claims.forEach((c, i) => {
      const card = document.createElement('article');
      card.className = 'claim-card' + (c.confidence < threshold ? ' below-threshold' : '');
      card.dataset.status = c.status;
      card.style.setProperty('--i', Math.min(i, 12));
      card.innerHTML = claimCardHTML(c, threshold);
      wireClaimCard(card, c);
      grid.appendChild(card);
    });
    $('#btn-open-in-checker').addEventListener('click', () => {
      currentClaims = claims;
      currentText = analysis.input_text;
      setInputText(analysis.input_text);
      switchView('analyzer');
      activateSubtab('analyzer-tabs', 'subtab', 'verify');
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
  if (!(await confirmDialog({ title: 'Delete all history?', body: `This removes ${historyCache.length} saved check${historyCache.length === 1 ? '' : 's'} and every claim in them. It cannot be undone.`, confirm: 'Delete everything', danger: true }))) return;
  const { error } = await db.from('analyses').delete().eq('user_id', userId);
  if (error) { showToast('Could not clear history', 'error'); return; }
  showToast('History cleared', 'success');
  historyCache = [];
  renderHistory();
  loadDashboardStats();
});

$('#btn-export-history')?.addEventListener('click', async () => {
  const [{ data: analyses }, { data: claims }] = await Promise.all([
    db.from('analyses').select('*').eq('user_id', userId).order('created_at', { ascending: false }),
    db.from('claims').select('*').eq('user_id', userId)
  ]);
  if (!analyses) { showToast('Could not export history', 'error'); return; }
  const byAnalysis = {};
  (claims || []).forEach(c => { (byAnalysis[c.analysis_id] = byAnalysis[c.analysis_id] || []).push(c); });
  const payload = {
    exported_at: new Date().toISOString(),
    app: 'Hallucination Hunter',
    checks: analyses.map(a => ({
      created_at: a.created_at, trust_score: a.trust_score, text: a.input_text,
      claims: (byAnalysis[a.id] || []).map(c => ({ claim: c.claim_text, status: c.status, confidence: c.confidence, explanation: c.explanation, source: c.source_name, url: c.source_url }))
    }))
  };
  downloadFile(`hallucination-hunter-history-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(payload, null, 2), 'application/json');
});

// SOURCES VIEW

async function loadSources() {
  const list = $('#sources-list');
  const { data, error } = await db.from('claims').select('source_name, source_url, status').eq('user_id', userId);
  if (error) {
    list.innerHTML = `<div class="empty-state small-empty"><h3>Unavailable</h3><p>Sources from past checks could not be loaded.</p></div>`;
    return;
  }
  if (!data || data.length === 0) {
    list.innerHTML = `<div class="empty-state small-empty"><h3>Nothing yet</h3><p>Sources show up here after your first check.</p></div>`;
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
    // prefer a homepage-ish link over a search URL
    if (s.url && /google\.com\/search/.test(s.url) && c.source_url && !/google\.com\/search/.test(c.source_url)) s.url = safeUrl(c.source_url);
  });

  const sources = Object.values(sourceMap).sort((a, b) => b.count - a.count);
  const max = sources[0].count;
  list.innerHTML = sources.slice(0, 40).map(s => `
    <div class="source-row">
      <div class="source-icon">${LINK_ICON}</div>
      <div class="source-info">
        <div class="source-name">${s.url ? `<a href="${escapeAttr(s.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(s.name)}</a>` : escapeHtml(s.name)}</div>
        <div class="source-meta">${s.v} verified, ${s.f} contradicted</div>
      </div>
      <div class="source-bar" aria-hidden="true"><span style="--w:${s.count / max}"></span></div>
      <div class="source-count">${s.count} ${s.count === 1 ? 'use' : 'uses'}</div>
    </div>`).join('');
}

// SETTINGS - cached in localStorage so they apply instantly and survive a storage outage

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
    if (badge) { badge.hidden = !below; badge.textContent = `Below ${threshold}% threshold`; }
    const line = card.querySelector('.conf-bar-threshold');
    if (line) { line.style.left = threshold + '%'; line.title = `Threshold: ${threshold}%`; }
  });
}

let settingsDirty = false;
function markSettingsDirty(dirty) {
  settingsDirty = dirty;
  const btn = $('#btn-save-settings');
  btn.disabled = !dirty;
  btn.textContent = dirty ? 'Save' : 'Saved';
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
  btn.textContent = 'Saving...';
  let failed = false;
  for (const s of settings) {
    await db.from('settings').delete().eq('key', s.key).eq('user_id', userId);
    const { error } = await db.from('settings').insert({ key: s.key, value: s.value, user_id: userId, updated_at: new Date().toISOString() });
    if (error) failed = true;
  }
  markSettingsDirty(false);
  showToast(failed ? 'Saved on this device. Syncing to storage failed.' : 'Settings saved', failed ? 'info' : 'success');
});

async function checkDbStatus() {
  const statusEl = $('#db-status');
  const analysesCountEl = $('#db-analyses-count');
  const claimsCountEl = $('#db-claims-count');
  statusEl.textContent = 'Checking...';
  statusEl.className = 'db-status';
  const [a, c] = await Promise.all([
    db.from('analyses').select('*', { count: 'exact', head: true }).eq('user_id', userId),
    db.from('claims').select('*', { count: 'exact', head: true }).eq('user_id', userId)
  ]);
  if (a.error || c.error) {
    statusEl.textContent = 'Disconnected';
    statusEl.className = 'db-status disconnected';
    analysesCountEl.textContent = '-';
    claimsCountEl.textContent = '-';
    return;
  }
  statusEl.textContent = 'Connected';
  statusEl.className = 'db-status connected';
  analysesCountEl.textContent = a.count ?? 0;
  claimsCountEl.textContent = c.count ?? 0;
}

// DASHBOARD - running totals in the ledger

async function loadDashboardStats() {
  const { data: analyses, error } = await db.from('analyses').select('trust_score, verified_count, total_claims').eq('user_id', userId);
  if (error || !analyses) return;
  const totalAnalyses = analyses.length;
  const totalClaims = analyses.reduce((s, a) => s + (a.total_claims || 0), 0);
  const totalVerified = analyses.reduce((s, a) => s + (a.verified_count || 0), 0);
  const avgScore = totalAnalyses ? Math.round(analyses.reduce((s, a) => s + (a.trust_score || 0), 0) / totalAnalyses) : 0;
  const accuracy = totalClaims ? Math.round((totalVerified / totalClaims) * 100) : 0;
  animateNum('dash-total', totalAnalyses);
  animateNum('dash-claims', totalClaims);
  animateNumWithSuffix($('#dash-avg-score'), avgScore, '%');
  animateNumWithSuffix($('#dash-accuracy'), accuracy, '%');
}

function animateNumWithSuffix(el, target, suffix) {
  if (!el) return;
  let num = el.querySelector('.stat-num');
  if (!num) { el.innerHTML = `<span class="stat-num">0</span><span class="stat-unit">${suffix}</span>`; num = el.querySelector('.stat-num'); }
  animateNum(num, target);
}

// DIALOG - a small promise-based confirm that matches the rest of the UI

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
// FEATURE: Voice Input

(() => {
  const micBtn = $('#btn-mic');
  if (!micBtn) return;

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) { micBtn.remove(); return; }

  let recognition = null;
  let isRecording = false;

  micBtn.addEventListener('click', () => {
    if (isRecording) {
      recognition.stop();
      return;
    }

    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = false; // Disable interim - prevents duplicate/repeated words
    recognition.lang = navigator.language || 'en-US';

    const startText = input.value; // Text that was in box before recording
    let newSpeech = '';             // Only speech added this session

    recognition.onstart = () => {
      isRecording = true;
      micBtn.classList.add('recording');
      micBtn.setAttribute('aria-pressed', 'true');
      showToast('Listening. Click the mic again to stop.', 'info');
    };

    recognition.onresult = (e) => {
      // Only process final results - accumulate new speech
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) {
          newSpeech += (newSpeech ? ' ' : '') + e.results[i][0].transcript.trim();
        }
      }
      // Show: original text + new speech (no duplication)
      setInputText(startText + (startText && newSpeech ? ' ' : '') + newSpeech);
    };

    recognition.onend = () => {
      isRecording = false;
      micBtn.classList.remove('recording');
      micBtn.setAttribute('aria-pressed', 'false');
    };

    recognition.onerror = (e) => {
      isRecording = false;
      micBtn.classList.remove('recording');
      micBtn.setAttribute('aria-pressed', 'false');
      const why = { 'not-allowed': 'Microphone access was blocked.', 'no-speech': 'Did not hear anything.', network: 'Voice input needs a connection.' };
      if (e.error !== 'aborted') showToast(why[e.error] || 'Voice input stopped.', 'error');
    };

    recognition.start();
  });
})();

// EXPORT, COPY, SHARE

function reportText() {
  const total = currentClaims.length;
  const count = s => currentClaims.filter(c => c.status === s).length;
  let text = `Hallucination Hunter report\n${new Date().toLocaleString()}\n\n`;
  text += `Trust score: ${scoreOf(currentClaims)}% across ${total} claims\n`;
  text += `Verified: ${count('verified')}, unverifiable: ${count('unverifiable')}, wrong: ${count('false')}\n\n`;
  currentClaims.forEach((c, i) => {
    text += `${i + 1}. ${VERDICT_LABELS[c.status]} (${c.confidence}% confidence)\n`;
    text += `   "${c.text}"\n`;
    if (c.correction) text += `   Actually: ${c.correction}\n`;
    text += `   ${c.explanation}\n`;
    text += `   Source: ${c.source}${safeUrl(c.sourceUrl) ? ' - ' + c.sourceUrl : ''}\n\n`;
  });
  return text;
}

function reportMarkdown() {
  const lines = ['# Hallucination Hunter report', '', `Trust score **${scoreOf(currentClaims)}%** across ${currentClaims.length} claims. Checked ${new Date().toLocaleString()}.`, '', '| # | Verdict | Confidence | Claim | Source |', '|---|---|---|---|---|'];
  const cell = s => String(s || '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
  currentClaims.forEach((c, i) => {
    const src = safeUrl(c.sourceUrl) ? `[${cell(c.source)}](${c.sourceUrl})` : cell(c.source);
    lines.push(`| ${i + 1} | ${VERDICT_LABELS[c.status]} | ${c.confidence}% | ${cell(c.text)}${c.correction ? '<br>*Actually:* ' + cell(c.correction) : ''} | ${src} |`);
  });
  lines.push('', '## Original text', '', currentText.split('\n').map(l => '> ' + l).join('\n'));
  return lines.join('\n');
}

$('#btn-export')?.addEventListener('click', () => {
  if (!currentClaims.length) { showToast('No results to print', 'error'); return; }
  $$('.claim-detail').forEach(d => { d.hidden = false; d.classList.add('open'); });
  window.print();
});

$('#btn-copy')?.addEventListener('click', async () => {
  if (!currentClaims.length) { showToast('No results to copy', 'error'); return; }
  if (await copyText(reportText())) showToast('Report copied', 'success');
});

$('#btn-markdown')?.addEventListener('click', () => {
  if (!currentClaims.length) { showToast('No results to download', 'error'); return; }
  downloadFile(`fact-check-${new Date().toISOString().slice(0, 10)}.md`, reportMarkdown(), 'text/markdown');
});

// Share links carry the text and verdicts in the URL fragment; nothing is uploaded.
function encodeShare() {
  const data = {
    v: 2,
    x: currentText.length <= 3000 ? currentText : '',
    c: currentClaims.map(c => [c.text, c.status[0], c.confidence, c.explanation, c.source, safeUrl(c.sourceUrl) && !/google\.com\/search/.test(c.sourceUrl) ? c.sourceUrl : '', c.correction || '', c.originalText !== c.text ? c.originalText : ''])
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
      id: i + 1, text: r[0], originalText: r[7] || r[0], status: letter[r[1]] || 'unverifiable', confidence: normalizeConfidence(r[2]),
      explanation: r[3], source: r[4], sourceUrl: r[5] || ('https://www.google.com/search?q=' + encodeURIComponent(r[0].slice(0, 120))), correction: r[6] || null, category: 'General'
    }));
    return { text: data.x || claims.map(c => c.text).join(' '), claims };
  }
  // v1 links from older builds
  const claims = (data.claims || []).map((c, i) => ({
    id: i + 1, text: c.t, originalText: c.t, status: normalizeStatus(c.s), confidence: normalizeConfidence(c.c),
    explanation: c.e, source: c.src, sourceUrl: null, correction: null, category: 'General'
  }));
  return { text: claims.map(c => c.text).join(' '), claims };
}

$('#btn-share')?.addEventListener('click', async () => {
  if (!currentClaims.length) { showToast('No results to share', 'error'); return; }
  let url;
  try {
    url = location.origin + location.pathname + '#share=' + encodeShare();
  } catch { showToast('Could not build a link for this check', 'error'); return; }
  if (url.length > 16000) { showToast('Too long for a link. Use Copy report instead.', 'error'); return; }
  if (navigator.share && matchMedia('(pointer: coarse)').matches) {
    try { await navigator.share({ title: 'Fact check', text: `Trust score ${scoreOf(currentClaims)}% across ${currentClaims.length} claims`, url }); return; }
    catch (e) { if (e && e.name === 'AbortError') return; }
  }
  if (await copyText(url)) showToast('Link copied. Anyone with it sees this result.', 'success');
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
    showToast('Showing a shared check', 'info');
  } catch (e) {
    console.warn('Bad share link:', e);
    showToast('That share link is damaged or incomplete', 'error');
  }
  history.replaceState(null, '', location.pathname + location.search);
  return true;
}

// Batch mode is handled inside runAnalysis(); this just explains the syntax.
$('#batch-mode')?.addEventListener('change', e => {
  if (e.target.checked) showToast('Separate texts with a line containing only ---', 'info');
});

// UTILITIES

function escapeRegExp(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function escapeHtml(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
function escapeAttr(s) { return escapeHtml(s); }

// THEME - light by default, dark on request or when the OS prefers it

function applyTheme(mode) {
  const dark = mode === 'dark' || (mode === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = dark ? '#1a1815' : '#f3efe6';
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

// CONNECTIVITY

function updateOnline() {
  const bar = $('#offline-bar');
  if (bar) bar.classList.toggle('show', navigator.onLine === false);
}
window.addEventListener('online', updateOnline);
window.addEventListener('offline', updateOnline);

// KEYBOARD - "/" focuses the input, "?" opens the shortcuts sheet

document.addEventListener('keydown', e => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
  if (e.key === 'Escape' && activeController) { activeController.abort(); return; }
  if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === '/') { e.preventDefault(); switchView('analyzer'); activateSubtab('analyzer-tabs', 'subtab', 'verify'); input.focus(); }
  if (e.key === '?') { e.preventDefault(); $('#shortcuts-dialog')?.showModal?.(); }
});
$('#btn-shortcuts')?.addEventListener('click', () => $('#shortcuts-dialog')?.showModal?.());
$$('dialog').forEach(d => d.addEventListener('click', e => { if (e.target === d) d.close('cancel'); }));

// INIT

(function init() {
  applyTheme(currentThemeMode());
  updateOnline();

  const local = readLocalSettings();
  if (local.confidence_threshold) applyThreshold(parseInt(local.confidence_threshold, 10));

  const shared = loadSharedAnalysis();
  if (!shared) {
    try { const draft = localStorage.getItem(DRAFT_KEY); if (draft) setInputText(draft); } catch {}
  }

  // Text handed over by the extension or another app: ?text=...
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
// GLOBAL SEARCH (Ctrl/Cmd+K) - arrow keys move, Enter opens, Esc closes
(() => {
  const toggle = $('#global-search-toggle');
  const overlay = $('#search-overlay');
  const field = $('#search-input');
  const out = $('#search-results');
  if (!toggle || !overlay) return;

  const EMPTY = '<div class="search-empty-state"><p>Start typing to search everything you have checked.</p></div>';
  let lastFocus = null;
  let timer = null;
  let seq = 0;
  let cache = null; // { analyses, claims } for the life of one open

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
    }, REDUCED_MOTION ? 0 : 160);
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
      db.from('analyses').select('id, input_text, trust_score, created_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(200),
      db.from('claims').select('id, analysis_id, claim_text, status, confidence, explanation, source_url, source_name, created_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(1000)
    ]);
    if (a.error && c.error) throw new Error(db.unavailable ? 'Storage is blocked in this browser.' : 'Could not reach storage.');
    cache = { analyses: a.data || [], claims: c.data || [] };
    return cache;
  }

  async function run(q) {
    const my = ++seq;
    if (!cache) out.innerHTML = '<div class="search-empty-state"><p>Searching...</p></div>';
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
      out.innerHTML = `<div class="search-no-results"><p>Nothing matches "<strong>${escapeHtml(q)}</strong>".</p></div>`;
      return;
    }

    let html = '';
    if (analyses.length) {
      html += `<div class="search-section-label">Checks (${analyses.length})</div>`;
      analyses.slice(0, 5).forEach(a => {
        const t = a.input_text || '';
        const at = Math.max(0, t.toLowerCase().indexOf(lq) - 30);
        const snippet = (at ? '...' : '') + t.slice(at, at + 90);
        html += `<div class="search-result-item" role="option" data-action="analysis" data-id="${escapeAttr(a.id)}">
          <div class="search-result-icon history band-${bandOf(a.trust_score)}">${a.trust_score ?? '-'}</div>
          <div class="search-result-info"><div class="search-result-title">${highlight(snippet, q)}</div><div class="search-result-meta">Trust ${a.trust_score ?? '-'}%, ${relativeDate(a.created_at)}</div></div>
        </div>`;
      });
    }
    if (claims.length) {
      html += `<div class="search-section-label">Claims (${claims.length})</div>`;
      claims.slice(0, 6).forEach(c => {
        const st = normalizeStatus(c.status);
        html += `<div class="search-result-item" role="option" data-action="analysis" data-id="${escapeAttr(c.analysis_id)}">
          <div class="search-result-icon claim">${MARKS[st]}</div>
          <div class="search-result-info"><div class="search-result-title">${highlight((c.claim_text || '').slice(0, 110), q)}</div><div class="search-result-meta">${VERDICT_LABELS[st]}, ${c.confidence}% confidence</div></div>
        </div>`;
      });
    }
    if (sources.length) {
      html += `<div class="search-section-label">Sources (${sources.length})</div>`;
      sources.slice(0, 5).forEach(s => {
        html += `<div class="search-result-item" role="option" data-action="source" data-url="${escapeAttr(s.url)}">
          <div class="search-result-icon source">${LINK_ICON}</div>
          <div class="search-result-info"><div class="search-result-title">${highlight(s.name, q)}</div><div class="search-result-meta">${highlight(s.url, q)}, cited ${s.count}x</div></div>
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
// Kept as a no-op: the old accuracy tab was folded into the results header.
function updateAccuracyTab() {}