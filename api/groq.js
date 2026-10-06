// Hallucination Hunter - Groq API proxy
// Security: Rate limiting, Input validation, CORS, Size limits

const rateLimit = new Map();

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 10;
const MAX_BODY_SIZE_BYTES = 50 * 1024;
const MAX_PROMPT_LENGTH = 20000;
const MAX_OUTPUT_TOKENS = 8192;

// Allowed origins: Vercel deployments, local dev, the Chrome extension and the
// Capacitor Android/iOS shells (which serve the app from https://localhost and
// capacitor://localhost respectively).
const ALLOWED_ORIGINS = [
  /^https:\/\/hallucination-hunter[a-z0-9\-]*\.vercel\.app$/,
  /^https?:\/\/localhost(:\d+)?$/,
  /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
  /^capacitor:\/\/localhost$/,
  /^chrome-extension:\/\/[a-p]{32}$/
];

function getRateLimitKey(req) {
  return (
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.headers['x-real-ip'] ||
    'unknown'
  );
}

function checkRateLimit(ip) {
  const now = Date.now();
  // Drop stale windows so the map cannot grow without bound on a warm instance.
  if (rateLimit.size > 5000) {
    for (const [key, rec] of rateLimit) {
      if (now - rec.windowStart > RATE_LIMIT_WINDOW_MS) rateLimit.delete(key);
    }
  }
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

function isAllowedOrigin(origin) {
  if (!origin) return true; // Allow no-origin (same-origin requests)
  return ALLOWED_ORIGINS.some(pattern => pattern.test(origin));
}

export default async function handler(req, res) {
  const origin = req.headers['origin'] || '';

  // Set CORS header dynamically - only echo back allowed origins
  if (isAllowedOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Expose-Headers', 'Retry-After, X-RateLimit-Remaining');
  res.setHeader('Access-Control-Max-Age', '600');
  res.setHeader('Vary', 'Origin');

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Rate Limiting
  const ip = getRateLimitKey(req);
  const limit = checkRateLimit(ip);
  res.setHeader('X-RateLimit-Limit', RATE_LIMIT_MAX_REQUESTS);
  res.setHeader('X-RateLimit-Remaining', limit.remaining ?? 0);

  if (!limit.allowed) {
    res.setHeader('Retry-After', String(limit.retryAfter));
    return res.status(429).json({
      error: `Too many requests. Please wait ${limit.retryAfter}s before trying again.`,
      retryAfter: limit.retryAfter
    });
  }

  // Request Size Limit
  const bodyStr = JSON.stringify(req.body || {});
  if (bodyStr.length > MAX_BODY_SIZE_BYTES) {
    return res.status(413).json({ error: 'Request too large. Max 50KB.' });
  }

  // Input Validation
  const { model, messages, temperature, max_tokens, reasoning_effort } = req.body || {};

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'Invalid request: messages required.' });
  }

  for (const msg of messages) {
    if (!msg.role || !msg.content || typeof msg.content !== 'string') {
      return res.status(400).json({ error: 'Invalid message format.' });
    }
    if (msg.content.length > MAX_PROMPT_LENGTH) {
      return res.status(400).json({ error: `Message too long. Max ${MAX_PROMPT_LENGTH} chars.` });
    }
    if (!['system', 'user', 'assistant'].includes(msg.role)) {
      return res.status(400).json({ error: 'Invalid message role.' });
    }
  }

  const ALLOWED_MODELS = [
    'openai/gpt-oss-120b',
    'openai/gpt-oss-20b',
    'llama-3.1-8b-instant',
    'qwen/qwen3.6-27b',
    'qwen/qwen3.8-27b',
    'groq/compound',
    'groq/compound-mini'
  ];
  if (model && !ALLOWED_MODELS.includes(model)) {
    return res.status(400).json({ error: 'Model not allowed.' });
  }

  // API Key
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'API key not configured' });
  }

  // Proxy to Groq
  try {
    const safeBody = {
      model: model || 'openai/gpt-oss-120b', // updated from deprecated llama-3.3-70b-versatile
      messages,
      temperature: typeof temperature === 'number' ? Math.min(Math.max(temperature, 0), 1) : 0.3,
      max_tokens: typeof max_tokens === 'number' ? Math.min(Math.max(max_tokens, 256), MAX_OUTPUT_TOKENS) : 4096,
      stream: false
    };

    // gpt-oss models accept a reasoning budget; anything else is ignored.
    if (['low', 'medium', 'high'].includes(reasoning_effort) && String(safeBody.model).startsWith('openai/gpt-oss')) {
      safeBody.reasoning_effort = reasoning_effort;
    }

    // Pass through response_format if client requests JSON mode
    if (req.body.response_format) {
      safeBody.response_format = { type: 'json_object' };
    }

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(safeBody)
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const upstream = data && data.error ? data.error : {};
      const retryAfter = response.headers.get('retry-after');
      if (retryAfter) res.setHeader('Retry-After', retryAfter);
      return res.status(response.status).json({
        error: upstream.message || `Groq API error (${response.status})`,
        code: upstream.code || null
      });
    }
    return res.status(200).json(data);
  } catch (err) {
    console.error('[groq proxy] error:', err.message);
    return res.status(500).json({ error: 'Proxy request failed. Please try again.' });
  }
}
