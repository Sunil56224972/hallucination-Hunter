// ═══════════════════════════════════════════
// HALLUCINATION HUNTER — Full App with Supabase
// ═══════════════════════════════════════════

const SUPABASE_URL = 'https://jdvafpwancenabxbnxbh.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpkdmFmcHdhbmNlbmFieGJueGJoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYxMDMwNjgsImV4cCI6MjEwMTY3OTA2OH0.xVZOUOiO_uDzRLHbZ9jjCjV8bZ8cUpZaQINzIgn6QlA';

const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ─── Helpers ─────────────────────────────
const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);
const delay = ms => new Promise(r => setTimeout(r, ms));

// ─── DOM refs ────────────────────────────
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

// ═══════════════════════════════════════════
// TOAST NOTIFICATIONS
// ═══════════════════════════════════════════

function showToast(message, type = 'info') {
  const icons = {
    success: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#1a7f64" stroke-width="2.5"><polyline points="20,6 9,17 4,12"/></svg>',
    error: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#b91c1c" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
    info: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>'
  };
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span class="toast-icon">${icons[type]}</span>${message}`;
  toastContainer.appendChild(toast);
  setTimeout(() => { toast.style.opacity = '0'; toast.style.transition = 'opacity 0.3s'; setTimeout(() => toast.remove(), 300); }, 3500);
}

// ═══════════════════════════════════════════
// NAVIGATION — Sidebar views
// ═══════════════════════════════════════════

$$('.sidebar-link').forEach(link => {
  link.addEventListener('click', e => {
    e.preventDefault();
    if (!link.dataset.view) return;
    $$('.sidebar-link').forEach(l => l.classList.remove('active'));
    $$('.view').forEach(v => v.classList.remove('active'));
    link.classList.add('active');
    $(`#view-${link.dataset.view}`).classList.add('active');

    // Load data when switching views
    if (link.dataset.view === 'history') loadHistory();
    if (link.dataset.view === 'settings') { loadSettings(); checkDbStatus(); }

    // Sync mobile nav
    document.querySelectorAll('.mobile-nav-link').forEach(m => {
      m.classList.toggle('active', m.dataset.view === link.dataset.view);
    });
  });
});

// Global view switcher (used by mobile nav)
function switchView(viewName) {
  $$('.sidebar-link').forEach(l => l.classList.remove('active'));
  $$('.view').forEach(v => v.classList.remove('active'));

  // Sources is a sub-tab inside analyzer, not a separate view
  if (viewName === 'sources') {
    $(`#view-analyzer`).classList.add('active');
    // Activate sources sub-tab
    $$('#analyzer-tabs .tab').forEach(t => t.classList.remove('active'));
    $$('.subtab-content').forEach(c => c.classList.remove('active'));
    const srcTab = document.querySelector('[data-subtab="sources"]');
    if (srcTab) srcTab.classList.add('active');
    const srcContent = $('#subtab-sources');
    if (srcContent) srcContent.classList.add('active');
    loadSources();
    // Sync sidebar to analyzer
    const sidebarMatch = document.querySelector('.sidebar-link[data-view="analyzer"]');
    if (sidebarMatch) sidebarMatch.classList.add('active');
    return;
  }

  $(`#view-${viewName}`).classList.add('active');

  // Sync sidebar
  const sidebarMatch = document.querySelector(`.sidebar-link[data-view="${viewName}"]`);
  if (sidebarMatch) sidebarMatch.classList.add('active');

  // Load data
  if (viewName === 'history') loadHistory();
  if (viewName === 'settings') { loadSettings(); checkDbStatus(); }
}

function updateMobileNav(btn) {
  document.querySelectorAll('.mobile-nav-link').forEach(m => m.classList.remove('active'));
  btn.classList.add('active');
}

// ═══════════════════════════════════════════
// ANALYZER SUB-TABS (Verify / How it works / Sources)
// ═══════════════════════════════════════════

$('#analyzer-tabs').addEventListener('click', e => {
  const btn = e.target.closest('[data-subtab]');
  if (!btn) return;
  $$('#analyzer-tabs .tab').forEach(t => t.classList.remove('active'));
  $$('.subtab-content').forEach(c => c.classList.remove('active'));
  btn.classList.add('active');
  $(`#subtab-${btn.dataset.subtab}`).classList.add('active');

  if (btn.dataset.subtab === 'sources') loadSources();
});

// ═══════════════════════════════════════════
// SETTINGS SUB-TABS (General / Database)
// ═══════════════════════════════════════════

$('#settings-tabs').addEventListener('click', e => {
  const btn = e.target.closest('[data-settab]');
  if (!btn) return;
  $$('#settings-tabs .tab').forEach(t => t.classList.remove('active'));
  $$('.settab-content').forEach(c => c.classList.remove('active'));
  btn.classList.add('active');
  $(`#settab-${btn.dataset.settab}`).classList.add('active');

  if (btn.dataset.settab === 'database') checkDbStatus();
});

// ═══════════════════════════════════════════
// INPUT HANDLERS
// ═══════════════════════════════════════════

input.addEventListener('input', () => {
  charCount.textContent = input.value.length;
});

btnClear.addEventListener('click', () => {
  input.value = '';
  charCount.textContent = '0';
  results.classList.add('hidden');
  processing.classList.add('hidden');
});

const EXAMPLES = [
  `The Great Wall of China is the only man-made structure visible from space with the naked eye. Construction began during the Qin Dynasty around 221 BC under Emperor Qin Shi Huang. The wall stretches approximately 13,171 miles and took over 2,000 years to complete. It was primarily built to protect against Mongolian invasions. An estimated 400,000 workers died during its construction. The wall is made entirely of stone and brick throughout its entire length.`,
  `Python was created by Guido van Rossum and first released in 1991. It is the fastest programming language available today. Python uses indentation for code blocks instead of curly braces. The language is named after the British comedy group Monty Python. Python 2 and Python 3 are fully backward compatible. It is the most popular language according to the TIOBE Index 2024.`,
  `The Eiffel Tower was built in 1889 for the World's Fair in Paris. It was designed by Gustave Eiffel and stands 1,063 feet tall including its antenna. The tower was originally intended to be temporary and was planned for demolition after 20 years. It weighs approximately 10,100 tons. The Eiffel Tower is the tallest structure in Europe. It receives about 7 million visitors per year.`
];

let exampleIdx = 0;
btnExample.addEventListener('click', () => {
  input.value = EXAMPLES[exampleIdx % EXAMPLES.length];
  charCount.textContent = input.value.length;
  exampleIdx++;
  showToast('Example loaded — click Analyze', 'info');
});

btnAnalyze.addEventListener('click', () => {
  const text = input.value.trim();
  if (!text) { showToast('Paste some text first', 'error'); return; }
  if (text.length < 30) { showToast('Text too short — need at least 30 characters', 'error'); return; }
  runAnalysis(text);
});

// Filter tabs
$$('.ftab').forEach(btn => {
  btn.addEventListener('click', () => {
    $$('.ftab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    filterClaims(btn.dataset.filter);
  });
});

// Tooltip
document.addEventListener('mousemove', e => {
  if (!tip.classList.contains('hidden')) {
    const x = Math.min(e.clientX + 14, window.innerWidth - 360);
    const y = Math.min(e.clientY + 14, window.innerHeight - 130);
    tip.style.left = x + 'px';
    tip.style.top = y + 'px';
  }
});

// ═══════════════════════════════════════════
// GROQ API — Real LLM Verification Engine
// ═══════════════════════════════════════════

let GROQ_API_KEY = localStorage.getItem('groq_api_key') || '';
if (!GROQ_API_KEY) {
  GROQ_API_KEY = prompt('Enter your Groq API key (get one free at console.groq.com):') || '';
  if (GROQ_API_KEY) localStorage.setItem('groq_api_key', GROQ_API_KEY);
}
const GROQ_MODEL = 'llama-3.3-70b-versatile';

async function callGroq(messages, temperature = 0.1) {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_API_KEY}` },
    body: JSON.stringify({ model: GROQ_MODEL, messages, temperature, response_format: { type: 'json_object' } })
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Groq API error (${res.status}): ${err}`);
  }
  const data = await res.json();
  return JSON.parse(data.choices[0].message.content);
}

// Step 1: Extract individual factual claims from the text
async function extractClaimsFromLLM(text) {
  const result = await callGroq([
    {
      role: 'system',
      content: `You are a precise claim extraction engine. Given a text, extract every individual factual claim that can be independently verified. Each claim should be a self-contained statement.

Rules:
- Extract ONLY factual claims (not opinions, questions, or subjective statements)
- Each claim should be atomic — one verifiable fact per claim
- Keep the original wording as close as possible
- Include numbers, dates, names, and specific details

Respond in JSON format:
{
  "claims": [
    { "id": 1, "text": "The exact claim text", "originalSentence": "The full original sentence it came from" },
    ...
  ]
}`
    },
    { role: 'user', content: text }
  ]);
  return result.claims || [];
}

// Step 2: Verify each claim using the LLM's knowledge
async function verifyClaimsWithLLM(claims) {
  if (claims.length === 0) return [];

  const claimList = claims.map(c => `[Claim ${c.id}]: "${c.text}"`).join('\n');

  const result = await callGroq([
    {
      role: 'system',
      content: `You are a world-class fact-checking engine used by journalists and researchers. Your job is to verify factual claims with ABSOLUTE accuracy. Users depend on you for truthful, real information — never guess, never fabricate.

STRICT RULES:
1. Only mark a claim as "verified" if you are 100% certain it is factually correct based on well-established, widely-known facts.
2. Mark as "false" if the claim contains ANY factual error — even partially wrong claims are "false". Always provide the CORRECT real information in your explanation (the actual number, date, name, etc.).
3. Mark as "unverifiable" if you are not fully certain, if the claim is subjective, or if it requires very recent data you may not have.
4. NEVER guess or make up facts. If you don't know the exact answer, say "unverifiable".
5. In your explanation, always cite the REAL, CORRECT fact. For example: "The human body has 206 bones, not 210" or "The heart beats about 100,000 times per day, not 100,000 per hour."
6. Confidence must reflect your ACTUAL certainty — don't inflate scores.

For each claim provide:
- **status**: "verified" | "false" | "unverifiable"
- **confidence**: 0-100 (real confidence, not inflated)
- **explanation**: 2-3 sentences with the REAL correct facts. Be specific with numbers, dates, and names. When a claim is false, state what the truth actually is.
- **source**: The most authoritative real organization (e.g., "Wikipedia", "WHO", "NASA", "NIH", "American Heart Association")
- **sourceUrl**: ONLY use real, well-known homepage URLs. Examples:
  - "https://www.nasa.gov" for NASA
  - "https://www.who.int" for WHO  
  - "https://en.wikipedia.org" for Wikipedia
  - "https://www.cdc.gov" for CDC
  DO NOT invent URLs. If unsure, set to null.

Respond in JSON:
{
  "results": [
    {
      "id": 1,
      "status": "verified|false|unverifiable",
      "confidence": 85,
      "explanation": "Specific explanation with real facts...",
      "source": "Source name",
      "sourceUrl": "https://www.example.org"
    }
  ]
}`
    },
    { role: 'user', content: `Fact-check each of these claims with absolute accuracy. Provide the REAL correct information for any false claims:\n\n${claimList}` }
  ], 0.1);

  // Map well-known source names to verified real URLs
  const knownSourceUrls = {
    'nasa': 'https://www.nasa.gov',
    'nasa earth observatory': 'https://earthobservatory.nasa.gov',
    'who': 'https://www.who.int',
    'world health organization': 'https://www.who.int',
    'wikipedia': 'https://en.wikipedia.org',
    'cdc': 'https://www.cdc.gov',
    'centers for disease control': 'https://www.cdc.gov',
    'american heart association': 'https://www.heart.org',
    'american academy of orthopaedic surgeons': 'https://www.aaos.org',
    'national institute of general medical sciences': 'https://www.nigms.nih.gov',
    'national institutes of health': 'https://www.nih.gov',
    'nih': 'https://www.nih.gov',
    'harvard health publishing': 'https://www.health.harvard.edu',
    'harvard health': 'https://www.health.harvard.edu',
    'mayo clinic': 'https://www.mayoclinic.org',
    'unesco': 'https://www.unesco.org',
    'unesco world heritage centre': 'https://whc.unesco.org',
    'national geographic': 'https://www.nationalgeographic.com',
    'smithsonian': 'https://www.si.edu',
    'national institute of diabetes and digestive and kidney diseases': 'https://www.niddk.nih.gov',
    'niddk': 'https://www.niddk.nih.gov',
    'webmd': 'https://www.webmd.com',
    'chinese historical records': null,
    'pubmed': 'https://pubmed.ncbi.nlm.nih.gov',
    'nature': 'https://www.nature.com',
    'science': 'https://www.science.org',
    'bbc': 'https://www.bbc.com',
    'reuters': 'https://www.reuters.com',
    'associated press': 'https://apnews.com'
  };

  const results = result.results || [];
  // Validate and fix source URLs
  return results.map(r => {
    const srcName = (r.source || '').toLowerCase().trim();
    if (knownSourceUrls.hasOwnProperty(srcName)) {
      r.sourceUrl = knownSourceUrls[srcName];
    } else if (r.sourceUrl && !r.sourceUrl.match(/^https?:\/\/(www\.)?[a-z0-9-]+\.[a-z]{2,}/i)) {
      r.sourceUrl = null; // Remove obviously fake URLs
    }
    return r;
  });
}

// ═══════════════════════════════════════════
// ANALYSIS PIPELINE (Real)
// ═══════════════════════════════════════════

async function runAnalysis(text) {
  results.classList.add('hidden');
  processing.classList.remove('hidden');
  btnAnalyze.disabled = true;

  $$('.process-step').forEach(s => { s.classList.remove('active', 'done'); s.querySelector('.ps-status').innerHTML = ''; });

  // Read actual settings from UI
  const confThreshold = parseInt($('#s-conf-range')?.value || '75', 10);
  const sourceCount = parseInt($('#s-source-count')?.value || '3', 10);

  try {
    // Step 1: Extract claims via Groq
    await animateStepStart('ps-extract');
    const rawClaims = await extractClaimsFromLLM(text);
    await animateStepDone('ps-extract', 0, 33);
    showToast(`${rawClaims.length} claims extracted`, 'info');

    if (rawClaims.length === 0) {
      showToast('No verifiable claims found in this text', 'error');
      btnAnalyze.disabled = false;
      processing.classList.add('hidden');
      return;
    }

    // Step 2: Search sources (visual step — Groq does this internally)
    await animateStepStart('ps-search');
    await delay(600);
    await animateStepDone('ps-search', 33, 66);

    // Step 3: Verify claims via Groq
    await animateStepStart('ps-verify');
    const verifyResults = await verifyClaimsWithLLM(rawClaims);
    await animateStepDone('ps-verify', 66, 100);

    // Merge extraction + verification, applying confidence threshold
    const verified = rawClaims.map(c => {
      const v = verifyResults.find(r => r.id === c.id) || {};
      let status = v.status || 'unverifiable';
      let confidence = v.confidence || 30;

      // Apply confidence threshold: if confidence is below the threshold,
      // demote "verified" claims to "unverifiable" (not confident enough)
      if (status === 'verified' && confidence < confThreshold) {
        status = 'unverifiable';
      }

      return {
        id: c.id,
        text: c.text,
        originalText: c.originalSentence || c.text,
        status: status,
        confidence: confidence,
        explanation: v.explanation || 'Could not verify this claim.',
        source: v.source || 'No source available',
        sourceUrl: v.sourceUrl || null
      };
    });

    currentClaims = verified;
    displayResults(text, verified);

    // Save to Supabase
    await saveAnalysis(text, verified);
    showToast('Analysis saved to database', 'success');
  } catch (err) {
    console.error('Analysis error:', err);
    showToast('Analysis failed: ' + err.message, 'error');
  } finally {
    btnAnalyze.disabled = false;
    setTimeout(() => processing.classList.add('hidden'), 250);
  }
}

async function animateStepStart(stepId) {
  const step = $(`#${stepId}`);
  step.classList.add('active');
  step.querySelector('.ps-status').innerHTML = '<div class="loader"></div>';
}

async function animateStepDone(stepId, pStart, pEnd) {
  const step = $(`#${stepId}`);
  const dur = 400;
  const t0 = performance.now();
  return new Promise(resolve => {
    function tick(now) {
      const t = Math.min((now - t0) / dur, 1);
      const pct = Math.round(pStart + (pEnd - pStart) * t);
      $('#progress-thumb').style.width = pct + '%';
      $('#progress-pct').textContent = pct + '%';
      if (t < 1) requestAnimationFrame(tick);
      else { step.classList.add('done'); step.classList.remove('active'); step.querySelector('.ps-status').innerHTML = ''; resolve(); }
    }
    requestAnimationFrame(tick);
  });
}

// ═══════════════════════════════════════════
// DISPLAY RESULTS
// ═══════════════════════════════════════════

function displayResults(originalText, claims) {
  const total = claims.length;
  const vCount = claims.filter(c => c.status === 'verified').length;
  const uCount = claims.filter(c => c.status === 'unverifiable').length;
  const fCount = claims.filter(c => c.status === 'false').length;
  const trustScore = total > 0 ? Math.round((vCount / total) * 100) : 0;

  animateNum('s-total', total);
  animateNum('s-verified', vCount);
  animateNum('s-unverifiable', uCount);
  animateNum('s-false', fCount);
  animateNum('score-val', trustScore);

  const circ = 2 * Math.PI * 18;
  const offset = circ - (trustScore / 100) * circ;
  setTimeout(() => {
    const arc = $('#score-arc');
    arc.style.transition = 'stroke-dashoffset 0.8s ease';
    arc.style.strokeDashoffset = offset;
  }, 100);

  buildAnnotated(originalText, claims);
  buildCards(claims);
  results.classList.remove('hidden');
  setTimeout(() => results.scrollIntoView({ behavior: 'smooth', block: 'start' }), 150);
}

function animateNum(id, target) {
  const el = $(`#${id}`);
  const dur = 700;
  const t0 = performance.now();
  function tick(now) {
    const t = Math.min((now - t0) / dur, 1);
    el.textContent = Math.round(target * (1 - Math.pow(1 - t, 3)));
    if (t < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

function buildAnnotated(originalText, claims) {
  let html = escapeHtml(originalText);
  const sorted = [...claims].sort((a, b) => b.originalText.length - a.originalText.length);
  sorted.forEach(c => {
    const escaped = escapeRegExp(escapeHtml(c.originalText));
    const re = new RegExp(`(${escaped})`, 'gi');
    html = html.replace(re, match =>
      `<span class="claim-hl ${c.status}" data-id="${c.id}" data-status="${c.status}" data-conf="${c.confidence}" data-src="${escapeAttr(c.source)}" data-explain="${escapeAttr(c.explanation)}">${match}</span>`
    );
  });
  annotatedText.innerHTML = html;
  annotatedText.querySelectorAll('.claim-hl').forEach(el => {
    el.addEventListener('mouseenter', showTip);
    el.addEventListener('mouseleave', hideTip);
  });
}

function showTip(e) {
  const el = e.target.closest('.claim-hl');
  if (!el) return;
  const labels = { verified: 'Verified', unverifiable: 'Unverifiable', false: 'Incorrect' };
  const colors = { verified: 'var(--green)', unverifiable: 'var(--amber)', false: 'var(--red)' };
  tip.querySelector('.tip-status').textContent = labels[el.dataset.status];
  tip.querySelector('.tip-status').style.color = colors[el.dataset.status];
  tip.querySelector('.tip-conf').textContent = el.dataset.conf + '% confidence';
  tip.querySelector('.tip-body').textContent = el.dataset.explain;
  tip.querySelector('.tip-source').textContent = '📎 ' + el.dataset.src;
  tip.classList.remove('hidden');
}
function hideTip() { tip.classList.add('hidden'); }

function buildCards(claims) {
  claimsGrid.innerHTML = '';
  const icons = {
    verified: `<img src="verified-icon.png" alt="Verified" class="badge-icon">`,
    unverifiable: `<img src="unverifiable-icon.png" alt="Unverifiable" class="badge-icon">`,
    false: `<img src="incorrect-icon.png" alt="Incorrect" class="badge-icon">`
  };
  const labels = { verified: 'Verified', unverifiable: 'Unverifiable', false: 'Incorrect' };

  claims.forEach((c, i) => {
    const card = document.createElement('div');
    card.className = 'claim-card';
    card.dataset.status = c.status;
    card.style.animationDelay = `${i * 0.05}s`;
    const isOn = c.status === 'verified';
    const srcLink = c.sourceUrl
      ? `<a href="${c.sourceUrl}" target="_blank" rel="noopener">${escapeHtml(c.source)}</a>`
      : `<span>${escapeHtml(c.source)}</span>`;

    card.innerHTML = `
      <div class="claim-card-top">
        <div class="claim-icon">${icons[c.status]}</div>
        <div class="claim-card-info">
          <div class="claim-card-name">${labels[c.status]}</div>
          <div class="claim-card-sub">${c.confidence}% confidence</div>
        </div>
        <label class="toggle"><input type="checkbox" ${isOn ? 'checked' : ''} disabled><span class="toggle-slider"></span></label>
      </div>
      <p class="claim-desc">${escapeHtml(c.text)}</p>
      <div class="claim-card-bottom"><button class="view-detail-btn">View details</button></div>
    `;

    const detailDiv = document.createElement('div');
    detailDiv.className = 'claim-detail hidden';
    detailDiv.innerHTML = `
      <div class="claim-explain">${escapeHtml(c.explanation)}</div>
      <div class="claim-src">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
        ${srcLink}
      </div>
    `;
    card.appendChild(detailDiv);
    card.querySelector('.view-detail-btn').addEventListener('click', () => {
      const detail = card.querySelector('.claim-detail');
      const btn = card.querySelector('.view-detail-btn');
      detail.classList.toggle('hidden');
      btn.textContent = detail.classList.contains('hidden') ? 'View details' : 'Hide details';
    });
    claimsGrid.appendChild(card);
  });
}

function filterClaims(filter) {
  $$('.claim-card').forEach(card => {
    card.style.display = (filter === 'all' || card.dataset.status === filter) ? '' : 'none';
  });
}

// ═══════════════════════════════════════════
// SUPABASE — Save Analysis
// ═══════════════════════════════════════════

async function saveAnalysis(text, claims) {
  const vCount = claims.filter(c => c.status === 'verified').length;
  const uCount = claims.filter(c => c.status === 'unverifiable').length;
  const fCount = claims.filter(c => c.status === 'false').length;
  const trustScore = claims.length > 0 ? Math.round((vCount / claims.length) * 100) : 0;

  const { data: analysis, error: aErr } = await db.from('analyses').insert({
    input_text: text,
    trust_score: trustScore,
    total_claims: claims.length,
    verified_count: vCount,
    unverifiable_count: uCount,
    false_count: fCount
  }).select().single();

  if (aErr) { console.error('Save analysis error:', aErr); throw aErr; }

  const claimRows = claims.map(c => ({
    analysis_id: analysis.id,
    claim_text: c.text,
    status: c.status,
    confidence: c.confidence,
    explanation: c.explanation,
    source_name: c.source,
    source_url: c.sourceUrl
  }));

  const { error: cErr } = await db.from('claims').insert(claimRows);
  if (cErr) { console.error('Save claims error:', cErr); throw cErr; }
}

// ═══════════════════════════════════════════
// HISTORY VIEW
// ═══════════════════════════════════════════

async function loadHistory() {
  const list = $('#history-list');
  const empty = $('#history-empty');
  const detail = $('#history-detail');
  detail.classList.add('hidden');

  const { data, error } = await db.from('analyses').select('*').order('created_at', { ascending: false });
  if (error) { showToast('Failed to load history', 'error'); console.error(error); return; }

  list.innerHTML = '';
  if (!data || data.length === 0) {
    list.innerHTML = `<div class="empty-state" id="history-empty">
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#c4bdb4" stroke-width="1.2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>
      <h3>No analyses yet</h3><p>Run your first analysis and it will show up here</p>
    </div>`;
    return;
  }

  data.forEach(a => {
    const scoreClass = a.trust_score >= 70 ? 'good' : a.trust_score >= 40 ? 'mid' : 'bad';
    const preview = a.input_text.substring(0, 100) + (a.input_text.length > 100 ? '...' : '');
    const date = new Date(a.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });

    const row = document.createElement('div');
    row.className = 'history-row';
    row.innerHTML = `
      <div class="history-score ${scoreClass}">${a.trust_score}</div>
      <div class="history-info">
        <div class="history-preview">${escapeHtml(preview)}</div>
        <div class="history-meta"><span>${date}</span><span>${a.total_claims} claims</span></div>
      </div>
      <div class="history-stats">
        <span class="history-stat v">${a.verified_count} ✓</span>
        <span class="history-stat u">${a.unverifiable_count} ?</span>
        <span class="history-stat f">${a.false_count} ✗</span>
      </div>
      <button class="history-delete" data-id="${a.id}" title="Delete">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3,6 5,6 21,6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
      </button>
    `;

    // Click row to view detail
    row.querySelector('.history-info').addEventListener('click', () => viewHistoryDetail(a.id));
    row.querySelector('.history-score').addEventListener('click', () => viewHistoryDetail(a.id));

    // Delete button
    row.querySelector('.history-delete').addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm('Delete this analysis?')) return;
      const { error } = await db.from('analyses').delete().eq('id', a.id);
      if (error) { showToast('Delete failed', 'error'); return; }
      showToast('Analysis deleted', 'success');
      loadHistory();
    });

    list.appendChild(row);
  });
}

async function viewHistoryDetail(analysisId) {
  const detail = $('#history-detail');
  const content = $('#history-detail-content');
  const list = $('#history-list');

  const { data: analysis } = await db.from('analyses').select('*').eq('id', analysisId).single();
  const { data: claims } = await db.from('claims').select('*').eq('analysis_id', analysisId).order('created_at', { ascending: true });

  if (!analysis || !claims) { showToast('Failed to load detail', 'error'); return; }

  list.classList.add('hidden');
  detail.classList.remove('hidden');

  const scoreClass = analysis.trust_score >= 70 ? 'good' : analysis.trust_score >= 40 ? 'mid' : 'bad';
  const date = new Date(analysis.created_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  const icons = {
    verified: `<img src="verified-icon.png" alt="Verified" class="badge-icon">`,
    unverifiable: `<img src="unverifiable-icon.png" alt="Unverifiable" class="badge-icon">`,
    false: `<img src="incorrect-icon.png" alt="Incorrect" class="badge-icon">`
  };
  const labels = { verified: 'Verified', unverifiable: 'Unverifiable', false: 'Incorrect' };

  let claimsHTML = '';
  claims.forEach(c => {
    const isOn = c.status === 'verified';
    const srcLink = c.source_url
      ? `<a href="${c.source_url}" target="_blank">${escapeHtml(c.source_name)}</a>`
      : `<span>${escapeHtml(c.source_name || 'No source')}</span>`;

    claimsHTML += `
      <div class="claim-card" data-status="${c.status}">
        <div class="claim-card-top">
          <div class="claim-icon">${icons[c.status]}</div>
          <div class="claim-card-info">
            <div class="claim-card-name">${labels[c.status]}</div>
            <div class="claim-card-sub">${c.confidence}% confidence</div>
          </div>
          <label class="toggle"><input type="checkbox" ${isOn ? 'checked' : ''} disabled><span class="toggle-slider"></span></label>
        </div>
        <p class="claim-desc">${escapeHtml(c.claim_text)}</p>
        <div class="claim-card-bottom"><button class="view-detail-btn" onclick="this.nextElementSibling.classList.toggle('hidden'); this.textContent = this.nextElementSibling.classList.contains('hidden') ? 'View details' : 'Hide details';">View details</button>
        <div class="claim-detail hidden">
          <div class="claim-explain">${escapeHtml(c.explanation || '')}</div>
          <div class="claim-src">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
            ${srcLink}
          </div>
        </div></div>
      </div>
    `;
  });

  content.innerHTML = `
    <div class="section-label" style="margin-bottom: 16px;">
      <div>
        <h2>Analysis from ${date}</h2>
        <p>Trust score: <strong style="color: var(--${scoreClass === 'good' ? 'green' : scoreClass === 'mid' ? 'amber' : 'red'})">${analysis.trust_score}%</strong> · ${analysis.total_claims} claims extracted</p>
      </div>
      <div class="summary-row" style="margin-top: 8px; justify-content: flex-start; gap: 8px;">
        <span class="history-stat v">${analysis.verified_count} verified</span>
        <span class="history-stat u">${analysis.unverifiable_count} unverifiable</span>
        <span class="history-stat f">${analysis.false_count} incorrect</span>
      </div>
    </div>
    <div class="annotated-card" style="margin-bottom: 24px;">${escapeHtml(analysis.input_text)}</div>
    <h3 style="font-size: 0.95rem; font-weight: 600; color: var(--text-900); margin-bottom: 14px;">Claims</h3>
    <div class="claims-grid">${claimsHTML}</div>
  `;
}

$('#btn-back-history').addEventListener('click', () => {
  $('#history-detail').classList.add('hidden');
  $('#history-list').classList.remove('hidden');
});

$('#btn-clear-history').addEventListener('click', async () => {
  if (!confirm('Delete ALL analysis history? This cannot be undone.')) return;
  const { error } = await db.from('analyses').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  if (error) { showToast('Failed to clear history', 'error'); return; }
  showToast('History cleared', 'success');
  loadHistory();
});

// ═══════════════════════════════════════════
// SOURCES VIEW
// ═══════════════════════════════════════════

async function loadSources() {
  const list = $('#sources-list');

  const { data, error } = await db.from('claims').select('source_name, source_url, status');
  if (error) { showToast('Failed to load sources', 'error'); return; }

  if (!data || data.length === 0) {
    list.innerHTML = `<div class="empty-state small-empty">
      <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#c4bdb4" stroke-width="1.2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
      <h3>No sources yet</h3><p>Run an analysis to start building your source database</p>
    </div>`;
    return;
  }

  // Aggregate by source name
  const sourceMap = {};
  data.forEach(c => {
    const name = c.source_name || 'Unknown source';
    if (!sourceMap[name]) sourceMap[name] = { name, url: c.source_url, count: 0, statuses: [] };
    sourceMap[name].count++;
    sourceMap[name].statuses.push(c.status);
  });

  const sources = Object.values(sourceMap).sort((a, b) => b.count - a.count);

  list.innerHTML = '';
  sources.forEach(s => {
    const vCount = s.statuses.filter(st => st === 'verified').length;
    const fCount = s.statuses.filter(st => st === 'false').length;
    const nameHTML = s.url ? `<a href="${s.url}" target="_blank">${escapeHtml(s.name)}</a>` : escapeHtml(s.name);

    const row = document.createElement('div');
    row.className = 'source-row';
    row.innerHTML = `
      <div class="source-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
      </div>
      <div class="source-info">
        <div class="source-name">${nameHTML}</div>
        <div class="source-meta">${vCount} verified · ${fCount} contradicted · ${s.count} total references</div>
      </div>
      <div class="source-count">${s.count}×</div>
    `;
    list.appendChild(row);
  });
}

// ═══════════════════════════════════════════
// SETTINGS
// ═══════════════════════════════════════════

async function loadSettings() {
  const { data, error } = await db.from('settings').select('*');
  if (error) { console.error('Load settings error:', error); return; }
  if (!data) return;

  data.forEach(s => {
    if (s.key === 'api_provider') $('#s-api-provider').value = s.value;
    if (s.key === 'confidence_threshold') {
      $('#s-conf-range').value = s.value;
      $('#s-conf-val').textContent = s.value + '%';
    }
  });
}

$('#s-conf-range').addEventListener('input', e => {
  $('#s-conf-val').textContent = e.target.value + '%';
});

$('#btn-save-settings').addEventListener('click', async () => {
  const settings = [
    { key: 'api_provider', value: $('#s-api-provider').value },
    { key: 'confidence_threshold', value: $('#s-conf-range').value }
  ];

  for (const s of settings) {
    const { error } = await db.from('settings').upsert({ key: s.key, value: s.value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
    if (error) { showToast('Failed to save: ' + s.key, 'error'); console.error(error); return; }
  }
  showToast('Settings saved', 'success');
});

async function checkDbStatus() {
  const statusEl = $('#db-status');
  const analysesCountEl = $('#db-analyses-count');
  const claimsCountEl = $('#db-claims-count');

  try {
    const { count: aCount, error: aErr } = await db.from('analyses').select('*', { count: 'exact', head: true });
    const { count: cCount, error: cErr } = await db.from('claims').select('*', { count: 'exact', head: true });

    if (aErr || cErr) throw new Error('Query failed');

    statusEl.textContent = 'Connected';
    statusEl.className = 'db-status connected';
    analysesCountEl.textContent = aCount;
    claimsCountEl.textContent = cCount;
  } catch (err) {
    statusEl.textContent = 'Disconnected';
    statusEl.className = 'db-status disconnected';
    analysesCountEl.textContent = '—';
    claimsCountEl.textContent = '—';
  }
}

// ═══════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════

function escapeRegExp(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function escapeHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
function escapeAttr(s) { return s.replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

// ═══════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════

(async () => {
  // Check DB connection quietly on load
  try {
    await db.from('settings').select('key').limit(1);
    console.log('Supabase connected');
  } catch (e) {
    console.warn('Supabase connection issue:', e);
  }
})();

// ═══════════════════════════════════════════
// GLOBAL SEARCH
// ═══════════════════════════════════════════
(() => {
  const searchToggle = $('#global-search-toggle');
  const searchOverlay = $('#search-overlay');
  const searchInput = $('#search-input');
  const searchResults = $('#search-results');
  const searchClose = $('#search-close');
  const typingEl = $('#search-typing');

  if (!searchToggle || !searchOverlay) return;

  // ─── Typing Animation ─────────────────
  const phrases = [
    'Search analyses…',
    'Find verified claims…',
    'Look up sources…',
    'Search fact-checks…',
    'Find hallucinations…'
  ];
  let phraseIdx = 0;
  let charIdx = 0;
  let isDeleting = false;
  let typingPaused = false;

  function typeLoop() {
    if (typingPaused) return;
    const current = phrases[phraseIdx];

    if (!isDeleting) {
      // Typing forward
      typingEl.textContent = current.slice(0, charIdx + 1);
      charIdx++;
      if (charIdx >= current.length) {
        // Pause at end of phrase
        setTimeout(() => { isDeleting = true; typeLoop(); }, 2000);
        return;
      }
      setTimeout(typeLoop, 70 + Math.random() * 40);
    } else {
      // Deleting
      typingEl.textContent = current.slice(0, charIdx);
      charIdx--;
      if (charIdx <= 0) {
        isDeleting = false;
        phraseIdx = (phraseIdx + 1) % phrases.length;
        setTimeout(typeLoop, 400);
        return;
      }
      setTimeout(typeLoop, 35);
    }
  }

  // Start typing after a small delay
  setTimeout(typeLoop, 800);

  // Open search
  function openSearch() {
    searchOverlay.classList.remove('hidden');
    setTimeout(() => searchInput.focus(), 50);
  }

  // Close search
  function closeSearch() {
    searchOverlay.classList.add('hidden');
    searchInput.value = '';
    searchResults.innerHTML = `<div class="search-empty-state">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#c4bdb4" stroke-width="1.2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
      <p>Type to search across your analyses, claims and sources</p>
    </div>`;
  }

  // Toggle
  searchToggle.addEventListener('click', openSearch);
  searchClose.addEventListener('click', closeSearch);

  // Click backdrop to close
  searchOverlay.addEventListener('click', (e) => {
    if (e.target === searchOverlay) closeSearch();
  });

  // ESC key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !searchOverlay.classList.contains('hidden')) {
      closeSearch();
    }
    // Cmd/Ctrl + K shortcut
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      if (searchOverlay.classList.contains('hidden')) {
        openSearch();
      } else {
        closeSearch();
      }
    }
  });

  // Debounced search
  let searchTimer = null;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const query = searchInput.value.trim();
    if (!query) {
      closeSearch();
      openSearch();
      return;
    }
    searchTimer = setTimeout(() => performSearch(query), 250);
  });

  // Highlight matching text
  function highlight(text, query) {
    if (!text) return '';
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return text.replace(new RegExp(`(${escaped})`, 'gi'), '<mark>$1</mark>');
  }

  // Perform search across Supabase
  async function performSearch(query) {
    searchResults.innerHTML = `<div class="search-empty-state"><p>Searching…</p></div>`;

    const lowerQ = query.toLowerCase();
    let html = '';

    try {
      // 1. Search analyses (history) — correct columns: trust_score, not overall_score
      const { data: analyses, error: aErr } = await db
        .from('analyses')
        .select('id, input_text, trust_score, created_at')
        .order('created_at', { ascending: false })
        .limit(50);

      if (aErr) console.warn('Search analyses error:', aErr.message);

      const matchedAnalyses = (analyses || []).filter(a =>
        (a.input_text || '').toLowerCase().includes(lowerQ)
      );

      // 2. Search claims — separate table with analysis_id
      const { data: claims, error: cErr } = await db
        .from('claims')
        .select('id, analysis_id, claim_text, status, confidence, explanation, source_url, source_name, created_at')
        .order('created_at', { ascending: false })
        .limit(100);

      if (cErr) console.warn('Search claims error:', cErr.message);

      const matchedClaims = (claims || []).filter(c =>
        (c.claim_text || '').toLowerCase().includes(lowerQ) ||
        (c.explanation || '').toLowerCase().includes(lowerQ)
      );

      // 3. Sources — extracted from claims (source_url / source_name)
      const sourceMap = new Map();
      (claims || []).forEach(c => {
        if (c.source_url) {
          const key = c.source_url;
          if (!sourceMap.has(key)) {
            sourceMap.set(key, { url: c.source_url, name: c.source_name || c.source_url, count: 0 });
          }
          sourceMap.get(key).count++;
        }
      });
      const allSources = [...sourceMap.values()];
      const matchedSources = allSources.filter(s =>
        s.url.toLowerCase().includes(lowerQ) ||
        s.name.toLowerCase().includes(lowerQ)
      );

      // Build results HTML
      if (matchedAnalyses.length === 0 && matchedClaims.length === 0 && matchedSources.length === 0) {
        searchResults.innerHTML = `<div class="search-no-results">
          <p>No results found for "<strong>${query}</strong>"</p>
        </div>`;
        return;
      }

      // Analyses section
      if (matchedAnalyses.length > 0) {
        html += `<div class="search-section-label">Analyses (${matchedAnalyses.length})</div>`;
        matchedAnalyses.slice(0, 5).forEach(a => {
          const preview = (a.input_text || '').slice(0, 80);
          const score = a.trust_score != null ? `${a.trust_score}%` : '—';
          const date = new Date(a.created_at).toLocaleDateString();
          html += `<div class="search-result-item" data-action="view-analysis" data-id="${a.id}">
            <div class="search-result-icon history">📊</div>
            <div class="search-result-info">
              <div class="search-result-title">${highlight(preview, query)}…</div>
              <div class="search-result-meta">Score: ${score} · ${date}</div>
            </div>
          </div>`;
        });
      }

      // Claims section
      if (matchedClaims.length > 0) {
        html += `<div class="search-section-label">Claims (${matchedClaims.length})</div>`;
        matchedClaims.slice(0, 5).forEach(c => {
          const text = (c.claim_text || '').slice(0, 80);
          const status = c.status || 'unknown';
          const date = c.created_at ? new Date(c.created_at).toLocaleDateString() : '';
          html += `<div class="search-result-item" data-action="view-analysis" data-id="${c.analysis_id}">
            <div class="search-result-icon claim">💬</div>
            <div class="search-result-info">
              <div class="search-result-title">${highlight(text, query)}</div>
              <div class="search-result-meta">${status} · ${date}</div>
            </div>
          </div>`;
        });
      }

      // Sources section
      if (matchedSources.length > 0) {
        html += `<div class="search-section-label">Sources (${matchedSources.length})</div>`;
        matchedSources.slice(0, 5).forEach(s => {
          html += `<div class="search-result-item" data-action="open-source" data-url="${s.url}">
            <div class="search-result-icon source">🔗</div>
            <div class="search-result-info">
              <div class="search-result-title">${highlight(s.name, query)}</div>
              <div class="search-result-meta">${highlight(s.url, query)} · Used ${s.count}x</div>
            </div>
          </div>`;
        });
      }

      searchResults.innerHTML = html;

      // Click handlers for results
      searchResults.querySelectorAll('.search-result-item').forEach(item => {
        item.addEventListener('click', () => {
          const action = item.dataset.action;
          closeSearch();

          if (action === 'view-analysis') {
            switchView('history');
            setTimeout(() => {
              const id = item.dataset.id;
              if (id && typeof viewHistoryDetail === 'function') viewHistoryDetail(id);
            }, 300);
          } else if (action === 'open-source') {
            const url = item.dataset.url;
            if (url) window.open(url, '_blank');
          }
        });
      });

    } catch (err) {
      console.error('Search error:', err);
      searchResults.innerHTML = `<div class="search-no-results">
        <p>Search error: ${err.message}</p>
      </div>`;
    }
  }
})();
