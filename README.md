# Hallucination Hunter

An editorial fact-checking desk for AI-generated text. Hallucination Hunter isolates every discrete factual statement from an LLM answer, cross-examines it against authoritative primary records, and annotates the original manuscript line by line with source citations, confidence ratings, and corrected facts.

Built with vanilla HTML, CSS, and ES2022 JavaScript, with Supabase Postgres for durable dossier storage. There is no build step.

```
AI Model Output ──POST /api/groq──> ┌──────────────────────────┐ ──JSON──> Annotated Manuscript & Proof Dossier
(ChatGPT / Claude / Gemini)         │   Hallucination Hunter   │ <──sync── Supabase Postgres (analyses & claims)
                                    └────────────┬─────────────┘
                                                 │
                                                 ├──> NVD, WHO, NASA, PubMed, Wikipedia, arXiv (Citations)
                                                 ├──> Chrome MV3 Browser Extension (Right-click selection)
                                                 └──> Capacitor Android / PWA Client (.apk / standalone)
```

The fastest way to verify text on the web is the bundled Manifest V3 browser extension (`chrome-extension/`), which checks any highlighted passage from your context menu without navigating away. For mobile devices, the web app compiles directly into an installable Android APK via Capacitor.

---

## How It Works

Every verification run follows a three-stage pipeline streamed live to the desk:

| Phase | What Happens |
| :--- | :--- |
| **01 Isolation** | Decomposes the manuscript into atomic factual statements. Rhetorical filler and subjective framing are set aside; exact dates, numbers, and proper nouns are preserved verbatim. |
| **02 Cross-Examination** | Tests each isolated claim against primary reference consensus (NASA, WHO, NIH, PubMed, Encyclopedia Britannica, Wikipedia, etc.). The verifier is instructed never to guess: uncertain assertions are marked `unverifiable`, and refuted assertions require an explicit corrected statement. |
| **03 Scoring & Attribution** | Assigns a certainty rating from 0 to 100, files a primary source link, calculates the aggregate Verification Index, and renders proofreader underlines directly across the original manuscript. |

Hallucination Hunter never presents a claim as true without linking its underlying authority. Claims falling below your configured confidence threshold in Settings are dimmed across all views.

---

## Surfaces & Ecosystem

- **Galley Proof Desk** — Live manuscript input with word count, specimen presets, voice dictation, and batch checking.
- **Verification Dossier** — Proportional breakdown meter, circular index readout, and one-click export (Markdown, PDF, Clipboard, Share URL).
- **Itemized Findings Ledger** — Numbered claim cards (`#01`, `#02`...) with rectangular editorial verdict stamps (`VERIFIED`, `UNVERIFIABLE`, `CONTRADICTED`), confidence gauges, and expandable reasoning drawers.
- **Annotated Manuscript** — Original prose highlighted in place with proofreader marks and superscripts; clicking any underline jumps to its dossier card.
- **Archive & History** — Stored verification dossiers synced with Supabase Postgres, featuring live keyword filtering, JSON backup export, and non-destructive undo delete.
- **Reference Index** — Citation frequency directory ranking authoritative institutions by usage across your checks.
- **Global Search (`Ctrl+K`)** — Instant modal searching across past analyses, claims, and cited URLs with keyboard navigation.
- **Chrome Extension (MV3)** — In-page fact-checking on any website via context menu (`chrome-extension/`).
- **Mobile & Android App** — Native-feeling responsive layout with bottom navigation bar and Capacitor Android build support.

---

## Quick Start

Requires Node 18 or newer.

```bash
# Clone the repository
git clone https://github.com/Sunil56224972/hallucination-Hunter.git
cd hallucination-Hunter

# Serve locally (no build step needed)
npx serve -l 3000
```

Open `http://localhost:3000`. Local runs automatically proxy through the hosted verification API, so no API key is required for testing.

To run with your own Groq key locally:

```bash
export GROQ_API_KEY="gsk_..."
# Or pass window.GROQ_API_KEY in the browser developer console
```

---

## Chrome Extension

The browser extension allows fact-checking text on any webpage without opening a new tab.

### Capabilities:
- Select text on any webpage &rarr; right-click &rarr; **Check with Hallucination Hunter**
- Keyboard shortcut `Alt+Shift+H` to pre-fill the popup with clipboard content
- Filter claims by verdict, copy reports, or open directly in the full web app
- Persists the latest result across popup closes
- Ships with zero bundled secrets: all requests securely route through the serverless proxy

### Installation (Developer Mode):
1. Navigate to `chrome://extensions/` in Chrome, Brave, or Edge.
2. Toggle **Developer mode** in the top-right corner.
3. Click **Load unpacked** and select the `chrome-extension/` directory.
4. Pin Hallucination Hunter to your toolbar.

---

## Android App & PWA

The application is structured to run as a standalone Progressive Web App (PWA) with service-worker offline caching (`sw.js`), and can be packaged into an Android APK via Capacitor.

### Building the Android APK:
```bash
# Generate launcher icons and splash screens from resources/
npx @capacitor/assets generate --android

# Synchronize web assets with the native Android wrapper
npx cap sync android

# Build the release or debug APK
cd android && ./gradlew assembleDebug
```
The resulting `.apk` file is located at `android/app/build/outputs/apk/debug/app-debug.apk`.

---

## Supabase Storage Backend

Durable persistence is powered by Supabase Postgres (`ap-south-1`). If the Supabase CDN client is unreachable, the engine falls back to an integrated PostgREST REST client without losing functionality.

```
Tables:
├── analyses        # Master dossier records (trust score, totals, timestamp, user ID)
├── claims          # Itemized factual assertions with confidence, source URL, and correction
└── settings        # User preferences (thresholds, appearance, engine provider)
```

To connect your own Supabase project:
1. Update `SUPABASE_URL` and `SUPABASE_KEY` in `app.js`.
2. Apply the schema indexes for fast query performance:
   - `idx_claims_analysis_id` on `claims(analysis_id)`
   - `idx_analyses_created_at_desc` on `analyses(created_at desc)`
   - `idx_settings_key_user` on `settings(key, user_id)`

---

## Deploying on Vercel

The application is designed for instant zero-configuration deployment on Vercel.

```bash
vercel --prod
```

### Environment Variables:
| Variable | Description |
| :--- | :--- |
| `GROQ_API_KEY` | **Required.** Your Groq API key from [console.groq.com](https://console.groq.com) powering `/api/groq.js`. |

---

## API Reference

| Method | Endpoint | Purpose |
| :--- | :--- | :--- |
| `POST` | `/api/groq` | Serverless AI inference proxy with rate limiting (10 req/min/IP) and input validation |
| `POST` | `/api/search` | DuckDuckGo web search endpoint for real-time reference URL retrieval |
| `GET` | `/sw.js` | Service worker managing offline cache and asset freshness |
| `GET` | `/manifest.webmanifest` | PWA manifest defining theme colors and app icons |

---

## Project Layout

```
hallucination-Hunter/
├── index.html              # Main single-page application & semantic layout
├── style.css               # Handcrafted design system (Light Paper & Night Press)
├── app.js                  # Extraction engine, verification pipeline & Supabase sync
├── sw.js                   # Service worker cache strategy (v8)
├── manifest.webmanifest    # Progressive Web App manifest
├── vercel.json             # Edge headers, cache rules & security policies
├── api/
│   ├── groq.js             # Serverless Groq inference proxy with rate limiting
│   └── search.js           # Reference discovery endpoint
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

## Security & Privacy

- **Zero Client-Side Keys:** `GROQ_API_KEY` is strictly held on the serverless proxy. The web app, browser extension, and Android APK all query `/api/groq`.
- **Rate Limiting:** IP-based token bucket (10 requests/minute) protects against upstream quota abuse.
- **Input Sanitization:** 20,000-character input caps and strict model whitelisting.
- **Anonymous Isolation:** User dossiers are partitioned by browser-generated UUID tokens; no third-party tracking cookies or personal identifiable information are stored.

---

## License

MIT &copy; [Sunil](https://github.com/Sunil56224972). See [LICENSE](LICENSE) for details.
