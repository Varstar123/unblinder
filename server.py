import threading
import time
import asyncio
import os
import json
import urllib.request
import urllib.parse
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

MODEL_PATH = os.environ.get("YOLO_MODEL", "yolo11n.onnx")

# The camera lives in the user's browser, not on this server. Frames arrive over
# the /ws socket, get detected on, and the results go straight back down the same
# socket. Nothing here ever touches a local capture device.
detector = Detector(MODEL_PATH)
model_lock = threading.Lock()

state_lock = threading.Lock()
latest_objects: List[dict] = []
latest_frame_at = 0.0
global_scene_context = "Scanning layout framework..."


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
# SCENE ANALYZER — summarizes whatever the camera is currently looking at
# ==========================================
def scene_analyzer_loop():
    global global_scene_context
    time.sleep(3.0)
    while True:
        with state_lock:
            current_objs = list(latest_objects)
            idle = (time.time() - latest_frame_at) > 15.0

        # No frames arriving means no camera is streaming; don't burn Groq calls.
        if idle or not groq_client:
            time.sleep(5.0)
            continue

        unique_items = list({obj["name"] for obj in current_objs})
        items_string = ", ".join(unique_items) if unique_items else "clear space"

        scene_prompt = (
            f"Analyze these environment tokens: {items_string}. "
            "In exactly 4 to 7 words, identify the macro environment or room layout. "
            "Keep it strictly brief, descriptive, and clean. No formatting or commentary."
        )
        try:
            completion = groq_client.chat.completions.create(
                messages=[{"role": "user", "content": scene_prompt}],
                model="llama-3.1-8b-instant",
                temperature=0.2,
                max_tokens=25,
            )
            clean_text = completion.choices[0].message.content.strip().replace('"', '').replace('*', '')
            with state_lock:
                global_scene_context = clean_text
        except Exception:
            pass
        time.sleep(10.0)


@app.on_event("startup")
def start_background_tasks():
    threading.Thread(target=scene_analyzer_loop, daemon=True).start()


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
@app.get("/api/geocode")
def geocode_address(query: str):
    """Converts user destination strings to physical latitude/longitude coordinates securely via OpenStreetMap API."""
    try:
        safe_query = urllib.parse.quote(query)
        url = f"https://nominatim.openstreetmap.org/search?q={safe_query}&format=json&limit=1"
        req = urllib.request.Request(url, headers={'User-Agent': 'UnblinderCognitiveConsole/1.0'})
        with urllib.request.urlopen(req) as response:
            data = json.loads(response.read().decode())
        if data:
            return {"success": True, "lat": float(data[0]["lat"]), "lon": float(data[0]["lon"]), "display_name": data[0]["display_name"]}
        return {"success": False, "message": "Location coordinates could not be resolved."}
    except Exception as e:
        return {"success": False, "message": str(e)}


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
# VOICE ASSISTANT — answers a spoken question, grounded in what the
# camera can currently see.
# ==========================================
class AiQuery(BaseModel):
    query: str


@app.post("/api/ai_assist")
def ai_assist(payload: AiQuery):
    if not groq_client:
        return {"success": False, "message": "AI reasoning engine unavailable (no GROQ_API_KEY configured)."}

    with state_lock:
        objs = list(latest_objects)
        scene = global_scene_context

    if objs:
        seen = "; ".join(f"{o['name']} ({o['steps_away']} steps, {o['position']})" for o in objs[:8])
    else:
        seen = "nothing detected right now"

    prompt = (
        "You are a voice assistant for a blind user who is listening through text-to-speech. "
        "Answer their question in 1 to 3 short sentences, under 50 words. Speak plainly and warmly, "
        "in second person. Never use markdown, bullet points, or asterisks.\n"
        "If the question is about their surroundings, answer using only the camera data below; "
        "do not invent objects that are not listed. If the question is general knowledge, "
        "just answer it normally.\n\n"
        f"What the camera sees right now: {seen}\n"
        f"Scene summary: {scene}\n\n"
        f"Their question: {payload.query}"
    )

    try:
        completion = groq_client.chat.completions.create(
            messages=[{"role": "user", "content": prompt}],
            model="llama-3.1-8b-instant",
            temperature=0.4,
            max_tokens=120,
        )
        text = completion.choices[0].message.content.strip().replace("*", "").replace("#", "")
        if not text:
            return {"success": False, "message": "Empty response from AI reasoning engine."}
        return {"success": True, "response": text}
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
    global latest_objects, latest_frame_at

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
