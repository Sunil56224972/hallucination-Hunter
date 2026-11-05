#!/usr/bin/env node
// Hallucination Hunter — Zero-dependency Stdio MCP Server (Node 18+)
// Connects Claude Desktop, Antigravity, Claude Code, Cursor, Windsurf, or Cline
// to the Hallucination Hunter verification engine and Supabase Postgres ledger.

const BASE_URL = (process.env.HALLUCINATION_HUNTER_URL || 'https://hallucination-hunter-five.vercel.app').replace(/\/+$/, '');
const GROQ_KEY = process.env.GROQ_API_KEY || '';
const CLIENT_NAME = process.env.HH_CLIENT || 'mcp-stdio';

const SERVER_INFO = { name: 'hallucination-hunter', version: '1.2.0' };
const SUPPORTED_PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];

const TOOLS = [
  {
    name: 'verify_llm_response',
    title: 'Verify LLM Response & Sync to Hallucination Hunter DB',
    description:
      'Extract atomic factual claims from an LLM draft or passage, verify each claim against established knowledge and live web sources, cross-check and store results in the Hallucination Hunter Supabase database, and return structured verdicts plus a ready-to-append Markdown audit block to display alongside your answer.',
    inputSchema: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'The LLM answer, draft, or factual passage to verify (15 to 20,000 characters).'
        },
        client: {
          type: 'string',
          description: 'Calling assistant name (e.g. "antigravity", "claude", "cursor").'
        },
        saveToDatabase: {
          type: 'boolean',
          description: 'Save check and claims to the Hallucination Hunter Supabase database (default: true).'
        }
      },
      required: ['text']
    }
  },
  {
    name: 'search_factcheck_database',
    title: 'Search Hallucination Hunter Fact-Check Database',
    description:
      'Query the shared Hallucination Hunter Supabase Postgres database of verified, unverifiable, and false claims and cited sources. Omit query for totals and recent checks.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Keyword, entity, claim fragment, or source domain to search.'
        },
        status: {
          type: 'string',
          enum: ['verified', 'unverifiable', 'false'],
          description: 'Optional status filter.'
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 30,
          description: 'Maximum rows to return (default: 10).'
        }
      }
    }
  }
];

async function callVerifyApi(payload) {
  const headers = { 'Content-Type': 'application/json' };
  if (GROQ_KEY.startsWith('gsk_')) {
    headers.Authorization = `Bearer ${GROQ_KEY}`;
  }
  const res = await fetch(`${BASE_URL}/api/verify`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    throw new Error(data.error || `API HTTP ${res.status}`);
  }
  return data;
}

async function handleRpc(msg) {
  if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0') return null;
  if (msg.id === undefined) return null; // notification

  const { id, method, params = {} } = msg;

  try {
    if (method === 'initialize') {
      const requested = String(params.protocolVersion || '');
      const protocolVersion = SUPPORTED_PROTOCOLS.includes(requested) ? requested : '2025-03-26';
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion,
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
          instructions:
            'Call verify_llm_response to check factual claims in your draft or user passage, then append the returned markdownReport block underneath your answer.'
        }
      };
    }

    if (method === 'ping') {
      return { jsonrpc: '2.0', id, result: {} };
    }

    if (method === 'tools/list') {
      return { jsonrpc: '2.0', id, result: { tools: TOOLS } };
    }

    if (method === 'tools/call') {
      const name = params.name;
      const args = params.arguments || {};

      if (name === 'verify_llm_response') {
        const out = await callVerifyApi({
          text: args.text,
          client: args.client || CLIENT_NAME,
          saveToDatabase: args.saveToDatabase !== false
        });
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: out.markdownReport }],
            structuredContent: out,
            isError: false
          }
        };
      }

      if (name === 'search_factcheck_database') {
        const out = await callVerifyApi({
          action: 'search',
          query: args.query || '',
          status: args.status || '',
          limit: args.limit || 10
        });
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: JSON.stringify(out, null, 2) }],
            structuredContent: out,
            isError: false
          }
        };
      }

      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32602, message: `Unknown tool: ${name}` }
      };
    }

    return {
      jsonrpc: '2.0',
      id,
      error: { code: -32601, message: `Method not found: ${method}` }
    };
  } catch (err) {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        content: [{ type: 'text', text: `Verification error: ${err.message}` }],
        isError: true
      }
    };
  }
}

let useContentLength = false;

function writeMessage(obj) {
  if (!obj) return;
  const json = JSON.stringify(obj);
  if (useContentLength) {
    const len = Buffer.byteLength(json, 'utf8');
    process.stdout.write(`Content-Length: ${len}\r\n\r\n${json}`);
  } else {
    process.stdout.write(`${json}\n`);
  }
}

let buffer = Buffer.alloc(0);

async function drainBuffer() {
  while (buffer.length > 0) {
    const preview = buffer.slice(0, 32).toString('utf8');
    if (/^Content-Length:/i.test(preview)) {
      useContentLength = true;
      const sep = buffer.indexOf('\r\n\r\n');
      if (sep === -1) return;
      const header = buffer.slice(0, sep).toString('utf8');
      const m = header.match(/Content-Length:\s*(\d+)/i);
      if (!m) {
        buffer = buffer.slice(sep + 4);
        continue;
      }
      const len = Number(m[1]);
      if (buffer.length < sep + 4 + len) return;
      const raw = buffer.slice(sep + 4, sep + 4 + len).toString('utf8');
      buffer = buffer.slice(sep + 4 + len);
      try {
        const resp = await handleRpc(JSON.parse(raw));
        writeMessage(resp);
      } catch {
        /* ignore malformed frame */
      }
    } else {
      const nl = buffer.indexOf('\n');
      if (nl === -1) return;
      const line = buffer.slice(0, nl).toString('utf8').trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      try {
        const resp = await handleRpc(JSON.parse(line));
        writeMessage(resp);
      } catch {
        /* ignore malformed line */
      }
    }
  }
}

process.stdin.on('data', chunk => {
  buffer = Buffer.concat([buffer, chunk]);
  drainBuffer();
});
