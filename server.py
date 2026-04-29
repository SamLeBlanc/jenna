"""
Backend server — KeyBERT + Claude proxy
Run with:  python server.py
Listens on http://localhost:5050
"""

import os
from flask import Flask, request, jsonify
from flask_cors import CORS
from keybert import KeyBERT
import anthropic
from dotenv import load_dotenv

load_dotenv("claud_key.env")

app = Flask(__name__)
CORS(app)  # allow all origins

@app.after_request
def add_cors_headers(response):
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    return response

@app.route("/extract", methods=["OPTIONS"])
@app.route("/claude", methods=["OPTIONS"])
@app.route("/health", methods=["OPTIONS"])
def handle_options():
    return "", 204

print("Loading KeyBERT model...")
kw_model = KeyBERT()
print("Model ready.")

api_key = os.environ.get("ANTHROPIC_API_KEY", "")
if not api_key or api_key == "your-api-key-here":
    print("⚠️  WARNING: ANTHROPIC_API_KEY is not set in claud_key.env — Claude calls will fail.")
else:
    print("Anthropic API key loaded.")

claude_client = anthropic.Anthropic(api_key=api_key) if api_key else None


# ── KeyBERT endpoint ──────────────────────────────────────────────────────────
@app.route("/extract", methods=["POST"])
def extract():
    data = request.get_json()

    doc        = data.get("doc", "")
    candidates = data.get("candidates", None)
    top_n      = data.get("top_n", 5)

    if not doc:
        return jsonify({"error": "No doc provided"}), 400

    keywords = kw_model.extract_keywords(
        doc,
        candidates=candidates if candidates else None,
        top_n=top_n
    )

    results = [{"keyword": kw, "score": round(score, 4)} for kw, score in keywords]
    return jsonify({"keywords": results})


# ── Claude proxy endpoint ─────────────────────────────────────────────────────
@app.route("/claude", methods=["POST"])
def claude():
    if not claude_client:
        return jsonify({"error": "ANTHROPIC_API_KEY is missing or not set in claud_key.env"}), 500

    data = request.get_json()

    model      = data.get("model", "claude-sonnet-4-6")
    max_tokens = data.get("max_tokens", 1024)
    system     = data.get("system", "")
    messages   = data.get("messages", [])

    if not messages:
        return jsonify({"error": "No messages provided"}), 400

    try:
        message = claude_client.messages.create(
            model=model,
            max_tokens=max_tokens,
            system=system,
            messages=messages
        )
        return jsonify({"text": message.content[0].text})
    except anthropic.AuthenticationError:
        return jsonify({"error": "Invalid API key — check ANTHROPIC_API_KEY in claud_key.env"}), 401
    except anthropic.RateLimitError:
        return jsonify({"error": "Anthropic rate limit hit — try again in a moment"}), 429
    except Exception as e:
        return jsonify({"error": f"Claude API error: {str(e)}"}), 500


# ── Health check ──────────────────────────────────────────────────────────────
@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok"})


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5050))
    app.run(host="0.0.0.0", port=port, debug=False)
