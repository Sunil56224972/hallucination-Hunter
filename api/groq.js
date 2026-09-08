// ═══════════════════════════════════════════════════════════════
// Hallucination Hunter — Groq API Proxy
// Security: Rate limiting, Input validation, CORS, Size limits
// ═══════════════════════════════════════════════════════════════

// In-memory rate limiter (resets on cold start — good enough for serverless)
const rateLimit = new Map();

const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 10;      // 10 requests per minute per IP
const MAX_BODY_SIZE_BYTES = 50 * 1024;   // 50 KB max request body
const MAX_PROMPT_LENGTH = 20000;         // 20,000 chars max

function getRateLimitKey(req) {
  return (
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.headers['x-real-ip'] ||
    'unknown'
  );
}

function checkRateLimit(ip) {
  const now = Date.now();
  const record = rateLimit.get(ip);

  if (!record || now - record.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimit.set(ip, { windowStart: now, count: 1 });
    return { allowed: true, remaining: RATE_LIMIT_MAX_REQUESTS - 1 };
  }

  if (record.count >= RATE_LIMIT_MAX_REQUESTS) {
    const retryAfter = Math.ceil((RATE_LIMIT_WINDOW_MS - (now - record.windowStart)) / 1000);
    return { allowed: false, retryAfter };
  }

  record.count++;
  return { allowed: true, remaining: RATE_LIMIT_MAX_REQUESTS - record.count };
}

function setSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  // Only allow requests from our own domain
  res.setHeader('Access-Control-Allow-Origin', 'https://hallucination-hunter-five.vercel.app');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Vary', 'Origin');
}

export default async function handler(req, res) {
  setSecurityHeaders(res);

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── Rate Limiting ──────────────────────────────────────────────
  const ip = getRateLimitKey(req);
  const limit = checkRateLimit(ip);

  res.setHeader('X-RateLimit-Limit', RATE_LIMIT_MAX_REQUESTS);
  res.setHeader('X-RateLimit-Remaining', limit.remaining ?? 0);

  if (!limit.allowed) {
    return res.status(429).json({
      error: `Too many requests. Please wait ${limit.retryAfter} seconds before trying again.`,
      retryAfter: limit.retryAfter
    });
  }

  // ── Request Size Limit ─────────────────────────────────────────
  const bodyStr = JSON.stringify(req.body || {});
  if (bodyStr.length > MAX_BODY_SIZE_BYTES) {
    return res.status(413).json({ error: 'Request too large. Maximum 50KB allowed.' });
  }

  // ── Input Validation ───────────────────────────────────────────
  const { model, messages, temperature, max_tokens } = req.body || {};

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'Invalid request: messages array required.' });
  }

  // Validate each message
  for (const msg of messages) {
    if (!msg.role || !msg.content || typeof msg.content !== 'string') {
      return res.status(400).json({ error: 'Invalid message format.' });
    }
    // Prevent excessively long prompts
    if (msg.content.length > MAX_PROMPT_LENGTH) {
      return res.status(400).json({ error: `Message too long. Maximum ${MAX_PROMPT_LENGTH} characters allowed.` });
    }
    // Only allow safe roles
    if (!['system', 'user', 'assistant'].includes(msg.role)) {
      return res.status(400).json({ error: 'Invalid message role.' });
    }
  }

  // Whitelist allowed models only
  const ALLOWED_MODELS = [
    'llama-3.3-70b-versatile',
    'llama-3.1-8b-instant',
    'llama3-70b-8192',
    'mixtral-8x7b-32768',
    'gemma2-9b-it'
  ];
  if (model && !ALLOWED_MODELS.includes(model)) {
    return res.status(400).json({ error: 'Model not allowed.' });
  }

  // ── API Key ────────────────────────────────────────────────────
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'API key not configured' });
  }

  // ── Proxy to Groq ──────────────────────────────────────────────
  try {
    const safeBody = {
      model: model || 'llama-3.3-70b-versatile',
      messages,
      temperature: typeof temperature === 'number' ? Math.min(Math.max(temperature, 0), 1) : 0.3,
      max_tokens: typeof max_tokens === 'number' ? Math.min(max_tokens, 4096) : 2048,
      stream: false
    };

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(safeBody)
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({ error: `Groq API error (${response.status}): ${JSON.stringify(data)}` });
    }

    return res.status(200).json(data);
  } catch (err) {
    console.error('[groq proxy] error:', err.message);
    return res.status(500).json({ error: 'Proxy request failed. Please try again.' });
  }
}
