# PayTalk — Conversational AI Agent for Instant Payments & Bill Splitting

Razorpay AI Builder Internship 2026 — Track 1: AI Growth & Agentic Commerce

## Objective
PayTalk lets users initiate payments, transfers, and bill-splits entirely
through natural conversation instead of navigating multi-step payment UIs.
It solves the friction of traditional payment flows (forms, dropdowns,
manual amount entry) by using an LLM agent with function-calling to parse
intent, confirm details, execute a mock transaction, and return a receipt —
all in one chat exchange.

## Architecture
- **Frontend**: React + Vite — chat UI and live transaction history
- **Backend**: Node.js (or Python Flask) — hosts `/api/chat` (agent orchestration) and
  `/api/transactions` (mock ledger)
- **LLM layer**: Function-calling (`parse_payment_intent` tool schema
  included, ready to plug into Anthropic/Gemini API)
- **Flow**: user message → intent extraction → confirmation echo →
  user confirms → mock execution → receipt + history log

> The backend ships with a lightweight regex-based `callLLMStub()` / `call_llm_stub()` so the
> app runs end-to-end without an API key. Swap it for a real Anthropic/Gemini
> function-calling call for the actual submission.

## Setup

### Option A: Node.js Backend (Recommended)
```bash
cd backend
npm install   # optional; zero-dependency fallback also works with bare node
npm start     # or: node server.js
```
Runs on `http://localhost:5000`.

### Option B: Python Flask Backend
```bash
cd backend
python -m venv venv && source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env   # add your ANTHROPIC_API_KEY or GEMINI_API_KEY
python app.py
```
Runs on `http://localhost:5000`.

### Frontend
```bash
cd frontend
npm install
npm run dev
```
Runs on `http://localhost:5173` (proxies `/api` to the backend on port 5000).

## Demo flow
1. Type: `pay Raj ₹500 for lunch`
2. Agent confirms: "Confirm: pay ₹500 to Raj for lunch? (yes/no)"
3. Reply `yes`
4. Agent executes mock payment, returns receipt ID
5. Transaction appears in the history panel

## Build Challenges & Technical Obstacles (draft for form)
- **Multi-turn state**: payments require a confirm step before execution,
  so the backend tracks per-session pending transactions rather than
  executing on the first message — avoids accidental payments from
  ambiguous LLM parses.
- **Intent extraction reliability**: natural language amounts/names vary
  a lot ("split 1200 three ways" vs "pay Raj 500") — solved by defining a
  strict function-calling schema so the LLM returns structured JSON
  instead of free text to parse.
- **Mock vs real payment gateway**: no production payment credentials
  available during the internship, so a mock `execute_payment()` function
  simulates the gateway response — swappable later for Razorpay's sandbox
  API without changing the agent logic.

## Next steps / stretch goals
- Real LLM function-calling wired to Anthropic or Gemini API
- Multi-payee bill-splitting math (equal/custom splits)
- Persistent DB instead of in-memory store
- Voice input
