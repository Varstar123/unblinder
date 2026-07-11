# Unblinder

An AI walking assistant for visually impaired pedestrians. It watches the path ahead through the user's camera, detects obstacles with YOLO, fuses them with OpenStreetMap walking directions, and speaks a single calm, safety-first briefing through text-to-speech.

The camera runs **in the browser**, not on the server — so on a phone, the rear camera is the one pointed at the path, and the whole thing works when deployed to the cloud.

## How it works

```
browser camera ──JPEG frames──▶  /ws  ──▶ YOLO (yolo11n)
     ▲                                        │
     └────────── detections + boxes ──────────┘

OpenStreetMap (Nominatim + OSRM) ──▶ route ──┐
                                              ├──▶ Groq LLM ──▶ spoken briefing
live obstacle detections ─────────────────────┘
```

The frontend captures frames, downscales them to 640px, and streams them over a WebSocket. The backend runs detection and sends back labels plus normalized bounding boxes, which the browser draws over the live video. Only one frame is in flight at a time, so a slow server lowers the frame rate rather than building a backlog of stale frames.

## API

| Route | Purpose |
|---|---|
| `GET /` | Service info page |
| `WS /ws` | Send JPEG frames, receive detections |
| `POST /api/briefing` | Fuses obstacles + navigation into one spoken briefing ("Guide Me") |
| `POST /api/ai_assist` | Answers a spoken question, grounded in what the camera sees |
| `GET /api/weather` | Conversational weather report for someone who can't see the sky |
| `GET /api/geocode` | Destination string → coordinates |
| `GET /api/route` | Walking route + turn-by-turn checkpoints |

Interactive docs are at `/docs`.

## Setup

You need Python 3.10+, Node.js, and a [Groq API key](https://console.groq.com/keys).

The model (`yolo11n.onnx`, 10MB) is committed, so there's nothing to download. Detection runs on **ONNX Runtime, not torch** — torch needs ~400MB resident and won't fit in a small instance, while this runs the same exported model in about 200MB total. If you want to re-export it from `.pt`, or run `detect.py`, install `requirements-dev.txt` instead, which adds ultralytics.

**Backend:**

```bash
python -m venv .venv
source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt

cp .env.example .env           # then set GROQ_API_KEY
uvicorn server:app --reload --port 8000
```

Without a `GROQ_API_KEY` the server still runs, but the briefing, assistant, and scene summary degrade to plain fallbacks.

**Frontend:**

```bash
cd frontend
npm install
npm run dev
```

Open the Vite URL (usually http://localhost:5173). The dashboard talks to `http://localhost:8000` by default; set `VITE_BACKEND_URL` to point it elsewhere.

Note that browsers only grant camera access on `localhost` or over HTTPS.

## Deploying

**Backend** — Render Web Service:

- Build: `pip install -r requirements.txt`
- Start: `uvicorn server:app --host 0.0.0.0 --port $PORT`
- Env: `GROQ_API_KEY`

The server runs in roughly 200MB, so a 512MB instance is enough.

**Frontend** — Render Static Site:

- Root directory: `frontend`
- Build: `npm install && npm run build`
- Publish directory: `dist`
- Env: `VITE_BACKEND_URL` = your backend's URL

## Layout

- `server.py` — FastAPI backend: detection socket, navigation, weather, LLM reasoning
- `detect.py` — standalone local webcam script, for quickly sanity-checking the model
- `frontend/src/App.jsx` — the dashboard: video, overlay, map, voice, and controls
