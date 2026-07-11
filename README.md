# Unblinder

An AI walking assistant for visually impaired pedestrians.

It watches the path ahead through the user's camera, detects obstacles with YOLO, fuses them with OpenStreetMap walking directions, and speaks a single calm, safety-first briefing — obstacles first if something is close, then the next turn and how far away it is.

The camera runs **in the browser**, not on the server. On a phone that means the rear camera is the one pointed at the path, and the whole thing works deployed to the cloud rather than only on the laptop the server happens to run on.

---

## How it works

```
 browser camera ──JPEG frames──▶  /ws  ──▶  YOLO11 (ONNX Runtime)
       ▲                                          │
       └────────── labels + boxes ────────────────┘

 OpenStreetMap (Nominatim + OSRM) ──▶ route ──┐
                                               ├──▶ Groq LLM ──▶ spoken briefing
 live obstacle detections ──────────────────────┘
```

The frontend captures frames, downscales them to 640px, and streams them over a WebSocket. The backend detects on each frame and returns labels plus normalized bounding boxes, which the browser draws over its own live video.

Only one frame is ever in flight: the next is sent when the previous one's detections come back. A slow server therefore lowers the frame rate rather than building a backlog of stale frames — which matters, because a detection you receive two seconds late is worse than no detection at all.

Detection runs on **ONNX Runtime rather than torch**. Torch needs roughly 400MB resident before doing any work and gets OOM-killed on a small instance; the same exported model runs in about 200MB total. `detector.py` does the pre/post-processing that ultralytics would otherwise hide: letterboxing, `cxcywh → xyxy`, undoing the letterbox, and per-class NMS.

Distance is estimated from apparent box height. It's monocular vision — there is no depth to read, only size — so "4 steps away" is an informed guess, not a measurement.

---

## What it does

**Guide me** — fuses live obstacles with your route and speaks one briefing: what's in the way and how to avoid it, then which way to turn and how far to the turn.

**Objects** — reads out the scene summary and every tracked object, nearest first, with position and steps.

**Weather** — pulls conditions for your live coordinates and turns them into plain spoken advice, for someone who cannot see the sky.

**Assistant** — ask anything out loud. It answers grounded in what the camera can currently see, and if you ask to *go* somewhere ("take me to Cubbon Park"), it recognizes that as a destination and sets the route itself — no typing.

**Destinations** can be a place name, raw coordinates, or a pasted Google Maps link, including a shortened `maps.app.goo.gl` one. Short links carry no coordinates; they redirect to a URL that does, and the browser can't follow that redirect because cross-origin requests to Google are blocked — so the server does it.

**Theme** — sky blue / white, with a dark mode. The toggle is in the header and your choice is remembered.

---

## API

| Route | Purpose |
|---|---|
| `WS /ws` | Send JPEG frames, receive detections |
| `GET /api/resolve` | Destination → coordinates. Place name, raw coordinates, or a Maps link |
| `GET /api/route` | Walking route and turn-by-turn checkpoints |
| `POST /api/briefing` | Fuses obstacles + navigation into one spoken briefing |
| `POST /api/ai_assist` | Answers a spoken question; may return a `navigate` intent |
| `GET /api/weather` | Conversational weather report |
| `GET /api/geocode` | Plain place-name lookup (`/api/resolve` supersedes this) |
| `GET /` | Service info page |

Interactive docs at `/docs`.

---

## Setup

You need Python 3.10+, Node.js, and a [Groq API key](https://console.groq.com/keys).

The model (`yolo11n.onnx`, 10MB) is committed — there's nothing to download.

**Backend**

```bash
python -m venv .venv
source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt

cp .env.example .env           # then set GROQ_API_KEY
uvicorn server:app --reload --port 8000
```

Without a `GROQ_API_KEY` the server still runs, but the briefing, assistant, and scene summary fall back to plain text.

**Frontend**

```bash
cd frontend
npm install
npm run dev
```

Open the Vite URL (usually http://localhost:5173). It talks to `http://localhost:8000` by default; set `VITE_BACKEND_URL` to point it elsewhere.

Browsers only grant camera access on `localhost` or over HTTPS. Voice input needs the Web Speech API, which today means a Chromium-based browser.

**Re-exporting the model**

`requirements-dev.txt` adds ultralytics, needed only to re-export `yolo11n.onnx` from a `.pt` file or to run `detect.py`. The server itself never imports torch.

---

## Deploying

Two services, both from this repo.

**Backend** — Render Web Service:

| | |
|---|---|
| Build | `pip install -r requirements.txt` |
| Start | `uvicorn server:app --host 0.0.0.0 --port $PORT` |
| Env | `GROQ_API_KEY` |

Runs in roughly 200MB, so a 512MB instance is enough.

**Frontend** — Render Static Site:

| | |
|---|---|
| Root directory | `frontend` |
| Build | `npm install && npm run build` |
| Publish directory | `dist` |
| Env | `VITE_BACKEND_URL` = the backend's URL |

`VITE_BACKEND_URL` is inlined at build time, so changing it requires a rebuild, not just a restart.

---

## Layout

```
server.py         FastAPI: frame socket, navigation, weather, LLM reasoning
detector.py       YOLO11 on ONNX Runtime — letterboxing, NMS, box mapping
detect.py         standalone local webcam script, for sanity-checking the model
yolo11n.onnx      the exported model
frontend/src/
  App.jsx         dashboard: video, detection overlay, map, voice, controls
  styles.css      theme tokens and component styles
```

Colours are defined once as CSS variables in `styles.css`. Flipping `data-theme` on `<html>` repaints the whole console, so no component holds a colour of its own.
