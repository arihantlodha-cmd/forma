# Forma — Spatial Reasoning Engine

Upload any image with shapes, spaces, or diagrams and get step-by-step AI reasoning about what's in it.

## Tech Stack

- **Frontend**: Plain HTML + CSS + Vanilla JavaScript (single `index.html`)
- **Backend**: Python + Flask (single `app.py`)
- **AI**: OpenAI GPT-4o Vision API

## Setup

### 1. Clone the repo

```bash
git clone <repo-url>
cd forma
```

### 2. Create a virtual environment and install dependencies

```bash
python -m venv venv
source venv/bin/activate      # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

### 3. Configure environment variables

```bash
cp .env.example .env
```

Open `.env` and set your OpenAI API key:

```
OPENAI_API_KEY=sk-...
```

Get a key at [platform.openai.com/api-keys](https://platform.openai.com/api-keys).

### 4. Run locally

```bash
python app.py
```

Visit [http://localhost:5000](http://localhost:5000).

## Deploy to Replit

1. Create a new Replit project, upload all files.
2. Add `OPENAI_API_KEY` as a Replit Secret.
3. Set the run command to `python app.py`.
4. Hit **Run**.

## Deploy to Vercel

Vercel doesn't natively serve Flask, but you can use the `vercel-python` adapter:

1. Install the Vercel CLI: `npm i -g vercel`
2. Add a `vercel.json`:

```json
{
  "builds": [{ "src": "app.py", "use": "@vercel/python" }],
  "routes": [{ "src": "/(.*)", "dest": "app.py" }]
}
```

3. Add `OPENAI_API_KEY` as a Vercel Environment Variable.
4. Run `vercel --prod`.

## File Structure

```
forma/
├── index.html         # Full frontend (single file)
├── app.py             # Flask backend with /analyze endpoint
├── requirements.txt   # Python dependencies
├── .env.example       # Environment variable template
├── .gitignore         # Ignores .env and pycache
└── README.md          # This file
```

## API

### `POST /analyze`

Accepts `multipart/form-data`:

| Field      | Type   | Description                     |
|------------|--------|---------------------------------|
| `image`    | file   | The image to analyze (max 20 MB)|
| `question` | string | The spatial question to answer  |

**Response (200)**:
```json
{ "answer": "Step-by-step reasoning from Forma..." }
```

**Response (4xx/5xx)**:
```json
{ "error": "Human-readable error message" }
```

---

Built by Arihant Lodha
