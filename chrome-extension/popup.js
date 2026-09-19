/* ==========================================
   Hallucination Hunter — Popup Logic
   Handles analysis, UI updates, and auto-capture
   ========================================== */

const API_BASE = 'https://hallucination-hunter.vercel.app';
const API_ENDPOINT = `${API_BASE}/api/groq`;

const $ = (sel) => document.querySelector(sel);
const textInput = $('#hh-text-input');
const analyzeBtn = $('#hh-analyze-btn');
const clearBtn = $('#hh-clear-btn');
const loadingEl = $('#hh-loading');
const errorEl = $('#hh-error');
const resultsEl = $('#hh-results');
const autoDetectEl = $('#hh-auto-detect');

// ── On popup open, check for captured/selected text ──
document.addEventListener('DOMContentLoaded', async () => {
  try {
    const data = await chrome.storage.local.get([
      'capturedText', 'capturedAt', 'capturedFrom',
      'selectedText', 'selectedAt'
    ]);

    // Prefer captured (copied) text, fall back to selected text
    const text = data.capturedText || data.selectedText || '';
    const age = Date.now() - (data.capturedAt || data.selectedAt || 0);

    // Only auto-fill if captured within last 5 minutes
    if (text && text.length > 10 && age < 300000) {
      textInput.value = text;
      autoDetectEl.style.display = 'flex';

      // Clear stored text after loading
      chrome.storage.local.set({ capturedText: '', selectedText: '' });
    }
  } catch (e) {
    // Not in extension context (testing in browser)
    console.log('Storage not available:', e.message);
  }
});

// ── Analyze Button ──
analyzeBtn.addEventListener('click', () => {
  const text = textInput.value.trim();
  if (!text) {
    showError('Please enter some text to analyze.');
    return;
  }
  if (text.length < 15) {
    showError('Text is too short. Enter at least one full sentence.');
    return;
  }
  analyzeClaims(text);
});

// ── Clear Button ──
clearBtn.addEventListener('click', () => {
  textInput.value = '';
  resultsEl.style.display = 'none';
  errorEl.style.display = 'none';
  autoDetectEl.style.display = 'none';
  textInput.focus();
});

// ── Enter key shortcut ──
textInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.ctrlKey) {
    analyzeBtn.click();
  }
});

// ── Main Analysis Function ──
async function analyzeClaims(text) {
  showLoading(true);
  hideError();
  resultsEl.style.display = 'none';

  const systemPrompt = `You are a fact-checking AI. Extract ALL factual claims from the given text. For EACH claim, verify it against your knowledge and classify it as:
- "verified" — the claim is factually correct
- "unverifiable" — cannot be confirmed or denied
- "false" — the claim is factually incorrect

Respond ONLY with a valid JSON array. Each object must have:
- "claim": the extracted factual claim (string)
- "status": "verified" | "unverifiable" | "false"
- "confidence": number 0-100
- "explanation": brief reason (string)
- "source": knowledge source used (string)
- "correction": only if status is "false", the correct fact (string or null)
- "category": topic category like "Science", "History", etc.

IMPORTANT: Return ONLY the JSON array, no markdown, no code fences, no extra text.`;

  try {
    const response = await fetch(API_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'openai/gpt-oss-120b',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Analyze this text:\n\n${text}` }
        ],
        temperature: 0.1,
        max_tokens: 4096,
        response_format: { type: 'json_object' }
      })
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`API error ${response.status}: ${err.substring(0, 100)}`);
    }

    const data = await response.json();
    let content = data.choices[0].message.content.trim();

    // Clean response — remove markdown code fences if present
    content = content.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '');

    let claims;
    try {
      claims = JSON.parse(content);
    } catch (parseErr) {
      // Try to extract JSON array from response
      const match = content.match(/\[[\s\S]*\]/);
      if (match) {
        claims = JSON.parse(match[0]);
      } else {
        throw new Error('Could not parse AI response');
      }
    }

    if (!Array.isArray(claims)) {
      claims = [claims];
    }

    displayResults(claims);
  } catch (err) {
    showError(err.message || 'Analysis failed. Please try again.');
  } finally {
    showLoading(false);
  }
}

// ── Display Results ──
function displayResults(claims) {
  const verified = claims.filter(c => c.status === 'verified').length;
  const unverifiable = claims.filter(c => c.status === 'unverifiable').length;
  const incorrect = claims.filter(c => c.status === 'false').length;
  const total = claims.length || 1;

  // Trust score
  const trustScore = Math.round(((verified * 100) + (unverifiable * 50)) / total);

  // Update trust bar
  const trustFill = $('#hh-trust-fill');
  const trustValue = $('#hh-trust-value');
  trustFill.style.width = trustScore + '%';
  trustValue.textContent = trustScore + '%';

  // Update color based on score
  if (trustScore >= 75) {
    trustValue.style.color = '#2e7d32';
  } else if (trustScore >= 50) {
    trustValue.style.color = '#e65100';
  } else {
    trustValue.style.color = '#c62828';
  }

  // Update counts
  $('#hh-count-verified').textContent = verified;
  $('#hh-count-unverifiable').textContent = unverifiable;
  $('#hh-count-incorrect').textContent = incorrect;

  // Build claim cards
  const claimsList = $('#hh-claims-list');
  claimsList.innerHTML = '';

  claims.forEach((claim, i) => {
    const status = claim.status === 'false' ? 'incorrect' : claim.status;
    const statusLabel = status === 'incorrect' ? 'Incorrect' : status === 'verified' ? 'Verified' : 'Unverifiable';

    const badgeIcons = {
      verified: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg>',
      unverifiable: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M12 8v4M12 16h.01"/></svg>',
      incorrect: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M18 6L6 18M6 6l12 12"/></svg>'
    };

    const card = document.createElement('div');
    card.className = 'hh-claim-card';
    card.style.animationDelay = `${i * 0.08}s`;
    card.innerHTML = `
      <div class="hh-claim-top">
        <div class="hh-claim-badge ${status}">${badgeIcons[status]}</div>
        <span class="hh-claim-status ${status}">${statusLabel}</span>
        <span class="hh-claim-conf">${claim.confidence || 0}%</span>
      </div>
      <div class="hh-claim-text">${escapeHtml(claim.claim)}</div>
      ${claim.correction ? `<div class="hh-claim-correction">✦ Correction: ${escapeHtml(claim.correction)}</div>` : ''}
      ${claim.source ? `<div class="hh-claim-source">Source: ${escapeHtml(claim.source)} · ${escapeHtml(claim.category || '')}</div>` : ''}
    `;
    claimsList.appendChild(card);
  });

  resultsEl.style.display = 'block';
}

// ── Helpers ──
function showLoading(show) {
  loadingEl.style.display = show ? 'flex' : 'none';
  analyzeBtn.disabled = show;
}

function showError(msg) {
  $('#hh-error-text').textContent = msg;
  errorEl.style.display = 'block';
}

function hideError() {
  errorEl.style.display = 'none';
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
