// Hallucination Hunter — Remote MCP Server (/api/mcp)
// Stateless Streamable HTTP (JSON-RPC 2.0) compatible with Claude, Antigravity,
// Cursor, Windsurf, ChatGPT Connectors, and OpenAI Responses API MCP.

import { runVerification, queryVerifiedDatabase } from './verify.js';

const SERVER_INFO = {
  name: 'hallucination-hunter',
  version: '1.2.0'
};

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
          description: 'Identifier for the calling assistant (e.g. "claude", "antigravity", "chatgpt", "cursor").'
        },
        saveToDatabase: {
          type: 'boolean',
          description: 'Whether to persist this check and its claims to the Hallucination Hunter Supabase Postgres database (default: true).'
        }
      },
      required: ['text']
    }
  },
  {
    name: 'search_factcheck_database',
    title: 'Search Hallucination Hunter Fact-Check Database',
    description:
      'Query the shared Hallucination Hunter Supabase Postgres database of previously verified, unverifiable, and false claims and cited sources. Omit query to retrieve database totals and recent checks.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Keyword, entity, claim fragment, or source domain to search in the claims ledger.'
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

async function handleRpcMessage(msg, bearerKey) {
  if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0') {
    return {
      jsonrpc: '2.0',
      id: msg?.id ?? null,
      error: { code: -32600, message: 'Invalid JSON-RPC 2.0 request.' }
    };
  }

  // Notifications have no id and expect no JSON-RPC response object
  if (msg.id === undefined) {
    return null;
  }

  const { id, method, params = {} } = msg;

  try {
    if (method === 'initialize') {
      const requested = String(params.protocolVersion || '');
      const protocolVersion = SUPPORTED_PROTOCOLS.includes(requested)
        ? requested
        : '2025-03-26';
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion,
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
          instructions:
            'When answering factual questions or auditing text, call verify_llm_response on your factual claims and append the returned markdownReport block underneath your answer.'
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
      const toolName = params.name;
      const args = params.arguments || {};

      if (toolName === 'verify_llm_response') {
        const out = await runVerification({
          text: args.text,
          client: args.client || 'mcp',
          saveToDatabase: args.saveToDatabase !== false,
          callerApiKey: bearerKey
        });
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [
              {
                type: 'text',
                text: `${out.markdownReport}\n\nJSON Summary: ${JSON.stringify({
                  analysisId: out.analysisId,
                  savedToDatabase: out.savedToDatabase,
                  verdict: out.verdict,
                  counts: out.counts,
                  databaseMatchesCount: out.databaseMatches.length
                })}`
              }
            ],
            structuredContent: out,
            isError: false
          }
        };
      }

      if (toolName === 'search_factcheck_database') {
        const dbOut = await queryVerifiedDatabase({
          query: args.query || '',
          status: args.status || '',
          limit: args.limit || 10
        });
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: JSON.stringify(dbOut, null, 2) }],
            structuredContent: dbOut,
            isError: false
          }
        };
      }

      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32602, message: `Unknown tool: ${toolName}` }
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
        content: [{ type: 'text', text: `Verification error: ${err.message || 'Unknown error'}` }],
        isError: true
      }
    };
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Accept, Authorization, MCP-Protocol-Version, Mcp-Session-Id'
  );

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method === 'DELETE') {
    return res.status(204).end();
  }

  if (req.method === 'GET') {
    const accept = String(req.headers?.accept || '');
    if (accept.includes('text/event-stream') && !accept.includes('application/json') && !accept.includes('text/html')) {
      return res.status(405).json({ error: 'Stateless MCP endpoint: send JSON-RPC 2.0 requests via POST.' });
    }
    return res.status(200).json({
      server: SERVER_INFO,
      transport: 'streamable-http',
      endpoint: 'https://hallucination-hunter-five.vercel.app/api/mcp',
      tools: TOOLS.map(t => ({ name: t.name, description: t.description }))
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  const authHeader = String(req.headers?.authorization || '');
  const bearerKey = authHeader.startsWith('Bearer gsk_') ? authHeader.slice(7).trim() : '';

  let payload = req.body;
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload);
    } catch {
      return res.status(400).json({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: 'Parse error: invalid JSON.' }
      });
    }
  }

  if (Array.isArray(payload)) {
    const responses = (
      await Promise.all(payload.map(item => handleRpcMessage(item, bearerKey)))
    ).filter(Boolean);
    if (responses.length === 0) return res.status(202).end();
    return res.status(200).json(responses);
  }

  const response = await handleRpcMessage(payload, bearerKey);
  if (!response) {
    return res.status(202).end();
  }
  return res.status(200).json(response);
}
