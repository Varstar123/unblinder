import React, { useEffect, useState, useRef } from 'react'
import { MapContainer, TileLayer, Marker, Polyline, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import L from 'leaflet'

// ==========================================
// PANEL ICONS — inline stroke SVGs. They take their colour from the
// panel's accent via currentColor, so there is nothing to re-theme.
// ==========================================
const svgBase = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  focusable: 'false',
}

const IconCompass = () => (
  <svg {...svgBase}>
    <circle cx="12" cy="12" r="9.5" />
    <path d="M16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88Z" />
  </svg>
)

const IconScan = () => (
  <svg {...svgBase}>
    <path d="M3 7V5a2 2 0 0 1 2-2h2" />
    <path d="M17 3h2a2 2 0 0 1 2 2v2" />
    <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
    <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
    <path d="M18.94 12.33a1 1 0 0 0 0-.66 7.5 7.5 0 0 0-13.88 0 1 1 0 0 0 0 .66 7.5 7.5 0 0 0 13.88 0" />
    <circle cx="12" cy="12" r="1.6" />
  </svg>
)

const IconWeather = () => (
  <svg {...svgBase}>
    <path d="M12 2v2" />
    <path d="m4.93 4.93 1.41 1.41" />
    <path d="M20 12h2" />
    <path d="m19.07 4.93-1.41 1.41" />
    <path d="M15.95 12.65a4 4 0 0 0-5.93-4.13" />
    <path d="M13 22H7a5 5 0 1 1 4.9-6H13a3 3 0 0 1 0 6Z" />
    <path d="M11 20v2" />
    <path d="M7 19v2" />
  </svg>
)

const IconSparkle = () => (
  <svg {...svgBase}>
    <path d="M12 2.5 13.9 9a3.2 3.2 0 0 0 2.1 2.1L22.5 13l-6.5 1.9a3.2 3.2 0 0 0-2.1 2.1L12 23.5l-1.9-6.5A3.2 3.2 0 0 0 8 14.9L1.5 13 8 11.1A3.2 3.2 0 0 0 10.1 9Z" />
  </svg>
)

const IconMic = () => (
  <svg {...svgBase}>
    <rect x="9" y="2" width="6" height="12" rx="3" />
    <path d="M19 11v1a7 7 0 0 1-14 0v-1" />
    <path d="M12 19v3" />
  </svg>
)

const IconVolume = () => (
  <svg {...svgBase}>
    <path d="M11 5 6 9H2v6h4l5 4V5Z" />
    <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
    <path d="M18.36 5.64a9 9 0 0 1 0 12.73" />
  </svg>
)

const IconVolumeOff = () => (
  <svg {...svgBase}>
    <path d="M11 5 6 9H2v6h4l5 4V5Z" />
    <path d="m22 9-6 6" />
    <path d="m16 9 6 6" />
  </svg>
)

const IconSun = () => (
  <svg {...svgBase}>
    <circle cx="12" cy="12" r="4.2" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </svg>
)

const IconMoon = () => (
  <svg {...svgBase}>
    <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a7 7 0 1 0 10.5 10.5Z" />
  </svg>
)

// ==========================================
// THEME TOGGLE
// Every colour in the app resolves through a CSS variable, so flipping
// data-theme on <html> repaints everything at once — there is no per-component
// theme logic anywhere else.
// ==========================================
function ThemeToggle({ theme, onToggle }) {
  const isDark = theme === 'dark'
  return (
    <button
      type="button"
      className={`ub-theme${isDark ? ' is-dark' : ''}`}
      onClick={onToggle}
      aria-label={`Switch to ${isDark ? 'light' : 'dark'} theme`}
      title={`Switch to ${isDark ? 'light' : 'dark'} theme`}
    >
      <span className="ub-theme-thumb" aria-hidden="true" />
      <span className="ub-theme-ico is-sun" aria-hidden="true"><IconSun /></span>
      <span className="ub-theme-ico is-moon" aria-hidden="true"><IconMoon /></span>
    </button>
  )
}

// ==========================================
// CUSTOM MAP ICONS (Bypasses default Leaflet image bugs)
// ==========================================
const userIcon = new L.DivIcon({
  className: 'custom-user-icon',
  html: `<div style="background-color: #0284c7; width: 18px; height: 18px; border-radius: 50%; border: 3px solid white; box-shadow: 0 0 15px #0284c7;"></div>`,
  iconSize: [18, 18],
  iconAnchor: [9, 9]
});

const checkpointIcon = new L.DivIcon({
  className: 'custom-checkpoint-icon',
  html: `<div style="background-color: #ef4444; width: 16px; height: 16px; border-radius: 50%; border: 3px solid white; box-shadow: 0 0 12px #ef4444;"></div>`,
  iconSize: [16, 16],
  iconAnchor: [8, 8]
});

// Helper component to smoothly pan map to user as they walk
function RecenterMap({ lat, lng }) {
  const map = useMap();
  useEffect(() => {
    if (lat && lng) {
      map.setView([lat, lng], map.getZoom(), { animate: true });
    }
  }, [lat, lng, map]);
  return null;
}

// ==========================================
// SPEECH PRIORITY ENGINE
// ==========================================
class SpeechQueueManager {
  constructor() {
    this.queue = []
    this.isPlaying = false
    this.currentItem = null
    this.currentPriority = null
    this.activeToken = 0
    this.explicitCompleteCallback = null
    this.listeners = new Set()
    this.isAmbientSuppressed = false // System override to suppress background tracking chatter
  }

  subscribe(fn) {
    this.listeners.add(fn)
    fn(this._state())
    return () => this.listeners.delete(fn)
  }

  _state() {
    return { isPlaying: this.isPlaying, priority: this.currentPriority }
  }

  _notify() {
    this.listeners.forEach((fn) => fn(this._state()))
  }

  speakAmbient(text, speed, voiceEnabledRef) {
    if (!voiceEnabledRef || !voiceEnabledRef.current) return
    if (this.currentPriority === 'explicit' || this.isAmbientSuppressed) return 
    if (!text || !text.trim()) return
    const alreadyQueued = this.queue.some((i) => i.text === text)
    const currentlyPlaying = this.currentItem && this.currentItem.text === text
    if (alreadyQueued || currentlyPlaying) return
    this.queue.push({ text, speed, priority: 'ambient' })
    this._pump()
  }

  speakExplicit(texts, speed, voiceEnabledRef, onComplete) {
    const list = (Array.isArray(texts) ? texts : [texts]).filter((t) => t && t.trim())

    this.activeToken += 1
    window.speechSynthesis.cancel()
    this.isPlaying = false
    this.currentItem = null
    this.queue = []
    this.explicitCompleteCallback = onComplete || null

    if (!voiceEnabledRef || !voiceEnabledRef.current || list.length === 0) {
      this.currentPriority = null
      this._notify()
      this._resolveExplicitComplete()
      return
    }

    this.currentPriority = 'explicit'
    this.queue = list.map((text) => ({ text, speed, priority: 'explicit' }))
    this._notify()
    this._pump()
  }

  _resolveExplicitComplete() {
    if (this.explicitCompleteCallback) {
      const cb = this.explicitCompleteCallback
      this.explicitCompleteCallback = null
      cb()
    }
  }

  _pump() {
    if (this.isPlaying) return
    if (this.queue.length === 0) {
      if (this.currentPriority === 'explicit') {
        this.currentPriority = null
        this._notify()
        this._resolveExplicitComplete()
      }
      return
    }

    const item = this.queue.shift()
    const myToken = this.activeToken
    this.isPlaying = true
    this.currentItem = item
    this.currentPriority = item.priority
    this._notify()

    const utterance = new SpeechSynthesisUtterance(item.text)
    utterance.rate = item.speed
    const voices = window.speechSynthesis.getVoices()
    if (voices.length > 0) {
      utterance.voice = voices.find((v) => v.localService) || voices[0]
    }

    const finish = () => {
      if (myToken !== this.activeToken) return 
      this.isPlaying = false
      this.currentItem = null
      this._pump()
    }
    utterance.onend = finish
    utterance.onerror = finish
    window.speechSynthesis.speak(utterance)
  }

  clearAll() {
    this.activeToken += 1
    this.queue = []
    window.speechSynthesis.cancel()
    this.isPlaying = false
    this.currentItem = null
    this.currentPriority = null
    this._notify()
    this._resolveExplicitComplete()
  }
}

const audioQueue = new SpeechQueueManager()

// ==========================================
// SPATIAL GEOMETRY MATHEMATICAL COMPUTATIONS
// ==========================================
// A pasted map link is fine to route with, but must never be read aloud.
function isMapLink(text) {
  const t = (text || '').trim().toLowerCase()
  return t.startsWith('http://') || t.startsWith('https://') || t.includes('goo.gl') || t.includes('google.com/maps')
}

function computeHaversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

function computeTargetBearing(lat1, lon1, lat2, lon2) {
  const dLon = (lon2 - lon1) * Math.PI / 180
  const lat1Rad = lat1 * Math.PI / 180
  const lat2Rad = lat2 * Math.PI / 180
  const y = Math.sin(dLon) * Math.cos(lat2Rad)
  const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) - Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLon)
  const brng = Math.atan2(y, x) * 180 / Math.PI
  return (brng + 360) % 360
}

// Shortest distance from the user to the route line itself, in metres.
//
// Distance to the next checkpoint is not the same question: you can be twenty metres
// from the next corner while standing in the middle of the road, or on the wrong side
// of a fence. Drifting off the path is about the whole polyline, not one point on it.
//
// Projects to a local flat plane centred on the user. Over a few hundred metres the
// curvature error is centimetres, and it makes this a plain point-to-segment problem.
function distanceToRouteMeters(lat, lon, geometry) {
  const pts = geometry && geometry.coordinates
  if (!pts || pts.length < 2) return null

  const R = 6371000
  const cosLat = Math.cos(lat * Math.PI / 180)
  const toXY = (la, lo) => [
    (lo - lon) * Math.PI / 180 * cosLat * R,
    (la - lat) * Math.PI / 180 * R,
  ]

  let best = Infinity
  for (let i = 0; i < pts.length - 1; i++) {
    // GeoJSON is [lon, lat].
    const [ax, ay] = toXY(pts[i][1], pts[i][0])
    const [bx, by] = toXY(pts[i + 1][1], pts[i + 1][0])

    const dx = bx - ax
    const dy = by - ay
    const len2 = dx * dx + dy * dy

    // The user sits at the origin, so this is the distance from (0,0) to segment AB.
    let t = len2 === 0 ? 0 : -(ax * dx + ay * dy) / len2
    t = Math.max(0, Math.min(1, t))
    const d = Math.hypot(ax + t * dx, ay + t * dy)
    if (d < best) best = d
  }
  return best
}

function computeTurnDirection(angleDiff) {
  if (Math.abs(angleDiff) <= 20) return 'straight'
  return angleDiff > 0 ? 'right' : 'left'
}

function normalizeAngleDiff(bearing, heading) {
  let diff = bearing - heading
  if (diff > 180) diff -= 360
  if (diff < -180) diff += 360
  return diff
}

// ==========================================
// PROXIMITY WARNINGS
// ==========================================
// Something close enough to walk into is worth saying without being asked. Saying it
// over and over is not — a bollard you are standing next to is still there, and
// repeating that every few seconds is noise a blind user then has to talk over.
//
// So the warning is edge-triggered: it fires on the transition into the danger zone
// and then latches. Standing in front of the same obstacle stays silent. The latch
// only clears when the object actually leaves the frame, which is what makes a
// second warning mean something new — it came back.
// A thing is only worth mentioning if you are going to walk into it. "Person, twenty
// metres away" is not information, it is noise — and noise in an audio-only interface
// is worse than nothing, because the user has to talk over it to be heard.
//
// So the test is a corridor, not a radius: the strip of ground you are about to occupy.
//
//              <---------- 5 m ---------->
//          .--------------------------------.
//          |  |                          |  |    in the corridor : warn under 5 m
//     side |  |        CORRIDOR          |  | side   off to the side : warn under 2 m,
//          |  |                          |  |        and only if close enough to clip
//          '--------------------------------'
//                       [ you ]
const AHEAD_WARN_M = 5.0        // in your path: this far ahead matters
const SIDE_WARN_M = 2.0         // off to the side: only when you could still clip it
const CORRIDOR_HALF_W_M = 0.75  // half the width of a walking person, plus a margin
const SIDE_REACH_M = 1.5        // beyond this, off to the side, it cannot be hit at all

// YOLO drops a box for a frame or two constantly; without this grace period that
// flicker would read as "left and came back" and re-fire the warning, which is
// exactly the loop we are removing. It must outlast a dropped frame, not a real exit.
const REARM_AFTER_ABSENT_MS = 2000

// Is this thing actually in the way?
function isObstructing(o) {
  if (o.distance_m == null) return false
  const lateral = Math.abs(o.lateral_m || 0)

  // Anything closer than about two metres overflows the frame, so its box is cropped and
  // its height — the only thing we measure distance from — is a lie that reads FAR. That
  // is the one direction we cannot afford to be wrong in, so a cropped box in the
  // corridor is treated as close. A false warning is an annoyance; a missed one is a fall.
  const closeEnough = (limit) => o.truncated || o.distance_m <= limit

  if (lateral <= CORRIDOR_HALF_W_M) return closeEnough(AHEAD_WARN_M)
  if (lateral > SIDE_REACH_M) return false
  return closeEnough(SIDE_WARN_M)
}

function describeObstruction(o) {
  const lateral = o.lateral_m || 0
  const where = Math.abs(lateral) <= CORRIDOR_HALF_W_M
    ? 'ahead'
    : lateral > 0 ? 'on your right' : 'on your left'

  // A cropped box is exactly the case where the distance is not to be believed — it
  // reads far because we can only see part of the object. Warning on it is right;
  // reading out the number we just decided was wrong is not. Say "close" and mean it.
  if (o.truncated) return `${o.name}, close, ${where}.`

  const metres = Math.max(1, Math.round(o.distance_m))
  return `${o.name}, ${metres} ${metres === 1 ? 'metre' : 'metres'} ${where}.`
}

// ==========================================
// CONTINUOUS GUIDANCE
// ==========================================
// Guide Me is a mode, not a sentence. Once on, it stays on until the user arrives or
// presses it again, and it watches three things the one-shot briefing could not:
// what is underfoot, whether they have wandered off the path, and whether they are
// walking in the wrong direction entirely.
//
// Every threshold below exists to stop a warning becoming a nag. A blind user cannot
// look away from audio — anything that repeats needlessly has to be talked over, and
// an aid people talk over is an aid people switch off.
const HAZARD_SCAN_MS = 7000        // how often the camera is checked for pits, kerbs, steps
const HAZARD_REPEAT_MS = 15000     // the same hazard is not re-announced inside this window
const ENV_CHECK_MS = 30000         // re-check indoor/outdoor: people walk out of buildings

const OFF_ROUTE_M = 25             // drifted this far from the route line: say so
const BACK_ON_ROUTE_M = 12         // and only call them back on once clearly back
                                   // (the gap between these two is hysteresis — without
                                   // it, hovering at the boundary would alternate
                                   // "off route"/"back on route" forever)

const HEADING_TOLERANCE_DEG = 50   // facing further off than this counts as wrong way
const HEADING_SUSTAIN_MS = 6000    // ...but only after holding it this long. A phone
                                   // compass swings hard with every footfall, so warning
                                   // on a single reading would fire almost continuously.
const ARRIVAL_M = 12               // close enough to a checkpoint to call it reached

// Objects is an explicit question, so unlike the guidance warnings it answers about the
// whole view rather than only the corridor — but nearest first, and in metres.
function buildObjectsNarration(objs) {
  if (!objs || objs.length === 0) return "Nothing is detected in view."
  const sorted = [...objs].sort((a, b) => (a.distance_m ?? 99) - (b.distance_m ?? 99))
  const top = sorted.slice(0, 6)
  const parts = top.map((o) => {
    const lateral = o.lateral_m || 0
    const where = Math.abs(lateral) <= CORRIDOR_HALF_W_M
      ? 'ahead'
      : lateral > 0 ? 'to your right' : 'to your left'
    const metres = Math.max(1, Math.round(o.distance_m ?? 0))
    return `${o.name}, ${metres} ${metres === 1 ? 'metre' : 'metres'} ${where}`
  })
  const remaining = objs.length - top.length
  const countNote = remaining > 0 ? ` and ${remaining} more further out` : ''
  return `${top.length} object${top.length > 1 ? 's' : ''} detected. ${parts.join('. ')}${countNote}.`
}

function buildFallbackGuidance(targetNode, distanceMeters, turnDirection, angleDiff, checkpointsRemaining) {
  const turnPhrase = turnDirection === 'straight'
    ? 'Continue straight ahead'
    : `Turn ${turnDirection}, about ${Math.round(Math.abs(angleDiff))} degrees`
  const steps = Math.round(distanceMeters / 0.75)
  const remainderNote = checkpointsRemaining > 1 ? ` ${checkpointsRemaining - 1} more turn${checkpointsRemaining - 1 > 1 ? 's' : ''} after this one.` : ' This is the final turn.'
  return `${turnPhrase}. Next checkpoint is ${Math.round(distanceMeters)} meters ahead, about ${steps} steps. Action: ${targetNode.instruction} onto ${targetNode.name}.${remainderNote}`
}

export default function App() {
  const [objects, setObjects] = useState([])
  const [aiDescription, setAiDescription] = useState("Initializing environment orientation...")
  const [voiceEnabled, setVoiceEnabled] = useState(true)
  const [running, setRunning] = useState(false)
  const [weatherReport, setWeatherReport] = useState("Standby for environmental telemetry...")
  const [fps, setFps] = useState(0)

  // NAVIGATION AND TELEMETRY STATES
  const [destinationInput, setDestinationInput] = useState("")
  const [startInput, setStartInput] = useState("My Live GPS Tracking Coords")
  const [isNavigating, setIsNavigating] = useState(false)
  const [navRouteData, setNavRouteData] = useState(null)
  const [currentPosition, setCurrentPosition] = useState(null)
  const [deviceHeading, setDeviceHeading] = useState(0)
  const [debugLogs, setDebugLogs] = useState(["[Console Bootup Complete] Waiting for coordinates input..."])

  const [activeAction, setActiveAction] = useState(null)
  const [speechState, setSpeechState] = useState({ isPlaying: false, priority: null })

  // Continuous guidance mode: on until arrival, or until the button is pressed again.
  const [guiding, setGuiding] = useState(false)
  const guidingRef = useRef(false)
  const offRouteLatchRef = useRef(false)
  const headingLatchRef = useRef({ since: 0, warned: false })
  const hazardLatchRef = useRef({ text: '', at: 0 })
  const hazardInFlightRef = useRef(false)

  // null until the camera has actually been looked at. Not the same as false — guessing
  // "outdoor" before we know would switch on GPS route guidance inside a building.
  const [indoor, setIndoor] = useState(null)
  const indoorRef = useRef(null)
  
  // VOICE RECOGNITION (AI ASSISTANT) STATE
  const [theme, setTheme] = useState(() => {
    try {
      const saved = localStorage.getItem('ub-theme')
      if (saved === 'dark' || saved === 'light') return saved
    } catch (e) { /* private mode: fall through to the default */ }
    return 'light'
  })

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try { localStorage.setItem('ub-theme', theme) } catch (e) { /* not fatal */ }
  }, [theme])

  const [isListening, setIsListening] = useState(false)
  const [speechSupported, setSpeechSupported] = useState(true)
  const recognitionRef = useRef(null)
  const micGrantedRef = useRef(false)
  const aiPhaseRef = useRef('idle') // Tracks 'idle' | 'listening' | 'processing'

  const wsRef = useRef(null)
  const msgCountRef = useRef(0)
  const videoRef = useRef(null)
  const overlayRef = useRef(null)
  const streamRef = useRef(null)
  const captureCanvasRef = useRef(null)
  const inFlightRef = useRef(false)
  const lastSentAtRef = useRef(0)
  const dangerLatchRef = useRef({})
  const actionIdRef = useRef(0)

  const voiceEnabledRef = useRef(voiceEnabled)
  const runningRef = useRef(running)
  const aiDescRef = useRef(aiDescription)
  const objectsRef = useRef(objects)
  const currentPositionRef = useRef(currentPosition)
  const deviceHeadingRef = useRef(deviceHeading)
  const navRouteDataRef = useRef(navRouteData)

  useEffect(() => { voiceEnabledRef.current = voiceEnabled }, [voiceEnabled])
  useEffect(() => { runningRef.current = running }, [running])
  useEffect(() => { aiDescRef.current = aiDescription }, [aiDescription])
  useEffect(() => { objectsRef.current = objects }, [objects])
  useEffect(() => { currentPositionRef.current = currentPosition }, [currentPosition])
  useEffect(() => { deviceHeadingRef.current = deviceHeading }, [deviceHeading])
  useEffect(() => { navRouteDataRef.current = navRouteData }, [navRouteData])

  useEffect(() => {
    const unsubscribe = audioQueue.subscribe(setSpeechState)
    return unsubscribe
  }, [])

  const BACKEND = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000'

  function logToConsole(message) {
    const stamp = new Date().toLocaleTimeString()
    setDebugLogs((prev) => [`[${stamp}] ${message}`, ...prev.slice(0, 49)])
  }

  // Every VLM-backed route says whether it actually looked at the photo, and if not,
  // why not. Surfacing that here is the difference between "the assistant is a bit
  // vague today" and "no request has ever reached Fireworks and here is the reason".
  function logVisionSource(label, data) {
    if (data.source === 'vlm') logToConsole(`[${label}]: answered FROM THE IMAGE (Fireworks VLM)`)
    else if (data.reason) logToConsole(`[${label}]: NO VISION — ${data.reason}`)
  }

  function beginAction(name) {
    actionIdRef.current += 1
    const id = actionIdRef.current
    setActiveAction(name)
    return id
  }
  function isStaleAction(id) {
    return id !== actionIdRef.current
  }
  function finishAction(id) {
    if (!isStaleAction(id)) setActiveAction(null)
  }

  useEffect(() => {
    window.speechSynthesis.onvoiceschanged = () => { window.speechSynthesis.getVoices() }
  }, [])

  // Initialize Web Speech API for AI Assistant feature
  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (SpeechRecognition) {
      setSpeechSupported(true)
      recognitionRef.current = new SpeechRecognition()
      recognitionRef.current.continuous = false
      recognitionRef.current.lang = 'en-US'

      recognitionRef.current.onresult = (event) => {
        aiPhaseRef.current = 'processing'
        const text = event.results[0][0].transcript
        setIsListening(false)
        handleAiQuery(text)
      }

      recognitionRef.current.onerror = (e) => {
        logToConsole(`[MIC ERROR]: ${e.error}`)
        setIsListening(false)
        aiPhaseRef.current = 'idle'
        audioQueue.isAmbientSuppressed = false

        // The user cannot see the debug log — especially on a phone, and especially
        // if they are blind. Every failure has to be audible or it did not happen.
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
          micGrantedRef.current = false
          audioQueue.speakExplicit(
            ['Microphone access is blocked. Allow the microphone for this site in your browser settings, then try again.'],
            1.1, voiceEnabledRef)
        } else if (e.error === 'no-speech') {
          audioQueue.speakExplicit(["I didn't hear anything. Tap the assistant and speak again."], 1.1, voiceEnabledRef)
        } else if (e.error === 'network') {
          audioQueue.speakExplicit(['Speech recognition needs a network connection and could not reach it.'], 1.1, voiceEnabledRef)
        } else if (e.error !== 'aborted') {
          audioQueue.speakExplicit(['The microphone failed. Please try again.'], 1.1, voiceEnabledRef)
        }
      }

      recognitionRef.current.onend = () => {
        setIsListening(false)
        // If it was just listening but no text was spoken, release the lock instantly
        if (aiPhaseRef.current === 'listening') {
          aiPhaseRef.current = 'idle'
          audioQueue.isAmbientSuppressed = false
        }
      }
    } else {
      setSpeechSupported(false)
      logToConsole("SpeechRecognition API not supported in this browser.")
    }

    // Printed on every boot so that "the mic button does nothing" is answerable from
    // the on-screen log alone. On a phone there is no devtools console to open, so a
    // capability that is silently missing is otherwise indistinguishable from a bug.
    logToConsole(
      `[ENV]: secure=${window.isSecureContext} · getUserMedia=${!!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)} · ` +
      `speechRecognition=${!!SpeechRecognition} · build=${__BUILD_ID__}`
    )
  }, [])

  useEffect(() => {
    const handleOrientation = (e) => {
      const heading = e.webkitCompassHeading || (360 - e.alpha)
      if (heading !== undefined && heading !== null) setDeviceHeading(Math.round(heading))
    }
    window.addEventListener('deviceorientation', handleOrientation)
    return () => window.removeEventListener('deviceorientation', handleOrientation)
  }, [])

  useEffect(() => {
    if (!navigator.geolocation) {
      logToConsole("ERROR: Native device geolocation tracking missing.")
      return
    }
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const coords = { lat: pos.coords.latitude, lon: pos.coords.longitude }
        setCurrentPosition(coords)
        if (navRouteDataRef.current && navRouteDataRef.current.checkpoints) {
          evaluateProactivePathStep(coords)
          evaluateDeviation(coords)
        }
      },
      (err) => logToConsole(`GPS Hardware Error: ${err.message}`),
      { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
    )
    return () => navigator.geolocation.clearWatch(watchId)
  }, [])

  // Advances the route as checkpoints are passed. The checkpoint list advances whether
  // or not guidance is on, so the map stays truthful — but it only speaks while guiding,
  // because an app that calls out turns you never asked for is an app talking to itself.
  function evaluateProactivePathStep(userCoords) {
    // Indoors the GPS fix drifts tens of metres and there is no footpath to be on, so
    // "you have reached your checkpoint" would be a coin toss announced as a fact.
    if (indoorRef.current === true) return

    const route = navRouteDataRef.current
    if (!route || !route.checkpoints || route.checkpoints.length === 0) return

    const nextPt = route.checkpoints[0]
    const distanceToNext = computeHaversineDistance(userCoords.lat, userCoords.lon, nextPt.lat, nextPt.lon)
    if (distanceToNext > ARRIVAL_M) return

    const remaining = route.checkpoints.slice(1)
    const updated = { ...route, checkpoints: remaining }
    navRouteDataRef.current = updated
    setNavRouteData(updated)

    if (remaining.length === 0) {
      setIsNavigating(false)
      logToConsole('[GUIDE]: destination reached.')
      if (guidingRef.current) {
        stopGuiding('You have reached your destination. Guidance is now off.')
      }
      return
    }

    if (!guidingRef.current) return
    const turnAlert = `${nextPt.instruction} onto ${nextPt.name}.`
    logToConsole(`[GUIDE]: checkpoint reached — ${turnAlert}`)
    audioQueue.speakExplicit([turnAlert], 1.1, voiceEnabledRef)
  }

  // Two ways to go wrong that the turn-by-turn cannot catch: walking off the path
  // altogether, and walking the right path in the wrong direction.
  function evaluateDeviation(userCoords) {
    if (!guidingRef.current) return
    if (indoorRef.current === true) return  // no path to be off, and no usable fix
    const route = navRouteDataRef.current
    if (!route || !route.checkpoints || route.checkpoints.length === 0) return

    // 1. Have they left the path? (Distance to the route LINE, not to the next corner.)
    const off = distanceToRouteMeters(userCoords.lat, userCoords.lon, route.geometry)
    if (off != null) {
      if (off > OFF_ROUTE_M && !offRouteLatchRef.current) {
        offRouteLatchRef.current = true
        logToConsole(`[GUIDE]: OFF ROUTE by ${Math.round(off)}m`)
        audioQueue.speakExplicit(
          [`Careful. You have drifted about ${Math.round(off)} meters off the path. Stop, and turn slowly until I tell you that you are back on it.`],
          1.1, voiceEnabledRef)
      } else if (off < BACK_ON_ROUTE_M && offRouteLatchRef.current) {
        offRouteLatchRef.current = false
        logToConsole('[GUIDE]: back on route.')
        audioQueue.speakExplicit(['You are back on the path.'], 1.1, voiceEnabledRef)
      }
    }

    // 2. Are they facing the wrong way? Only after holding it — see HEADING_SUSTAIN_MS.
    const target = route.checkpoints[0]
    const bearing = computeTargetBearing(userCoords.lat, userCoords.lon, target.lat, target.lon)
    const diff = normalizeAngleDiff(bearing, deviceHeadingRef.current)
    const now = Date.now()
    const h = headingLatchRef.current

    if (Math.abs(diff) <= HEADING_TOLERANCE_DEG) {
      headingLatchRef.current = { since: 0, warned: false }
      return
    }
    if (!h.since) h.since = now
    if (h.warned || now - h.since < HEADING_SUSTAIN_MS) return

    h.warned = true
    const dir = diff > 0 ? 'right' : 'left'
    logToConsole(`[GUIDE]: heading off by ${Math.round(diff)}°`)
    audioQueue.speakExplicit(
      [`You are walking away from your route. Turn ${dir}, about ${Math.round(Math.abs(diff))} degrees.`],
      1.1, voiceEnabledRef)
  }

  // Speaks the fused turn + obstacle briefing once. Called on activation and then on a
  // slow cadence while guiding. Stays on Groq: this is the latency-critical path.
  async function speakBriefing({ explicit = true } = {}) {
    const user = currentPositionRef.current
    const route = navRouteDataRef.current
    if (!user || !route || !route.checkpoints || route.checkpoints.length === 0) return

    const targetNode = route.checkpoints[0]
    const distanceMeters = computeHaversineDistance(user.lat, user.lon, targetNode.lat, targetNode.lon)
    const bearing = computeTargetBearing(user.lat, user.lon, targetNode.lat, targetNode.lon)
    const heading = deviceHeadingRef.current
    const angleDiff = normalizeAngleDiff(bearing, heading)
    const turnDirection = computeTurnDirection(angleDiff)
    const fallbackText = buildFallbackGuidance(targetNode, distanceMeters, turnDirection, angleDiff, route.checkpoints.length)

    const say = (text) => {
      // Routine re-briefings go out as ambient, so an obstacle or hazard warning can cut
      // straight through them. The first briefing on activation is explicit: the user
      // just pressed the button and is waiting to hear something.
      if (explicit) audioQueue.speakExplicit([text], 1.1, voiceEnabledRef)
      else audioQueue.speakAmbient(text, 1.1, voiceEnabledRef)
    }

    try {
      const res = await fetch(`${BACKEND}/api/briefing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          objects: objectsRef.current.slice(0, 8).map((o) => ({
            name: o.name, position: o.position, steps_away: o.steps_away, confidence: o.confidence
          })),
          scene_description: aiDescRef.current,
          navigation: {
            has_route: true,
            next_instruction: targetNode.instruction,
            next_street_name: targetNode.name,
            distance_to_next_checkpoint_m: distanceMeters,
            total_distance_remaining_m: route.total_distance_meters,
            bearing_to_next_deg: bearing,
            device_heading_deg: heading,
            turn_direction: turnDirection,
            turn_degrees: Math.abs(angleDiff),
            checkpoints_remaining: route.checkpoints.length,
          }
        })
      })
      const data = await res.json()
      if (data.success && data.briefing) {
        logToConsole(`[GUIDE]: ${data.briefing}`)
        say(data.briefing)
      } else {
        say(fallbackText)
      }
    } catch (err) {
      say(fallbackText)
    }
  }

  // Indoors or out? Everything forks on this, so it is asked of the camera rather than
  // guessed from GPS — a building has a ceiling, and the model can simply see it.
  async function checkEnvironment() {
    if (!guidingRef.current || !runningRef.current) return
    try {
      const res = await fetch(`${BACKEND}/api/environment`, { method: 'POST' })
      const data = await res.json()
      if (!guidingRef.current) return

      if (!data.success || data.indoor == null) {
        if (data.reason) logToConsole(`[ENV]: unknown — ${data.reason}`)
        return
      }
      if (indoorRef.current === data.indoor) return

      const firstAnswer = indoorRef.current === null
      indoorRef.current = data.indoor
      setIndoor(data.indoor)
      logToConsole(`[ENV]: ${data.indoor ? 'INDOOR' : 'OUTDOOR'}`)

      if (data.indoor) {
        // Say this plainly rather than quietly degrade. A blind user who believes they
        // are being routed, and is not, is in more danger than one who knows they aren't.
        audioQueue.speakExplicit(
          ['You are indoors. I cannot guide you to a destination here, but I will warn you about what is ahead.'],
          1.1, voiceEnabledRef)
      } else if (!firstAnswer) {
        audioQueue.speakExplicit(['You are outdoors. Route guidance is back on.'], 1.1, voiceEnabledRef)
      }
    } catch (err) {
      // Next tick retries; an unknown environment simply leaves the mode unchanged.
    }
  }

  // Checks what is underfoot. Only speaks when there is actually something wrong —
  // the backend answers CLEAR most of the time and we stay quiet on that.
  async function scanHazards() {
    if (!guidingRef.current || !runningRef.current) return
    if (hazardInFlightRef.current) return

    hazardInFlightRef.current = true
    try {
      const res = await fetch(`${BACKEND}/api/hazards`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // What counts as a hazard differs: stairs and glass doors inside, potholes and
        // kerbs outside. Asking about potholes in a corridor only invites false positives.
        body: JSON.stringify({ indoor: indoorRef.current === true }),
      })
      const data = await res.json()
      if (!guidingRef.current) return

      if (!data.hazard || !data.alert) {
        if (data.reason) logToConsole(`[HAZARD]: no vision — ${data.reason}`)
        return
      }

      // The pothole is still a pothole four seconds later. Say it once, then let it rest
      // — unless it is still there after HAZARD_REPEAT_MS, by which point a walker who
      // has not reacted deserves reminding.
      const last = hazardLatchRef.current
      const now = Date.now()
      if (data.alert === last.text && now - last.at < HAZARD_REPEAT_MS) return
      hazardLatchRef.current = { text: data.alert, at: now }

      logToConsole(`[HAZARD]: ${data.alert}`)
      audioQueue.speakExplicit([data.alert], 1.15, voiceEnabledRef)
    } catch (err) {
      // A dropped request is not worth announcing; the next tick retries in seconds.
    } finally {
      hazardInFlightRef.current = false
    }
  }

  function stopGuiding(message) {
    guidingRef.current = false
    setGuiding(false)
    offRouteLatchRef.current = false
    headingLatchRef.current = { since: 0, warned: false }
    hazardLatchRef.current = { text: '', at: 0 }
    indoorRef.current = null
    setIndoor(null)
    logToConsole('[GUIDE]: guidance stopped.')
    audioQueue.clearAll()
    if (message) audioQueue.speakExplicit([message], 1.1, voiceEnabledRef)
  }

  // Guide Me is a mode, not a sentence. Press once to start, again to stop, again to
  // start — and it stays on by itself until the destination is reached.
  //
  // A route is no longer required. Indoors there cannot be one, and refusing to help at
  // all because OpenStreetMap has no footpath through a shopping centre would be absurd:
  // without a destination it is still a working set of eyes.
  function handleGuideMeButton() {
    if (guidingRef.current) {
      stopGuiding('Guidance stopped.')
      return
    }

    const route = navRouteDataRef.current
    const hasRoute = !!(route && route.checkpoints && route.checkpoints.length)

    if (!runningRef.current && !hasRoute) {
      audioQueue.speakExplicit(
        ['I need either the camera or a destination. Start the camera, or set where you want to go.'],
        1.1, voiceEnabledRef)
      return
    }

    guidingRef.current = true
    setGuiding(true)
    offRouteLatchRef.current = false
    headingLatchRef.current = { since: 0, warned: false }
    hazardLatchRef.current = { text: '', at: 0 }
    indoorRef.current = null
    setIndoor(null)
    logToConsole('[GUIDE]: guidance started.')

    if (!runningRef.current) {
      audioQueue.speakExplicit(
        ['Guiding you. The camera is off, so I cannot see the path ahead.'], 1.1, voiceEnabledRef)
      return
    }
    if (!hasRoute) {
      audioQueue.speakExplicit(
        ['Watching the path ahead. No destination is set, so I will warn you but not guide you anywhere.'],
        1.1, voiceEnabledRef)
      return
    }
    if (!currentPositionRef.current) {
      audioQueue.speakExplicit(['Guiding you. Waiting for GPS.'], 1.1, voiceEnabledRef)
      return
    }

    // One briefing on the press — the user asked, and is waiting to hear something. After
    // this it goes quiet, and only speaks when something is wrong.
    speakBriefing({ explicit: true })
  }

  // The guidance loop. Only alive while guiding, so nothing here runs — and no VLM call
  // is ever made — unless the user has actually asked to be guided.
  //
  // Note what is NOT here any more: the periodic re-briefing. Walking the route correctly
  // is now silent. Being told "turn left in 30 metres" every 25 seconds when you are
  // already walking correctly toward that turn tells you nothing you did not know, and an
  // aid people talk over is an aid people switch off. It speaks at the turn itself, when
  // something is in the way, when the ground is dangerous, and when you go wrong.
  useEffect(() => {
    if (!guiding) return
    checkEnvironment()
    scanHazards()
    const hazardTimer = setInterval(scanHazards, HAZARD_SCAN_MS)
    const envTimer = setInterval(checkEnvironment, ENV_CHECK_MS)
    return () => {
      clearInterval(hazardTimer)
      clearInterval(envTimer)
    }
  }, [guiding])

  // Fires once when something enters the corridor, then stays quiet for as long as it is
  // on screen. See isObstructing() above for what counts, and the latch comments for why
  // it fires on the edge rather than repeating.
  function announceDangers(liveObjects) {
    const now = Date.now()
    const latch = dangerLatchRef.current

    liveObjects.forEach((obj) => {
      const entry = latch[obj.name] || { warned: false, lastSeenAt: 0 }
      entry.lastSeenAt = now
      latch[obj.name] = entry

      if (entry.warned || !isObstructing(obj)) return
      entry.warned = true
      audioQueue.speakAmbient(describeObstruction(obj), 1.15, voiceEnabledRef)
    })

    // Re-arm only once it has genuinely gone, not merely blinked out for a frame.
    Object.keys(latch).forEach((name) => {
      if (now - latch[name].lastSeenAt > REARM_AFTER_ABSENT_MS) delete latch[name]
    })
  }

  // Objects is a question, not a subscription: it looks once, says what it sees, stops.
  // Nothing re-analyzes the scene on its own, so this is where the fresh look happens.
  async function handleObjectButton() {
    const id = beginAction('object')

    if (!runningRef.current) {
      audioQueue.speakExplicit(['The camera is not running.'], 1.1, voiceEnabledRef, () => finishAction(id))
      return
    }

    const speakFallback = () =>
      audioQueue.speakExplicit([buildObjectsNarration(objectsRef.current)], 1.1, voiceEnabledRef, () => finishAction(id))

    try {
      const res = await fetch(`${BACKEND}/api/scene`, { method: 'POST' })
      const data = await res.json()
      if (isStaleAction(id)) return

      logVisionSource('OBJECTS', data)

      if (!data.success || !data.summary) {
        logToConsole(`[OBJECTS]: ${data.message || 'scene analysis failed'}`)
        speakFallback()
        return
      }

      setAiDescription(data.summary)
      logToConsole(`[OBJECTS · SCENE]: ${data.summary}`)
      const objectsNarration = buildObjectsNarration(data.objects || objectsRef.current)
      audioQueue.speakExplicit([data.summary, objectsNarration], 1.1, voiceEnabledRef, () => finishAction(id))
    } catch (err) {
      if (isStaleAction(id)) return
      speakFallback()
    }
  }

  function handleWeatherButton() {
    const id = beginAction('weather')
    if (!currentPositionRef.current) {
      setWeatherReport("Unable to fetch weather: No live GPS tracking.")
      audioQueue.speakExplicit(["Unable to fetch weather. GPS location is not available."], 1.1, voiceEnabledRef, () => finishAction(id))
      return
    }
    
    setWeatherReport("Accessing weather data satellites...")
    ;(async () => {
      try {
        const res = await fetch(`${BACKEND}/api/weather?lat=${currentPositionRef.current.lat}&lon=${currentPositionRef.current.lon}`)
        const data = await res.json()
        if (isStaleAction(id)) return
        setWeatherReport(data.report)
        audioQueue.speakExplicit([data.report], 1.1, voiceEnabledRef, () => finishAction(id))
      } catch (err) {
        if (isStaleAction(id)) return
        setWeatherReport("Unable to pull weather metrics.")
        audioQueue.speakExplicit(["Unable to pull weather metrics."], 1.1, voiceEnabledRef, () => finishAction(id))
      }
    })()
  }

  // Raises the browser's microphone prompt, the same one the camera and GPS raise.
  //
  // SpeechRecognition.start() is supposed to ask for the mic itself, and on desktop
  // Chrome it does. On mobile it frequently does not: no dialog ever appears, start()
  // just fails with not-allowed, and the button looks broken. getUserMedia is what
  // reliably triggers the prompt — so we ask through that first, then hand over.
  //
  // We drop the stream immediately. We never wanted audio, only the permission, and
  // holding the track open can stop SpeechRecognition acquiring the mic afterwards.
  async function ensureMicPermission() {
    if (micGrantedRef.current) return true

    // getUserMedia only exists in a secure context. Over plain HTTP on a phone the
    // whole mediaDevices object is simply absent — no error, no prompt, nothing.
    if (!window.isSecureContext) {
      logToConsole(`[MIC ERROR]: insecure origin (${window.location.protocol}//). Camera and mic need HTTPS.`)
      audioQueue.speakExplicit(['This page is not secure, so the microphone cannot be used. Open it over HTTPS.'], 1.1, voiceEnabledRef)
      return false
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      logToConsole('[MIC ERROR]: no getUserMedia in this browser.')
      audioQueue.speakExplicit(['This browser has no microphone access.'], 1.1, voiceEnabledRef)
      return false
    }

    // A permission the user has already blocked does NOT re-prompt — getUserMedia just
    // throws instantly. That looks identical to "nothing happened", so name it, or the
    // user will keep tapping a button that can never work until they reset it by hand.
    try {
      if (navigator.permissions && navigator.permissions.query) {
        const status = await navigator.permissions.query({ name: 'microphone' })
        logToConsole(`[MIC]: permission state = ${status.state}`)
        if (status.state === 'denied') {
          audioQueue.speakExplicit(
            ['The microphone is blocked for this site. Tap the lock icon next to the address bar, allow the microphone, then reload.'],
            1.1, voiceEnabledRef)
          return false
        }
      }
    } catch (e) { /* Safari has no 'microphone' descriptor — fall through and just ask */ }

    try {
      logToConsole('[MIC]: requesting permission…')
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      stream.getTracks().forEach((track) => track.stop())
      micGrantedRef.current = true
      logToConsole('[MIC]: permission granted.')
      return true
    } catch (err) {
      logToConsole(`[MIC ERROR]: ${err.name} — ${err.message}`)
      const blocked = err.name === 'NotAllowedError' || err.name === 'SecurityError'
      audioQueue.speakExplicit(
        [blocked
          ? 'Microphone access was denied. Allow the microphone for this site, then tap the assistant again.'
          : 'The microphone could not be opened. It may be in use by another app.'],
        1.1, voiceEnabledRef)
      return false
    }
  }

  async function toggleListen() {
    if (!recognitionRef.current) {
      logToConsole('Speech recognition not supported in this browser.')
      audioQueue.speakExplicit(
        ['Voice input is not supported in this browser. Try Chrome.'],
        1.1, voiceEnabledRef)
      return
    }

    if (isListening) {
      recognitionRef.current.stop()
      setIsListening(false)
      aiPhaseRef.current = 'idle'
      audioQueue.isAmbientSuppressed = false
      return
    }

    // Only the very first tap awaits: once granted, micGrantedRef short-circuits and
    // start() runs synchronously inside the click, which keeps the user gesture that
    // stricter mobile browsers require.
    if (!(await ensureMicPermission())) return

    actionIdRef.current += 1
    audioQueue.clearAll()

    // Lock background noise completely before opening mic channel
    aiPhaseRef.current = 'listening'
    audioQueue.isAmbientSuppressed = true

    try {
      recognitionRef.current.start()
      setIsListening(true)
    } catch (err) {
      // start() throws if the previous session hasn't fully torn down yet.
      logToConsole(`[MIC ERROR]: ${err.message}`)
      aiPhaseRef.current = 'idle'
      audioQueue.isAmbientSuppressed = false
      setIsListening(false)
    }
  }

  async function handleAiQuery(query) {
    const id = beginAction('ai_assist')
    logToConsole(`[AI ASSISTANT]: Querying "${query}"...`)

    // Releases the mic/ambient-speech lock once the assistant has finished talking.
    const release = () => {
      aiPhaseRef.current = 'idle'
      audioQueue.isAmbientSuppressed = false
      finishAction(id)
    }

    try {
      const res = await fetch(`${BACKEND}/api/ai_assist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query })
      })
      const data = await res.json()
      if (isStaleAction(id)) return

      logVisionSource('AI ASSISTANT', data)

      if (!data.success || !data.response) {
        audioQueue.speakExplicit(["AI Assistant connection error."], 1.1, voiceEnabledRef, release)
        return
      }

      // "Take me to the train station" — the assistant heard a destination, so
      // set the route itself instead of just answering.
      if (data.intent === 'navigate' && data.destination) {
        logToConsole(`[AI ASSISTANT]: Destination intent → "${data.destination}"`)
        await beginNavigation(data.destination, { spokenPrefix: [data.response], onSpoken: release })
        return
      }

      audioQueue.speakExplicit([data.response], 1.1, voiceEnabledRef, release)
    } catch (e) {
      if (isStaleAction(id)) return
      audioQueue.speakExplicit(["AI Assistant connection error."], 1.1, voiceEnabledRef, release)
    }
  }

  // Geocodes a destination and locks in a walking route to it. Callable from the
  // form or from the voice assistant, so speaking a destination and typing one
  // take exactly the same path.
  //
  // spokenPrefix is spoken immediately before the outcome. It exists because
  // speakExplicit cancels whatever is already talking — so the assistant's
  // acknowledgement and the routing result have to go out as one utterance,
  // or the second would cut off the first.
  async function beginNavigation(destination, { spokenPrefix = [], onSpoken } = {}) {
    const target = (destination || '').trim()
    if (!target) return false

    logToConsole(`Wiping tracking metrics. Fetching grid for: "${target}"`)
    setDestinationInput(target)
    setNavRouteData(null)
    setIsNavigating(false)
    // A new destination invalidates the route we were guiding along, so guidance has to
    // end here rather than keep steering the user toward the old one.
    if (guidingRef.current) stopGuiding()

    const speak = (lines) => audioQueue.speakExplicit([...spokenPrefix, ...lines], 1.1, voiceEnabledRef, onSpoken)

    let startLat = 10.0150, startLon = 76.3280
    if (currentPositionRef.current) {
      startLat = currentPositionRef.current.lat
      startLon = currentPositionRef.current.lon
    }

    // A pasted URL is unspeakable — never read it back out loud.
    const spokenTarget = isMapLink(target) ? 'that map link' : target

    try {
      const geoRes = await fetch(`${BACKEND}/api/resolve?query=${encodeURIComponent(target)}`)
      const geoData = await geoRes.json()
      if (!geoData.success) {
        logToConsole(`Could not resolve "${target}": ${geoData.message || 'unknown reason'}`)
        speak([`I could not find ${spokenTarget} on the map.`])
        return false
      }
      logToConsole(`Target locked via ${geoData.source} — ${geoData.display_name}`)

      const routeRes = await fetch(`${BACKEND}/api/route?start_lat=${startLat}&start_lon=${startLon}&end_lat=${geoData.lat}&end_lon=${geoData.lon}`)
      const routeData = await routeRes.json()
      if (!routeData.success) {
        logToConsole('Routing Denied.')
        speak([`I found ${spokenTarget}, but I could not trace a walking route to it.`])
        return false
      }

      setNavRouteData(routeData)
      setIsNavigating(true)
      speak([`New itinerary locked. Distance is ${Math.round(routeData.total_distance_meters)} meters.`])
      return true
    } catch (err) {
      logToConsole(`Telemetry Exception: ${err.message}`)
      speak(['Navigation failed. Please try again.'])
      return false
    }
  }

  function executeRoutingProcess(e) {
    e.preventDefault()
    beginNavigation(destinationInput)
  }

  // Maps the normalized box coords the server returns onto the letterboxed
  // rect the video actually occupies inside its element, so the overlay lines
  // up regardless of how the panel is sized.
  function drawOverlay(detections) {
    const canvas = overlayRef.current
    const video = videoRef.current
    if (!canvas || !video || !video.videoWidth) return

    const cw = canvas.clientWidth
    const ch = canvas.clientHeight
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw
      canvas.height = ch
    }

    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, cw, ch)
    if (!detections || !detections.length) return

    const scale = Math.min(cw / video.videoWidth, ch / video.videoHeight)
    const dw = video.videoWidth * scale
    const dh = video.videoHeight * scale
    const ox = (cw - dw) / 2
    const oy = (ch - dh) / 2

    ctx.lineWidth = 2
    ctx.font = '600 13px system-ui, sans-serif'
    ctx.textBaseline = 'top'

    detections.forEach((obj) => {
      if (!obj.box) return
      const [nx1, ny1, nx2, ny2] = obj.box
      const x = ox + nx1 * dw
      const y = oy + ny1 * dh
      const w = (nx2 - nx1) * dw
      const h = (ny2 - ny1) * dh

      // Red means the same thing the voice means: this one is in your way. Anything else
      // is just something the detector happened to see.
      const color = isObstructing(obj) ? '#f87171' : '#4ade80'
      ctx.strokeStyle = color
      ctx.strokeRect(x, y, w, h)

      const label = `${obj.name} · ${obj.distance_m ?? '?'}m`
      const labelY = Math.max(y - 18, 0)
      ctx.fillStyle = color
      ctx.fillRect(x, labelY, ctx.measureText(label).width + 10, 18)
      ctx.fillStyle = '#0b0f19'
      ctx.fillText(label, x + 5, labelY + 1)
    })
  }

  // Grabs the current video frame, JPEG-encodes it, and ships it to the backend.
  function sendFrame() {
    const ws = wsRef.current
    const video = videoRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    if (!runningRef.current || !video || video.readyState < 2 || !video.videoWidth) return

    let canvas = captureCanvasRef.current
    if (!canvas) {
      canvas = document.createElement('canvas')
      captureCanvasRef.current = canvas
    }

    // Downscale before sending — YOLO sees 640px anyway, and this keeps the
    // upload small enough to stay realtime on a phone connection.
    const targetWidth = 640
    const scale = targetWidth / video.videoWidth
    canvas.width = targetWidth
    canvas.height = Math.round(video.videoHeight * scale)
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height)

    canvas.toBlob((blob) => {
      const sock = wsRef.current
      if (!blob || !sock || sock.readyState !== WebSocket.OPEN || inFlightRef.current) return
      inFlightRef.current = true
      lastSentAtRef.current = Date.now()
      sock.send(blob)
    }, 'image/jpeg', 0.6)
  }

  useEffect(() => {
    const wsProto = BACKEND.startsWith('https') ? 'wss' : 'ws'
    const wsHost = BACKEND.replace(/^https?:/, '')
    const wsUrl = `${wsProto}:${wsHost}/ws`

    let disposed = false

    function connect() {
      const ws = new WebSocket(wsUrl)
      wsRef.current = ws

      ws.onopen = () => { inFlightRef.current = false }

      ws.onmessage = (ev) => {
        if (ws !== wsRef.current) return
        inFlightRef.current = false
        msgCountRef.current += 1
        try {
          const data = JSON.parse(ev.data)
          if (runningRef.current) {
            const liveObjects = data.objects || []
            setObjects(liveObjects)
            drawOverlay(liveObjects)
            if (data.description && data.description !== aiDescRef.current) { setAiDescription(data.description) }
            if (voiceEnabledRef.current) announceDangers(liveObjects)
          } else { setObjects([]) }
        } catch (e) { console.error(e) }
      }
      ws.onerror = (e) => console.error('WS error', e)
      ws.onclose = () => {
        inFlightRef.current = false
        if (!disposed) setTimeout(connect, 1000)
      }
    }
    connect()

    // Only one frame is ever in flight: the next is sent when the previous
    // one's detections come back. A slow server therefore lowers the frame
    // rate instead of building up a backlog of stale frames.
    const pump = setInterval(() => {
      if (inFlightRef.current) {
        if (Date.now() - lastSentAtRef.current > 4000) inFlightRef.current = false
        return
      }
      sendFrame()
    }, 120)

    const fpsI = setInterval(() => { setFps(msgCountRef.current); msgCountRef.current = 0 }, 1000)
    return () => {
      disposed = true
      clearInterval(pump)
      clearInterval(fpsI)
      if (wsRef.current) wsRef.current.close()
    }
  }, [])

  // The <video> only exists while running, so attach the stream once it mounts.
  useEffect(() => {
    const video = videoRef.current
    if (running && video && streamRef.current && video.srcObject !== streamRef.current) {
      video.srcObject = streamRef.current
      video.play().catch(() => {})
    }
  }, [running])

  function snapshot() {
    const video = videoRef.current
    if (!video || !video.videoWidth) return
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    if (ctx) {
      ctx.drawImage(video, 0, 0)
      const url = canvas.toDataURL('image/png')
      const a = document.createElement('a')
      a.href = url
      a.download = `snapshot-${Date.now()}.png`
      a.click()
    }
  }

  // Pauses detection without giving up the camera permission/stream.
  function toggleRunning() {
    const nextState = !running
    setRunning(nextState)
    if (!nextState) {
      audioQueue.clearAll()
      // Otherwise a still-latched obstacle would be silently swallowed on resume.
      dangerLatchRef.current = {}
    }
  }

  // The camera is the user's own device — on a phone this is the rear camera,
  // which is the one actually pointed at the path ahead.
  async function startCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      logToConsole('[CAMERA ERROR]: This browser exposes no camera API.')
      return
    }
    try {
      const stream = streamRef.current || await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      })
      streamRef.current = stream
      setRunning(true)
      logToConsole('[SENSOR]: Camera stream acquired.')
    } catch (err) {
      logToConsole(`[CAMERA ERROR]: ${err.message}`)
      audioQueue.speakExplicit(['Camera access was denied.'], 1.1, voiceEnabledRef)
    }
  }

  function stopCamera() {
    const stream = streamRef.current
    if (stream) stream.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    setRunning(false)
    setObjects([])
    drawOverlay([])
    audioQueue.clearAll()
    dangerLatchRef.current = {}
    logToConsole('[SENSOR]: Camera stream released.')
  }

  const activeCheckpoint = navRouteData && navRouteData.checkpoints && navRouteData.checkpoints.length > 0
    ? navRouteData.checkpoints[0]
    : null

  function buttonStatusLabel(name) {
    if (activeAction !== name) return null
    if (speechState.isPlaying && speechState.priority === 'explicit') return '🔊 Speaking…'
    return '🧠 Preparing…'
  }

  const primaryActions = [
    {
      id: 'guide',
      spine: guiding ? 'Guiding' : 'Guide',
      glyph: <IconCompass />,
      title: guiding ? (indoor === true ? 'Watching…' : 'Guiding…') : 'Guide Me',
      description: !guiding
        ? 'Guides you to your destination and then stays quiet — speaking only at a turn, when something is in your way, or when you go wrong. Tap again to stop.'
        : indoor === true
          ? 'Indoors: no route to follow, so it watches instead. Warning about obstacles, steps, glass and anything in your path.'
          : 'Silent while you are on track. Speaks at turns, when something is in your way, and if you drift off the path.',
      idle: guiding
        ? (indoor === null ? 'Active · checking…' : indoor ? 'Indoors · watching' : 'Outdoors · on route')
        : 'Silent unless it matters',
      ariaLabel: guiding ? 'Stop guidance' : 'Guide me: start continuous spoken navigation',
      onClick: handleGuideMeButton,
      // Never disabled: the button has to remain pressable in order to stop guidance.
      disabled: false,
      tint: { '--ub-glow': 'rgba(2,132,199,0.55)', '--ub-soft': 'rgba(2,132,199,0.17)', '--ub-base': '#0b3a5d', '--ub-deep': '#06213a', '--ub-status': '#bae6fd' },
    },
    {
      id: 'object',
      spine: 'Objects',
      glyph: <IconScan />,
      title: 'Objects',
      description: 'Looks at the path right now and describes what is in front of you, nearest first — including hazards and signs the detector cannot name. Speaks once.',
      idle: 'Look once · Describe',
      ariaLabel: 'Describe what is in front of me right now',
      onClick: handleObjectButton,
      disabled: activeAction === 'object',
      tint: { '--ub-glow': 'rgba(139,92,246,0.55)', '--ub-soft': 'rgba(139,92,246,0.17)', '--ub-base': '#33246e', '--ub-deep': '#1b1440', '--ub-status': '#ddd6fe' },
    },
    {
      id: 'weather',
      spine: 'Weather',
      glyph: <IconWeather />,
      title: 'Weather',
      description: 'Pulls conditions for your live coordinates and turns them into plain spoken advice — umbrella or not.',
      idle: 'Conditions · Advice',
      ariaLabel: 'Get current weather report',
      onClick: handleWeatherButton,
      disabled: activeAction === 'weather',
      tint: { '--ub-glow': 'rgba(245,158,11,0.55)', '--ub-soft': 'rgba(245,158,11,0.16)', '--ub-base': '#6b4410', '--ub-deep': '#3a2409', '--ub-status': '#fde68a' },
    },
    {
      id: 'ai_assist',
      spine: isListening ? 'Listening' : 'Assistant',
      glyph: isListening ? <IconMic /> : <IconSparkle />,
      title: isListening ? 'Listening…' : 'AI Assistant',
      description: !speechSupported
        ? 'Voice input needs the Web Speech API, which this browser does not have. Chrome supports it, on desktop and on Android.'
        : isListening
          ? 'Microphone is open and ambient narration is suppressed. Ask your question now.'
          : 'Ask anything about the scene around you. Tap once to open the microphone, tap again to cancel.',
      idle: !speechSupported ? 'Unsupported browser' : isListening ? 'Speak now' : 'Ask anything',
      ariaLabel: isListening ? 'Stop listening' : 'AI Assistant: ask questions about the scene',
      onClick: toggleListen,
      disabled: false,
      tint: isListening
        // Listening stays red on purpose — it's an alert state, not a theme colour.
        ? { '--ub-glow': 'rgba(239,68,68,0.6)', '--ub-soft': 'rgba(239,68,68,0.18)', '--ub-base': '#4c1d1d', '--ub-deep': '#2b0f0f', '--ub-status': '#fecaca' }
        : { '--ub-glow': 'rgba(16,185,129,0.55)', '--ub-soft': 'rgba(16,185,129,0.17)', '--ub-base': '#0c5244', '--ub-deep': '#062e27', '--ub-status': '#a7f3d0' },
    },
  ]

return (
    <div className="unblinder-app" style={{ background: 'var(--surface-2)', color: 'var(--text)', fontFamily: 'sans-serif' }}>

      <header className="ub-header">
        <div className="ub-brand">
          <div className="ub-brand-row">
            <span className="ub-live-dot" aria-hidden="true" />
            <h1>UNBLINDER COGNITIVE CONSOLE</h1>
          </div>
          <p>Tactical Core Architecture • Accelerated Spatial Telemetry Frame</p>
        </div>

        <div className="ub-hud">
          <ThemeToggle theme={theme} onToggle={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))} />

          <label className={`ub-speech${voiceEnabled ? ' is-on' : ''}`}>
            <span className="ub-speech-icon" aria-hidden="true">
              {voiceEnabled ? <IconVolume /> : <IconVolumeOff />}
            </span>
            <span className="ub-speech-text">
              <span>SPEECH:</span>
              <span className="ub-swap">
                <span className={voiceEnabled ? undefined : 'is-hidden'}>ACTIVE</span>
                <span className={voiceEnabled ? 'is-hidden' : undefined}>MUTED</span>
              </span>
            </span>
            <input
              type="checkbox"
              className="ub-switch"
              checked={voiceEnabled}
              aria-label="Speech output"
              onChange={() => {
                const nextState = !voiceEnabled
                setVoiceEnabled(nextState)
                if (!nextState) audioQueue.clearAll()
              }}
            />
          </label>

          <button type="button" className="ub-link-btn" onClick={toggleRunning}>
            <span className="ub-swap">
              <span className={running ? undefined : 'is-hidden'}>Pause UI</span>
              <span className={running ? 'is-hidden' : undefined}>Resume UI</span>
            </span>
          </button>
          <button type="button" className="ub-link-btn" onClick={snapshot}>
            Snapshot
          </button>
          <button
            type="button"
            className={`ub-link-btn ${running ? 'is-danger' : 'is-go'}`}
            onClick={running ? stopCamera : startCamera}
          >
            <span className="ub-swap">
              <span className={running ? undefined : 'is-hidden'}>Stop Camera</span>
              <span className={running ? 'is-hidden' : undefined}>Start Camera</span>
            </span>
          </button>
          <div className="ub-stat" style={{ fontSize: '0.85rem', fontFamily: 'monospace', color: 'var(--text-muted)' }}>LATENCY: {fps > 0 ? `${Math.round(1000/fps)}ms` : '—'} • FPS: {fps}</div>
        </div>
      </header>

      <section aria-label="Primary voice controls" style={{ marginBottom: '2rem' }}>
        <div className="ub-split">
          {primaryActions.map((action, i) => {
            const busy = activeAction === action.id
            const listening = action.id === 'ai_assist' && isListening
            const active = action.id === 'guide' && guiding
            const status = buttonStatusLabel(action.id) || action.idle
            const classes = ['ub-panel']
            if (busy || listening || active) classes.push('is-open')
            if (listening) classes.push('is-listening')
            // Guidance runs for minutes with no other visual cue that it is on.
            if (active) classes.push('is-guiding')

            return (
              <button
                key={action.id}
                type="button"
                className={classes.join(' ')}
                style={action.tint}
                onClick={action.onClick}
                disabled={action.disabled}
                aria-busy={busy}
                aria-label={action.ariaLabel}
              >
                <span className="ub-glyph" aria-hidden="true">{action.glyph}</span>
                <span className="ub-index" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
                <span className="ub-vlabel" aria-hidden="true">{action.spine}</span>

                <span className="ub-content">
                  <span className="ub-title">{action.title}</span>
                  <span className="ub-desc">{action.description}</span>
                  <span className="ub-status">
                    {busy && <span className="ub-dot" aria-hidden="true" />}
                    {status}
                  </span>
                </span>
              </button>
            )
          })}
        </div>
      </section>

      {/* SYSTEM CONTROL HUD */}
      <section style={{ background: 'linear-gradient(to right, var(--surface), var(--surface-3))', border: '1px solid var(--border)', borderRadius: '18px', padding: '1.5rem', marginBottom: '2rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <div style={{ borderBottom: '1px solid var(--border)', paddingBottom: '0.75rem' }}>
          <h2 style={{ fontSize: '1.25rem', fontWeight: '800', color: 'var(--text)' }}>🎯 ADVANCED COGNITIVE SPATIAL MAPPING</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', fontFamily: 'monospace' }}>REALTIME LOCATION MONITORING INTERFACE</p>
        </div>

        <form onSubmit={executeRoutingProcess} className="ub-navform">
          <div>
            <label style={{ display: 'block', color: 'var(--text-muted)', fontSize: '0.8rem', fontWeight: '700', marginBottom: '6px', fontFamily: 'monospace' }}>START POINT REFERENCE</label>
            <input type="text" value={startInput} disabled style={{ width: '100%', padding: '0.75rem 1rem', background: 'var(--surface-2)', border: '1px solid var(--border-2)', borderRadius: '10px', color: 'var(--text-muted)' }} />
          </div>
          <div>
            <label style={{ display: 'block', color: 'var(--text-muted)', fontSize: '0.8rem', fontWeight: '700', marginBottom: '6px', fontFamily: 'monospace' }}>SET NEW TARGET DESTINATION</label>
            <input type="text" placeholder="Place name, coordinates, or a pasted Google Maps link…" value={destinationInput} onChange={(e) => setDestinationInput(e.target.value)} style={{ width: '100%', padding: '0.75rem 1rem', background: 'var(--surface)', border: '1px solid var(--border-strong)', borderRadius: '10px', color: 'var(--text)', fontWeight: '600' }} />
          </div>
          <button type="submit" style={{ width: '100%', padding: '0.75rem 1rem', background: 'var(--btn-bg)', color: 'var(--btn-ink)', fontWeight: '700', borderRadius: '10px', border: 'none', cursor: 'pointer' }}>🗺️ PLOT MATRIX</button>
        </form>
      </section>

      {/* INTERACTIVE LEAFLET MAP SECTION */}
      <section style={{ background: 'var(--surface-3)', border: '1px solid var(--border)', borderRadius: '18px', padding: '1.5rem', marginBottom: '2rem' }}>
        <h3 style={{ fontSize: '1rem', fontFamily: 'monospace', color: 'var(--heading-accent)', marginBottom: '1rem', fontWeight: '800' }}>🗺️ HIGH-PRECISION VISUAL POSITIONING VERIFICATION MONITOR</h3>
        <div className="ub-mapgrid">

          <div className="ub-mapbox" style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '14px', position: 'relative', overflow: 'hidden' }}>
            {currentPosition ? (
              <MapContainer 
                center={[currentPosition.lat, currentPosition.lon]} 
                zoom={17} 
                zoomControl={false}
                style={{ height: '100%', width: '100%', zIndex: 1 }}
              >
                <TileLayer
                  key={theme}
                  url={`https://{s}.basemaps.cartocdn.com/${theme === 'dark' ? 'dark_all' : 'light_all'}/{z}/{x}/{y}{r}.png`}
                  attribution='&copy; <a href="https://carto.com/">CartoDB</a>'
                />
                
                <RecenterMap lat={currentPosition.lat} lng={currentPosition.lon} />
                
                <Marker position={[currentPosition.lat, currentPosition.lon]} icon={userIcon} />

                {navRouteData && navRouteData.geometry && (
                  <Polyline 
                    positions={navRouteData.geometry.coordinates.map(c => [c[1], c[0]])} 
                    color="#0369a1"
                    weight={6} 
                    opacity={0.8}
                    dashArray="10, 12"
                  />
                )}

                {activeCheckpoint && (
                  <Marker position={[activeCheckpoint.lat, activeCheckpoint.lon]} icon={checkpointIcon} />
                )}
              </MapContainer>
            ) : (
              <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: '0.9rem', fontFamily: 'monospace' }}>
                [ AWAITING HIGH PRECISION LOCAL HARDWARE GPS CORRELATION LINK ]
              </div>
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', background: 'var(--surface)', padding: '1rem', borderRadius: '14px', border: '1px solid var(--border)', fontFamily: 'monospace', fontSize: '0.85rem' }}>
            <div style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--border-2)', paddingBottom: '4px', fontWeight: 'bold' }}>LIVE TELEMETRY READOUT</div>
            <div><span style={{ color: 'var(--text-muted)' }}>LAT:</span> {currentPosition ? currentPosition.lat.toFixed(6) : "Searching..."}</div>
            <div><span style={{ color: 'var(--text-muted)' }}>LON:</span> {currentPosition ? currentPosition.lon.toFixed(6) : "Searching..."}</div>
            <div><span style={{ color: 'var(--text-muted)' }}>COMPASS BEARING:</span> {deviceHeading}°</div>
            {activeCheckpoint && currentPosition && (
              <>
                <div><span style={{ color: 'var(--text-muted)' }}>TARGET BEARING:</span> {Math.round(computeTargetBearing(currentPosition.lat, currentPosition.lon, activeCheckpoint.lat, activeCheckpoint.lon))}°</div>
                <div><span style={{ color: 'var(--text-muted)' }}>DIST TO NODE:</span> {Math.round(computeHaversineDistance(currentPosition.lat, currentPosition.lon, activeCheckpoint.lat, activeCheckpoint.lon))}m</div>
              </>
            )}
            <div style={{ marginTop: 'auto', paddingTop: '10px', borderTop: '1px solid var(--border-2)' }}>
              <span style={{ color: 'var(--console-text)', fontWeight: 'bold' }}>ROUTE METRIC SCAN:</span><br/>
              {isNavigating ? "🎯 ROUTE ACTIVE" : "💤 STANDBY ENGINE"}
            </div>
          </div>
        </div>
      </section>

      <main className="ub-main">
        <section style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <div style={{ position: 'relative', width: '100%', aspectRatio: '16/9', background: 'var(--video-bed)', borderRadius: '18px', overflow: 'hidden', border: '2px solid var(--border)' }}>
            {running ? (
              <>
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  style={{ width: '100%', height: '100%', objectFit: 'contain', background: 'var(--video-bed)' }}
                />
                <canvas
                  ref={overlayRef}
                  style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
                />
              </>
            ) : (
              <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="var(--text-faint)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: '1rem' }}><path d="M13 13v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h2.5l.5-1"></path><line x1="2" y1="2" x2="22" y2="22"></line><path d="M10 5h4l2 3h4a2 2 0 0 1 2 2v7.5"></path></svg>
                <h3 style={{ color: 'var(--text-muted)', fontFamily: 'monospace' }}>SENSOR LINK OFFLINE</h3>
                <button onClick={startCamera} style={{ background: 'var(--cta-bg)', color: 'var(--cta-ink)', fontWeight: '800', padding: '0.8rem 2rem', borderRadius: '12px', border: 'none', cursor: 'pointer', marginTop: '1rem', display: 'flex', alignItems: 'center', gap: '10px' }}><svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M5 3v18l15-9L5 3z"/></svg>ENGAGE CAMERA SENSOR</button>
              </div>
            )}
          </div>

          <div className="ub-scene" style={{ background: 'linear-gradient(135deg, var(--surface-3), var(--surface))', borderRadius: '18px', border: '1px solid var(--border)' }}>
            <div style={{ fontSize: '0.8rem', fontFamily: 'monospace', color: 'var(--success)', fontWeight: '700', textTransform: 'uppercase', marginBottom: '0.75rem' }}>Macro Scene Summary Context</div>
            <div className="ub-scene-text" style={{ fontWeight: '700', color: 'var(--text)' }}>"{aiDescription}"</div>
          </div>

          <div style={{ padding: '1.5rem', background: 'var(--surface)', border: '2px solid var(--border)', borderRadius: '18px' }}>
            <div style={{ fontSize: '0.8rem', fontFamily: 'monospace', color: 'var(--heading-accent)', fontWeight: '700', marginBottom: '0.75rem', textTransform: 'uppercase' }}>⚙️ ACTIVE TELEMETRY LOG DISPLAY WINDOW</div>
            <div style={{ height: '140px', overflowY: 'auto', background: 'var(--surface-2)', borderRadius: '10px', padding: '1rem', fontFamily: 'monospace', fontSize: '0.85rem', color: 'var(--console-text)', lineHeight: '1.6', border: '1px solid var(--border)' }}>
              {debugLogs.map((log, idx) => (
                <div key={idx} style={{ borderBottom: '1px solid var(--border)', paddingBottom: '4px', marginBottom: '4px' }}>{log}</div>
              ))}
            </div>
          </div>
        </section>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <aside style={{ background: 'var(--surface-3)', padding: '1.7rem', borderRadius: '18px', border: '1px solid var(--border)' }}>
            <h2 style={{ fontSize: '1.4rem', fontWeight: '800', borderBottom: '1px solid var(--border)', paddingBottom: '1rem', marginBottom: '1.5rem' }}>YOLO Tracked Targets</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', maxHeight: '250px', overflowY: 'auto' }}>
               {objects.length === 0 && (
                <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '2rem 0', fontFamily: 'monospace' }}>[ NO TARGET OBJECTS REGISTERED ]</div>
              )}
              {objects.map((o, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '16px', background: 'var(--surface)', padding: '1.2rem', borderRadius: '14px', border: '1px solid var(--border-2)' }}>
                  <div style={{ background: 'var(--btn-bg)', color: 'var(--btn-ink)', fontWeight: '800', padding: '10px', borderRadius: '10px', fontFamily: 'monospace' }}>{(o.position || 'ce').slice(0,2).toUpperCase()}</div>
                  <div>
                    <div style={{ fontWeight: '700', fontSize: '1.2rem' }}>{o.name}</div>
                    <div style={{ color: isObstructing(o) ? 'var(--danger, #ef4444)' : 'var(--warn)', fontWeight: '800', fontSize: '0.85rem', marginTop: '4px' }}>
                      {o.distance_m}m {isObstructing(o) ? '· IN YOUR WAY' : 'away'}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </aside>

          <aside style={{ background: 'var(--surface-3)', padding: '1.7rem', borderRadius: '18px', border: '1px solid var(--border)' }}>
            <div style={{ borderBottom: '1px solid var(--border)', paddingBottom: '1rem', marginBottom: '1.5rem' }}>
              <h2 style={{ fontSize: '1.4rem', fontWeight: '800' }}>Spatial Weather</h2>
            </div>
            <div style={{ background: 'var(--surface)', padding: '1.2rem', borderRadius: '14px', border: '1px solid var(--border-2)', fontFamily: 'monospace', fontSize: '0.95rem' }}>{weatherReport}</div>
          </aside>
        </div>
      </main>
    </div>
  )
}