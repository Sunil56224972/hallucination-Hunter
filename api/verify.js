// Hallucination Hunter — Universal Verification & Database API (/api/verify)
// Powers Agent Skills (Claude, Antigravity, Cursor, Codex), MCP servers,
// ChatGPT Custom GPT Actions, and REST / SDK integrations.

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://jdvafpwancenabxbnxbh.supabase.co';
const SUPABASE_KEY =
  process.env.SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpkdmFmcHdhbmNlbmFieGJueGJoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYxMDMwNjgsImV4cCI6MjEwMTY3OTA2OH0.xVZOUOiO_uDzRLHbZ9jjCjV8bZ8cUpZaQINzIgn6QlA';

const APP_ORIGIN = 'https://hallucination-hunter-five.vercel.app';
const DEFAULT_MODEL = 'openai/gpt-oss-120b';
const MAX_TEXT_LENGTH = 20000;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 20;

const rateBucket = new Map();

function clientIp(req) {
  return (
    req.headers?.['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.headers?.['x-real-ip'] ||
    'unknown'
  );
}

function checkLimit(ip) {
  const now = Date.now();
  if (rateBucket.size > 5000) {
    for (const [k, v] of rateBucket) {
      if (now - v.start > RATE_LIMIT_WINDOW_MS) rateBucket.delete(k);
    }
  }
  const cur = rateBucket.get(ip);
  if (!cur || now - cur.start > RATE_LIMIT_WINDOW_MS) {
    rateBucket.set(ip, { start: now, count: 1 });
    return { allowed: true, remaining: RATE_LIMIT_MAX - 1 };
  }
  if (cur.count >= RATE_LIMIT_MAX) {
    const retryAfter = Math.ceil((RATE_LIMIT_WINDOW_MS - (now - cur.start)) / 1000);
    return { allowed: false, retryAfter };
  }
  cur.count += 1;
  return { allowed: true, remaining: RATE_LIMIT_MAX - cur.count };
}

function sanitizeClient(raw) {
  const cleaned = String(raw || 'skill')
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '')
    .slice(0, 28);
  return cleaned || 'skill';
}

function normalizeStatus(s) {
  const v = String(s || '').toLowerCase().trim();
  if (v === 'verified' || v === 'true' || v === 'correct') return 'verified';
  if (v === 'false' || v === 'incorrect' || v === 'wrong' || v === 'inaccurate') return 'false';
  return 'unverifiable';
}

function normalizeConfidence(n) {
  let v = Number(n);
  if (!Number.isFinite(v)) return 40;
  if (v > 0 && v <= 1) v *= 100;
  return Math.round(Math.max(0, Math.min(100, v)));
}

function safeUrl(u) {
  try {
    const url = new URL(String(u || '').trim());
    if (!/^https?:$/.test(url.protocol)) return null;
    if (/(^|\.)example\.(com|org|net)$/i.test(url.hostname)) return null;
    return url.href;
  } catch {
    return null;
  }
}

export function computeVerdict(claims) {
  const v = claims.filter(c => c.status === 'verified').length;
  const u = claims.filter(c => c.status === 'unverifiable').length;
  const f = claims.filter(c => c.status === 'false').length;
  const total = claims.length;

  const parts = [];
  if (v) parts.push(`${v} verified`);
  if (u) parts.push(`${u} unverifiable`);
  if (f) parts.push(`${f} false`);
  const summary = parts.length ? parts.join(' \u00b7 ') : 'No checkable factual claims';

  if (total === 0 || (v === 0 && f === 0 && u > 0)) {
    return {
      label: total === 0 ? 'No claims' : 'Unverified',
      title: total === 0 ? 'No checkable factual claims' : 'Needs outside verification',
      band: 'unverified',
      trustScore: null,
      dbScore: 0,
      unverifiedOnly: true,
      summary,
      counts: { total, verified: v, unverifiable: u, false: f }
    };
  }

  const score = Math.round((v / total) * 100);
  const band = score >= 70 ? 'good' : score >= 40 ? 'mid' : 'bad';
  const title =
    score >= 70
      ? 'Mostly accurate'
      : score >= 40
        ? 'Mixed \u2014 check flagged lines'
        : 'Mostly inaccurate';

  return {
    label: `${score}%`,
    title,
    band,
    trustScore: score,
    dbScore: score,
    unverifiedOnly: false,
    summary,
    counts: { total, verified: v, unverifiable: u, false: f }
  };
}

function parseJsonObject(raw) {
  const text = String(raw || '').trim();
  if (!text) throw new Error('Empty model output');
  try {
    return JSON.parse(text);
  } catch {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) return JSON.parse(fenced[1].trim());
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start !== -1 && end > start) return JSON.parse(text.slice(start, end + 1));
    throw new Error('Malformed JSON returned by verification model');
  }
}

async function callGroqJson(messages, { apiKey, maxTokens = 6144, effort = 'medium' }) {
  const body = {
    model: DEFAULT_MODEL,
    messages,
    temperature: 0.2,
    max_tokens: maxTokens,
    reasoning_effort: effort,
    response_format: { type: 'json_object' },
    stream: false
  };

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || `Groq API error (${res.status})`;
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  const content = data?.choices?.[0]?.message?.content || '';
  return parseJsonObject(content);
}

const SINGLE_PASS_PROMPT = `You are Hallucination Hunter, a rigorous factual verification engine. Extract every standalone, checkable factual claim from the input text and verify each against established, reliable knowledge.

STRICT RULES:
1. Extract ONLY objective factual claims (skip opinions, personal preferences like "I'd pick X over Y", greetings, questions, or advice).
2. Keep exact numbers, dates, names, versions, and prices intact in each atomic claim. Copy "originalSentence" verbatim from the input.
3. Mark "verified" ONLY when you are 100% certain every detail is factually accurate based on established pre-cutoff knowledge.
4. Mark "false" when ANY detail contradicts established facts, and supply a one-sentence "correction" stating the true fact.
5. Mark "unverifiable" whenever you are not 100% certain — including events from 2025 or later, unfamiliar or post-cutoff AI/software model versions, unconfirmed benchmarks/pricing, live rankings, or "Company X claims..." statements whose underlying release cannot be independently confirmed. NEVER guess "verified".
6. Keep "explanation" direct and plain (1-2 sentences).

Return JSON:
{
  "claims": [
    {
      "id": 1,
      "claim": "Self-contained factual statement",
      "originalSentence": "Exact substring from input",
      "status": "verified" | "unverifiable" | "false",
      "confidence": 0-100,
      "explanation": "1-2 plain sentences with real facts",
      "correction": "One corrected sentence when false, otherwise null",
      "source": "Authoritative organization (e.g. NASA, Encyclopaedia Britannica, Python Software Foundation)",
      "sourceUrl": "Specific real URL you are certain exists, or null",
      "category": "Science | History | Geography | Technology | Health | Mathematics | Politics | Culture | Economics | Sports | General"
    }
  ]
}
Extract at most 25 claims. If no checkable factual claims exist, return {"claims": []}.`;

async function resolveSearchUrl(query) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 2600);
  try {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query + ' fact')}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      signal: ctrl.signal
    });
    if (!res.ok) return null;
    const html = await res.text();
    const linkRegex = /class="result__a"[^>]*href="([^"]+)"[^>]*>([^<]+)/g;
    let m;
    while ((m = linkRegex.exec(html)) !== null) {
      let hit = m[1];
      const title = m[2].trim();
      if (hit.includes('uddg=')) hit = decodeURIComponent(hit.split('uddg=')[1].split('&')[0]);
      if (hit.startsWith('http') && !hit.includes('duckduckgo.com')) {
        return { url: hit, title };
      }
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function supabaseFetch(path, { method = 'GET', body, headers = {} } = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      ...headers
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  return { ok: res.ok, status: res.status, data, headers: res.headers };
}

function extractAnchorTerms(text) {
  const matches = String(text || '').match(/\b([A-Z][a-zA-Z0-9.-]{3,}|\d{4})\b/g) || [];
  const seen = new Set();
  const stop = new Set(['This', 'That', 'There', 'These', 'Those', 'When', 'Where', 'Which', 'While', 'After', 'Before', 'Because', 'However']);
  const out = [];
  for (const raw of matches) {
    if (stop.has(raw)) continue;
    const key = raw.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(raw);
    if (out.length >= 3) break;
  }
  return out;
}

async function lookupPriorClaims(text) {
  const terms = extractAnchorTerms(text);
  if (!terms.length) return [];
  try {
    const orClause = terms
      .map(t => `claim_text.ilike.*${encodeURIComponent(t.replace(/[,()*]/g, ''))}*`)
      .join(',');
    const { ok, data } = await supabaseFetch(
      `claims?select=claim_text,status,confidence,explanation,source_name,source_url,created_at&or=(${orClause})&order=created_at.desc&limit=6`
    );
    if (!ok || !Array.isArray(data)) return [];
    const unique = [];
    const seen = new Set();
    for (const row of data) {
      const k = String(row.claim_text || '').toLowerCase().trim();
      if (!k || seen.has(k)) continue;
      seen.add(k);
      unique.push({
        claim: row.claim_text,
        status: row.status,
        confidence: row.confidence,
        explanation: row.explanation,
        source: row.source_name,
        sourceUrl: row.source_url,
        checkedAt: row.created_at
      });
    }
    return unique;
  } catch {
    return [];
  }
}

async function persistAnalysis({ text, claims, verdict, client }) {
  if (!claims.length) return { saved: false, analysisId: null };
  const userTag = `skill:${client}`;
  try {
    const { ok, data } = await supabaseFetch('analyses', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: {
        input_text: text,
        trust_score: verdict.dbScore,
        total_claims: verdict.counts.total,
        verified_count: verdict.counts.verified,
        unverifiable_count: verdict.counts.unverifiable,
        false_count: verdict.counts.false,
        user_id: userTag,
        model_used: DEFAULT_MODEL
      }
    });
    const analysis = Array.isArray(data) ? data[0] : data;
    if (!ok || !analysis?.id) return { saved: false, analysisId: null };

    const rows = claims.map(c => ({
      analysis_id: analysis.id,
      claim_text: c.claim,
      status: c.status,
      confidence: c.confidence,
      explanation: c.correction ? `${c.explanation}\n\nActually: ${c.correction}` : c.explanation,
      source_name: c.source,
      source_url: c.sourceUrl,
      user_id: userTag
    }));

    const claimInsert = await supabaseFetch('claims', { method: 'POST', body: rows });
    return { saved: claimInsert.ok, analysisId: analysis.id };
  } catch {
    return { saved: false, analysisId: null };
  }
}

function buildMarkdownReport(verdict, claims, inspectUrl, savedToDatabase) {
  const head =
    verdict.trustScore === null
      ? `**Hallucination Hunter \u00b7 ${verdict.label}** (${verdict.title})`
      : `**Hallucination Hunter \u00b7 ${verdict.label} (${verdict.title})**`;
  const syncNote = savedToDatabase ? 'Synced to DB' : 'Checked';
  const lines = [
    '---',
    `${head} \u00b7 ${verdict.summary} \u00b7 ${syncNote} \u00b7 [Inspect inline \u2197](${inspectUrl})`
  ];

  if (!claims.length) {
    lines.push('- No checkable objective claims were found in this passage.');
    return lines.join('\n');
  }

  for (const c of claims) {
    const tag =
      c.status === 'verified'
        ? 'Verified'
        : c.status === 'false'
          ? 'False'
          : 'Unverifiable';
    const cite = c.sourceUrl ? ` ([${c.source}](${c.sourceUrl}))` : c.source ? ` (${c.source})` : '';
    let item = `- **${tag} (${c.confidence}%)** \u2014 ${c.claim} \u2014 ${c.explanation}${cite}`;
    if (c.status === 'false' && c.correction) {
      item += `\n  *Correction:* ${c.correction}`;
    }
    lines.push(item);
  }
  return lines.join('\n');
}

export async function queryVerifiedDatabase({ query = '', status = '', limit = 10 } = {}) {
  const cap = Math.max(1, Math.min(30, Number(limit) || 10));
  const q = String(query || '').trim();
  const st = String(status || '').toLowerCase().trim();

  if (q) {
    const cleaned = encodeURIComponent(q.replace(/[,()*]/g, '').slice(0, 120));
    let path = `claims?select=id,analysis_id,claim_text,status,confidence,explanation,source_name,source_url,user_id,created_at&or=(claim_text.ilike.*${cleaned}*,explanation.ilike.*${cleaned}*,source_name.ilike.*${cleaned}*)&order=created_at.desc&limit=${cap}`;
    if (['verified', 'unverifiable', 'false'].includes(st)) {
      path += `&status=eq.${st}`;
    }
    const { ok, data } = await supabaseFetch(path);
    return {
      ok: true,
      mode: 'search',
      query: q,
      count: Array.isArray(data) ? data.length : 0,
      claims: ok && Array.isArray(data)
        ? data.map(r => ({
            id: r.id,
            analysisId: r.analysis_id,
            claim: r.claim_text,
            status: r.status,
            confidence: r.confidence,
            explanation: r.explanation,
            source: r.source_name,
            sourceUrl: r.source_url,
            origin: String(r.user_id || '').startsWith('skill:') ? r.user_id.slice(6) : 'web',
            checkedAt: r.created_at
          }))
        : []
    };
  }

  const [recentRes, analysesCountRes, claimsCountRes] = await Promise.all([
    supabaseFetch(
      `analyses?select=id,input_text,trust_score,total_claims,verified_count,unverifiable_count,false_count,user_id,created_at&order=created_at.desc&limit=${cap}`
    ),
    supabaseFetch('analyses?select=id', { headers: { Prefer: 'count=exact', Range: '0-0' } }),
    supabaseFetch('claims?select=id', { headers: { Prefer: 'count=exact', Range: '0-0' } })
  ]);

  const parseTotal = res => {
    const cr = res.headers?.get?.('content-range') || '';
    const m = cr.match(/\/(\d+)$/);
    return m ? Number(m[1]) : null;
  };

  return {
    ok: true,
    mode: 'recent',
    database: {
      totalAnalyses: parseTotal(analysesCountRes),
      totalClaims: parseTotal(claimsCountRes),
      region: 'ap-south-1'
    },
    analyses: Array.isArray(recentRes.data)
      ? recentRes.data.map(a => {
          const dummy = [
            ...Array(Number(a.verified_count) || 0).fill({ status: 'verified' }),
            ...Array(Number(a.unverifiable_count) || 0).fill({ status: 'unverifiable' }),
            ...Array(Number(a.false_count) || 0).fill({ status: 'false' })
          ];
          const vm = computeVerdict(dummy);
          return {
            id: a.id,
            excerpt: String(a.input_text || '').slice(0, 220),
            verdictLabel: vm.label,
            verdictTitle: vm.title,
            summary: vm.summary,
            origin: String(a.user_id || '').startsWith('skill:') ? a.user_id.slice(6) : 'web',
            createdAt: a.created_at
          };
        })
      : []
  };
}

export async function runVerification({
  text,
  client = 'skill',
  saveToDatabase = true,
  enrichSources = true,
  lookupDatabase = true,
  callerApiKey = ''
} = {}) {
  const cleaned = String(text || '').trim();
  if (!cleaned || cleaned.length < 15) {
    const err = new Error('Provide at least one complete sentence (15+ characters) to verify.');
    err.status = 400;
    throw err;
  }
  if (cleaned.length > MAX_TEXT_LENGTH) {
    const err = new Error(`Text exceeds maximum length of ${MAX_TEXT_LENGTH} characters.`);
    err.status = 413;
    throw err;
  }

  const apiKey = callerApiKey || process.env.GROQ_API_KEY;
  if (!apiKey) {
    const err = new Error('Server GROQ_API_KEY is not configured.');
    err.status = 500;
    throw err;
  }

  const clientSlug = sanitizeClient(client);

  const [parsed, dbMatches] = await Promise.all([
    callGroqJson(
      [
        { role: 'system', content: SINGLE_PASS_PROMPT },
        { role: 'user', content: cleaned }
      ],
      { apiKey, maxTokens: 6144, effort: 'medium' }
    ),
    lookupDatabase !== false ? lookupPriorClaims(cleaned) : Promise.resolve([])
  ]);

  const rawList = Array.isArray(parsed) ? parsed : parsed.claims || parsed.results || [];
  const claims = rawList
    .filter(c => c && (c.claim || c.text))
    .slice(0, 25)
    .map((c, idx) => {
      const claimText = String(c.claim || c.text).trim();
      const status = normalizeStatus(c.status);
      const source =
        c.source && !/^(unknown|no source|none|n\/a)$/i.test(String(c.source).trim())
          ? String(c.source).trim()
          : 'Web search';
      const url =
        safeUrl(c.sourceUrl) ||
        `https://www.google.com/search?q=${encodeURIComponent(claimText.slice(0, 120))}`;
      const correction =
        status === 'false' && c.correction && String(c.correction).toLowerCase() !== 'null'
          ? String(c.correction).trim()
          : null;
      return {
        id: idx + 1,
        claim: claimText,
        originalSentence: String(c.originalSentence || claimText).trim(),
        status,
        confidence: normalizeConfidence(c.confidence),
        explanation: String(c.explanation || 'No explanation returned.').trim(),
        correction,
        source,
        sourceUrl: url,
        category: String(c.category || 'General').trim()
      };
    });

  if (enrichSources !== false && claims.length > 0) {
    const missing = claims.filter(c => /google\.com\/search/i.test(c.sourceUrl)).slice(0, 5);
    if (missing.length > 0) {
      await Promise.allSettled(
        missing.map(async c => {
          const hit = await resolveSearchUrl(c.claim.slice(0, 140));
          if (hit?.url) {
            c.sourceUrl = hit.url;
            if (c.source === 'Web search' && hit.title) {
              try {
                c.source = new URL(hit.url).hostname.replace(/^www\./i, '');
              } catch {
                /* keep existing */
              }
            }
          }
        })
      );
    }
  }

  const verdict = computeVerdict(claims);
  const persistence =
    saveToDatabase !== false
      ? await persistAnalysis({ text: cleaned, claims, verdict, client: clientSlug })
      : { saved: false, analysisId: null };

  const inspectUrl = `${APP_ORIGIN}/?text=${encodeURIComponent(cleaned.slice(0, 2400))}`;
  const markdownReport = buildMarkdownReport(verdict, claims, inspectUrl, persistence.saved);

  return {
    ok: true,
    client: clientSlug,
    analysisId: persistence.analysisId,
    savedToDatabase: persistence.saved,
    verdict: {
      label: verdict.label,
      title: verdict.title,
      band: verdict.band,
      trustScore: verdict.trustScore,
      unverifiedOnly: verdict.unverifiedOnly,
      summary: verdict.summary
    },
    counts: verdict.counts,
    claims,
    databaseMatches: dbMatches,
    inspectUrl,
    markdownReport
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Client-Name');
  res.setHeader('Access-Control-Expose-Headers', 'Retry-After, X-RateLimit-Remaining');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed. Use GET or POST.' });
  }

  const authHeader = String(req.headers?.authorization || '');
  const bearerKey = authHeader.startsWith('Bearer gsk_') ? authHeader.slice(7).trim() : '';

  if (!bearerKey) {
    const lim = checkLimit(clientIp(req));
    res.setHeader('X-RateLimit-Limit', String(RATE_LIMIT_MAX));
    res.setHeader('X-RateLimit-Remaining', String(lim.remaining ?? 0));
    if (!lim.allowed) {
      res.setHeader('Retry-After', String(lim.retryAfter));
      return res.status(429).json({
        ok: false,
        error: `Rate limit reached. Retry in ${lim.retryAfter}s or pass your own Groq key via Authorization: Bearer gsk_...`,
        retryAfter: lim.retryAfter
      });
    }
  }

  try {
    if (req.method === 'GET') {
      const textParam = req.query?.text;
      if (textParam) {
        const out = await runVerification({
          text: textParam,
          client: req.query?.client || req.headers?.['x-client-name'] || 'get-api',
          saveToDatabase: req.query?.save !== '0' && req.query?.save !== 'false',
          enrichSources: req.query?.enrich !== '0',
          callerApiKey: bearerKey
        });
        return res.status(200).json(out);
      }
      const dbOut = await queryVerifiedDatabase({
        query: req.query?.search || req.query?.q || '',
        status: req.query?.status || '',
        limit: req.query?.limit || 10
      });
      return res.status(200).json(dbOut);
    }

    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    if (body.action === 'search' || (body.query && !body.text)) {
      const dbOut = await queryVerifiedDatabase({
        query: body.query || body.search || '',
        status: body.status || '',
        limit: body.limit || 10
      });
      return res.status(200).json(dbOut);
    }

    const out = await runVerification({
      text: body.text || body.passage || body.content || '',
      client: body.client || req.headers?.['x-client-name'] || 'api',
      saveToDatabase: body.saveToDatabase !== false,
      enrichSources: body.enrichSources !== false,
      lookupDatabase: body.lookupDatabase !== false,
      callerApiKey: bearerKey
    });
    return res.status(200).json(out);
  } catch (err) {
    const code = Number(err.status) || 500;
    return res.status(code).json({
      ok: false,
      error: err.message || 'Verification failed.'
    });
  }
}
