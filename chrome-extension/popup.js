/* Hallucination Hunter - extension popup.
   Talks to the same hosted proxy as the web app, so no API key ships with the extension. */

'use strict';

const APP_URL = 'https://hallucination-hunter-five.vercel.app/';
const PROXY_URL = APP_URL + 'api/groq';
const MODEL = 'openai/gpt-oss-120b';
const MAX_CHARS = 20000;
const TIMEOUT_MS = 75000;
const CAPTURE_MAX_AGE = 5 * 60 * 1000;

const $ = sel => document.querySelector(sel);
const textInput = $('#hh-text-input');
const analyzeBtn = $('#hh-analyze-btn');
const loadingEl = $('#hh-loading');
const errorEl = $('#hh-error');
const resultsEl = $('#hh-results');
const autoDetectEl = $('#hh-auto-detect');

let controller = null;
let lastClaims = [];
let lastText = '';
let activeFilter = null;

// chrome.storage when running as an extension, localStorage when opened as a plain page.
const store = {
  async get(keys) {
    if (globalThis.chrome && chrome.storage && chrome.storage.local) return chrome.storage.local.get(keys);
    const out = {};
    keys.forEach(k => { try { const v = localStorage.getItem('hh_' + k); if (v !== null) out[k] = JSON.parse(v); } catch (e) { /* ignore */ } });
    return out;
  },
  async set(obj) {
    if (globalThis.chrome && chrome.storage && chrome.storage.local) return chrome.storage.local.set(obj);
    Object.entries(obj).forEach(([k, v]) => { try { localStorage.setItem('hh_' + k, JSON.stringify(v)); } catch (e) { /* ignore */ } });
  }
};

const STEPS = ['Reading the text...', 'Pulling out the factual claims...', 'Checking each claim...', 'Writing up the verdicts...'];

// ---------- startup ----------

document.addEventListener('DOMContentLoaded', async () => {
  try {
    const manifest = globalThis.chrome && chrome.runtime && chrome.runtime.getManifest ? chrome.runtime.getManifest() : null;
    if (manifest) $('#hh-version').textContent = 'v' + manifest.version.replace(/\.0$/, '');
  } catch (e) { /* not in extension context */ }

  if (/Mac/i.test(navigator.platform)) {
    document.querySelector('.hh-hint kbd').textContent = 'Cmd';
    $('#hh-shortcut-hint').textContent = 'Option+Shift+H';
  }

  const data = await store.get(['capturedText', 'capturedAt', 'capturedFrom', 'autoRun', 'lastText', 'lastClaims', 'draft']);
  const captured = data.capturedText || '';
  const age = Date.now() - (data.capturedAt || 0);

  if (captured.length > 10 && age < CAPTURE_MAX_AGE) {
    setText(captured);
    autoDetectEl.textContent = data.capturedFrom ? `Filled in from ${data.capturedFrom}.` : 'Filled in from the text you copied.';
    autoDetectEl.hidden = false;
    await store.set({ capturedText: '', autoRun: false });
    if (data.autoRun) { analyze(); return; }
  } else if (data.lastText && Array.isArray(data.lastClaims) && data.lastClaims.length) {
    setText(data.lastText);
    displayResults(data.lastClaims, data.lastText, { instant: true });
  } else if (data.draft) {
    setText(data.draft);
  }
  textInput.focus();
});

function setText(t) {
  textInput.value = String(t).slice(0, MAX_CHARS);
  updateCount();
}

function updateCount() {
  const n = textInput.value.length;
  const el = $('#hh-count');
  el.textContent = `${n.toLocaleString()} / 20,000`;
  el.classList.toggle('over', n >= MAX_CHARS);
}

let draftTimer = 0;
textInput.addEventListener('input', () => {
  updateCount();
  autoDetectEl.hidden = true;
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => store.set({ draft: textInput.value }), 300);
});

// ---------- controls ----------

analyzeBtn.addEventListener('click', analyze);
$('#hh-retry-btn').addEventListener('click', analyze);
$('#hh-cancel-btn').addEventListener('click', () => controller && controller.abort());

$('#hh-clear-btn').addEventListener('click', () => {
  if (controller) controller.abort();
  setText('');
  hide(resultsEl); hide(errorEl);
  autoDetectEl.hidden = true;
  lastClaims = []; lastText = '';
  store.set({ draft: '', lastText: '', lastClaims: [] });
  textInput.focus();
});

document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); if (!controller) analyze(); }
  if (e.key === 'Escape' && controller) { e.preventDefault(); controller.abort(); }
});

$('#hh-copy-btn').addEventListener('click', async () => {
  const btn = $('#hh-copy-btn');
  try {
    await navigator.clipboard.writeText(reportText());
    flashLabel(btn, 'Copied');
  } catch (e) {
    flashLabel(btn, 'Copy failed');
  }
});

$('#hh-open-btn').addEventListener('click', () => {
  const text = lastText || textInput.value.trim();
  const url = APP_URL + (text ? '?text=' + encodeURIComponent(text.slice(0, 6000)) + '&run=1' : '');
  if (globalThis.chrome && chrome.tabs && chrome.tabs.create) chrome.tabs.create({ url });
  else window.open(url, '_blank', 'noopener');
});

$$('.hh-summary-badge').forEach(b => b.addEventListener('click', () => {
  activeFilter = activeFilter === b.dataset.filter ? null : b.dataset.filter;
  $$('.hh-summary-badge').forEach(x => x.setAttribute('aria-pressed', x.dataset.filter === activeFilter ? 'true' : 'false'));
  $$('.hh-claim-card').forEach(card => {
    card.hidden = !!activeFilter && card.dataset.status !== activeFilter;
  });
}));

function $$(sel) { return Array.from(document.querySelectorAll(sel)); }

function flashLabel(btn, label) {
  const orig = btn.dataset.label || btn.textContent;
  btn.dataset.label = orig;
  btn.textContent = label;
  setTimeout(() => { btn.textContent = orig; }, 1400);
}

// ---------- the check ----------

const SYSTEM_PROMPT = `You are a careful fact-checker. Extract every distinct, checkable factual claim from the user's text (skip opinions, advice and filler). Verify each against well-established knowledge.

Return a JSON object of the form {"claims": [ ... ]} where each item has:
- "claim": the claim, rewritten as one self-contained sentence
- "status": "verified" (correct), "unverifiable" (cannot be confirmed either way) or "false" (contradicted by reliable knowledge)
- "confidence": integer 0-100, how sure you are of the verdict
- "explanation": one or two plain sentences on why
- "correction": for "false" only, the correct fact; otherwise null
- "source": the kind of source a reader could check, e.g. "Encyclopaedia Britannica"
- "category": a short topic such as "History" or "Science"

Return at most 25 claims. If there are no factual claims, return {"claims": []}.`;

async function analyze() {
  const text = textInput.value.trim();
  if (!text) { showError('Paste some text first.'); return; }
  if (text.length < 15) { showError('That is a bit short. Give it at least one full sentence.'); return; }
  if (controller) return;

  controller = new AbortController();
  const timer = setTimeout(() => controller && controller.abort('timeout'), TIMEOUT_MS);
  setBusy(true);
  hide(errorEl);
  hide(resultsEl);

  try {
    const claims = await requestClaims(text, controller.signal);
    lastText = text;
    lastClaims = claims;
    displayResults(claims, text);
    store.set({ lastText: text, lastClaims: claims, lastAt: Date.now() });
  } catch (err) {
    if (err && err.name === 'AbortError') {
      if (controller && controller.signal.reason === 'timeout') showError('The check took too long. Try a shorter passage.', true);
    } else {
      showError(err.message || 'The check failed. Try again in a moment.', err.retryable !== false);
    }
  } finally {
    clearTimeout(timer);
    controller = null;
    setBusy(false);
  }
}

async function requestClaims(text, signal) {
  const body = {
    model: MODEL,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: text }
    ],
    temperature: 0.1,
    max_tokens: 6144,
    reasoning_effort: 'low',
    response_format: { type: 'json_object' }
  };

  for (let attempt = 0; ; attempt++) {
    let res, payload;
    try {
      res = await fetch(PROXY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal
      });
      payload = await res.json().catch(() => null);
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      if (attempt < 1) { await wait(1000, signal); continue; }
      throw friendly(navigator.onLine === false ? 'You are offline. Reconnect and try again.' : 'Could not reach the checking service. Check your connection.');
    }

    if (res.ok) {
      const content = payload && payload.choices && payload.choices[0] && payload.choices[0].message && payload.choices[0].message.content;
      const parsed = parseJson(content);
      if (parsed) return normalize(parsed);
      if (attempt < 1) continue;
      throw friendly('The checker returned something unreadable. Trying again usually works.');
    }

    const msg = (payload && payload.error) || '';
    const transient = res.status === 429 || res.status >= 500 || (res.status === 400 && /json/i.test(msg));
    if (transient && attempt < 1) {
      const ra = Math.min(parseInt(res.headers.get('retry-after') || '0', 10) || 0, 15);
      await wait(ra ? ra * 1000 : 1500, signal);
      continue;
    }
    if (res.status === 429) throw friendly('Too many checks in a short time. Wait a minute and try again.');
    if (res.status === 413) throw friendly('That text is too long to check in one go.', false);
    if (res.status === 403) throw friendly('The checking service refused this request. Update the extension and try again.', false);
    if (res.status >= 500) throw friendly('The checking service is having trouble right now. Try again in a minute.');
    throw friendly(msg || `Request failed (${res.status}).`);
  }
}

function friendly(message, retryable = true) {
  const e = new Error(message);
  e.retryable = retryable;
  return e;
}

function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    if (signal) signal.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
  });
}

function parseJson(content) {
  if (content && typeof content === 'object') return content;
  const text = String(content || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(text); } catch (e) { /* fall through */ }
  const m = text.match(/[\[{][\s\S]*[\]}]/);
  if (m) { try { return JSON.parse(m[0]); } catch (e) { /* fall through */ } }
  return null;
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

function normalize(parsed) {
  const list = Array.isArray(parsed) ? parsed : (parsed.claims || parsed.results || []);
  return (Array.isArray(list) ? list : [])
    .filter(c => c && (c.claim || c.text))
    .slice(0, 25)
    .map(c => {
      const status = normalizeStatus(c.status);
      return {
        claim: String(c.claim || c.text).trim(),
        status,
        confidence: normalizeConfidence(c.confidence),
        explanation: c.explanation ? String(c.explanation) : '',
        correction: status === 'false' && c.correction && String(c.correction).toLowerCase() !== 'null' ? String(c.correction) : '',
        source: c.source ? String(c.source) : '',
        category: c.category ? String(c.category) : ''
      };
    });
}

// ---------- rendering ----------

const ICONS = {
  verified: '<svg width="11" height="11" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 10.5l3.5 3.5 7.5-8"/></svg>',
  unverifiable: '<svg width="11" height="11" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M7.3 7.6a2.8 2.8 0 1 1 3.8 2.6c-.7.3-1.1.9-1.1 1.6v.3M10 15.4h.01"/></svg>',
  false: '<svg width="11" height="11" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M5.5 5.5l9 9M14.5 5.5l-9 9"/></svg>'
};
const LABELS = { verified: 'Verified', unverifiable: 'Unverifiable', false: 'Wrong' };
const CLASS = { verified: 'verified', unverifiable: 'unverifiable', false: 'incorrect' };

function scoreOf(claims) {
  const v = claims.filter(c => c.status === 'verified').length;
  return claims.length ? Math.round((v / claims.length) * 100) : 0;
}

function displayResults(claims, text, { instant = false } = {}) {
  lastClaims = claims;
  lastText = text;
  activeFilter = null;
  $$('.hh-summary-badge').forEach(x => x.setAttribute('aria-pressed', 'false'));

  const counts = { verified: 0, unverifiable: 0, false: 0 };
  claims.forEach(c => { counts[c.status]++; });
  const score = scoreOf(claims);
  const band = score >= 70 ? 'good' : score >= 40 ? 'mid' : 'bad';

  resultsEl.dataset.band = band;
  $('#hh-count-verified').textContent = counts.verified;
  $('#hh-count-unverifiable').textContent = counts.unverifiable;
  $('#hh-count-incorrect').textContent = counts.false;

  const list = $('#hh-claims-list');
  list.innerHTML = '';
  if (!claims.length) {
    list.innerHTML = '<p class="hh-empty">No checkable facts found. Opinions and advice are skipped.</p>';
  }
  claims.forEach((c, i) => {
    const card = document.createElement('article');
    card.className = 'hh-claim-card ' + CLASS[c.status];
    card.dataset.status = c.status;
    card.style.setProperty('--i', Math.min(i, 12));
    card.innerHTML = `
      <div class="hh-claim-top">
        <span class="hh-claim-badge ${CLASS[c.status]}">${ICONS[c.status]}</span>
        <span class="hh-claim-status ${CLASS[c.status]}">${LABELS[c.status]}</span>
        <span class="hh-claim-conf">${c.confidence}%</span>
      </div>
      <p class="hh-claim-text"></p>
      ${c.correction ? '<p class="hh-claim-correction"><strong>Actually:</strong> <span></span></p>' : ''}
      ${c.explanation ? '<details class="hh-claim-more"><summary>Why</summary><p></p></details>' : ''}
      ${c.source ? '<p class="hh-claim-source"></p>' : ''}`;
    card.querySelector('.hh-claim-text').textContent = c.claim;
    if (c.correction) card.querySelector('.hh-claim-correction span').textContent = c.correction;
    if (c.explanation) card.querySelector('.hh-claim-more p').textContent = c.explanation;
    if (c.source) card.querySelector('.hh-claim-source').textContent = 'Source: ' + c.source + (c.category ? ' \u00b7 ' + c.category : '');
    list.appendChild(card);
  });

  resultsEl.classList.toggle('instant', instant);
  show(resultsEl);
  const fill = $('#hh-trust-fill');
  fill.style.transform = 'scaleX(0)';
  requestAnimationFrame(() => requestAnimationFrame(() => { fill.style.transform = `scaleX(${score / 100})`; }));
  countUp($('#hh-trust-value'), score, instant);
}

function countUp(el, target, instant) {
  if (instant || matchMedia('(prefers-reduced-motion: reduce)').matches) { el.textContent = target + '%'; return; }
  const start = performance.now();
  const dur = 700;
  function step(now) {
    const t = Math.min(1, (now - start) / dur);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = Math.round(target * eased) + '%';
    if (t < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

function reportText() {
  const score = scoreOf(lastClaims);
  const lines = [`Hallucination Hunter report - trust score ${score}% (${lastClaims.length} claims)`, ''];
  lastClaims.forEach((c, i) => {
    lines.push(`${i + 1}. [${LABELS[c.status]}, ${c.confidence}%] ${c.claim}`);
    if (c.correction) lines.push(`   Actually: ${c.correction}`);
    if (c.explanation) lines.push(`   ${c.explanation}`);
    if (c.source) lines.push(`   Source: ${c.source}`);
  });
  lines.push('', 'Checked with ' + APP_URL);
  return lines.join('\n');
}

// ---------- state helpers ----------

let stepTimer = 0;
function setBusy(busy) {
  analyzeBtn.disabled = busy;
  analyzeBtn.classList.toggle('is-busy', busy);
  textInput.readOnly = busy;
  clearInterval(stepTimer);
  if (busy) {
    let i = 0;
    $('#hh-loading-text').textContent = STEPS[0];
    stepTimer = setInterval(() => {
      i = Math.min(i + 1, STEPS.length - 1);
      $('#hh-loading-text').textContent = STEPS[i];
    }, 3500);
    show(loadingEl);
  } else {
    hide(loadingEl);
  }
}

function show(el) { el.hidden = false; }
function hide(el) { el.hidden = true; }

function showError(msg, retry = false) {
  $('#hh-error-text').textContent = msg;
  $('#hh-retry-btn').hidden = !retry;
  show(errorEl);
}
