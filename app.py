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
    print("WARNING: OPENAI_API_KEY is not set.")

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
        "steps that walk through your reasoning. Be clear, educational, and precise."
    ),
    "expert": (
        "You are Forma, an expert spatial reasoning system used by engineers, architects, and "
        "scientists. Assume domain knowledge. Provide rigorous, numbered analysis with relevant "
        "formulas, technical terminology, and quantitative estimates."
    ),
}
_MAX_TOKENS = {"quick": 600, "deep": 1500, "expert": 2000}

# ── Constants ──────────────────────────────────────────────────────────────────

ALLOWED_EXT = {"png", "jpg", "jpeg", "webp", "gif"}
MAX_BYTES   = 20 * 1024 * 1024
RATE_LIMIT  = 15

# ── SQLite ─────────────────────────────────────────────────────────────────────

# Use /tmp on Vercel (read-only filesystem), local dir otherwise
_is_vercel = bool(os.environ.get("VERCEL"))
DB_PATH = "/tmp/forma.db" if _is_vercel else os.path.join(os.path.dirname(__file__), "forma.db")

def _get_db():
    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row
    return db

def _init_db():
    with _get_db() as db:
        db.executescript("""
            CREATE TABLE IF NOT EXISTS analyses (
                id         TEXT    PRIMARY KEY,
                question   TEXT    NOT NULL,
                answer     TEXT    NOT NULL,
                mode       TEXT    NOT NULL,
                image_b64  TEXT,
                project_id TEXT,
                created_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS projects (
                id         TEXT    PRIMARY KEY,
                name       TEXT    NOT NULL,
                emoji      TEXT    NOT NULL DEFAULT '📁',
                created_at INTEGER NOT NULL
            );
        """)
_init_db()

# ── Rate limiter ───────────────────────────────────────────────────────────────

_rate: dict = defaultdict(list)
_uses_log: list = []  # global per-minute log for stats

def _is_limited(ip: str) -> bool:
    now = time.time()
    _rate[ip] = [t for t in _rate[ip] if now - t < 60]
    if len(_rate[ip]) >= RATE_LIMIT:
        return True
    _rate[ip].append(now)
    _uses_log.append(now)
    return False

def _uses_this_minute() -> int:
    now = time.time()
    return len([t for t in _uses_log if now - t < 60])

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

# ── PDF generation ─────────────────────────────────────────────────────────────

def _make_pdf(rows):
    """Generate a PDF from a list of analysis rows. Returns bytes."""
    try:
        from reportlab.lib.pagesizes import letter
        from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
        from reportlab.lib.units import inch
        from reportlab.lib import colors
        from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, HRFlowable, Image as RLImage
        from reportlab.lib.enums import TA_LEFT
        import io, base64 as b64

        buf = io.BytesIO()
        doc = SimpleDocTemplate(buf, pagesize=letter,
                                leftMargin=inch, rightMargin=inch,
                                topMargin=inch, bottomMargin=inch)
        styles = getSampleStyleSheet()
        title_style = ParagraphStyle('title', parent=styles['Title'],
                                     fontSize=20, textColor=colors.black, spaceAfter=6)
        q_style     = ParagraphStyle('q', parent=styles['Normal'],
                                     fontSize=11, textColor=colors.HexColor('#333333'),
                                     fontName='Helvetica-Bold', spaceAfter=4)
        a_style     = ParagraphStyle('a', parent=styles['Normal'],
                                     fontSize=10, textColor=colors.HexColor('#111111'),
                                     leading=16, spaceAfter=12)
        meta_style  = ParagraphStyle('meta', parent=styles['Normal'],
                                     fontSize=9, textColor=colors.HexColor('#888888'), spaceAfter=16)

        story = [Paragraph("Forma Analysis Report", title_style),
                 Paragraph(f"Generated {time.strftime('%B %d, %Y')}", meta_style),
                 HRFlowable(width="100%", thickness=1, color=colors.HexColor('#cccccc')),
                 Spacer(1, 0.2*inch)]

        for row in rows:
            qtext = row['question'] if isinstance(row, dict) else row[1]
            atext = row['answer']   if isinstance(row, dict) else row[2]
            mode  = row['mode']     if isinstance(row, dict) else row[3]
            img64 = row.get('image_b64') if isinstance(row, dict) else (row[4] if len(row) > 4 else None)
            ts    = row['created_at'] if isinstance(row, dict) else row[5]

            story.append(Paragraph(_esc(qtext), q_style))
            story.append(Paragraph(f"Mode: {mode} · {time.strftime('%b %d %Y', time.localtime(ts))}", meta_style))

            if img64:
                try:
                    img_data = b64.b64decode(img64)
                    img_io   = io.BytesIO(img_data)
                    rl_img   = RLImage(img_io, width=3*inch, height=2*inch)
                    story.append(rl_img)
                    story.append(Spacer(1, 0.1*inch))
                except Exception:
                    pass

            # Format answer paragraphs
            for line in atext.split('\n'):
                if line.strip():
                    story.append(Paragraph(_esc(line), a_style))

            story.append(HRFlowable(width="100%", thickness=0.5, color=colors.HexColor('#eeeeee')))
            story.append(Spacer(1, 0.2*inch))

        doc.build(story)
        buf.seek(0)
        return buf.read()
    except ImportError:
        return None

# ── Share page template ────────────────────────────────────────────────────────

_SHARE_TPL = """<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Forma — {q_short}</title>
<style>*{{box-sizing:border-box;margin:0;padding:0}}body{{background:#000;color:#f0f0f0;font-family:system-ui,sans-serif;line-height:1.6;min-height:100vh}}
nav{{position:fixed;top:0;left:0;right:0;height:48px;display:flex;align-items:center;justify-content:space-between;padding:0 2rem;background:rgba(0,0,0,.9);border-bottom:1px solid #1c1c1c}}
.logo{{font-size:.95rem;font-weight:800;letter-spacing:-.03em}}.cta{{background:#fff;color:#000;border:none;padding:.28rem .8rem;border-radius:5px;font-size:.75rem;font-weight:700;cursor:pointer;text-decoration:none}}
main{{max-width:720px;margin:0 auto;padding:5.5rem 1.5rem 4rem}}.badge{{display:inline-block;border:1px solid #2a2a2a;color:#a0a0a0;border-radius:4px;padding:.1rem .45rem;font-size:.65rem;font-weight:700;letter-spacing:.06em;margin-bottom:1.25rem}}
.q-box{{background:#0d0d0d;border:1px solid #1c1c1c;border-radius:10px;padding:1.1rem 1.25rem;margin-bottom:1rem}}.q-label{{font-size:.62rem;font-weight:700;letter-spacing:.08em;color:#404040;text-transform:uppercase;margin-bottom:.4rem}}
.q-text{{font-size:.95rem;font-weight:600;color:#f0f0f0}}.a-box{{background:#0d0d0d;border:1px solid #1c1c1c;border-radius:10px;overflow:hidden}}
.a-head{{padding:.6rem 1rem;border-bottom:1px solid #1c1c1c;background:#111;font-size:.72rem;font-weight:700;color:#a0a0a0;letter-spacing:.04em}}
.a-body{{padding:1.1rem 1rem;font-family:'Courier New',monospace;font-size:.8rem;line-height:1.9;color:#c8c8c8;white-space:pre-wrap;word-break:break-word}}
.sn{{color:#fff;font-weight:700}}.foot{{text-align:center;margin-top:2rem;padding-top:2rem;border-top:1px solid #1c1c1c;font-size:.78rem;color:#404040}}
</style></head><body>
<nav><div class="logo">Forma</div><a href="/" class="cta">Try Forma</a></nav>
<main>
<div class="badge">SHARED ANALYSIS · {mode} · {created}</div>
<div class="q-box"><div class="q-label">Question</div><div class="q-text">{question}</div></div>
<div class="a-box"><div class="a-head">FORMA OUTPUT</div><div class="a-body">{answer}</div></div>
<div class="foot">Generated by Forma — Spatial Reasoning Engine</div>
</main></body></html>"""

# ── Helpers ────────────────────────────────────────────────────────────────────

def _validate_image(f):
    """Returns (raw_bytes, mime_type, error_response)"""
    if not f or not f.filename:
        return None, None, (jsonify({"error": "No image provided."}), 400)
    if not _ext_ok(f.filename):
        return None, None, (jsonify({"error": "Unsupported file type."}), 400)
    raw = f.read()
    if len(raw) > MAX_BYTES:
        return None, None, (jsonify({"error": "Image too large (max 20 MB)."}), 400)
    if not _magic_ok(raw):
        return None, None, (jsonify({"error": "Invalid image content."}), 400)
    ext  = f.filename.rsplit(".", 1)[1].lower()
    mime = {"jpg":"image/jpeg","jpeg":"image/jpeg","png":"image/png",
            "webp":"image/webp","gif":"image/gif"}.get(ext, "image/jpeg")
    return raw, mime, None

# ── Routes: static ─────────────────────────────────────────────────────────────

@app.route("/")
def index():
    return send_from_directory(".", "index.html")

@app.route("/ping")
def ping():
    return jsonify({"protected": bool(_pw), "ok": True})

@app.route("/auth", methods=["POST"])
def auth():
    if not _pw:
        return jsonify({"ok": True})
    key = (request.json or {}).get("key", "")
    return jsonify({"ok": key == _pw})

@app.route("/stats")
def stats():
    uses = _uses_this_minute()
    db_size = os.path.getsize(DB_PATH) // 1024 if os.path.exists(DB_PATH) else 0
    with _get_db() as db:
        total = db.execute("SELECT COUNT(*) FROM analyses").fetchone()[0]
    return jsonify({"total_analyses": total, "db_size_kb": db_size,
                    "uses_this_minute": uses, "rate_limit": RATE_LIMIT})

@app.route("/config", methods=["POST"])
def set_config():
    """Save config. On Vercel applies in-memory only; locally writes .env."""
    data = request.json or {}
    api_key  = data.get("api_key", "").strip()
    password = data.get("password", "").strip()

    global _pw
    if password:
        _pw = password
        os.environ["FORMA_PASSWORD"] = password
    if api_key:
        os.environ["OPENAI_API_KEY"] = api_key
        client.api_key = api_key

    if not _is_vercel:
        env_path = os.path.join(os.path.dirname(__file__), ".env")
        lines = []
        if os.path.exists(env_path):
            with open(env_path) as f:
                for line in f:
                    k = line.split("=", 1)[0].strip()
                    if k not in ("OPENAI_API_KEY", "FORMA_PASSWORD"):
                        lines.append(line.rstrip())
        if api_key:  lines.append(f"OPENAI_API_KEY={api_key}")
        if password: lines.append(f"FORMA_PASSWORD={password}")
        with open(env_path, "w") as f:
            f.write("\n".join(lines) + "\n")

    return jsonify({"ok": True})

# ── Routes: projects ───────────────────────────────────────────────────────────

@app.route("/projects", methods=["GET"])
def list_projects():
    with _get_db() as db:
        rows = db.execute("SELECT * FROM projects ORDER BY created_at DESC").fetchall()
        result = []
        for r in rows:
            count = db.execute("SELECT COUNT(*) FROM analyses WHERE project_id=?", (r["id"],)).fetchone()[0]
            result.append({**dict(r), "analysis_count": count})
    return jsonify(result)

@app.route("/projects", methods=["POST"])
def create_project():
    data  = request.json or {}
    name  = data.get("name", "").strip()
    emoji = data.get("emoji", "📁")
    if not name:
        return jsonify({"error": "Project name required."}), 400
    pid = secrets.token_hex(4)
    with _get_db() as db:
        db.execute("INSERT INTO projects VALUES (?,?,?,?)", (pid, name, emoji, int(time.time())))
    return jsonify({"id": pid, "name": name, "emoji": emoji})

@app.route("/projects/<pid>", methods=["DELETE"])
def delete_project(pid):
    with _get_db() as db:
        db.execute("UPDATE analyses SET project_id=NULL WHERE project_id=?", (pid,))
        db.execute("DELETE FROM projects WHERE id=?", (pid,))
    return jsonify({"ok": True})

@app.route("/projects/<pid>", methods=["PATCH"])
def update_project(pid):
    data = request.json or {}
    fields, vals = [], []
    if "name"  in data: fields.append("name=?");  vals.append(data["name"].strip())
    if "emoji" in data: fields.append("emoji=?"); vals.append(data["emoji"])
    if not fields:
        return jsonify({"error": "Nothing to update."}), 400
    vals.append(pid)
    with _get_db() as db:
        db.execute(f"UPDATE projects SET {','.join(fields)} WHERE id=?", vals)
    return jsonify({"ok": True})

@app.route("/projects/<pid>/analyses", methods=["GET"])
def project_analyses(pid):
    with _get_db() as db:
        rows = db.execute(
            "SELECT id,question,answer,mode,created_at FROM analyses WHERE project_id=? ORDER BY created_at DESC",
            (pid,)).fetchall()
    return jsonify([dict(r) for r in rows])

@app.route("/analyses/<aid>/move", methods=["PATCH"])
def move_analysis(aid):
    pid = (request.json or {}).get("project_id")  # None to remove from project
    with _get_db() as db:
        db.execute("UPDATE analyses SET project_id=? WHERE id=?", (pid, aid))
    return jsonify({"ok": True})

# ── Routes: search ─────────────────────────────────────────────────────────────

@app.route("/search")
def search():
    q      = request.args.get("q", "").strip()
    mode   = request.args.get("mode", "")
    from_ts = int(request.args.get("from", 0))
    to_ts   = int(request.args.get("to", int(time.time()) + 86400))
    limit   = min(int(request.args.get("limit", 50)), 200)

    sql    = "SELECT id,question,answer,mode,created_at FROM analyses WHERE created_at BETWEEN ? AND ?"
    params = [from_ts, to_ts]
    if q:
        sql += " AND (question LIKE ? OR answer LIKE ?)"
        like = f"%{q}%"; params += [like, like]
    if mode:
        sql += " AND mode=?"; params.append(mode)
    sql += " ORDER BY created_at DESC LIMIT ?"
    params.append(limit)

    with _get_db() as db:
        rows = db.execute(sql, params).fetchall()
    return jsonify([dict(r) for r in rows])

# ── Routes: save / share ───────────────────────────────────────────────────────

@app.route("/save", methods=["POST"])
def save():
    if not _authed(request):
        return jsonify({"error": "Unauthorized"}), 401
    data       = request.json or {}
    question   = data.get("question", "").strip()
    answer     = data.get("answer",   "").strip()
    mode       = data.get("mode",     "deep")
    project_id = data.get("project_id")
    image_b64  = data.get("image_b64")  # optional thumbnail
    if not question or not answer:
        return jsonify({"error": "Missing question or answer."}), 400
    sid = secrets.token_hex(4)
    with _get_db() as db:
        db.execute("INSERT INTO analyses VALUES (?,?,?,?,?,?,?)",
                   (sid, question, answer, mode, image_b64, project_id, int(time.time())))
    base = request.host_url.rstrip("/")
    return jsonify({"id": sid, "url": f"{base}/r/{sid}"})

@app.route("/r/<sid>")
def shared(sid):
    with _get_db() as db:
        row = db.execute("SELECT question,answer,mode,created_at FROM analyses WHERE id=?", (sid,)).fetchone()
    if not row:
        return "Analysis not found.", 404
    answer_html = re.sub(r"^(Step\s+\d+[:.)]?|\d+[.)]\s*)",
                         r'<span class="sn">\1</span>', _esc(row["answer"]), flags=re.MULTILINE)
    return _SHARE_TPL.format(
        q_short=_esc(row["question"][:60]), question=_esc(row["question"]),
        answer=answer_html, mode=_esc(row["mode"]),
        created=time.strftime("%B %d, %Y", time.localtime(row["created_at"])), sid=sid)

# ── Routes: export ─────────────────────────────────────────────────────────────

@app.route("/export/<sid>/pdf")
def export_analysis_pdf(sid):
    with _get_db() as db:
        row = db.execute("SELECT * FROM analyses WHERE id=?", (sid,)).fetchone()
    if not row:
        return "Not found.", 404
    pdf = _make_pdf([dict(row)])
    if not pdf:
        return jsonify({"error": "reportlab not installed."}), 500
    return Response(pdf, mimetype="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="forma-{sid}.pdf"'})

@app.route("/projects/<pid>/export/pdf")
def export_project_pdf(pid):
    with _get_db() as db:
        proj = db.execute("SELECT name FROM projects WHERE id=?", (pid,)).fetchone()
        rows = db.execute("SELECT * FROM analyses WHERE project_id=? ORDER BY created_at", (pid,)).fetchall()
    if not proj:
        return "Project not found.", 404
    pdf = _make_pdf([dict(r) for r in rows])
    if not pdf:
        return jsonify({"error": "reportlab not installed."}), 500
    name = re.sub(r'[^\w\-]', '_', proj["name"])
    return Response(pdf, mimetype="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="forma-{name}.pdf"'})

# ── Routes: batch ──────────────────────────────────────────────────────────────

@app.route("/batch", methods=["POST"])
def batch():
    if not _authed(request):
        return jsonify({"error": "Unauthorized"}), 401

    files     = request.files.getlist("images")
    questions = request.form.getlist("questions")  # one per image, or one shared
    mode      = request.form.get("mode", "deep")
    project_id = request.form.get("project_id")
    shared_q  = request.form.get("question", "")  # fallback if per-image questions not provided

    if not files:
        return jsonify({"error": "No images provided."}), 400

    results = []
    for i, f in enumerate(files):
        q = (questions[i] if i < len(questions) else None) or shared_q
        if not q:
            results.append({"error": "No question for image.", "filename": f.filename})
            continue

        raw, mime, err = _validate_image(f)
        if err:
            results.append({"error": err[0].get_json()["error"], "filename": f.filename})
            continue

        data_url = f"data:{mime};base64,{base64.b64encode(raw).decode()}"
        try:
            resp = client.chat.completions.create(
                model="gpt-4o",
                messages=[
                    {"role": "system", "content": _PROMPTS.get(mode, _PROMPTS["deep"])},
                    {"role": "user", "content": [
                        {"type": "image_url", "image_url": {"url": data_url, "detail": "high"}},
                        {"type": "text", "text": q},
                    ]},
                ],
                max_tokens=_MAX_TOKENS.get(mode, 1500),
                timeout=60,
            )
            answer = resp.choices[0].message.content
            sid    = secrets.token_hex(4)
            img_b64_thumb = base64.b64encode(raw[:1024*50]).decode() if len(raw) <= 1024*50 else None
            with _get_db() as db:
                db.execute("INSERT INTO analyses VALUES (?,?,?,?,?,?,?)",
                           (sid, q, answer, mode, img_b64_thumb, project_id, int(time.time())))
            results.append({"id": sid, "filename": f.filename, "question": q, "answer": answer})
        except Exception as exc:
            results.append({"error": str(exc), "filename": f.filename})

    return jsonify({"results": results, "count": len(results)})

# ── Routes: analyze (streaming) ───────────────────────────────────────────────

@app.route("/analyze", methods=["POST"])
def analyze():
    if not _authed(request):
        return jsonify({"error": "Unauthorized.", "auth": True}), 401

    ip = (request.headers.get("X-Forwarded-For","") or request.remote_addr or "").split(",")[0].strip()
    if _is_limited(ip):
        return jsonify({"error": "Rate limit exceeded. Wait a moment."}), 429

    f = request.files.get("image")
    raw, mime, err = _validate_image(f)
    if err:
        return err

    question = request.form.get("question", "").strip()
    if not question:
        return jsonify({"error": "No question provided."}), 400

    mode = request.form.get("mode", "deep")
    if mode not in _PROMPTS:
        mode = "deep"

    data_url = f"data:{mime};base64,{base64.b64encode(raw).decode()}"
    turns    = json.loads(request.form.get("history", "[]"))

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
                model="gpt-4o", messages=msgs,
                max_tokens=_MAX_TOKENS[mode], stream=True, timeout=60,
            )
            for chunk in stream:
                delta = chunk.choices[0].delta.content
                if delta:
                    yield f"data: {json.dumps({'token': delta})}\n\n"
            yield "data: [DONE]\n\n"
        except Exception as exc:
            msg = str(exc)
            if "api_key" in msg.lower() or "authentication" in msg.lower():
                msg = "Invalid or missing OpenAI API key."
            elif "quota" in msg.lower() or "billing" in msg.lower():
                msg = "OpenAI quota exceeded."
            yield f"data: {json.dumps({'error': msg})}\n\n"

    return Response(stream_with_context(_stream()), mimetype="text/event-stream",
                    headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


if __name__ == "__main__":
    port  = int(os.environ.get("PORT", 5001))
    debug = os.environ.get("FLASK_DEBUG", "false").lower() == "true"
    app.run(debug=debug, port=port, threaded=True)
