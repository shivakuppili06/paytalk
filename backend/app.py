"""
PayTalk Backend — Conversational Payment Agent
Flask API that exposes a chat endpoint. The LLM (via function-calling)
parses user intent, and the backend executes mock payment actions.

Run:
    pip install -r requirements.txt
    export ANTHROPIC_API_KEY=your_key_here   # or set GEMINI_API_KEY and swap client
    python app.py
"""

import os
import uuid
import json
from datetime import datetime
from flask import Flask, request, jsonify
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

# ---------------------------------------------------------------------------
# In-memory "database" (swap for real DB later)
# ---------------------------------------------------------------------------
TRANSACTIONS = []
PENDING_CONFIRMATIONS = {}  # session_id -> pending transaction details


# ---------------------------------------------------------------------------
# Mock payment execution — replace with a real/sandbox payment gateway later
# ---------------------------------------------------------------------------
def execute_payment(payer: str, payees: list, amount: float, note: str = ""):
    """Simulates executing a payment / split. Always 'succeeds' for the demo."""
    txn = {
        "id": str(uuid.uuid4())[:8],
        "payer": payer,
        "payees": payees,
        "amount": amount,
        "note": note,
        "status": "success",
        "timestamp": datetime.utcnow().isoformat() + "Z",
    }
    TRANSACTIONS.append(txn)
    return txn


# ---------------------------------------------------------------------------
# Tool / function schema for LLM function-calling
# (Works with Anthropic's tool-use format; adapt field names if using Gemini)
# ---------------------------------------------------------------------------
TOOLS = [
    {
        "name": "parse_payment_intent",
        "description": (
            "Extract structured payment details from a user's natural "
            "language request. Use this whenever the user asks to pay, "
            "send money, or split a bill."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "amount": {"type": "number", "description": "Total amount in rupees"},
                "payees": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Names of people being paid / splitting with",
                },
                "note": {"type": "string", "description": "Reason/memo for the payment"},
                "split": {
                    "type": "boolean",
                    "description": "True if this is a bill split among multiple payees",
                },
            },
            "required": ["amount", "payees"],
        },
    }
]

SYSTEM_PROMPT = """You are PayTalk, a conversational payment assistant.
When the user asks to pay someone or split a bill, call parse_payment_intent
with the extracted details. Do not execute the payment yourself — the backend
handles confirmation and execution. Keep replies short and conversational."""


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@app.route("/api/chat", methods=["POST"])
def chat():
    """
    Main chat endpoint.
    Expected body: { "message": str, "session_id": str }

    NOTE: This stub shows where to plug in the LLM call. Replace
    `call_llm_stub` with a real Anthropic/Gemini function-calling call.
    """
    data = request.get_json(force=True)
    message = data.get("message", "")
    session_id = data.get("session_id", "default")

    # If there's a pending confirmation for this session, check for yes/no
    if session_id in PENDING_CONFIRMATIONS:
        if message.strip().lower() in ("yes", "confirm", "y", "ok"):
            pending = PENDING_CONFIRMATIONS.pop(session_id)
            txn = execute_payment(**pending)
            return jsonify({
                "reply": f"✅ Paid ₹{txn['amount']} to {', '.join(txn['payees'])}. "
                         f"Receipt ID: {txn['id']}",
                "transaction": txn,
            })
        elif message.strip().lower() in ("no", "cancel", "n"):
            PENDING_CONFIRMATIONS.pop(session_id)
            return jsonify({"reply": "Cancelled. Anything else?"})
        else:
            return jsonify({"reply": "Please reply 'yes' to confirm or 'no' to cancel."})

    # --- Replace this block with a real LLM function-calling call ---
    parsed = call_llm_stub(message)
    # -------------------------------------------------------------

    if parsed is None:
        return jsonify({"reply": "I can help you pay someone or split a bill — "
                                  "try: 'pay Raj ₹500 for lunch'."})

    PENDING_CONFIRMATIONS[session_id] = {
        "payer": "You",
        "payees": parsed["payees"],
        "amount": parsed["amount"],
        "note": parsed.get("note", ""),
    }
    payees_str = ", ".join(parsed["payees"])
    return jsonify({
        "reply": f"Confirm: pay ₹{parsed['amount']} to {payees_str}"
                 f"{' for ' + parsed['note'] if parsed.get('note') else ''}? (yes/no)"
    })


@app.route("/api/transactions", methods=["GET"])
def get_transactions():
    return jsonify(TRANSACTIONS)


# ---------------------------------------------------------------------------
# LLM stub — swap this out for a real Anthropic/Gemini function-calling call
# ---------------------------------------------------------------------------
def call_llm_stub(message: str):
    """
    Very naive placeholder parser so the app is runnable/demoable
    without an API key. Replace with a real LLM call, e.g.:

        import anthropic
        client = anthropic.Anthropic()
        resp = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=500,
            system=SYSTEM_PROMPT,
            tools=TOOLS,
            messages=[{"role": "user", "content": message}],
        )
        # then read resp.content for a tool_use block named parse_payment_intent
    """
    import re

    amount_match = re.search(r"₹?\s?(\d+(?:\.\d+)?)", message)
    if not amount_match:
        return None

    amount = float(amount_match.group(1))

    # naive "to X" / "with X" name extraction
    name_match = re.search(r"(?:to|with)\s+([A-Za-z][A-Za-z\s]*?)(?:\s+for|\s*$)", message)
    payees = [name_match.group(1).strip()] if name_match else ["Friend"]

    note_match = re.search(r"for\s+(.+)$", message)
    note = note_match.group(1).strip() if note_match else ""

    return {"amount": amount, "payees": payees, "note": note}


if __name__ == "__main__":
    app.run(debug=True, port=5000)
