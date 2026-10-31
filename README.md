# Hallucination Hunter

An autonomous agentic verification system for AI-generated text. Hallucination Hunter operates as an automated fact-checking agent: it decomposes arbitrary LLM output into discrete atomic propositions, orchestrates multi-source tool-calling loops across institutional knowledge bases and live web indexes, assesses confidence via adversarial cross-examination, and files structured verdicts with real-time provenance tracking.

Built with vanilla HTML, CSS, and ES2022 JavaScript on Node / Vercel edge runtime, with Supabase Postgres for durable dossier memory. There is no build step.

```
Incoming LLM Output ──POST /api/ingest/text──> ┌───────────────────────────┐ ──Agentic Workflow──> Verified Dossier & Galley Markup
(ChatGPT / Claude / Gemini / Agentic APIs)     │   Hallucination Hunter    │ <──State Sync─── Supabase Memory (Postgres 17)
                                               │   Autonomous Supervisor   │
                                               └─────────────┬─────────────┘
                                                             │
           ┌───────────────────────────────┬─────────────────┴────────────────┬───────────────────────────────┐
           │                               │                                  │                               │
    ┌──────▼──────┐                 ┌──────▼──────┐                    ┌──────▼──────┐                 ┌──────▼──────┐
    │ Claim Parser│                 │  Reference  │                    │ Adversarial │                 │ Prov Tracker│
    │ Atomic Fact │                 │   Retriever │                    │  Evaluator  │                 │ MITRE/NVD/  │
    │ Extraction  │                 │  Web & APIs │                    │ Calibrator  │                 │ Primary Cite│
    └─────────────┘                 └─────────────┘                    └─────────────┘                 └─────────────┘
           │                               │                                  │                               │
           └───────────────────────────────┼──────────────────────────────────┴───────────────────────────────┘
                                           │
                                    ┌──────▼──────┐
                                    │ Tool Hub &  │ <── Chrome MV3 Extension (Agentic text capture)
                                    │ Client Sync │ <── Capacitor Android Native Shell (.apk)
                                    │ PostgREST DB│ <── Headless CLI & MCP-Compatible Tools
                                    └─────────────┘
```

The fastest way to attach the agent to your browsing workflow is the bundled Manifest V3 extension (`chrome-extension/`), which intercepts text selections via context menus and routes them to the agentic pipeline without context switching. On mobile, the entire agent shell compiles directly into an installable Android APK via Capacitor.

---

## Agentic Verification Architecture

Every verification request triggers an autonomous multi-stage agentic workflow streamed live to the console:

```
[Raw Manuscript] ──> (Phase 1: Triage & Decomposition)
                            │
                            ▼
                    [Atomic Claims Matrix] ──> (Phase 2: Autonomous Tool Calling & Search)
                                                      │
                                                      ▼
                                              [Evidence Graph] ──> (Phase 3: Adversarial Verification)
                                                                          │
                                                                          ▼
                                                                  [Scored Dossier] ──> (Phase 4: Synthesis & Provenance)
                                                                                              │
                                                                                              ▼
                                                                                  [Galley Proof & Supabase Sync]
```

### The 4-Phase Pipeline

| Phase | Agent Role | Execution & Tools |
| :--- | :--- | :--- |
| **01 Triage & Decomposition** | **Parser Agent** | Ingests raw text, strips rhetorical filler and subjective hedging, and decomposes complex arguments into atomic, independently testable propositions. Preserves numbers, dates, and named entities verbatim with exact character spans for in-situ manuscript pinning. |
| **02 Autonomous Retrieval** | **Research Agent** | Formulates targeted investigative queries for each atomic statement. Orchestrates parallel calls across the live web and curated institutional authorities (NASA, WHO, CDC, FDA, PubMed, Encyclopedia Britannica, Wikipedia, arXiv, etc.). |
| **03 Adversarial Cross-Examination** | **Evaluator Agent** | Subjects each claim and retrieved evidence pair to rigorous cross-examination. Enforces a strict zero-hallucination policy: ambiguous or ungrounded claims are classified as `unverifiable` rather than guessed, and contradicted claims generate an explicit, evidence-backed correction. |
| **04 Synthesis & Provenance** | **Memory & Reporter** | Computes the calibrated Verification Index (0–100%), maps confidence thresholds against user policy, generates proofreader markups with superscript anchors (`01`, `02`), and logs the complete audit trail to Supabase Postgres. |

---

## Agent Capabilities & Surfaces

- **Live Galley Proof Console** — Ruled manuscript sheet with live word/char counters, specimen presets (*Great Wall*, *Python Release*, *Eiffel Tower*), audio dictation, and batch verification.
- **Forensic Verification Dossier** — Real-time Verification Index circular readout, proportional breakdown meters (`Verified`, `Unverifiable`, `Contradicted`), and multi-format export (Markdown, PDF, Clipboard, Share URL).
- **Claim-by-Claim Ledger** — Numbered inspection cards (`#01`, `#02`...) with rectangular editorial verdict stamps, certainty gauges, threshold violation markers, and expandable reasoning notes.
- **In-Situ Manuscript Markup** — Original passage underlined in place with proofreader styling and superscripts; clicking any mark scrolls directly to its evaluation card.
- **Durable Memory & History** — Persistent audit logs synced with Supabase Postgres (`ap-south-1`), featuring instant keyword search, JSON state export, and undoable deletion.
- **Institutional Reference Index** — Authority frequency directory ranking cited reference domains by confidence and citation count.
- **Omni Search (`Ctrl+K`)** — Global keyboard-driven search indexing historical analyses, atomic claims, and primary sources.
- **Chrome Extension (MV3)** — In-page context menu integration for instant text extraction across any web surface (`chrome-extension/`).
- **Android APK & Standalone PWA** — Offline-capable progressive web application and Capacitor Android build wrapper.

---

## Quick Start

Requires Node 18 or newer.

```bash
# 1. Clone the repository
git clone https://github.com/Sunil56224972/hallucination-Hunter.git
cd hallucination-Hunter

# 2. Start the local server (zero build step)
npx serve -l 3000
```

Open `http://localhost:3000`. Local runs automatically proxy through the hosted serverless verification endpoint, so you can test immediately without configuring local API keys.

To run with a direct Groq inference key:
```bash
export GROQ_API_KEY="gsk_..."
# Or set window.GROQ_API_KEY in the browser console during development
```

---

## Chrome Extension Setup

The browser extension allows fact-checking text on any webpage without navigating away:

1. Open your browser and navigate to `chrome://extensions/` (Chrome, Brave, Edge, Opera).
2. Enable **Developer mode** in the upper-right corner.
3. Click **Load unpacked** and select the `chrome-extension/` directory.
4. Pin the extension to your toolbar.
5. Highlight any text on any page &rarr; right-click &rarr; select **Check with Hallucination Hunter** (or press `Alt+Shift+H`).

---

## Android Build & APK Packaging

The application includes Capacitor mobile scaffolding to build native Android packages:

```bash
# Generate launcher icons and splash screens from resources/
npx @capacitor/assets generate --android

# Synchronize web assets with the native Android container
npx cap sync android

# Build the debug APK
cd android && ./gradlew assembleDebug
```
The compiled APK will be output to:
`android/app/build/outputs/apk/debug/app-debug.apk`

---

## Supabase State & Memory Backend

Persistent audit trails and historical dossiers are stored in Supabase Postgres (`ap-south-1`). The application features an automatic PostgREST REST client fallback, guaranteeing uninterrupted operation even if external CDN bundles are blocked.

```
Postgres Schema:
├── analyses        # Master dossier records (trust score, totals, timestamp, user ID)
├── claims          # Atomic statements, verdict statuses, confidence, corrections, source URLs
└── settings        # Policy configuration, confidence thresholds, UI theme preferences
```

### Production Database Optimization:
To configure your own database instance, apply the following indexes:
```sql
CREATE INDEX idx_claims_analysis_id ON claims(analysis_id);
CREATE INDEX idx_analyses_created_at_desc ON analyses(created_at DESC);
CREATE INDEX idx_settings_key_user ON settings(key, user_id);
```

---

## Deployment & Edge Runtime

Deploy instantly to Vercel with zero configuration:

```bash
vercel --prod
```

### Environment Variables:
| Variable | Description |
| :--- | :--- |
| `GROQ_API_KEY` | **Required.** Your Groq Cloud API key powering the `/api/groq.js` inference proxy. |

---

## API & Agentic Tool Catalog

All browser operations communicate over structured HTTP endpoints:

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/api/groq` | Serverless LPU inference proxy with token-bucket rate limiting (10 req/min/IP) and input sanitization |
| `POST` | `/api/search` | Dynamic DuckDuckGo search endpoint for real-time reference retrieval |
| `GET` | `/sw.js` | Service worker managing asset caching and offline resilience |
| `GET` | `/manifest.webmanifest` | PWA manifest specifying app behavior and mobile icons |

---

## Project Structure

```
hallucination-Hunter/
├── index.html              # Core single-page interface & semantic DOM structure
├── style.css               # Handcrafted design system (Daylight Paper & Night Press)
├── app.js                  # Agent orchestration, verification pipeline & Supabase sync
├── sw.js                   # Service worker cache strategy (v8)
├── manifest.webmanifest    # Progressive Web App configuration
├── vercel.json             # Edge headers, cache rules & security policies
├── api/
│   ├── groq.js             # Serverless Groq inference proxy with rate limiting
│   └── search.js           # Live search and reference discovery endpoint
├── chrome-extension/       # Manifest V3 browser extension
│   ├── manifest.json       # Extension configuration & permissions
│   ├── popup.html / js     # Extension UI and verification logic
│   ├── content.js          # In-page text capture
│   └── background.js       # Background service worker & context menus
├── resources/              # Capacitor Android icon & splash screen assets
├── assets/                 # Web favicons, PWA icons, and brand video
└── screenshots/            # UI screenshots & preview media
```

---

## Security & Verification Integrity

- **Server-Side Credential Isolation:** `GROQ_API_KEY` is never exposed to the client; all calls from web, extension, and mobile shells route through the `/api/groq` proxy.
- **Abuse Prevention:** IP-level rate limiting prevents upstream API exhaustion.
- **Deterministic Extraction:** Atomic statements are bound to character offsets in the source text, preventing misattribution.
- **Anonymous Session Isolation:** Records are partitioned using random browser-stored UUID tokens without third-party tracking.

---

## License

MIT &copy; [Sunil](https://github.com/Sunil56224972). See [LICENSE](LICENSE) for details.
