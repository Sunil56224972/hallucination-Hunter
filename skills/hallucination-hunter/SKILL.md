---
name: hallucination-hunter
description: "Verify factual claims in LLM drafts and passages, cross-check and sync results with the Hallucination Hunter Supabase database, and append a source-backed trust audit alongside your response. Use when the user asks to fact-check text, check for hallucinations, verify claims, query past verified claims, or include Hallucination Hunter verification with your answer."
license: MIT
compatibility: "Works in Antigravity, Claude Code, Claude.ai, Cursor, Windsurf, Codex CLI, and any agent with Node 18+, curl, WebFetch, or MCP."
allowed-tools: Bash Read WebFetch
metadata:
  author: Sunil56224972
  version: "1.2.0"
  category: verification
  triggers: fact-check, hallucination, verify-claims, hallucination-hunter, trust-score, audit-answer
---

# Hallucination Hunter

Decompose AI-generated drafts or user passages into atomic factual claims, verify each claim against established knowledge and live web sources, sync results to the shared Hallucination Hunter Supabase Postgres database, and present the audit block alongside your answer.

## When to Use

- Use when the user asks to fact-check, verify, cite-check, or audit a passage or AI response for hallucinations.
- Use when the user asks you to answer a factual question **with Hallucination Hunter** (Co-Pilot Mode: output your answer plus the verified claim audit).
- Use when the user asks to look up previously verified or contradicted claims in the Hallucination Hunter database.
- Do NOT use for pure code syntax linting, creative fiction, personal opinions, or passages shorter than 15 characters with zero objective facts.

## Prerequisites

- Network access to `https://hallucination-hunter-five.vercel.app` (or a custom `HALLUCINATION_HUNTER_URL`).
- Execution path (pick the first available in your environment):
  1. **MCP tool** `verify_llm_response` / `search_factcheck_database` (if the `hallucination-hunter` MCP server is connected).
  2. **Bundled Node 18+ CLI** `scripts/verify.mjs` (located inside this skill directory).
  3. **Direct HTTP fallback** via `curl` (`POST https://hallucination-hunter-five.vercel.app/api/verify`) or `WebFetch` (`GET https://hallucination-hunter-five.vercel.app/api/verify?text=...`).
- Optional: Set `GROQ_API_KEY=gsk_...` in the environment to use your own Groq key and bypass shared rate limits.

## Workflows

### Workflow 1: Answer + Verify Alongside (Co-Pilot Mode)

Run this workflow when answering a factual prompt with Hallucination Hunter active:

1. **Draft your factual response** clearly and concisely, keeping concrete dates, numbers, versions, and names explicit.
2. **Verify your draft** before finalizing by passing the draft text to Hallucination Hunter:
   ```bash
   node scripts/verify.mjs --text "<your drafted factual answer>" --client antigravity
   ```
   *(Replace `--client` with `claude`, `antigravity`, `chatgpt`, `cursor`, or `codex` matching your host).*
3. **Self-correct false claims**: If the JSON or Markdown output flags any claim in your own draft as **False**, update your draft using the returned `correction` and re-verify once if needed.
4. **Present both results together**: Output your clean answer first, followed immediately by the returned Hallucination Hunter Markdown audit block.

### Workflow 2: Audit a User-Provided Passage

Run this workflow when the user pastes or points to text they want checked:

1. Execute verification on the exact passage (do not rewrite the user's text before checking):
   ```bash
   node scripts/verify.mjs --text "<user passage>" --client claude --json
   ```
   For long files, pass `--file <path>` instead of `--text`.
2. Summarize which claims held up, call out every **False** claim with its factual `correction`, and note any **Unverifiable** post-cutoff or unconfirmed claims without guessing.
3. Include the `inspectUrl` link so the user can view inline underlined highlights in the web console.

### Workflow 3: Search the Fact-Check Database

Query the shared Supabase Postgres ledger (`analyses` and `claims` tables) before or during research:

```bash
# Search previously checked claims by keyword or entity
node scripts/verify.mjs --search "Python" --limit 8

# Filter only contradicted (false) claims in the database
node scripts/verify.mjs --search "Tower" --status false

# List recent checks and live database totals
node scripts/verify.mjs --recent --limit 5
```

### Shell-Free / WebFetch Fallback

If `node` is unavailable, call the REST endpoint with `curl` or `WebFetch`:

```bash
curl -sS -X POST https://hallucination-hunter-five.vercel.app/api/verify \
  -H "Content-Type: application/json" \
  -d '{"text":"Python was created by Guido van Rossum in 1991.","client":"claude"}'
```

For read-only `GET` tools (`WebFetch`):
`https://hallucination-hunter-five.vercel.app/api/verify?text=Python%20was%20created%20by%20Guido%20van%20Rossum%20in%201991.&client=web-llm`

## Output Format

When presenting an answer alongside Hallucination Hunter, always keep your primary response first and append the deterministic verification block below a horizontal rule:

```markdown
<Your direct answer to the user>

---
**Hallucination Hunter · 100% (Mostly accurate)** · 2 verified · Synced to DB · [Inspect inline ↗](https://hallucination-hunter-five.vercel.app/?text=...)
- **Verified (98%)** — <Atomic claim 1> — <Concise factual explanation> ([<Source>](<URL>))
- **Verified (95%)** — <Atomic claim 2> — <Concise factual explanation> ([<Source>](<URL>))
```

If all extracted claims are post-cutoff or unconfirmed (`unverifiedOnly: true`), report **`Unverified (Needs outside verification)`** rather than `0%`.

## Error Handling

- **HTTP 429 (Rate limit)**: Wait the number of seconds in `retryAfter` (typically 15-60s) and retry once, or instruct the user to set `GROQ_API_KEY` for dedicated throughput.
- **Sandbox blocks outbound network**: Re-run the verification command with network access enabled (or ask the user to approve outbound access to `hallucination-hunter-five.vercel.app`).
- **Input under 15 characters**: Skip the API call and ask the user for at least one complete factual sentence.
- **Ephemeral / private text**: Pass `--no-save` (or `"saveToDatabase": false`) when checking sensitive text that must not be written to the shared Supabase ledger.

## Examples

### Example 1: Answering a question with live verification

```text
User: Explain when Python was created and when Python 3.0 shipped, and verify with Hallucination Hunter.

Command:
node scripts/verify.mjs --text "Python was created by Guido van Rossum and first released in February 1991. Python 3.0 was released on December 3, 2008." --client claude

Output returned to user:
Python was created by Guido van Rossum at CWI and first released in February 1991. Python 3.0 shipped on December 3, 2008 as a major backward-incompatible revision.

---
**Hallucination Hunter · 100% (Mostly accurate)** · 2 verified · Synced to DB · [Inspect inline ↗](https://hallucination-hunter-five.vercel.app/?text=...)
- **Verified (98%)** — Python was created by Guido van Rossum and first released in February 1991. — Guido van Rossum released Python 0.9.0 in February 1991. ([Python Software Foundation](https://docs.python.org/3/faq/general.html))
- **Verified (97%)** — Python 3.0 was released on December 3, 2008. — Python 3.0 final was released on December 3, 2008. ([Python.org](https://www.python.org/download/releases/3.0/))
```

### Example 2: Catching a hallucination in a pasted passage

```text
User: Check this AI answer: "The Eiffel Tower was completed in 1889 and is 450 meters tall."

Command:
node scripts/verify.mjs --text "The Eiffel Tower was completed in 1889 and is 450 meters tall." --client antigravity

Output returned to user:
---
**Hallucination Hunter · 50% (Mixed — check flagged lines)** · 1 verified · 1 false · Synced to DB · [Inspect inline ↗](https://hallucination-hunter-five.vercel.app/?text=...)
- **Verified (98%)** — The Eiffel Tower was completed in 1889. — Built for the 1889 Exposition Universelle in Paris. ([Tour Eiffel](https://www.toureiffel.paris/en))
- **False (96%)** — The Eiffel Tower is 450 meters tall. — The Eiffel Tower stands 330 meters tall including its broadcast antenna, not 450 meters. ([Tour Eiffel](https://www.toureiffel.paris/en/the-monument/key-figures))
  *Correction:* The Eiffel Tower is approximately 330 meters (1,083 feet) tall.
```

## Platform Setup Reference

For installation in Antigravity, Claude Code, Claude.ai, ChatGPT Custom GPT Actions, MCP configs, and Python/JS pipelines, read [references/platform-setup.md](references/platform-setup.md).
