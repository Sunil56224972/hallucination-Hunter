# Multi-LLM & Database Integration Reference

Connect Hallucination Hunter to any assistant so factual answers include claim-by-claim verification and sync with the shared Supabase Postgres ledger.

## 1. Agent Skill CLI (`npx skills add`)

Works in **Antigravity**, **Claude Code**, **Cursor**, **Windsurf**, **Codex CLI**, **OpenCode**, and **Cline**:

```bash
npx skills add Sunil56224972/hallucination-Hunter
```

Manual directory copy:
- **Antigravity**: Copy `skills/hallucination-hunter` into `<config-dir>/skills/hallucination-hunter`
- **Claude Code**: Copy `skills/hallucination-hunter` into `.claude/skills/hallucination-hunter`
- **Claude.ai (Web / Desktop)**: Upload `hallucination-hunter-skill.zip` under **Settings -> Capabilities -> Skills**

## 2. Model Context Protocol (MCP)

### Option A: Zero-install Remote HTTP MCP

Add the Streamable HTTP endpoint to any MCP host supporting remote URLs (Claude Connectors, Cursor, Windsurf, OpenAI Responses MCP):

```json
{
  "mcpServers": {
    "hallucination-hunter": {
      "url": "https://hallucination-hunter-five.vercel.app/api/mcp"
    }
  }
}
```

### Option B: Local Stdio MCP (`node mcp/server.mjs`)

For `claude_desktop_config.json`, Antigravity MCP config, or local IDE configs:

```json
{
  "mcpServers": {
    "hallucination-hunter": {
      "command": "node",
      "args": ["/path/to/hallucination-Hunter/mcp/server.mjs"],
      "env": {
        "HH_CLIENT": "claude"
      }
    }
  }
}
```

## 3. ChatGPT (Custom GPT Actions)

1. Open ChatGPT -> **Explore GPTs** -> **Create** -> **Configure**.
2. Scroll to **Actions** -> **Create new action** -> **Import from URL**:
   `https://hallucination-hunter-five.vercel.app/openapi.json`
3. Leave Authentication set to **None** (or Bearer with your own `gsk_...` Groq key).
4. Paste these instructions into your GPT's **Instructions** box:

```text
Whenever you answer a question containing factual claims (dates, numbers, names, versions, scientific or historical facts):
1. Draft a clear, helpful answer first.
2. Call verifyLlmResponse with your factual passage and client="chatgpt".
3. If any claim comes back with status="false", fix that claim in your answer using the returned correction.
4. Output your answer followed by the returned markdownReport block so the user sees both your answer and the Hallucination Hunter claim-by-claim audit synced to the database.
```

## 4. Direct REST & Database Query API (Any LLM / LangChain / Dify / n8n)

### Verify text & sync to Supabase Postgres

```bash
curl -sS -X POST https://hallucination-hunter-five.vercel.app/api/verify \
  -H "Content-Type: application/json" \
  -d '{"text":"The Eiffel Tower was completed in 1889 and stands 330 meters tall.","client":"api"}'
```

### Query verified/false claims in the database

```bash
curl -sS "https://hallucination-hunter-five.vercel.app/api/verify?search=Python&limit=5"
```

### Python integration (append verification to any OpenAI / Anthropic / Gemini response)

```python
import requests

def answer_with_verification(llm_answer: str, client: str = "python-agent") -> str:
    r = requests.post(
        "https://hallucination-hunter-five.vercel.app/api/verify",
        json={"text": llm_answer, "client": client, "saveToDatabase": True},
        timeout=25,
    )
    r.raise_for_status()
    audit = r.json()["markdownReport"]
    return f"{llm_answer}\n\n{audit}"
```
