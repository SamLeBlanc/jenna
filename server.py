"""
Backend server — Python runner
Run with:  python server.py
Listens on $PORT (default 8080)
"""

import os
import io
import sys
import warnings
import logging
import traceback
import contextlib

# Suppress all warnings before any model imports
warnings.filterwarnings("ignore")
os.environ["TOKENIZERS_PARALLELISM"] = "false"
logging.disable(logging.CRITICAL)

import numpy as np
import torch
from flask import Flask, request, jsonify
from flask_cors import CORS
from keybert import KeyBERT
import anthropic
import spacy
from spacy.matcher import Matcher, PhraseMatcher
from transformers import pipeline as transformers_pipeline
from sentence_transformers import SentenceTransformer, util as st_util
from dotenv import load_dotenv

load_dotenv("claud_key.env")

app = Flask(__name__)
CORS(app)

@app.after_request
def add_cors_headers(response):
    response.headers["Access-Control-Allow-Origin"]  = "*"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    return response

@app.route("/run",    methods=["OPTIONS"])
@app.route("/health", methods=["OPTIONS"])
def handle_options():
    return "", 204


# ── Load models once at startup ───────────────────────────────────────────────

print("Loading KeyBERT model...")
kw_model = KeyBERT()
print("KeyBERT ready.")

print("Loading spaCy model...")
nlp = spacy.load("en_core_web_lg")
print("spaCy ready.")

print("Loading sentence transformer...")
sentence_model = SentenceTransformer("all-MiniLM-L6-v2")
print("Sentence transformer ready.")

api_key = os.environ.get("ANTHROPIC_API_KEY", "")
if not api_key:
    print("WARNING: ANTHROPIC_API_KEY not set — Claude calls will fail.")
else:
    print("Anthropic API key loaded.")
claude_client = anthropic.Anthropic(api_key=api_key) if api_key else None


# ── Shared exec namespace — injected into every code block run ────────────────

EXEC_GLOBALS = {
    "__builtins__": __builtins__,
    # stdlib
    "os":       os,
    "sys":      sys,
    "warnings": warnings,
    "logging":  logging,
    # numeric / ML
    "np":       np,
    "numpy":    np,
    "torch":    torch,
    # spaCy
    "spacy":        spacy,
    "nlp":          nlp,
    "Matcher":      Matcher,
    "PhraseMatcher": PhraseMatcher,
    # KeyBERT
    "KeyBERT":  KeyBERT,
    "kw_model": kw_model,
    # Anthropic
    "anthropic":   anthropic,
    "claude_client": claude_client,
    # Transformers
    "pipeline": transformers_pipeline,
    # Sentence Transformers
    "SentenceTransformer": SentenceTransformer,
    "sentence_model":      sentence_model,
    "util":                st_util,
}


# ── Python runner ─────────────────────────────────────────────────────────────

@app.route("/run", methods=["POST"])
def run_code():
    data       = request.get_json()
    code       = data.get("code", "")
    field_note = data.get("field_note", "")

    if not code:
        return jsonify({"error": "No code provided"}), 400

    # Fresh copy of globals for each run so code can't pollute across runs
    # Override input() so any call — regardless of prompt string — returns the field note
    exec_globals = dict(EXEC_GLOBALS)
    exec_globals["input"] = lambda prompt="": field_note

    patched = code

    # Suppress warnings inside exec'd code too
    patched = "import warnings; warnings.filterwarnings('ignore')\n" + patched

    stdout_buf = io.StringIO()
    stderr_buf = io.StringIO()
    error      = None

    with contextlib.redirect_stdout(stdout_buf), contextlib.redirect_stderr(stderr_buf):
        try:
            exec(patched, exec_globals)
        except Exception:
            error = traceback.format_exc()

    output = stdout_buf.getvalue()
    if stderr_buf.getvalue():
        output += stderr_buf.getvalue()
    if error:
        output += error

    return jsonify({"output": output.rstrip()})


# ── Health check ──────────────────────────────────────────────────────────────

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok"})


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8080))
    app.run(host="0.0.0.0", port=port, debug=False)
