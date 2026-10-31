/* Hallucination Hunter — Companion Extension Popup
   Uses the hosted /api/groq and /api/search endpoints so no API key ships in the extension. */

'use strict';

const APP_URL = 'https://hallucination-hunter-five.vercel.app/';
const PROXY_URL = APP_URL + 'api/groq';
const SEARCH_URL = APP_URL + 'api/search';
const MODEL = 'openai/gpt-oss-120b';
const MAX_CHARS = 20000;
const TIMEOUT_MS = 75000;
const CAPTURE_MAX_AGE = 5 * 60 * 1000;

const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));

const textInput = $('#hh-text-input');
const analyzeBtn = $('#hh-analyze-btn');
const loadingEl = $('#hh-loading');
const errorEl = $('#hh-error');
const resultsEl = $('#hh-results');
const autoDetectEl = $('#hh-auto-detect');
const collapsedBar = $('#hh-collapsed-bar');
const collapsedSnippet = $('#hh-collapsed-snippet');

let controller = null;
let lastClaims = [];
let lastText = '';
let activeFilter = 'all';

const store = {
  async get(keys) {
    if (globalThis.chrome && chrome.storage && chrome.storage.local) return chrome.storage.local.get(keys);
    const out = {};
    keys.forEach(k => {
      try {
        const v = localStorage.getItem('hh_ext_' + k);
        if (v !== null) out[k] = JSON.parse(v);
      } catch {
        /* ignore */
      }
    });
    return out;
  },
  async set(obj) {
    if (globalThis.chrome && chrome.storage && chrome.storage.local) return chrome.storage.local.set(obj);
    Object.entries(obj).forEach(([k, v]) => {
      try { localStorage.setItem('hh_ext_' + k, JSON.stringify(v)); } catch { /* ignore */ }
    });
  }
};

const STEPS = [
  'Extracting factual claims\u2026',
  'Checking facts against records\u2026',
  'Attaching reference links\u2026'
];

// Query active tab selection when user opens popup after highlighting text
async function readActiveTabSelection() {
  if (!(globalThis.chrome && chrome.tabs && chrome.tabs.query && chrome.tabs.sendMessage)) return null;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id || !/^https?:/i.test(tab.url || '')) return null;
    const resp = await chrome.tabs.sendMessage(tab.id, { type: 'hh-get-selection' });
    if (resp && resp.text && resp.text.length >= 20) return resp;
  } catch {
    /* content script not loaded on this tab */
  }
  return null;
}

function applyPopupTheme(theme) {
  if (theme === 'dark' || theme === 'light') {
    document.documentElement.dataset.theme = theme;
  } else {
    delete document.documentElement.dataset.theme;
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  try {
    const manifest = globalThis.chrome && chrome.runtime && chrome.runtime.getManifest ? chrome.runtime.getManifest() : null;
    if (manifest) $('#hh-version').textContent = 'v' + manifest.version.replace(/\.0$/, '');
  } catch {
    /* standalone preview */
  }

  if (/Mac/i.test(navigator.platform)) {
    const modKey = $('#hh-mod-key');
    if (modKey) modKey.textContent = 'Cmd';
    $('#hh-shortcut-hint').textContent = 'Option+Shift+H';
  }

  const data = await store.get(['theme', 'capturedText', 'capturedAt', 'capturedFrom', 'autoRun', 'lastText', 'lastClaims', 'draft']);
  if (data.theme) applyPopupTheme(data.theme);

  const liveSel = await readActiveTabSelection();
  const captured = data.capturedText || '';
  const age = Date.now() - (data.capturedAt || 0);

  if (captured.length > 15 && age < CAPTURE_MAX_AGE) {
    setText(captured);
    autoDetectEl.textContent = data.capturedFrom ? `Loaded selection from ${data.capturedFrom}` : 'Loaded copied text';
    autoDetectEl.hidden = false;
    await store.set({ capturedText: '', autoRun: false });
    if (data.autoRun) { analyze(); return; }
  } else if (liveSel && liveSel.text) {
    setText(liveSel.text);
    autoDetectEl.textContent = liveSel.host ? `Selected on ${liveSel.host}` : 'Loaded page selection';
    autoDetectEl.hidden = false;
  } else if (data.lastText && Array.isArray(data.lastClaims) && data.lastClaims.length) {
    setText(data.lastText);
    displayResults(data.lastClaims, data.lastText, { instant: true });
    return;
  } else if (data.draft) {
    setText(data.draft);
  }
  textInput.focus();
});

$('#hh-theme-btn')?.addEventListener('click', async () => {
  const cur = document.documentElement.dataset.theme;
  const sysDark = matchMedia('(prefers-color-scheme: dark)').matches;
  const isDark = cur === 'dark' || (!cur && sysDark);
  const next = isDark ? 'light' : 'dark';
  applyPopupTheme(next);
  await store.set({ theme: next });
});

$('#hh-paste-btn')?.addEventListener('click', async () => {
  try {
    const clip = await navigator.clipboard.readText();
    if (clip && clip.trim()) {
      setText(clip.trim());
      autoDetectEl.hidden = true;
      textInput.focus();
    }
  } catch {
    textInput.focus();
  }
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

function setResultsLayout(hasResults, editing = false) {
  document.body.classList.toggle('has-results', hasResults);
  document.body.classList.toggle('editing-input', editing);
  collapsedBar.hidden = !(hasResults && !editing);
}

$('#hh-edit-btn')?.addEventListener('click', () => {
  setResultsLayout(true, true);
  textInput.focus();
});

$('#hh-new-btn')?.addEventListener('click', () => {
  clearAll();
});

analyzeBtn.addEventListener('click', analyze);
$('#hh-retry-btn').addEventListener('click', analyze);
$('#hh-cancel-btn').addEventListener('click', () => controller && controller.abort());

function clearAll() {
  if (controller) controller.abort();
  setText('');
  hide(resultsEl);
  hide(errorEl);
  autoDetectEl.hidden = true;
  lastClaims = [];
  lastText = '';
  setResultsLayout(false, false);
  store.set({ draft: '', lastText: '', lastClaims: [] });
  textInput.focus();
}

$('#hh-clear-btn').addEventListener('click', clearAll);

document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    if (!controller) analyze();
  }
  if (e.key === 'Escape' && controller) {
    e.preventDefault();
    controller.abort();
  }
});

$('#hh-copy-btn').addEventListener('click', async () => {
  const btn = $('#hh-copy-btn');
  try {
    await navigator.clipboard.writeText(reportText());
    flashLabel(btn, 'Copied');
  } catch {
    flashLabel(btn, 'Copy failed');
  }
});

$('#hh-open-btn').addEventListener('click', () => {
  const text = lastText || textInput.value.trim();
  const url = APP_URL + (text ? '?text=' + encodeURIComponent(text.slice(0, 6000)) + '&run=1' : '');
  if (globalThis.chrome && chrome.tabs && chrome.tabs.create) chrome.tabs.create({ url });
  else window.open(url, '_blank', 'noopener');
});

$$('.hh-ftab').forEach(btn => {
  btn.addEventListener('click', () => {
    activeFilter = btn.dataset.filter || 'all';
    $$('.hh-ftab').forEach(b => {
      const on = b === btn;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    applyFilter();
  });
});

function applyFilter() {
  const cards = $$('.hh-claim-card');
  let visible = 0;
  cards.forEach(card => {
    const showCard = activeFilter === 'all' || card.dataset.status === activeFilter;
    card.hidden = !showCard;
    if (showCard) visible++;
  });
  let empty = $('#hh-filter-empty');
  if (visible === 0 && lastClaims.length > 0) {
    if (!empty) {
      empty = document.createElement('p');
      empty.id = 'hh-filter-empty';
      empty.className = 'hh-empty';
      $('#hh-claims-list').appendChild(empty);
    }
    empty.textContent = `No ${LABELS[activeFilter]?.toLowerCase() || ''} claims in this passage.`;
  } else if (empty) {
    empty.remove();
  }
}

function flashLabel(btn, label) {
  const orig = btn.dataset.label || btn.textContent;
  btn.dataset.label = orig;
  btn.textContent = label;
  setTimeout(() => { btn.textContent = orig; }, 1300);
}

// Strict verification prompt — avoids hallucinating "verified" on post-cutoff / unconfirmed model specs
const SYSTEM_PROMPT = `You are a rigorous fact-checker. Extract every standalone, checkable factual claim from the user's text and verify each against reliable, established knowledge.

STRICT RULES:
1. Skip personal preferences ("I'd pick X over Y"), opinions, greetings, and subjective filler.
2. Mark "verified" ONLY when you are certain every detail (numbers, dates, names, versions) is accurate based on established pre-cutoff facts.
3. Mark "false" when ANY part contradicts established facts, and provide a concise one-sentence "correction".
4. Mark "unverifiable" whenever you are not 100% certain — including events from 2025 or later, unfamiliar or post-cutoff AI/software model versions (such as unconfirmed model numbers, release claims, or token pricing), live rankings, or statements phrased as "Company X claims/states..." whose underlying release or fact you cannot independently confirm. NEVER mark an unfamiliar version or recent claim "verified" just because it sounds plausible.
5. Keep "explanation" direct and concise (1-2 plain sentences).

Return JSON:
{
  "claims": [
    {
      "claim": "Self-contained factual statement",
      "status": "verified" | "unverifiable" | "false",
      "confidence": 0-100,
      "explanation": "1-2 plain sentences",
      "correction": "One corrected sentence when false, otherwise null",
      "source": "Authoritative source name (e.g. Encyclopaedia Britannica, NASA)",
      "sourceUrl": "Specific real URL you are certain exists, or null",
      "category": "Short topic"
    }
  ]
}
Return at most 25 claims. If none exist, return {"claims": []}.`;

async function analyze() {
  const text = textInput.value.trim();
  if (!text) { showError('Paste or select a passage first.'); return; }
  if (text.length < 15) { showError('Enter at least one complete factual sentence.'); return; }
  if (controller) return;

  controller = new AbortController();
  const timer = setTimeout(() => controller && controller.abort('timeout'), TIMEOUT_MS);
  setBusy(true);
  hide(errorEl);
  hide(resultsEl);

  try {
    let claims = await requestClaims(text, controller.signal);
    claims = await enrichSources(claims, controller.signal);
    lastText = text;
    lastClaims = claims;
    displayResults(claims, text);
    store.set({ lastText: text, lastClaims: claims, lastAt: Date.now() });
  } catch (err) {
    if (err && err.name === 'AbortError') {
      if (controller && controller.signal.reason === 'timeout') {
        showError('Check timed out. Try a shorter passage.', true);
      }
    } else {
      showError(err.message || 'Verification failed. Try again.', err.retryable !== false);
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
      throw friendly(navigator.onLine === false ? 'You are offline.' : 'Could not reach the verification service.');
    }

    if (res.ok) {
      const content = payload && payload.choices && payload.choices[0] && payload.choices[0].message && payload.choices[0].message.content;
      const parsed = parseJson(content);
      if (parsed) return normalize(parsed);
      if (attempt < 1) continue;
      throw friendly('Unreadable model output. Retry in a moment.');
    }

    const msg = (payload && payload.error) || '';
    const transient = res.status === 429 || res.status >= 500 || (res.status === 400 && /json/i.test(msg));
    if (transient && attempt < 1) {
      const ra = Math.min(parseInt(res.headers.get('retry-after') || '0', 10) || 0, 15);
      await wait(ra ? ra * 1000 : 1400, signal);
      continue;
    }
    if (res.status === 429) throw friendly('Rate limit reached. Wait a moment and try again.');
    if (res.status === 413) throw friendly('Passage is too long to check in one pass.', false);
    if (res.status >= 500) throw friendly('Verification service is temporarily unavailable.');
    throw friendly(msg || `Request failed (${res.status}).`);
  }
}

async function enrichSources(claims, signal) {
  const targets = claims.filter(c => !c.sourceUrl || /google\.com\/search/i.test(c.sourceUrl)).slice(0, 4);
  if (!targets.length) return claims;
  await Promise.allSettled(targets.map(async c => {
    if (signal && signal.aborted) return;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 2600);
    try {
      const res = await fetch(SEARCH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: c.claim.slice(0, 130) }),
        signal: ctrl.signal
      });
      if (!res.ok) return;
      const data = await res.json().catch(() => null);
      const hit = (data && Array.isArray(data.results) ? data.results : [])
        .map(r => safeUrl(r && r.url))
        .find(Boolean);
      if (hit) c.sourceUrl = hit;
    } catch {
      /* keep fallback */
    } finally {
      clearTimeout(timer);
    }
  }));
  return claims;
}

function safeUrl(u) {
  try {
    const url = new URL(String(u || '').trim());
    if (!/^https?:$/.test(url.protocol)) return null;
    if (/(^|\.)example\.(com|org)$/.test(url.hostname)) return null;
    return url.href;
  } catch { return null; }
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
  try { return JSON.parse(text); } catch { /* fall through */ }
  const m = text.match(/[\[{][\s\S]*[\]}]/);
  if (m) { try { return JSON.parse(m[0]); } catch { /* fall through */ } }
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
      const claim = String(c.claim || c.text).trim();
      const status = normalizeStatus(c.status);
      const url = safeUrl(c.sourceUrl) || ('https://www.google.com/search?q=' + encodeURIComponent(claim.slice(0, 110)));
      return {
        claim,
        status,
        confidence: normalizeConfidence(c.confidence),
        explanation: c.explanation ? String(c.explanation) : '',
        correction: status === 'false' && c.correction && String(c.correction).toLowerCase() !== 'null' ? String(c.correction) : '',
        source: c.source && !/^(unknown|none|n\/a)/i.test(c.source) ? String(c.source) : 'Web search',
        sourceUrl: url,
        category: c.category ? String(c.category) : ''
      };
    });
}

// Rendering
const ICONS = {
  verified: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8.4 6.3 11.7 13 4.6"/></svg>',
  unverifiable: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><circle cx="8" cy="8" r="6"/><path d="M6.5 6.3a1.6 1.6 0 1 1 2.1 1.5c-.4.2-.6.5-.6 1v.3"/><circle cx="8" cy="11.4" r="0.75" fill="currentColor" stroke="none"/></svg>',
  false: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/></svg>'
};
const LABELS = { verified: 'Verified', unverifiable: 'Unverifiable', false: 'False' };
const CLASS = { verified: 'verified', unverifiable: 'unverifiable', false: 'incorrect' };

function verdictMeta(counts, total) {
  if (total === 0 || (counts.verified === 0 && counts.false === 0 && counts.unverifiable > 0)) {
    return { unverifiedOnly: true, score: 0, band: 'mid', label: 'Unverified', title: 'Needs outside verification' };
  }
  const score = Math.round((counts.verified / total) * 100);
  const band = score >= 70 ? 'good' : score >= 40 ? 'mid' : 'bad';
  const title = score >= 70 ? 'Mostly accurate' : score >= 40 ? 'Mixed \u2014 check flagged lines' : 'Mostly inaccurate';
  return { unverifiedOnly: false, score, band, label: `${score}%`, title };
}

function displayResults(claims, text, { instant = false } = {}) {
  lastClaims = claims;
  lastText = text;
  activeFilter = 'all';
  $$('.hh-ftab').forEach(b => {
    const on = b.dataset.filter === 'all';
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  });

  const cleanSnippet = String(text || '').replace(/\s+/g, ' ').trim();
  collapsedSnippet.textContent = cleanSnippet.length > 80 ? cleanSnippet.slice(0, 80) + '\u2026' : cleanSnippet;
  setResultsLayout(true, false);

  const counts = { verified: 0, unverifiable: 0, false: 0 };
  claims.forEach(c => { counts[c.status]++; });
  const total = claims.length;
  const meta = verdictMeta(counts, total);

  resultsEl.dataset.band = meta.band;
  $('#hh-verdict-title').textContent = meta.title;
  $('#hh-verdict-sub').textContent = total
    ? `${counts.verified} of ${total} ${total === 1 ? 'claim' : 'claims'} verified`
    : 'No checkable factual claims found';

  $('#hh-count-all').textContent = total;
  $('#hh-count-verified').textContent = counts.verified;
  $('#hh-count-unverifiable').textContent = counts.unverifiable;
  $('#hh-count-incorrect').textContent = counts.false;

  $('#hh-bd-verified').style.width = total ? `${(counts.verified / total) * 100}%` : '0%';
  $('#hh-bd-unverifiable').style.width = total ? `${(counts.unverifiable / total) * 100}%` : '0%';
  $('#hh-bd-false').style.width = total ? `${(counts.false / total) * 100}%` : '0%';

  const list = $('#hh-claims-list');
  list.innerHTML = '';
  if (!claims.length) {
    list.innerHTML = '<p class="hh-empty">No checkable factual claims found. Opinions and preferences are skipped.</p>';
  }

  claims.forEach((c, i) => {
    const num = String(i + 1).padStart(2, '0');
    const card = document.createElement('article');
    card.className = 'hh-claim-card';
    card.dataset.status = c.status;

    const top = document.createElement('div');
    top.className = 'hh-claim-top';
    top.innerHTML = `
      <span class="hh-claim-idx">${num}</span>
      <span class="hh-status ${CLASS[c.status]}">${ICONS[c.status]}<span>${LABELS[c.status]}</span></span>
      <span class="hh-claim-conf">${c.confidence}%</span>`;
    card.appendChild(top);

    const claimP = document.createElement('p');
    claimP.className = 'hh-claim-text';
    claimP.textContent = c.claim;
    card.appendChild(claimP);

    if (c.correction) {
      const corr = document.createElement('p');
      corr.className = 'hh-claim-correction';
      const strong = document.createElement('strong');
      strong.textContent = 'Correction:';
      corr.appendChild(strong);
      corr.appendChild(document.createTextNode(c.correction));
      card.appendChild(corr);
    }

    if (c.explanation) {
      const exp = document.createElement('p');
      exp.className = 'hh-claim-explain';
      exp.textContent = c.explanation;
      card.appendChild(exp);
    }

    if (c.source) {
      const src = document.createElement('p');
      src.className = 'hh-claim-source';
      const href = safeUrl(c.sourceUrl);
      if (href) {
        const a = document.createElement('a');
        a.href = href;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.textContent = c.source;
        src.appendChild(a);
      } else {
        src.textContent = c.source;
      }
      if (c.category) {
        src.appendChild(document.createTextNode(' \u00b7 ' + c.category));
      }
      card.appendChild(src);
    }

    list.appendChild(card);
  });

  const trustEl = $('#hh-trust-value');
  trustEl.classList.toggle('is-text', meta.unverifiedOnly);
  show(resultsEl);
  $('#hh-main').scrollTop = 0;

  if (meta.unverifiedOnly) {
    trustEl.textContent = 'Unverified';
  } else {
    countUp(trustEl, meta.score, instant);
  }
}

function countUp(el, target, instant) {
  if (instant || matchMedia('(prefers-reduced-motion: reduce)').matches) {
    el.textContent = target + '%';
    return;
  }
  const start = performance.now();
  const dur = 500;
  function step(now) {
    const t = Math.min(1, (now - start) / dur);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = Math.round(target * eased) + '%';
    if (t < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

function reportText() {
  const counts = { verified: 0, unverifiable: 0, false: 0 };
  lastClaims.forEach(c => { counts[c.status]++; });
  const meta = verdictMeta(counts, lastClaims.length);
  const lines = [`Hallucination Hunter Fact-Check — ${meta.label} (${lastClaims.length} claims)`, ''];
  lastClaims.forEach((c, i) => {
    lines.push(`${String(i + 1).padStart(2, '0')}. [${LABELS[c.status]}, ${c.confidence}%] ${c.claim}`);
    if (c.correction) lines.push(`    Correction: ${c.correction}`);
    if (c.explanation) lines.push(`    ${c.explanation}`);
    if (c.source) lines.push(`    Source: ${c.source}${safeUrl(c.sourceUrl) ? ' — ' + c.sourceUrl : ''}`);
  });
  lines.push('', APP_URL);
  return lines.join('\n');
}

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
    }, 3200);
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
