import threading
import time
import asyncio
import base64
import os
import re
import json
import urllib.request
import urllib.parse
import urllib.error
from typing import List, Optional

import numpy as np
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
import cv2
from groq import Groq
from dotenv import load_dotenv

from detector import Detector

load_dotenv()

app = FastAPI(title="Unblinder")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

GROQ_API_KEY = os.environ.get("GROQ_API_KEY")
groq_client = Groq(api_key=GROQ_API_KEY) if GROQ_API_KEY else None

# ==========================================
# VISION-LANGUAGE MODEL (optional)
# ==========================================
# YOLO only knows COCO's 80 classes. It cannot see a pothole, a kerb, a flight of
# steps, a puddle, or the text on a sign — and those are most of what actually
# matters underfoot. Without a VLM the scene summary is the LLM guessing at an
# environment from a bag of class names, having never seen a pixel.
#
# When a Fireworks key is present we send the real frame to a VLM instead. It runs
# on a slow loop, deliberately far away from the detection path: a VLM takes
# seconds, and the obstacle warnings depend on the frame loop staying realtime.
#
# Everything degrades to the label-only path if the key is absent or a call fails.
FIREWORKS_API_KEY = os.environ.get("FIREWORKS_API_KEY")
# Must be a model whose /v1/models entry has supports_image_input=true. Most of the
# catalogue is text-only and will simply ignore the image, which fails silently:
# you get a confident answer about a photo the model never saw.
FIREWORKS_VLM_MODEL = os.environ.get(
    "FIREWORKS_VLM_MODEL", "accounts/fireworks/models/kimi-k2p6"
)
FIREWORKS_URL = "https://api.fireworks.ai/inference/v1/chat/completions"
VISION_ENABLED = bool(FIREWORKS_API_KEY)

# The VLM is only ever called when the user asks — pressing Objects, or asking the
# assistant a question. There is no background loop, so a camera streaming for an
# hour with nobody pressing anything costs nothing at all.
MODEL_PATH = os.environ.get("YOLO_MODEL", "yolo11n.onnx")

# The camera lives in the user's browser, not on this server. Frames arrive over
# the /ws socket, get detected on, and the results go straight back down the same
# socket. Nothing here ever touches a local capture device.
detector = Detector(MODEL_PATH)
model_lock = threading.Lock()

state_lock = threading.Lock()
latest_objects: List[dict] = []
latest_frame_at = 0.0
# The most recent JPEG exactly as the browser sent it — already downscaled to 640px,
# which is what the VLM wants anyway. Held so the slow vision loop and the assistant
# can look at the real image instead of a list of labels.
latest_frame_jpeg: Optional[bytes] = None
# Only ever written by /api/scene, i.e. when the user presses Objects. Until then it
# says so, rather than implying an analysis has happened.
global_scene_context = "Press Objects to describe what is ahead."


def _vlm_chat(prompt: str, jpeg: bytes, max_tokens: int = 60,
              temperature: float = 0.2, json_mode: bool = False) -> str:
    """One frame plus a prompt to the Fireworks VLM. Raises on any failure —
    every caller is expected to fall back to the label-only path.

    reasoning_effort=none is load-bearing, not a tuning knob. Kimi is a reasoning
    model and by default streams its chain-of-thought into `content` with no
    delimiter to strip and no separate field to ignore — so the text we would end
    up speaking to a blind user is the model thinking out loud, and it burns the
    whole token budget deliberating before it ever reaches an answer. Turning
    reasoning off takes a call from 400+ completion tokens and no usable output to
    ~22 tokens and a clean sentence. JSON mode does not suppress it; only this does.
    """
    body = {
        "model": FIREWORKS_VLM_MODEL,
        "max_tokens": max_tokens,
        "temperature": temperature,
        "reasoning_effort": "none",
        "messages": [{
            "role": "user",
            "content": [
                {"type": "text", "text": prompt},
                {"type": "image_url", "image_url": {
                    "url": "data:image/jpeg;base64," + base64.b64encode(jpeg).decode(),
                }},
            ],
        }],
    }
    if json_mode:
        body["response_format"] = {"type": "json_object"}

    req = urllib.request.Request(
        FIREWORKS_URL,
        data=json.dumps(body).encode(),
        headers={
            "Authorization": f"Bearer {FIREWORKS_API_KEY}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        method="POST",
    )
    # A bare "it failed" is useless here, because the caller silently falls back and
    # the user just sees a plausible answer with no API call behind it. Fireworks puts
    # the actual cause (bad model id, no image support, out of credit) in the body.
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            payload = json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        try:
            detail = e.read().decode()[:300]
        except Exception:
            detail = "(no body)"
        raise RuntimeError(f"Fireworks HTTP {e.code}: {detail}") from None
    except urllib.error.URLError as e:
        raise RuntimeError(f"Fireworks unreachable: {e.reason}") from None

    return payload["choices"][0]["message"]["content"].strip()


def run_detection(frame):
    """Detects on one BGR frame and describes each hit the way a walker needs it:
    which side of the path it's on, and roughly how many steps away.

    Returns (objects, inference_ms). Boxes are already normalized to 0..1 by the
    detector, so the browser can draw them at whatever size it renders the video.
    """
    with model_lock:
        t0 = time.time()
        detections = detector.detect(frame)
        inference_ms = (time.time() - t0) * 1000.0

    objects = []
    for det in detections:
        x1, y1, x2, y2 = det["box"]
        center_x = (x1 + x2) / 2
        height_ratio = y2 - y1

        # A taller box means a closer object. Crude, but it's monocular vision —
        # there's no depth to read, only apparent size.
        position = "left" if center_x < 1 / 3 else "right" if center_x > 2 / 3 else "center"
        steps = 2 if height_ratio > 0.7 else 4 if height_ratio > 0.4 else 8 if height_ratio > 0.2 else 15

        objects.append({
            "name": det["name"],
            "confidence": det["confidence"],
            "position": position,
            "steps_away": steps,
            "box": det["box"],
        })

    return objects, inference_ms


# ==========================================
# SCENE ANALYZER — on demand only. The user presses Objects, we look once.
# ==========================================
# Nothing here runs on a loop. An earlier version re-analyzed every few seconds and
# spoke the result, which meant the app talked over the user continuously and billed
# a VLM call for scenery nobody had asked about. Now a camera left streaming costs
# exactly nothing until somebody asks a question.
VLM_SCENE_PROMPT = (
    "You are the eyes of a blind person who has just asked what is in front of them. "
    "This photo is the view directly ahead.\n"
    "Name what is in their path, nearest and most important first, and say roughly where "
    "each thing is — ahead, to your left, to your right. Include hazards an object detector "
    "cannot label: steps, kerbs, broken ground, puddles, barriers. Read out any sign text "
    "you can see.\n"
    "At most 3 short sentences, under 45 words. Plain spoken English, second person. "
    "No markdown, no preamble. If the way is clear, say so."
)


def _ask_with_vision(build_prompt, frame_jpeg, label, **kw):
    """Runs the VLM if it possibly can, and says out loud why if it can't.

    The fallback to text-only is the right behaviour — a walking aid must not go dark
    because an API did — but a *silent* fallback is how you end up staring at a
    plausible answer wondering why nothing ever reached Fireworks. There are three
    separate ways to land in the text path and from the outside they look identical,
    so every one of them gets named, logged, and returned to the client.

    Returns (raw_text_or_None, source, reason).
    """
    if not VISION_ENABLED:
        reason = "no FIREWORKS_API_KEY on the server"
    elif not frame_jpeg:
        reason = "no live camera frame (is the camera running?)"
    else:
        try:
            raw = _vlm_chat(build_prompt(True), frame_jpeg, **kw)
            print(f"[vision] {label}: answered from the image ({len(frame_jpeg)} byte frame)")
            return raw, "vlm", None
        except Exception as e:
            reason = str(e)

    print(f"[vision] {label}: FELL BACK to text-only: {reason}")
    return None, "text", reason


def _scene_from_labels(objects) -> Optional[str]:
    """The original summary: the LLM never sees the image, it guesses an environment
    from a bag of class names. Kept as the fallback when no VLM is configured."""
    if not groq_client:
        return None

    unique_items = list({obj["name"] for obj in objects})
    items_string = ", ".join(unique_items) if unique_items else "clear space"
    prompt = (
        f"Analyze these environment tokens: {items_string}. "
        "In exactly 4 to 7 words, identify the macro environment or room layout. "
        "Keep it strictly brief, descriptive, and clean. No formatting or commentary."
    )
    try:
        completion = groq_client.chat.completions.create(
            messages=[{"role": "user", "content": prompt}],
            model="llama-3.1-8b-instant",
            temperature=0.2,
            max_tokens=25,
        )
        return completion.choices[0].message.content
    except Exception:
        return None


# The guidance loop calls this every few seconds while Guide Me is on, so it must be
# terse and it must SHUT UP when there is nothing wrong. A hazard scanner that says
# "the path is clear" every seven seconds is just a loop of noise the user has to
# talk over — so the model is given an explicit way to say nothing: the word CLEAR.
VLM_HAZARD_PROMPT = (
    "You are watching the ground ahead for a blind person who is walking right now.\n"
    "Look ONLY for things that could hurt them within their next few steps: a pit or open "
    "hole, a missing drain cover, broken or uneven pavement, a step or kerb up or down, a "
    "staircase, a puddle or wet floor, a barrier or roadworks, a vehicle blocking the way, "
    "or the footpath ending, narrowing, or being blocked.\n"
    "If you see none of those and the way ahead is walkable, reply with exactly one word: CLEAR\n"
    "Otherwise reply with ONE spoken warning, under 12 words, second person, naming the "
    "hazard and which side it is on. No markdown, no preamble, no reassurance."
)


@app.post("/api/hazards")
def scan_hazards():
    """Underfoot hazard check for the active guidance loop. Returns hazard=False far more
    often than True, and the caller is expected to stay silent when it does."""
    with state_lock:
        frame_jpeg = latest_frame_jpeg
        stale = (time.time() - latest_frame_at) > 5.0

    if frame_jpeg is None or stale:
        return {"success": False, "hazard": False, "source": "text",
                "reason": "no live camera frame (is the camera running?)"}

    text, source, reason = _ask_with_vision(
        lambda _has_image: VLM_HAZARD_PROMPT, frame_jpeg, "hazards", max_tokens=40,
    )
    if text is None:
        return {"success": False, "hazard": False, "source": source, "reason": reason}

    clean = text.strip().strip('."').replace("*", "").replace("#", "")
    # Anything that starts with CLEAR is a no-op. Checking the prefix rather than equality
    # because models like to append a full stop or a stray word however firmly you ask.
    if not clean or clean.upper().startswith("CLEAR"):
        return {"success": True, "hazard": False, "alert": None, "source": source}

    return {"success": True, "hazard": True, "alert": clean, "source": source}


@app.post("/api/scene")
def analyze_scene():
    """One-shot scene analysis. This is the Objects button, and it is the only thing
    that triggers a scene VLM call — press it and we look, otherwise we don't."""
    global global_scene_context

    with state_lock:
        objs = list(latest_objects)
        frame_jpeg = latest_frame_jpeg
        stale = (time.time() - latest_frame_at) > 5.0

    if frame_jpeg is None or stale:
        return {"success": False, "message": "No live camera frame. Start the camera first."}

    # The scene prompt has no text-only variant — without an image there is nothing to
    # describe, so that path goes to _scene_from_labels instead of a reworded prompt.
    text, source, reason = _ask_with_vision(
        lambda _has_image: VLM_SCENE_PROMPT, frame_jpeg, "scene", max_tokens=120,
    )

    if text is None:
        text = _scene_from_labels(objs)
    if not text:
        return {"success": False, "message": f"Scene analysis unavailable ({reason})."}

    clean_text = text.strip().replace('"', '').replace('*', '').replace('#', '')
    if not clean_text:
        return {"success": False, "message": "Empty scene analysis."}

    with state_lock:
        global_scene_context = clean_text

    return {"success": True, "summary": clean_text, "objects": objs,
            "source": source, "reason": reason}


@app.on_event("startup")
def announce_vision_mode():
    # The VLM falls back silently on failure, which is right for a walking aid but
    # makes "is vision actually on?" impossible to answer from behaviour alone.
    if VISION_ENABLED:
        print(f"[vision] Fireworks VLM enabled: {FIREWORKS_VLM_MODEL} (on demand only)")
    else:
        print("[vision] disabled (no FIREWORKS_API_KEY): scene summary is YOLO labels only")


@app.get("/", response_class=HTMLResponse)
def index():
    return """<!doctype html>
<title>Unblinder API</title>
<style>body{font-family:system-ui,sans-serif;background:#0b0f19;color:#e5e7eb;max-width:40rem;margin:4rem auto;padding:0 1.5rem;line-height:1.6}
code{background:#1f2937;padding:.15rem .4rem;border-radius:4px}a{color:#a855f7}</style>
<h1>Unblinder API</h1>
<p>This is the backend. The camera runs in the browser and streams frames to
<code>/ws</code>, which returns YOLO detections. Open the dashboard to use it.</p>
<p><a href="/docs">Interactive API docs &rarr;</a></p>"""


# ==========================================
# NAVIGATION ENDPOINTS
# ==========================================
_NUM = r'(-?\d{1,3}(?:\.\d+)?)'

# "10.0150, 76.3280" typed straight into the box
_PLAIN_COORDS_RE = re.compile(rf'^\s*{_NUM}\s*,\s*{_NUM}\s*$')

# Coordinate sources inside a Google Maps URL, in descending order of trust:
#   !3d!4d  — the *place's* real coordinates, buried in the data blob
#   ?q= etc — an explicit coordinate parameter
#   /@      — only the map viewport centre, which is close but not exact
_DATA_COORDS_RE   = re.compile(rf'!3d{_NUM}!4d{_NUM}')
_PARAM_COORDS_RE  = re.compile(rf'[?&](?:q|query|destination|daddr|ll|sll|center|mlat)=(?:loc:)?{_NUM}\s*,\s*{_NUM}')
_PATH_COORDS_RE   = re.compile(rf'/maps/(?:search|dir|place)/{_NUM},\+?{_NUM}')
_AT_COORDS_RE     = re.compile(rf'/@{_NUM},{_NUM}')

# Links that name a place but carry no coordinates — fall back to geocoding the name
_PLACE_NAME_RE  = re.compile(r'/maps/place/([^/@?]+)')
_SEARCH_NAME_RE = re.compile(r'/maps/search/([^/@?]+)')

_BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36'


def _coords_in_range(lat: float, lon: float) -> bool:
    return -90.0 <= lat <= 90.0 and -180.0 <= lon <= 180.0


def _extract_coords(text: str):
    """Pull the best available lat/lon out of a Maps URL (or a page body)."""
    decoded = urllib.parse.unquote(text or "")
    for pattern in (_DATA_COORDS_RE, _PARAM_COORDS_RE, _PATH_COORDS_RE, _AT_COORDS_RE):
        match = pattern.search(decoded)
        if match:
            lat, lon = float(match.group(1)), float(match.group(2))
            if _coords_in_range(lat, lon):
                return lat, lon
    return None


def _extract_place_name(url: str):
    decoded = urllib.parse.unquote(url or "")
    for pattern in (_PLACE_NAME_RE, _SEARCH_NAME_RE):
        match = pattern.search(decoded)
        if match:
            name = match.group(1).replace('+', ' ').strip()
            if name and not _PLAIN_COORDS_RE.match(name):
                return name
    return None


def _follow_link(url: str):
    """
    Short links (maps.app.goo.gl / goo.gl/maps) hold no coordinates themselves —
    they 302 to a full URL that does. urlopen follows redirects, so geturl() gives
    us the destination. The browser cannot do this itself: cross-origin fetches to
    Google are blocked by CORS, which is why this lives on the server.
    """
    req = urllib.request.Request(url, headers={'User-Agent': _BROWSER_UA})
    with urllib.request.urlopen(req, timeout=10) as response:
        final_url = response.geturl()
        body = response.read(300_000).decode('utf-8', errors='ignore')
    return final_url, body


def _geocode_free_text(query: str):
    """Converts a place name to coordinates via OpenStreetMap's Nominatim."""
    try:
        safe_query = urllib.parse.quote(query)
        url = f"https://nominatim.openstreetmap.org/search?q={safe_query}&format=json&limit=1"
        req = urllib.request.Request(url, headers={'User-Agent': 'UnblinderCognitiveConsole/1.0'})
        with urllib.request.urlopen(req, timeout=10) as response:
            data = json.loads(response.read().decode())
        if data:
            return {
                "success": True,
                "lat": float(data[0]["lat"]),
                "lon": float(data[0]["lon"]),
                "display_name": data[0]["display_name"],
                "source": "place name",
            }
        return {"success": False, "message": "Location coordinates could not be resolved."}
    except Exception as e:
        return {"success": False, "message": str(e)}


@app.get("/api/resolve")
def resolve_destination(query: str):
    """
    Turns whatever the user pasted into coordinates. Accepts:
      - raw coordinates      "10.0150, 76.3280"
      - a full Maps URL      google.com/maps/place/.../@10.01,76.32,17z/data=...!3d10.01!4d76.32
      - a shortened link     maps.app.goo.gl/xxxx  (resolved by following the redirect)
      - a plain place name   "Lulu Mall Kochi"     (geocoded)
    """
    raw = (query or "").strip()
    if not raw:
        return {"success": False, "message": "No destination provided."}

    plain = _PLAIN_COORDS_RE.match(raw)
    if plain:
        lat, lon = float(plain.group(1)), float(plain.group(2))
        if not _coords_in_range(lat, lon):
            return {"success": False, "message": "Those coordinates are outside the valid range."}
        return {
            "success": True, "lat": lat, "lon": lon,
            "display_name": f"Pin at {lat:.5f}, {lon:.5f}",
            "source": "coordinates",
        }

    lowered = raw.lower()
    is_link = lowered.startswith(("http://", "https://")) or "goo.gl" in lowered or "google.com/maps" in lowered
    if not is_link:
        return _geocode_free_text(raw)

    # Coordinates sitting in the pasted URL already — no network call needed.
    found = _extract_coords(raw)
    if found:
        return {
            "success": True, "lat": found[0], "lon": found[1],
            "display_name": f"Map link · {found[0]:.5f}, {found[1]:.5f}",
            "source": "map link",
        }

    # Otherwise it is probably a short link. Follow it and look again.
    try:
        final_url, body = _follow_link(raw)
    except Exception as e:
        return {"success": False, "message": f"Could not open that map link ({e})."}

    found = _extract_coords(final_url) or _extract_coords(body)
    if found:
        return {
            "success": True, "lat": found[0], "lon": found[1],
            "display_name": f"Shared pin · {found[0]:.5f}, {found[1]:.5f}",
            "source": "shortened map link",
        }

    # The link names a place but hides the coordinates — geocode the name instead.
    name = _extract_place_name(final_url) or _extract_place_name(raw)
    if name:
        return _geocode_free_text(name)

    return {"success": False, "message": "That map link did not contain a location I could read."}


@app.get("/api/geocode")
def geocode_address(query: str):
    """Kept for compatibility; /api/resolve is the richer entry point."""
    return _geocode_free_text(query)


def _format_maneuver_instruction(maneuver: dict) -> str:
    """
    Builds a clean 'type modifier' instruction string, e.g. "turn right" or "arrive".
    Previously this always appended a trailing space + empty modifier (e.g. "arrive "),
    which downstream consumers had to swallow silently.
    """
    maneuver_type = (maneuver.get("type") or "proceed").strip()
    modifier = (maneuver.get("modifier") or "").strip()
    return f"{maneuver_type} {modifier}".strip() if modifier else maneuver_type


@app.get("/api/route")
def calculate_walking_route(start_lat: float, start_lon: float, end_lat: float, end_lon: float):
    """Fetches full geometric walking paths and cross-street checkpoints from OpenStreetMap routing matrix."""
    try:
        url = f"http://router.project-osrm.org/route/v1/foot/{start_lon},{start_lat};{end_lon},{end_lat}?overview=full&geometries=geojson&steps=true"
        req = urllib.request.Request(url, headers={'User-Agent': 'UnblinderCognitiveConsole/1.0'})
        with urllib.request.urlopen(req) as response:
            data = json.loads(response.read().decode())
        if data and "routes" in data and len(data["routes"]) > 0:
            route = data["routes"][0]
            checkpoints = []
            for leg in route.get("legs", []):
                for step in leg.get("steps", []):
                    maneuver = step.get("maneuver", {}) or {}
                    location = maneuver.get("location") or [0, 0]
                    checkpoints.append({
                        "instruction": _format_maneuver_instruction(maneuver),
                        "name": step.get("name") or "Pathway",
                        "distance": step.get("distance", 0),
                        "lat": location[1],
                        "lon": location[0],
                    })
            return {
                "success": True,
                "total_distance_meters": route.get("distance"),
                "total_duration_seconds": route.get("duration"),
                "geometry": route.get("geometry"),
                "checkpoints": checkpoints
            }
        return {"success": False, "message": "Unable to trace an accessible walking trajectory path."}
    except Exception as e:
        return {"success": False, "message": str(e)}


@app.get("/api/weather")
def get_weather_report(lat: float, lon: float):
    try:
        weather_url = f"https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}&current_weather=true"
        req = urllib.request.Request(weather_url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req) as response:
            data = json.loads(response.read().decode())
        current = data.get("current_weather", {})
        temp = current.get("temperature")
        wind = current.get("windspeed")
        code = current.get("weathercode")

        if groq_client:
            weather_prompt = (
                f"The user is visually impaired and cannot see the sky. Based on these micro-metrics: "
                f"Temperature is {temp}°C, Wind Speed is {wind} km/h, and WMO Weather Code is {code}. "
                "In exactly 2 brief sentences, tell them the current conditions in a conversational, warm tone. "
                "Conclude with explicit clear advice on whether they need an umbrella or extra precautions. "
                "Strictly avoid any markdown, bold headers, or text indicators."
            )
            completion = groq_client.chat.completions.create(messages=[{"role": "user", "content": weather_prompt}], model="llama-3.1-8b-instant", temperature=0.3, max_tokens=80)
            report = completion.choices[0].message.content.strip()
        else:
            report = f"The current temperature outside is {temp} degrees celsius, with a wind speed of {wind} kilometers per hour."
        return {"success": True, "report": report}
    except Exception:
        return {"success": False, "report": "Unable to contact the spatial weather satellites right now."}


# ==========================================
# VOICE ASSISTANT — answers a spoken question, grounded in what the camera can
# currently see. It also recognizes when the user is asking to be taken
# somewhere ("take me to the train station") and hands the place name back as
# an intent, so the frontend can set the destination without any typing.
# ==========================================
class AiQuery(BaseModel):
    query: str


def _parse_assistant_json(raw: str) -> dict:
    """The model is asked for JSON, but a stray prose reply shouldn't break the
    assistant — fall back to treating whatever came back as a plain answer."""
    try:
        data = json.loads(raw)
    except (ValueError, TypeError):
        return {"intent": "answer", "destination": None, "response": raw}

    intent = data.get("intent")
    destination = data.get("destination")
    response = (data.get("response") or "").strip()

    if intent != "navigate" or not isinstance(destination, str) or not destination.strip():
        return {"intent": "answer", "destination": None, "response": response or raw}

    return {"intent": "navigate", "destination": destination.strip(), "response": response}


def _build_assist_prompt(query: str, seen: str, scene: str, has_image: bool) -> str:
    # With a frame attached the model can see for itself, so the "never mention
    # anything not in the list" guardrail becomes wrong — it would gag the model
    # about the very hazards YOLO has no class for. Without a frame it is the only
    # thing standing between the user and a hallucinated obstacle.
    if has_image:
        grounding = (
            "A photo of the path directly ahead of them is attached, taken just now. Answer "
            "questions about their surroundings from that photo. You may describe things the "
            "object detector cannot label — steps, kerbs, broken ground, puddles, barriers — "
            "and you may read aloud any sign or text you can see in it. Never state anything "
            "the photo does not actually show.\n"
            # The two sources disagree sooner or later — a bin detected as a person, a box the
            # detector never saw. Say plainly which wins, and on what: the photo is the truth
            # about WHAT is there, the detector is the truth about HOW FAR, because a step
            # count comes from box geometry and cannot be eyeballed from a picture.
            "The detector's output is listed below too. Trust the photo about what is actually "
            "there, and trust the detector's step counts for how far away it is. If they "
            "disagree about what something is, believe your eyes.\n\n"
        )
    else:
        grounding = (
            "For questions about their surroundings, use only the camera data below; never "
            "invent objects that are not listed.\n\n"
        )

    return (
        "You are a voice assistant for a blind pedestrian who is listening through text-to-speech.\n\n"
        "First decide what they want:\n"
        "- If they are asking to travel or walk somewhere, or to set/change a destination "
        "(for example 'take me to the train station', 'navigate to MG Road', 'I want to go to "
        "the nearest pharmacy'), the intent is navigate. Put the place exactly as they named it "
        "in destination.\n"
        "- Anything else — questions about their surroundings, or general questions — is the "
        "answer intent, with destination null.\n\n"
        "Reply with JSON only, in this shape:\n"
        '{"intent": "navigate" | "answer", "destination": string | null, "response": string}\n\n'
        "The response field is what gets spoken aloud. Keep it under 40 words, 1 to 3 short "
        "sentences, second person, plain and warm. No markdown, bullets, or asterisks. "
        "For a navigate intent, simply confirm where you are taking them, for example "
        "'Setting a route to the train station now.' Do not state distances or directions — "
        "the app supplies those itself.\n"
        + grounding +
        f"Object detector output: {seen}\n"
        # The stored scene summary is only refreshed when the user presses Objects, so
        # by now it can be minutes old and describe pavement they have already walked
        # past. Handing that to a model that is holding a live photo is worse than
        # useless — it invites it to describe a place that is no longer there. Only the
        # text-only path, which has no photo, has any use for it.
        + ("" if has_image else f"Scene summary: {scene}\n")
        + f"\nWhat they said: {query}"
    )


@app.post("/api/ai_assist")
def ai_assist(payload: AiQuery):
    if not (groq_client or VISION_ENABLED):
        return {"success": False, "message": "AI reasoning engine unavailable (no GROQ_API_KEY configured)."}

    with state_lock:
        objs = list(latest_objects)
        scene = global_scene_context
        frame_jpeg = latest_frame_jpeg

    if objs:
        seen = "; ".join(f"{o['name']} ({o['steps_away']} steps, {o['position']})" for o in objs[:8])
    else:
        seen = "nothing detected right now"

    # Ask the VLM against the live frame when we can — this is the whole point of
    # it: "what does that sign say" and "are there steps" are unanswerable from a
    # list of COCO labels. It costs a second or two, which is fine here; the user
    # asked a question and is waiting. It would not be fine on the Guide Me path.
    raw, source, reason = _ask_with_vision(
        lambda has_image: _build_assist_prompt(payload.query, seen, scene, has_image),
        frame_jpeg, "ai_assist", max_tokens=200, temperature=0.3, json_mode=True,
    )

    try:
        if raw is None:
            if not groq_client:
                return {"success": False, "message": "AI reasoning engine unavailable."}
            completion = groq_client.chat.completions.create(
                messages=[{"role": "user", "content": _build_assist_prompt(
                    payload.query, seen, scene, has_image=False)}],
                model="llama-3.1-8b-instant",
                temperature=0.3,
                max_tokens=160,
                response_format={"type": "json_object"},
            )
            raw = completion.choices[0].message.content.strip()

        parsed = _parse_assistant_json(raw)

        response = parsed["response"].replace("*", "").replace("#", "").strip()
        if not response:
            return {"success": False, "message": "Empty response from AI reasoning engine."}

        return {
            "success": True,
            "response": response,
            "intent": parsed["intent"],
            "destination": parsed["destination"],
            # "vlm" = it looked at the photo. "text" = it did not, and reason says why.
            "source": source,
            "reason": reason,
        }
    except Exception as e:
        return {"success": False, "message": str(e)}


# ==========================================
# AI FUSION BRIEFING — combines live object detection AND live
# navigation/map telemetry into ONE cohesive, prioritized spoken
# briefing (obstacles first if close, then turn/distance guidance).
# This is what powers the "Guide Me" button on the frontend.
# ==========================================
class ObjectItem(BaseModel):
    name: str
    position: Optional[str] = "center"
    steps_away: Optional[int] = None
    confidence: Optional[float] = None

class NavigationContext(BaseModel):
    has_route: bool = False
    next_instruction: Optional[str] = None
    next_street_name: Optional[str] = None
    distance_to_next_checkpoint_m: Optional[float] = None
    total_distance_remaining_m: Optional[float] = None
    bearing_to_next_deg: Optional[float] = None
    device_heading_deg: Optional[float] = None
    turn_direction: Optional[str] = None  # "left" | "right" | "straight"
    turn_degrees: Optional[float] = None
    checkpoints_remaining: Optional[int] = None

class BriefingRequest(BaseModel):
    objects: List[ObjectItem] = []
    scene_description: Optional[str] = None
    navigation: Optional[NavigationContext] = None


def _build_briefing_prompt(payload: BriefingRequest) -> str:
    obj_lines = []
    for o in payload.objects[:8]:
        steps = o.steps_away if o.steps_away is not None else "unknown distance in"
        obj_lines.append(f"{o.name} ({steps} steps, {o.position})")
    objects_str = "; ".join(obj_lines) if obj_lines else "no obstacles currently detected"

    nav = payload.navigation
    if nav and nav.has_route:
        degrees_str = f"{round(nav.turn_degrees)}" if nav.turn_degrees is not None else "an unknown number of"
        nav_str = (
            f"Next maneuver: {nav.next_instruction or 'proceed'} onto {nav.next_street_name or 'the path'}. "
            f"Distance to that turn: {round(nav.distance_to_next_checkpoint_m or 0)} meters. "
            f"Turn needed relative to current facing direction: {nav.turn_direction or 'unknown'}, "
            f"{degrees_str} degrees. "
            f"Checkpoints remaining after this one: {max((nav.checkpoints_remaining or 1) - 1, 0)}."
        )
    else:
        nav_str = "No active navigation route is set."

    return (
        "You are a real-time spoken-guidance assistant for a blind pedestrian who is walking right now "
        "and listening to you through text-to-speech. You are given live obstacle-detection data and live "
        "navigation data. Fuse them into ONE short spoken briefing of 3 to 5 sentences, under 70 words total.\n"
        "Rules:\n"
        "1. Safety first: if an obstacle is very close (3 steps or fewer), mention it and how to avoid it "
        "before anything else.\n"
        "2. Then give clear walking directions: which way to turn (left, right, or straight) and the "
        "distance in meters to the next turn.\n"
        "3. Speak plainly and calmly, second person, present tense, like guiding a friend.\n"
        "4. Never use markdown, bullet points, headers, or asterisks. Never mention that you are an AI.\n"
        "5. Do not invent streets, objects, or distances that are not in the data below.\n\n"
        f"Scene summary: {payload.scene_description or 'unavailable'}\n"
        f"Detected objects: {objects_str}\n"
        f"Navigation: {nav_str}"
    )


@app.post("/api/briefing")
def generate_fused_briefing(payload: BriefingRequest):
    if not groq_client:
        return {"success": False, "message": "AI reasoning engine unavailable (no GROQ_API_KEY configured)."}
    try:
        prompt = _build_briefing_prompt(payload)
        completion = groq_client.chat.completions.create(
            messages=[{"role": "user", "content": prompt}],
            model="llama-3.1-8b-instant",
            temperature=0.3,
            max_tokens=140,
        )
        text = completion.choices[0].message.content.strip().replace("*", "").replace("#", "")
        if not text:
            return {"success": False, "message": "Empty response from AI reasoning engine."}
        return {"success": True, "briefing": text}
    except Exception as e:
        return {"success": False, "message": str(e)}


# ==========================================
# FRAME SOCKET — the browser sends JPEG frames as binary messages and gets
# detections back on the same socket. One reply per frame, which also gives
# the client natural backpressure: it waits for a reply before sending the
# next frame, so a slow server just means a lower frame rate, not a backlog.
# ==========================================
@app.websocket('/ws')
async def websocket_endpoint(websocket: WebSocket):
    global latest_objects, latest_frame_at, latest_frame_jpeg

    await websocket.accept()
    loop = asyncio.get_running_loop()

    frame_count = 0
    window_start = time.time()
    fps = 0.0

    try:
        while True:
            data = await websocket.receive_bytes()

            frame = cv2.imdecode(np.frombuffer(data, dtype=np.uint8), cv2.IMREAD_COLOR)
            if frame is None:
                await websocket.send_json({
                    "objects": [],
                    "stats": {"inference_ms": 0.0, "fps": 0.0},
                    "description": global_scene_context,
                    "error": "undecodable frame",
                })
                continue

            objects, inference_ms = await loop.run_in_executor(None, run_detection, frame)

            frame_count += 1
            now = time.time()
            if now - window_start >= 1.0:
                fps = frame_count / (now - window_start)
                frame_count = 0
                window_start = now

            with state_lock:
                latest_objects = objects
                latest_frame_at = now
                latest_frame_jpeg = data
                description = global_scene_context

            await websocket.send_json({
                "objects": objects,
                "stats": {"inference_ms": round(inference_ms, 1), "fps": round(fps, 1)},
                "description": description,
            })
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        with state_lock:
            latest_objects = []
            latest_frame_jpeg = None
