# Hallucination Hunter — Full Feature List

## Round 1 Features (No Database) ✅ DEPLOYED

### Feature 1: Core Text Analyzer
- Paste any AI-generated text
- Extract individual factual claims via Groq LLM
- Verify each claim with confidence scoring
- Color-coded highlights (green=verified, red=false, yellow=unverifiable)
- Trust score with animated donut chart
- Claim cards with explanation + source attribution
- Export as PDF / Copy results to clipboard

### Feature 2: Voice Input (Web Speech API)
- Microphone button for hands-free input
- Real-time speech-to-text transcription
- Works in Chrome/Edge natively
- Appends spoken text without duplication

---

## Full Feature Set (with Database — for later rounds)

### Supabase Integration
- Real-time persistence of analyses and claims
- Per-user isolation via anonymous UUID
- Dashboard stats (total analyses, avg trust score, claims checked)

### History View
- Browse past analyses with timestamps and scores
- View detailed claim breakdowns per analysis
- Delete individual or all history entries

### Trusted Sources Directory
- 40+ curated authoritative sources
- Government, medical, academic, news, tech categories
- Linked directly in claim verification results

### Settings & Configuration
- Adjustable confidence threshold (50-95%)
- Verification engine selection
- Database status monitoring

### Search
- Global search across analyses, claims, and sources
- Cmd/Ctrl+K shortcut

### Batch Analysis
- Separate texts with --- for batch processing

### Share Analysis
- Generate shareable URL with base64-encoded results
