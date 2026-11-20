/**
 * PayTalk Backend — Conversational Payment Agent (Node.js)
 * 
 * Exposes:
 *   - POST /api/chat: LLM / intent extraction, confirmation flow, mock payment execution
 *   - GET  /api/transactions: Returns ledger of completed transactions
 *   - GET  /api/health: Service status
 *
 * Works with Express (when installed) or zero-dependency native Node.js HTTP fallback.
 */

import http from 'node:http';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Load .env if present without requiring external package
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const [key, ...vals] = trimmed.split('=');
    if (key && vals.length > 0) {
      const val = vals.join('=').trim().replace(/^["']|["']$/g, '');
      if (!process.env[key.trim()]) {
        process.env[key.trim()] = val;
      }
    }
  }
}

const PORT = Number(process.env.PORT) || 5000;

// ---------------------------------------------------------------------------
// In-memory "database" (mirrors Flask backend)
// ---------------------------------------------------------------------------
const TRANSACTIONS = [];
const PENDING_CONFIRMATIONS = new Map(); // session_id -> pending transaction details

// ---------------------------------------------------------------------------
// Mock payment execution
// ---------------------------------------------------------------------------
function executePayment({ payer = 'You', payees = ['Friend'], amount = 0, note = '' }) {
  const txn = {
    id: randomUUID().slice(0, 8),
    payer,
    payees: Array.isArray(payees) ? payees : [payees],
    amount: Number(amount),
    note: note || '',
    status: 'success',
    timestamp: new Date().toISOString(),
  };
  TRANSACTIONS.push(txn);
  return txn;
}

// ---------------------------------------------------------------------------
// Intent Parser / LLM Function-Calling
// ---------------------------------------------------------------------------
function callLLMStub(message) {
  if (!message || typeof message !== 'string') return null;

  // Match currency and amount (e.g. ₹500, 500, Rs. 500, Rs 500, 500.50)
  const amountMatch = message.match(/(?:₹|rs\.?|inr)?\s*(\d+(?:\.\d+)?)/i);
  if (!amountMatch) return null;

  const amount = parseFloat(amountMatch[1]);
  if (isNaN(amount) || amount <= 0) return null;

  const isSplit = /\bsplit\b/i.test(message);

  // Extract payees:
  // 1) "to Raj", "with Raj and Priya", "to Priya, Rohan"
  // 2) "pay Raj ₹500", "pay Raj 500", "send Priya 200"
  let payees = ['Friend'];
  const toWithNameMatch = message.match(/(?:to|with)\s+([A-Za-z][A-Za-z\s,\w]*?)(?:\s+for|\s*$)/i);
  const payDirectNameMatch = message.match(/(?:pay|send|transfer(?:\s+to)?)\s+([A-Za-z]+)\s+[^0-9a-zA-Z]*\d+/i);

  if (toWithNameMatch) {
    const rawNames = toWithNameMatch[1];
    payees = rawNames
      .split(/,|\band\b/i)
      .map((n) => n.trim())
      .filter((n) => n.length > 0);
    if (payees.length === 0) payees = ['Friend'];
  } else if (payDirectNameMatch) {
    payees = [payDirectNameMatch[1].trim()];
  }

  // Extract memo/note: "for lunch", "for coffee", "for dinner"
  const noteMatch = message.match(/for\s+(.+)$/i);
  const note = noteMatch ? noteMatch[1].trim() : '';

  return { amount, payees, note, isSplit };
}

// Anthropic Claude Function-calling integration (optional if ANTHROPIC_API_KEY provided)
async function callAnthropicLLM(message, apiKey) {
  const tools = [
    {
      name: 'parse_payment_intent',
      description: 'Extract structured payment details from natural language request.',
      input_schema: {
        type: 'object',
        properties: {
          amount: { type: 'number', description: 'Total amount in rupees' },
          payees: {
            type: 'array',
            items: { type: 'string' },
            description: 'Names of people being paid or splitting with',
          },
          note: { type: 'string', description: 'Reason/memo for the payment' },
          split: { type: 'boolean', description: 'True if splitting among payees' },
        },
        required: ['amount', 'payees'],
      },
    },
  ];

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 500,
      system:
        'You are PayTalk, a payment assistant. Call parse_payment_intent with extracted payment details.',
      tools,
      messages: [{ role: 'user', content: message }],
    }),
  });

  if (!res.ok) {
    throw new Error(`Anthropic API error: ${res.statusText}`);
  }

  const data = await res.json();
  const toolUse = data.content?.find((item) => item.type === 'tool_use');
  if (toolUse && toolUse.name === 'parse_payment_intent') {
    return toolUse.input;
  }
  return null;
}

// Gemini Function-calling integration (optional if GEMINI_API_KEY provided)
async function callGeminiLLM(message, apiKey) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
  const prompt = `You are PayTalk payment parser. Extract payment intent from: "${message}".
Return JSON ONLY matching this format or null if not a payment request:
{"amount": number, "payees": ["name"], "note": "memo", "split": boolean}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json' },
    }),
  });

  if (!res.ok) {
    throw new Error(`Gemini API error: ${res.statusText}`);
  }

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) return null;
  return JSON.parse(text);
}

// Core Chat Handler
async function handleChat({ message = '', session_id = 'default' }) {
  const trimmed = message.trim();

  // If there is a pending confirmation for this session
  if (PENDING_CONFIRMATIONS.has(session_id)) {
    const lower = trimmed.toLowerCase();
    if (['yes', 'confirm', 'y', 'ok', 'sure', 'proceed'].includes(lower)) {
      const pending = PENDING_CONFIRMATIONS.get(session_id);
      PENDING_CONFIRMATIONS.delete(session_id);
      const txn = executePayment(pending);
      return {
        reply: `✅ Paid ₹${txn.amount} to ${txn.payees.join(', ')}. Receipt ID: ${txn.id}`,
        transaction: txn,
      };
    } else if (['no', 'cancel', 'n', 'stop'].includes(lower)) {
      PENDING_CONFIRMATIONS.delete(session_id);
      return { reply: 'Cancelled. Anything else?' };
    } else {
      return { reply: "Please reply 'yes' to confirm or 'no' to cancel." };
    }
  }

  // Check for external LLM API keys, otherwise use regex intent parser stub
  let parsed = null;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;

  if (anthropicKey && anthropicKey !== 'your_key_here') {
    try {
      parsed = await callAnthropicLLM(message, anthropicKey);
    } catch (e) {
      console.warn('Anthropic API failed, falling back to stub:', e.message);
    }
  } else if (geminiKey && geminiKey !== 'your_key_here') {
    try {
      parsed = await callGeminiLLM(message, geminiKey);
    } catch (e) {
      console.warn('Gemini API failed, falling back to stub:', e.message);
    }
  }

  if (!parsed) {
    parsed = callLLMStub(message);
  }

  if (!parsed || !parsed.amount) {
    return {
      reply: "I can help you pay someone or split a bill — try: 'pay Raj ₹500 for lunch'.",
    };
  }

  PENDING_CONFIRMATIONS.set(session_id, {
    payer: 'You',
    payees: parsed.payees,
    amount: parsed.amount,
    note: parsed.note || '',
  });

  const payeesStr = parsed.payees.join(', ');
  const memoStr = parsed.note ? ` for ${parsed.note}` : '';
  return {
    reply: `Confirm: pay ₹${parsed.amount} to ${payeesStr}${memoStr}? (yes/no)`,
  };
}

// ---------------------------------------------------------------------------
// Server Bootstrap: Express (if available) with Native HTTP Fallback
// ---------------------------------------------------------------------------
async function startServer() {
  try {
    // Try using Express if installed in node_modules
    const express = (await import('express')).default;
    const cors = (await import('cors')).default;

    const app = express();
    app.use(cors());
    app.use(express.json());

    app.get('/api/health', (req, res) => {
      res.json({ status: 'ok', runtime: 'nodejs', engine: 'express', port: PORT });
    });

    app.get('/api/transactions', (req, res) => {
      res.json(TRANSACTIONS);
    });

    app.post('/api/chat', async (req, res) => {
      const { message = '', session_id = 'default' } = req.body || {};
      const response = await handleChat({ message, session_id });
      res.json(response);
    });

    app.listen(PORT, () => {
      console.log(`🚀 PayTalk Node.js (Express) backend running on http://localhost:${PORT}`);
    });
    return;
  } catch {
    // Zero-dependency native Node.js HTTP server fallback
    console.log('Notice: Express not found in node_modules. Starting native Node.js HTTP server fallback.');
    
    const server = http.createServer(async (req, res) => {
      // CORS headers
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      const url = new URL(req.url, `http://${req.headers.host}`);

      if (req.method === 'GET' && url.pathname === '/api/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', runtime: 'nodejs', engine: 'native-http', port: PORT }));
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/transactions') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(TRANSACTIONS));
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/chat') {
        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
        });
        req.on('end', async () => {
          try {
            const data = body ? JSON.parse(body) : {};
            const response = await handleChat(data);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(response));
          } catch (e) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid JSON body' }));
          }
        });
        return;
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    });

    server.listen(PORT, () => {
      console.log(`🚀 PayTalk Node.js (Native HTTP) backend running on http://localhost:${PORT}`);
    });
  }
}

startServer();
