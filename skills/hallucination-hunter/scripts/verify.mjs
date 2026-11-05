#!/usr/bin/env node
// Hallucination Hunter — Zero-dependency Agent Skill CLI (Node 18+)
// Verifies LLM drafts or passages claim by claim and queries/syncs with the
// shared Hallucination Hunter Supabase Postgres database.

import { readFileSync } from 'node:fs';

const API_BASE = (process.env.HALLUCINATION_HUNTER_URL || 'https://hallucination-hunter-five.vercel.app').replace(/\/+$/, '');

function parseArgs(argv) {
  const out = {
    text: '',
    file: '',
    search: '',
    status: '',
    client: process.env.HH_CLIENT || 'agent-skill',
    limit: 10,
    save: true,
    json: false,
    recent: false,
    help: false
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--json') out.json = true;
    else if (a === '--no-save') out.save = false;
    else if (a === '--recent') out.recent = true;
    else if (a === '--text' || a === '-t') out.text = argv[++i] || '';
    else if (a === '--file' || a === '-f') out.file = argv[++i] || '';
    else if (a === '--search' || a === '-s') out.search = argv[++i] || '';
    else if (a === '--status') out.status = argv[++i] || '';
    else if (a === '--client' || a === '-c') out.client = argv[++i] || out.client;
    else if (a === '--limit' || a === '-n') out.limit = Number(argv[++i]) || 10;
    else if (!a.startsWith('-') && !out.text) out.text = a;
  }
  return out;
}

function printHelp() {
  console.log(`Usage:
  node scripts/verify.mjs --text "<draft or passage>" [--client claude|antigravity|chatgpt] [--no-save] [--json]
  node scripts/verify.mjs --file <path> [--client antigravity]
  node scripts/verify.mjs --search "<keyword or claim>" [--status verified|false|unverifiable] [--limit 10]
  node scripts/verify.mjs --recent [--limit 10]`);
}

async function readStdin() {
  if (process.stdin.isTTY) return '';
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8').trim();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    process.exit(0);
  }

  const headers = { 'Content-Type': 'application/json' };
  if (process.env.GROQ_API_KEY?.startsWith('gsk_')) {
    headers.Authorization = `Bearer ${process.env.GROQ_API_KEY}`;
  }

  if (args.search || args.recent) {
    const params = new URLSearchParams();
    if (args.search) params.set('search', args.search);
    if (args.status) params.set('status', args.status);
    params.set('limit', String(args.limit));

    const res = await fetch(`${API_BASE}/api/verify?${params.toString()}`, { headers });
    const data = await res.json();
    if (!res.ok || data.ok === false) {
      console.error(`Error: ${data.error || res.statusText}`);
      process.exit(1);
    }
    if (args.json) {
      console.log(JSON.stringify(data, null, 2));
      return;
    }
    if (data.mode === 'search') {
      console.log(`Database matches for "${data.query}" (${data.count}):`);
      for (const c of data.claims || []) {
        console.log(`- [${String(c.status).toUpperCase()} ${c.confidence}%] ${c.claim} — ${c.explanation} (${c.source || 'Web'}: ${c.sourceUrl || 'n/a'})`);
      }
    } else {
      console.log(`Hallucination Hunter DB: ${data.database?.totalAnalyses ?? '?'} checks · ${data.database?.totalClaims ?? '?'} claims (${data.database?.region || 'Postgres'})`);
      for (const a of data.analyses || []) {
        console.log(`- [${a.verdictLabel}] (${a.summary} · via ${a.origin}) ${a.excerpt.replace(/\s+/g, ' ')}`);
      }
    }
    return;
  }

  let inputText = args.text;
  if (!inputText && args.file) {
    inputText = readFileSync(args.file, 'utf8').trim();
  }
  if (!inputText) {
    inputText = await readStdin();
  }

  if (!inputText || inputText.length < 15) {
    console.error('Error: Provide at least one complete factual sentence via --text, --file, or stdin.');
    process.exit(2);
  }

  const res = await fetch(`${API_BASE}/api/verify`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      text: inputText,
      client: args.client,
      saveToDatabase: args.save
    })
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    console.error(`Error: ${data.error || `HTTP ${res.status}`}`);
    process.exit(1);
  }

  if (args.json) {
    console.log(JSON.stringify(data, null, 2));
  } else {
    console.log(data.markdownReport);
    if (Array.isArray(data.databaseMatches) && data.databaseMatches.length > 0) {
      console.log(`\nPrior database matches (${data.databaseMatches.length}):`);
      for (const m of data.databaseMatches.slice(0, 3)) {
        console.log(`- [${m.status} ${m.confidence}%] ${m.claim} (${m.sourceUrl || m.source || 'stored'})`);
      }
    }
  }
}

main().catch(err => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
