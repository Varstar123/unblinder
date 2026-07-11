# Unblinder

An AI walking assistant for visually impaired pedestrians.

It watches the path ahead through the user's camera, detects obstacles with YOLO, fuses them with OpenStreetMap walking directions, and speaks a single calm, safety-first briefing — obstacles first if something is close, then the next turn and how far away it is.

A second, slower pass sends the actual frame to a vision-language model, so it can also warn about the things a detector has no class for — broken pavement, kerbs, steps, puddles, barriers — and read a sign out loud when asked.

The camera runs **in the browser**, not on the server. On a phone that means the rear camera is the one pointed at the path, and the whole thing works deployed to the cloud rather than only on the laptop the server happens to run on.

---

## How it works

```
                                        FAST PATH — every frame, ~10fps, local
 browser camera ──JPEG frames──▶  /ws  ──▶  YOLO11 (ONNX Runtime)
       ▲                                          │
       └────────── labels + boxes ────────────────┤
                                                  │
                                                  ▼   SLOW PATH — every 6s, remote
                                        Fireworks VLM ──▶ scene + hazards + sign text

 OpenStreetMap (Nominatim + OSRM) ──▶ route ──┐
                                               ├──▶ Groq LLM ──▶ spoken briefing
 live obstacle detections ──────────────────────┘
```

The frontend captures frames, downscales them to 640px, and streams them over a WebSocket. The backend detects on each frame and returns labels plus normalized bounding boxes, which the browser draws over its own live video.

Only one frame is ever in flight: the next is sent when the previous one's detections come back. A slow server therefore lowers the frame rate rather than building a backlog of stale frames — which matters, because a detection you receive two seconds late is worse than no detection at all.

Detection runs on **ONNX Runtime rather than torch**. Torch needs roughly 400MB resident before doing any work and gets OOM-killed on a small instance; the same exported model runs in about 200MB total. `detector.py` does the pre/post-processing that ultralytics would otherwise hide: letterboxing, `cxcywh → xyxy`, undoing the letterbox, and per-class NMS.

Distance is estimated from apparent box height. It's monocular vision — there is no depth to read, only size — so "4 steps away" is an informed guess, not a measurement.

### Two tiers of sight

YOLO is fast and precise but only knows COCO's 80 classes, and it gives geometry — boxes, sides, steps. A VLM is slow and gives no coordinates at all, but it sees an open-ended scene and can be asked questions. They are not substitutes, so the app runs both.

**The fast path** is YOLO on every frame. It drives the bounding-box overlay, the tracked-object list, and the obstacle half of the Guide Me briefing. It is entirely local — no network — and it is what the safety-critical warnings depend on, so nothing slow is allowed near it.

**The slow path** sends the real JPEG to a vision-language model every few seconds. This exists because most of what actually matters underfoot has no COCO class: a pothole, a kerb, a flight of steps, a puddle, a construction barrier, the text on a sign. Before it, the "scene summary" was the LLM being handed the string `"person, car, bench"` and asked to guess an environment — it had never seen a pixel.

`/api/briefing` (Guide Me) deliberately stays on Groq. It is the safety-critical path and a VLM costs seconds; it has no business there.

Everything degrades gracefully: with no `FIREWORKS_API_KEY`, or on any API failure, both the scene summary and the assistant silently fall back to the label-only path. The VLM can never take the app down — but the fallback being silent is also why the server prints which path it is on at startup.

---

## What it does

**Guide me** — fuses live obstacles with your route and speaks one briefing: what's in the way and how to avoid it, then which way to turn and how far to the turn.

**Objects** — reads out the scene summary and every tracked object, nearest first, with position and steps.

**Weather** — pulls conditions for your live coordinates and turns them into plain spoken advice, for someone who cannot see the sky.

**Assistant** — ask anything out loud. The question goes to the VLM together with the live frame, so it answers from what is actually in front of you rather than from a list of labels. That means it can describe hazards nothing was trained to detect, and it can **read a sign aloud** — *"what does that sign say?"* → *"the sign says wet floor; take care, the ground ahead may be slippery."*

If instead you ask to *go* somewhere ("take me to Cubbon Park"), it recognizes that as a destination and sets the route itself — no typing.

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

You need Python 3.10+, Node.js, and a [Groq API key](https://console.groq.com/keys). A [Fireworks API key](https://fireworks.ai/account/api-keys) is optional but is what gives the app open-ended sight.

The model (`yolo11n.onnx`, 10MB) is committed — there's nothing to download.

**Backend**

```bash
python -m venv .venv
source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt

cp .env.example .env           # then set GROQ_API_KEY (and optionally FIREWORKS_API_KEY)
uvicorn server:app --reload --port 8000
```

| Variable | Required | What it does |
|---|---|---|
| `GROQ_API_KEY` | yes | Briefing, weather, and the text-only fallbacks |
| `FIREWORKS_API_KEY` | no | Turns on the VLM. Without it the app never sees the image |
| `FIREWORKS_VLM_MODEL` | no | Defaults to `accounts/fireworks/models/kimi-k2p6` |
| `VLM_INTERVAL_S` | no | Seconds between VLM calls, default `6`. The only knob that moves cost |

Without a `GROQ_API_KEY` the server still runs, but the briefing, assistant, and scene summary fall back to plain text.

The server prints which vision path it is on at startup, because the fallback is otherwise silent:

```
[vision] Fireworks VLM enabled: accounts/fireworks/models/kimi-k2p6, every 6s
[vision] disabled (no FIREWORKS_API_KEY): scene summary is YOLO labels only
```

**Two things that will bite you if you change the model**

`FIREWORKS_VLM_MODEL` must name a model whose `/v1/models` entry has `supports_image_input: true`. Most of the catalogue is text-only and will **ignore the image without erroring** — you get a confident answer about a photo the model never saw, which is the worst possible failure mode here.

`_vlm_chat` sends `reasoning_effort: "none"`, and that is load-bearing rather than a tuning choice. Kimi is a reasoning model: left on, it streams its chain-of-thought into `content` with no delimiter to strip, so the text handed to text-to-speech is the model thinking out loud — and it exhausts the token budget deliberating before it ever reaches an answer. Off, a call drops from 400+ completion tokens and nothing usable to ~22 tokens and a clean sentence. JSON mode does not suppress it; neither does `"low"`.

**Cost**

Roughly 10 calls a minute while the camera is streaming, and **zero** when it isn't — an idle guard skips the loop if no frame has arrived in 15 seconds, so leaving the backend running costs nothing. The per-frame detection loop and Guide Me never call Fireworks at all.

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
| Env | `GROQ_API_KEY`, and `FIREWORKS_API_KEY` if you want the VLM |

Runs in roughly 200MB, so a 512MB instance is enough. The VLM is a hosted API call, not a local model, so turning it on costs no memory.

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
server.py         FastAPI: frame socket, VLM, navigation, weather, LLM reasoning
detector.py       YOLO11 on ONNX Runtime — letterboxing, NMS, box mapping
detect.py         standalone local webcam script, for sanity-checking the model
yolo11n.onnx      the exported model
frontend/src/
  App.jsx         dashboard: video, detection overlay, map, voice, controls
  styles.css      theme tokens and component styles
```

Inside `server.py`, the vision layer is `_vlm_chat` (one frame + a prompt to Fireworks), `scene_analyzer_loop` (the slow pass), and `_scene_from_labels` (the fallback that never sees the image).

Colours are defined once as CSS variables in `styles.css`. Flipping `data-theme` on `<html>` repaints the whole console, so no component holds a colour of its own.
