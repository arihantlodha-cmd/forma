import os, base64, json, re, time, sqlite3, secrets
from collections import defaultdict
from html import escape as _esc
from flask import Flask, request, jsonify, send_from_directory, Response, stream_with_context
from openai import OpenAI
from dotenv import load_dotenv

load_dotenv()

_api_key = os.environ.get("OPENAI_API_KEY")
_pw      = os.environ.get("FORMA_PASSWORD", "")
if not _api_key:
    print("WARNING: OPENAI_API_KEY is not set. Requests to /analyze will fail.")

app    = Flask(__name__, static_folder=".", static_url_path="")
client = OpenAI(api_key=_api_key or "missing")

# ── Reasoning modes ────────────────────────────────────────────────────────────

_PROMPTS = {
    "quick": (
        "You are Forma, a spatial reasoning AI. Analyze the image and answer the question "
        "concisely in 2–3 numbered steps. Be direct and efficient."
    ),
    "deep": (
        "You are Forma, a spatial reasoning AI. Analyze the spatial relationships, geometry, "
        "dimensions, and physical structure in the image. Always respond with clearly numbered "
        "steps that walk through your reasoning. Be clear, educational, and precise. Never just "
        "give the final answer — always show the spatial thinking behind it."
    ),
    "expert": (
        "You are Forma, an expert spatial reasoning system used by engineers, architects, and "
        "scientists. Assume the user has domain knowledge. Provide rigorous, numbered analysis. "
        "Include relevant formulas, technical terminology, and quantitative estimates. Reference "
        "spatial principles and geometric theorems by name."
    ),
}
_MAX_TOKENS = {"quick": 600, "deep": 1500, "expert": 2000}

# ── Constants ──────────────────────────────────────────────────────────────────

ALLOWED_EXT = {"png", "jpg", "jpeg", "webp", "gif"}
MAX_BYTES   = 20 * 1024 * 1024
RATE_LIMIT  = 15

# ── SQLite ─────────────────────────────────────────────────────────────────────

DB_PATH = os.path.join(os.path.dirname(__file__), "forma.db")

def _init_db():
    with sqlite3.connect(DB_PATH) as db:
        db.execute("""
            CREATE TABLE IF NOT EXISTS analyses (
                id         TEXT    PRIMARY KEY,
                question   TEXT    NOT NULL,
                answer     TEXT    NOT NULL,
                mode       TEXT    NOT NULL,
                created_at INTEGER NOT NULL
            )
        """)
_init_db()

# ── Rate limiter ───────────────────────────────────────────────────────────────

_rate: dict = defaultdict(list)

def _is_limited(ip: str) -> bool:
    now = time.time()
    _rate[ip] = [t for t in _rate[ip] if now - t < 60]
    if len(_rate[ip]) >= RATE_LIMIT:
        return True
    _rate[ip].append(now)
    return False

# ── Auth ───────────────────────────────────────────────────────────────────────

def _authed(req) -> bool:
    if not _pw:
        return True
    return req.headers.get("X-Forma-Key", "") == _pw

# ── File validation ────────────────────────────────────────────────────────────

def _ext_ok(name: str) -> bool:
    return "." in name and name.rsplit(".", 1)[1].lower() in ALLOWED_EXT

def _magic_ok(data: bytes) -> bool:
    return (
        data[:3] == b"\xff\xd8\xff"
        or data[:8] == b"\x89PNG\r\n\x1a\n"
        or data[:6] in (b"GIF87a", b"GIF89a")
        or (data[:4] == b"RIFF" and len(data) >= 12 and data[8:12] == b"WEBP")
    )

# ── Share page template ────────────────────────────────────────────────────────

_SHARE_TPL = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Forma — {q_short}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    :root{{--bg:#07090f;--surf:#0f1219;--surf2:#161c2d;--border:#1e2740;--indigo:#6366f1;--indigo-lt:#818cf8;--glow:rgba(99,102,241,0.1);--text:#e2e8f0;--text2:#94a3b8;--text3:#64748b;}}
    *,*::before,*::after{{box-sizing:border-box;margin:0;padding:0;}}
    body{{background:var(--bg);color:var(--text);font-family:'Inter',sans-serif;line-height:1.6;min-height:100vh;}}
    nav{{position:fixed;top:0;left:0;right:0;height:52px;display:flex;align-items:center;justify-content:space-between;padding:0 2rem;background:rgba(7,9,15,.85);backdrop-filter:blur(14px);border-bottom:1px solid var(--border);z-index:10;}}
    .logo{{font-size:1rem;font-weight:800;letter-spacing:-.04em;}}
    .logo span{{color:var(--indigo-lt);}}
    .cta{{background:var(--indigo);color:#fff;border:none;padding:.3rem .9rem;border-radius:7px;font-size:.78rem;font-weight:700;cursor:pointer;text-decoration:none;font-family:inherit;}}
    .cta:hover{{background:var(--indigo-lt);}}
    main{{max-width:780px;margin:0 auto;padding:6rem 1.5rem 4rem;}}
    .share-meta{{display:flex;align-items:center;gap:.6rem;margin-bottom:1.5rem;font-size:.7rem;color:var(--text3);font-family:'JetBrains Mono',monospace;}}
    .share-badge{{background:var(--glow);border:1px solid rgba(99,102,241,.25);color:var(--indigo-lt);border-radius:4px;padding:.1rem .45rem;font-weight:700;font-size:.65rem;letter-spacing:.05em;}}
    .share-q{{background:var(--surf);border:1px solid var(--border);border-radius:12px;padding:1.25rem 1.4rem;margin-bottom:1rem;}}
    .share-q-label{{font-size:.65rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--text3);margin-bottom:.5rem;}}
    .share-q-text{{font-size:1rem;font-weight:600;color:var(--text);}}
    .share-a{{background:var(--surf);border:1px solid var(--border);border-radius:12px;overflow:hidden;}}
    .share-a-head{{padding:.7rem 1.1rem;border-bottom:1px solid var(--border);background:var(--surf2);display:flex;align-items:center;gap:.5rem;}}
    .share-a-body{{padding:1.25rem 1.1rem;font-family:'JetBrains Mono',monospace;font-size:.82rem;line-height:1.9;color:#c4cee6;white-space:pre-wrap;word-break:break-word;}}
    .sn{{color:var(--indigo-lt);font-weight:600;}}
    .share-foot{{text-align:center;margin-top:2.5rem;padding-top:2rem;border-top:1px solid var(--border);}}
    .share-foot p{{font-size:.82rem;color:var(--text3);margin-bottom:1rem;}}
  </style>
</head>
<body>
<nav>
  <div class="logo">For<span>m</span>a</div>
  <a href="/" class="cta">Try Forma</a>
</nav>
<main>
  <div class="share-meta">
    <span class="share-badge">SHARED ANALYSIS</span>
    <span>mode: {mode}</span>
    <span>·</span>
    <span>{created}</span>
  </div>
  <div class="share-q">
    <div class="share-q-label">Question</div>
    <div class="share-q-text">{question}</div>
  </div>
  <div class="share-a">
    <div class="share-a-head">
      <span class="share-badge">FORMA</span>
      <span style="font-size:.8rem;font-weight:600;color:var(--text2)">Spatial Reasoning Output</span>
    </div>
    <div class="share-a-body">{answer}</div>
  </div>
  <div class="share-foot">
    <p>Generated by Forma — Spatial Reasoning Engine</p>
    <a href="/" class="cta">Analyze your own image</a>
  </div>
</main>
</body>
</html>"""

# ── Routes ─────────────────────────────────────────────────────────────────────

@app.route("/")
def index():
    return send_from_directory(".", "index.html")


@app.route("/ping")
def ping():
    return jsonify({"protected": bool(_pw)})


@app.route("/auth", methods=["POST"])
def auth():
    if not _pw:
        return jsonify({"ok": True})
    key = (request.json or {}).get("key", "")
    return jsonify({"ok": key == _pw})


@app.route("/save", methods=["POST"])
def save():
    if not _authed(request):
        return jsonify({"error": "Unauthorized"}), 401
    data     = request.json or {}
    question = data.get("question", "").strip()
    answer   = data.get("answer",   "").strip()
    mode     = data.get("mode",     "deep")
    if not question or not answer:
        return jsonify({"error": "Missing question or answer."}), 400
    sid = secrets.token_hex(4)
    with sqlite3.connect(DB_PATH) as db:
        db.execute("INSERT INTO analyses VALUES (?,?,?,?,?)",
                   (sid, question, answer, mode, int(time.time())))
    base = request.host_url.rstrip("/")
    return jsonify({"id": sid, "url": f"{base}/r/{sid}"})


@app.route("/r/<sid>")
def shared(sid):
    with sqlite3.connect(DB_PATH) as db:
        row = db.execute("SELECT question,answer,mode,created_at FROM analyses WHERE id=?",
                         (sid,)).fetchone()
    if not row:
        return "Analysis not found.", 404
    question, answer, mode, created_at = row
    answer_html = re.sub(
        r"^(Step\s+\d+[:.)]?|\d+[.)]\s*)",
        r'<span class="sn">\1</span>',
        _esc(answer),
        flags=re.MULTILINE,
    )
    return _SHARE_TPL.format(
        q_short   = _esc(question[:60]),
        question  = _esc(question),
        answer    = answer_html,
        mode      = _esc(mode),
        created   = time.strftime("%B %d, %Y", time.localtime(created_at)),
        sid       = sid,
    )


@app.route("/analyze", methods=["POST"])
def analyze():
    if not _authed(request):
        return jsonify({"error": "Unauthorized. Check your access key.", "auth": True}), 401

    ip = (request.headers.get("X-Forwarded-For", "") or request.remote_addr or "").split(",")[0].strip()
    if _is_limited(ip):
        return jsonify({"error": "Rate limit exceeded. Wait a moment and try again."}), 429

    if "image" not in request.files:
        return jsonify({"error": "No image file provided."}), 400
    f = request.files["image"]
    if not f.filename:
        return jsonify({"error": "Empty filename."}), 400
    if not _ext_ok(f.filename):
        return jsonify({"error": "Unsupported file type. Use PNG, JPG, WEBP, or GIF."}), 400

    raw = f.read()
    if len(raw) > MAX_BYTES:
        return jsonify({"error": "Image too large (max 20 MB)."}), 400
    if not _magic_ok(raw):
        return jsonify({"error": "File content does not match a supported image format."}), 400

    question = request.form.get("question", "").strip()
    if not question:
        return jsonify({"error": "No question provided."}), 400

    mode = request.form.get("mode", "deep")
    if mode not in _PROMPTS:
        mode = "deep"

    ext      = f.filename.rsplit(".", 1)[1].lower()
    mime     = {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png",
                "webp": "image/webp", "gif": "image/gif"}.get(ext, "image/jpeg")
    data_url = f"data:{mime};base64,{base64.b64encode(raw).decode()}"

    # Build message history (supports multi-turn follow-ups)
    history_json = request.form.get("history", "")
    turns        = json.loads(history_json) if history_json else []

    if turns:
        msgs = [{"role": "system", "content": _PROMPTS[mode]}]
        msgs.append({"role": "user", "content": [
            {"type": "image_url", "image_url": {"url": data_url, "detail": "high"}},
            {"type": "text",      "text": turns[0]["text"]},
        ]})
        for t in turns[1:]:
            msgs.append({"role": t["role"], "content": t["text"]})
        msgs.append({"role": "user", "content": question})
    else:
        msgs = [
            {"role": "system", "content": _PROMPTS[mode]},
            {"role": "user", "content": [
                {"type": "image_url", "image_url": {"url": data_url, "detail": "high"}},
                {"type": "text",      "text": question},
            ]},
        ]

    def _stream():
        try:
            stream = client.chat.completions.create(
                model="gpt-4o",
                messages=msgs,
                max_tokens=_MAX_TOKENS[mode],
                stream=True,
                timeout=60,
            )
            for chunk in stream:
                delta = chunk.choices[0].delta.content
                if delta:
                    yield f"data: {json.dumps({'token': delta})}\n\n"
            yield "data: [DONE]\n\n"
        except Exception as exc:
            msg = str(exc)
            if "api_key" in msg.lower() or "authentication" in msg.lower():
                msg = "Invalid or missing OpenAI API key. Check your .env file."
            elif "quota" in msg.lower() or "billing" in msg.lower():
                msg = "OpenAI quota exceeded. Check your account billing."
            yield f"data: {json.dumps({'error': msg})}\n\n"

    return Response(
        stream_with_context(_stream()),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


if __name__ == "__main__":
    port  = int(os.environ.get("PORT", 5000))
    debug = os.environ.get("FLASK_DEBUG", "false").lower() == "true"
    app.run(debug=debug, port=port)
