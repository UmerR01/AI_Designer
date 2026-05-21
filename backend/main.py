import os
import time
import json
import base64
import re
import contextvars
import asyncio
import threading
from io import BytesIO
from pathlib import Path
from typing import Optional, Union

from PIL import Image
from dotenv import load_dotenv
from google import genai
from google.genai import types

import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware

load_dotenv(override=True)

# Programmatically detect local credentials.json to prevent any Windows path escaping issues
local_creds = Path(__file__).parent / "credentials.json"
if local_creds.exists():
    os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = str(local_creds.resolve())

# ──────────────────────────────────────────────────────────────────────────────
# CONFIGURATION & CLIENT
# ──────────────────────────────────────────────────────────────────────────────
PROJECT_ID = os.getenv("VERTEX_PROJECT_ID", "joblynk-489820")
LOCATION   = os.getenv("VERTEX_LOCATION", "us-central1")
OUTPUT_DIR = Path("pipeline_outputs")
OUTPUT_DIR.mkdir(exist_ok=True)

client = genai.Client(vertexai=True, project=PROJECT_ID, location=LOCATION)

IMAGE_MODEL = "gemini-3.1-flash-image-preview"
TEXT_MODEL  = "gemini-2.5-flash-lite"

# Simple in-process pacing to reduce burst calls that trigger 429 limits.
_GEN_LOCK = threading.Lock()
_LAST_GEN_CALL_TS = 0.0
MIN_GENERATION_INTERVAL_SECONDS = float(os.getenv("MIN_GENERATION_INTERVAL_SECONDS", "8"))
_CURRENT_OUTPUT_DIR: contextvars.ContextVar[Path] = contextvars.ContextVar("CURRENT_OUTPUT_DIR", default=OUTPUT_DIR)

# In-process session store  { session_id -> { turns, last_images, ... } }
SESSION_MEMORY: dict[str, dict] = {}

app = FastAPI(title="Design Pipeline API", version="3.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ──────────────────────────────────────────────────────────────────────────────
# PLATFORM SPECS
# Centralised so every prompt function pulls from the same source of truth.
# ──────────────────────────────────────────────────────────────────────────────
PLATFORM_SPECS: dict[str, dict] = {
    "mobile": {
        "label":        "iOS / Android mobile app",
        "viewport":     "390 x 844 px  (iPhone 14 portrait)",
        "aspect_ratio": "9:16 portrait",
        "nav_type":     "bottom_tab_bar",
        "safe_areas":   "status bar top (44 px), home indicator bottom (34 px)",
        "touch_target": "minimum 44 x 44 pt",
        "font_scale":   "body 16 sp, heading 22-28 sp",
        "layout_note":  "Single scrollable column. No sidebars. No multi-column grids.",
        "forbidden":    "Do NOT render a web browser chrome, desktop sidebars, or multi-column layouts.",
    },
    "tablet": {
        "label":        "iPad / Android tablet app",
        "viewport":     "768 x 1024 px  (iPad portrait)",
        "aspect_ratio": "3:4 portrait",
        "nav_type":     "sidebar",
        "safe_areas":   "status bar top (20 px)",
        "touch_target": "minimum 44 x 44 pt",
        "font_scale":   "body 17 sp, heading 24-32 sp",
        "layout_note":  "May use two-column split-view. Navigation sidebar on the left.",
        "forbidden":    "Do NOT render a desktop web browser chrome.",
    },
    "web": {
        "label":        "Desktop web application",
        "viewport":     "1440 x 900 px  (standard laptop)",
        "aspect_ratio": "16:9 landscape",
        "nav_type":     "top_navbar",
        "safe_areas":   "none",
        "touch_target": "cursor-friendly, minimum 32 x 32 px",
        "font_scale":   "body 14-16 px, heading 24-40 px",
        "layout_note":  "Multi-column layouts allowed. Use a top navigation bar.",
        "forbidden":    "Do NOT render a mobile phone frame or bottom tab bar.",
    },
}


def _spec(platform: str) -> dict:
    """Return platform spec, defaulting to mobile."""
    return PLATFORM_SPECS.get(platform, PLATFORM_SPECS["mobile"])


# ──────────────────────────────────────────────────────────────────────────────
# SESSION MEMORY HELPERS
# ──────────────────────────────────────────────────────────────────────────────

def _normalize_session_id(session_id: Optional[str]) -> str:
    return session_id or f"session-{int(time.time() * 1000)}-{os.urandom(4).hex()}"


def _get_session_state(session_id: str) -> dict:
    return SESSION_MEMORY.setdefault(session_id, {
        "turns":        [],
        "last_images":  {},   # panel -> raw bytes
        "last_prompts": {},
        "last_intents": {},
        "ui_flow":      {},
    })


def _remember_turn(
    session_id: str,
    panel: str,
    role: str,
    *,
    query:     str            = "",
    summary:   str            = "",
    prompt:    str            = "",
    raw_bytes: Optional[bytes] = None,
    filename:  str            = "",
    intent:    str            = "",
    platform:  str            = "",
    is_edit:   bool           = False,
) -> None:
    state = _get_session_state(session_id)
    state["turns"].append({
        "panel": panel, "role": role, "query": query, "summary": summary,
        "prompt": prompt, "filename": filename, "intent": intent,
        "platform": platform, "is_edit": is_edit, "timestamp": time.time(),
    })
    if raw_bytes is not None:
        state["last_images"][panel] = raw_bytes
    if prompt:
        state["last_prompts"][panel] = prompt
    if intent:
        state["last_intents"][panel] = intent
    # Cap memory
    if len(state["turns"]) > 24:
        state["turns"] = state["turns"][-24:]


def _session_context(session_id: str, panel: str) -> str:
    """Return last 4 turns for this panel as short text."""
    state = SESSION_MEMORY.get(session_id)
    if not state:
        return ""
    turns = [t for t in state["turns"] if t.get("panel") == panel][-4:]
    lines: list[str] = []
    for t in turns:
        if t["role"] == "user"      and t.get("query"):   lines.append(f"User: {t['query']}")
        if t["role"] == "assistant" and t.get("summary"): lines.append(f"Assistant: {t['summary']}")
    return "\n".join(lines)


def _session_last_image(session_id: str, panel: str) -> Optional[bytes]:
    state = SESSION_MEMORY.get(session_id)
    return state["last_images"].get(panel) if state else None


# ──────────────────────────────────────────────────────────────────────────────
# SHARED IMAGE UTILITIES
# ──────────────────────────────────────────────────────────────────────────────

def _bytes_to_base64(data: bytes) -> str:
    return base64.b64encode(data).decode("utf-8")


def _safe_slug(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", (value or "").strip().lower())
    return slug.strip("_") or "screen"


def _session_output_dir(session_id: str) -> Path:
    return OUTPUT_DIR / "sessions" / _safe_slug(session_id)


def _prepare_image_part(image_source: Union[str, bytes, Path]) -> types.Part:
    if isinstance(image_source, (str, Path)):
        with open(image_source, "rb") as f:
            data = f.read()
    else:
        data = image_source
    return types.Part.from_bytes(data=data, mime_type="image/png")


async def ws_send(ws: WebSocket, event: str, data: dict) -> None:
    await ws.send_json({"event": event, **data})


def _is_retryable_generation_error(err: Exception) -> bool:
    message = str(err).lower()
    return (
        "429" in message
        or "resource_exhausted" in message
        or "quota" in message
        or "rate limit" in message
    )


def _backoff_seconds(attempt: int, err: Exception) -> int:
    # Rate-limit failures often require a longer cooldown than transient failures.
    if _is_retryable_generation_error(err):
        return min(5 * 2, 90)
    return min(3 * attempt, 20)


def _generate_content_with_retry(
    *,
    model: str,
    contents: list,
    config: Optional[types.GenerateContentConfig] = None,
    max_retries: int = 5,
    label: str = "generation",
) -> object:
    last_error: Optional[Exception] = None
    for attempt in range(1, max_retries + 1):
        try:
            kwargs = {"model": model, "contents": contents}
            if config is not None:
                kwargs["config"] = config
            return client.models.generate_content(**kwargs)
        except Exception as exc:
            last_error = exc
            print(f"[{label}] Attempt {attempt}/{max_retries} failed: {exc}")
            if attempt < max_retries:
                wait_time = _backoff_seconds(attempt, exc)
                print(f"[{label}] Retrying in {wait_time}s...")
                time.sleep(wait_time)

    raise RuntimeError(f"Failed to complete {label} after {max_retries} attempts. Last error: {last_error}")


# ──────────────────────────────────────────────────────────────────────────────
# INTENT CLASSIFICATION
# ──────────────────────────────────────────────────────────────────────────────

def _safe_json_parse(text: str) -> dict:
    text = text.strip().replace("```json", "").replace("```", "").strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return {
            "intent": "ui", "platform": "mobile", "is_edit": False,
            "screens": ["Home", "Search", "Profile", "Settings"],
            "navigation": {
                "type": "bottom_tab_bar",
                "items": [
                    {"label": "Home",    "icon": "home",    "screen": "Home"},
                    {"label": "Search",  "icon": "search",  "screen": "Search"},
                    {"label": "Profile", "icon": "person",  "screen": "Profile"},
                    {"label": "Settings","icon": "settings","screen": "Settings"},
                ],
            },
        }


def classify_intent(user_input: str, forced_platform: Optional[str] = None) -> dict:
    """
    Classify intent. If forced_platform is set (from the frontend chip),
    it is injected as a hard constraint so the model cannot override it.
    """
    platform_hint = (
        f'\n    IMPORTANT: The user explicitly selected platform="{forced_platform}". '
        f'You MUST return "platform": "{forced_platform}" — do not override this.'
        if forced_platform else ""
    )

    prompt = f"""
    Analyze this design request: "{user_input}"
    {platform_hint}

    Return ONLY a valid JSON object (no markdown, no explanation):
    {{
      "intent":   "ui" | "logo" | "illustration" | "social_media",
      "platform": "mobile" | "web" | "tablet" | "instagram" | "twitter" | "none",
      "screens":  [4-5 screen names when intent is "ui", else []],
      "navigation": {{
        "type":  "bottom_tab_bar" (mobile/tablet) | "top_navbar" (web),
        "items": [
          {{"label": "Home",   "icon": "home",   "screen": "Home"}},
          {{"label": "Search", "icon": "search", "screen": "Search"}},
          ... (4-5 items, labels must match screens list)
        ]
      }},
      "is_edit": true | false
    }}

    Rules:
    - mobile/tablet: always bottom_tab_bar
    - web: always top_navbar
    - Screen names in "screens" must exactly match navigation item "screen" values
    """
    resp = _generate_content_with_retry(
        model=TEXT_MODEL,
        contents=[prompt],
        max_retries=4,
        label="intent classification",
    )
    return _safe_json_parse(resp.text)


def classify_ui_chat_intent(user_input: str, forced_platform: Optional[str] = None) -> dict:
    """
    Conversational intent for /ws/ui.
    Decides whether to chat, start generation, regenerate anchor, approve anchor, or generate one specific screen.
    """
    platform_rule = ""
    if forced_platform and forced_platform != "auto":
        platform_rule = (
            f'IMPORTANT: User selected platform "{forced_platform}". '
            f'You MUST return "platform": "{forced_platform}".'
        )

    prompt = f"""
You are an AI UI design assistant.

User message:
"{user_input}"

{platform_rule}

Return ONLY valid JSON:
{{
  "mode": "chat" | "start_ui" | "generate_specific_screen" | "approve_anchor" | "revise_anchor",
  "reply": "short assistant reply for chat mode (or empty)",
  "platform": "mobile" | "web" | "tablet" | "none",
  "screens": ["Screen 1", "Screen 2", "Screen 3"],
  "specific_screen": "",
  "anchor_feedback": ""
}}

Rules:
- If user asks strategy/advice/discussion and not generation request -> mode=chat.
- If user asks to create/generate UI flow -> mode=start_ui.
- If user explicitly asks for one specific screen -> mode=generate_specific_screen and fill specific_screen.
- If user says approve/continue/looks good -> mode=approve_anchor.
- If user asks changes to selected design/anchor -> mode=revise_anchor and fill anchor_feedback.
- For start_ui, include 4-5 realistic screen names.
- For web/mobile app UIs, include Dashboard or Home in screens.
- Output only JSON. No markdown.
"""
    resp = _generate_content_with_retry(
        model=TEXT_MODEL,
        contents=[prompt],
        max_retries=4,
        label="ui chat intent classification",
    )
    parsed = _safe_json_parse(resp.text)
    if "mode" not in parsed:
        return {
            "mode": "chat",
            "reply": "I can help with UI strategy or generate screens. Tell me your app idea and platform.",
            "platform": forced_platform if forced_platform else "none",
            "screens": [],
            "specific_screen": "",
            "anchor_feedback": "",
        }
    return parsed


def normalize_ui_screens(query: str, platform: str, screens: list[str]) -> list[str]:
    """Deduplicate screens and enforce Dashboard/Home anchor as first screen for app-like UI flows."""
    cleaned: list[str] = []
    seen = set()
    for s in screens or []:
        name = (s or "").strip()
        if not name:
            continue
        key = name.lower()
        if key in seen:
            continue
        seen.add(key)
        cleaned.append(name)

    if not cleaned:
        cleaned = ["Dashboard", "Activity", "Profile", "Settings"]

    anchor_idx = None
    for i, s in enumerate(cleaned):
        if "dashboard" in s.lower() or "home" in s.lower():
            anchor_idx = i
            break

    if anchor_idx is None:
        cleaned.insert(0, "Dashboard")
    elif anchor_idx != 0:
        anchor = cleaned.pop(anchor_idx)
        cleaned.insert(0, anchor)

    # Keep the UI flow focused: one anchor + up to four follow-up screens.
    cleaned = cleaned[:5]

    return cleaned


# ──────────────────────────────────────────────────────────────────────────────
# CORE IMAGE GENERATION
# ──────────────────────────────────────────────────────────────────────────────

def generate_image(
    prompt: str,
    reference_image: Optional[bytes] = None,
    filename: str = "output.png",
    max_retries: int = 5,
) -> tuple[Path, bytes]:
    """Generate one image with retry/backoff, return (saved_path, raw_bytes)."""
    contents: list = []
    if reference_image:
        contents.append(_prepare_image_part(reference_image))
    contents.append(prompt)

    last_error: Optional[Exception] = None
    for attempt in range(1, max_retries + 1):
        try:
            global _LAST_GEN_CALL_TS
            with _GEN_LOCK:
                now = time.monotonic()
                elapsed = now - _LAST_GEN_CALL_TS
                if elapsed < MIN_GENERATION_INTERVAL_SECONDS:
                    wait_for_slot = MIN_GENERATION_INTERVAL_SECONDS - elapsed
                    print(
                        f"[generate_image] Throttling {wait_for_slot:.1f}s before calling model for {filename}"
                    )
                    time.sleep(wait_for_slot)

            response = client.models.generate_content(
                model=IMAGE_MODEL,
                contents=contents,
                config=types.GenerateContentConfig(response_modalities=["IMAGE"]),
            )
            _LAST_GEN_CALL_TS = time.monotonic()

            for part in response.candidates[0].content.parts:
                if part.inline_data:
                    raw = part.inline_data.data
                    save_dir = _CURRENT_OUTPUT_DIR.get()
                    save_path = save_dir / filename
                    img = Image.open(BytesIO(raw))
                    try:
                        w, h = img.size
                        print(f"[generate_image] Image size for {filename}: {w}x{h}")
                    except Exception:
                        print(f"[generate_image] Could not determine image size for {filename}")
                    save_path.parent.mkdir(parents=True, exist_ok=True)
                    img.save(save_path)
                    print(f"[generate_image] Success for {filename} on attempt {attempt}/{max_retries}")
                    return save_path, raw

            raise RuntimeError("No image returned by the model.")

        except Exception as exc:
            last_error = exc
            print(f"[generate_image] Attempt {attempt}/{max_retries} failed for {filename}: {exc}")
            if attempt < max_retries:
                wait_time = _backoff_seconds(attempt, exc)
                print(f"[generate_image] Retrying in {wait_time}s...")
                time.sleep(wait_time)

    raise RuntimeError(
        f"Failed to generate {filename} after {max_retries} attempts. Last error: {last_error}"
    )


# ──────────────────────────────────────────────────────────────────────────────
# UI PROMPT BUILDERS
# ──────────────────────────────────────────────────────────────────────────────

def build_style_guide_prompt(query: str, platform: str, navigation: dict) -> str:
    spec       = _spec(platform)
    nav_type   = navigation.get("type", spec["nav_type"])
    nav_labels = ", ".join(item.get("label", "") for item in navigation.get("items", []))

    return f"""
Create a DESIGN SYSTEM STYLE GUIDE (NOT an app screen) for a {spec['label']} application.
App concept: {query}

Show ONLY design tokens — never real app screens, phones, or browser frames.

SECTION 1 — Color Palette
  Swatches with hex codes: primary, secondary, accent, background, surface, error, light/dark variants.

SECTION 2 — Typography
  Font family, sizes (H1, H2, H3, Body, Caption), weights (Regular, Medium, SemiBold, Bold).
  Base body size: {spec['font_scale']}.

SECTION 3 — Components
  Primary button, secondary button (outlined), disabled button.
  Input field (empty, focused, error states). Card with shadow + border-radius. Badge/chip.

SECTION 4 — {nav_type.replace('_', ' ').title()}
  Full navigation component for items: {nav_labels}.
  Show active state vs inactive state clearly with icons and labels.

SECTION 5 — Spacing & Radius Scale
  Spacing: 4, 8, 12, 16, 24, 32 px. Border-radius values: small, medium, large, pill.

FORMAT: clean white background, labeled sections, Figma-style component page, no device frames.
"""


def build_screen_prompt(
    query: str,
    platform: str,
    screen_name: str,
    navigation: dict,
    active_nav_label: str,
) -> str:

    spec = _spec(platform)

    nav_type = navigation.get("type", spec["nav_type"])
    nav_items = navigation.get("items", [])

    nav_str = " | ".join(
        f"[{item['label']}]" if item.get("label") == active_nav_label else item["label"]
        for item in nav_items
    )

    return f"""
Generate EXACTLY ONE high-fidelity {spec['label']} UI screen.

The output must look like a REAL screenshot captured directly from a production-ready application.

DO NOT add any spec overlays, measurement callouts, rulers, annotation labels, or layout guides.
The image must not contain text like 44px, 34px, A/B/C markers, spacing notes, wireframe hints, or design-system markup.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
OUTPUT FORMAT (STRICT)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Generate EXACTLY ONE screen only.

The image must contain:
- one application screen
- one viewport
- one navigation system
- one continuous UI state

DO NOT generate:
- multiple screens
- overlapping layouts
- Figma boards
- Dribbble showcases
- Behance presentations
- UI galleries
- side-by-side screens
- floating previews
- duplicate pages
- cropped secondary screens
- perspective mockups
- product showcases
- design presentation layouts

The output must look like:
- a real app screenshot
- a real website screenshot
- a real deployed product UI

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PLATFORM RULES (STRICT)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Platform         : {platform}
Viewport         : {spec['viewport']}
Aspect Ratio     : {spec['aspect_ratio']}
Safe Areas       : {spec['safe_areas']}
Touch Targets    : {spec['touch_target']}
Typography Scale : {spec['font_scale']}
Layout Rule      : {spec['layout_note']}

FORBIDDEN:
{spec['forbidden']}

IMPORTANT:
- Maintain strict platform consistency.
- If platform is mobile → generate ONLY mobile UI.
- If platform is web → generate ONLY desktop web UI.
- Never mix desktop and mobile layouts.
- Never mix Android and iOS patterns.
- Never generate tablet layouts unless explicitly requested.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
APPLICATION CONTEXT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Application:
{query}

Current Screen:
{screen_name}

This screen must feel like part of a real coherent application ecosystem.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
NAVIGATION SYSTEM
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Navigation Type:
{nav_type}

Navigation Items:
{nav_str}

Rules:
- Items inside [ ] are ACTIVE.
- Highlight ONLY the active navigation item.
- Keep navigation visually identical across screens.
- Use the exact same labels, order, spacing, icon style, active state, and sizing.
- Do NOT invent new nav items.
- Do NOT remove nav items.
- Do NOT rename nav items.

{"Place the tab bar FIXED at the BOTTOM of the viewport." if nav_type == "bottom_tab_bar" else "Place the navigation bar FIXED at the TOP of the viewport."}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
MOBILE SCREEN RULES (STRICT)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ONLY apply if platform is mobile:

Generate a REALISTIC iPhone 15 Pro mobile application screenshot.

The mobile UI must:
- look like a real native iOS app
- use proper mobile spacing
- use proper touch-friendly sizing
- use realistic mobile typography hierarchy
- use realistic mobile proportions
- support natural vertical scrolling if needed
- feel immersive and premium
- fill the screen naturally edge-to-edge

The result should feel like:
- a real App Store-quality product
- a real mobile screenshot captured from the app
- a polished fintech/social/productivity application

CRITICAL:
- Render ONLY ONE realistic mobile screen viewport.
- The UI must appear inside a natural iPhone-style screen area.
- Use realistic iOS safe-area spacing.
- Preserve authentic mobile proportions.

DO NOT:
- create floating showcase cards
- create presentation backgrounds
- create borderless web-style canvases
- create desktop layouts
- create floating phone mockups
- create multiple app states
- create Android UI
- create website-style layouts
- create SaaS landing page structures
- create feature-grid marketing pages

For onboarding/welcome screens:
- use concise text
- use premium spacing
- use strong visual hierarchy
- use immersive modern composition
- use realistic CTA buttons

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
WEB SCREEN RULES (STRICT)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ONLY apply if platform is web:

Generate ONE realistic desktop web application screenshot.

The web UI must:
- look like a real browser screenshot
- use realistic desktop proportions
- use realistic web spacing density
- feel like a deployed SaaS/web product
- fill the browser viewport naturally
- use modern enterprise-level layout quality

CRITICAL:
- Render ONLY ONE desktop web viewport.
- Render the layout FLAT and STRAIGHT-ON.
- The website must fill the image naturally edge-to-edge.
- The UI should feel like a real deployed website.

The result should feel comparable to:
- Stripe
- Linear
- Notion
- Framer
- Vercel
- modern SaaS applications

For landing pages:
Create:
- a clean modern navbar
- a strong hero section
- concise headline
- supporting text
- realistic CTA buttons
- feature highlights
- trust/social proof
- clean modern section composition

For dashboard/internal pages:
Create:
- realistic analytics panels
- charts
- widgets
- tables
- filters
- premium dashboard layouts
- modern enterprise UI composition

DO NOT:
- create floating website cards
- create perspective browser mockups
- create overlapping screens
- create presentation boards
- create mobile layouts
- create multiple browser windows
- create inset dashboard previews
- create floating mini-app previews
- create UI showcase compositions
- create Figma-style presentations

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STYLE SYSTEM
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Use the reference image ONLY as a STYLE reference.

Copy ONLY:
- color palette
- typography
- spacing rhythm
- border radius
- shadows
- icon style
- button aesthetics
- visual density
- overall design language

DO NOT COPY:
- layouts
- charts
- widgets
- sections
- cards
- composition
- screen hierarchy
- content structure

The generated screen must have its OWN realistic layout appropriate for "{screen_name}".

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CONTENT RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Generate realistic UI content relevant to:
- the application concept
- the current screen
- the active navigation state

Use:
- believable placeholder data
- realistic charts
- meaningful labels
- premium UI hierarchy
- realistic cards
- production-quality layouts

The screen should feel:
- complete
- functional
- premium
- modern
- realistic
- visually balanced

Avoid:
- empty sections
- duplicated cards
- repeated widgets
- unfinished layouts
- wireframe placeholders
- giant whitespace gaps

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
VISUAL QUALITY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

The UI must be:
- modern
- premium
- polished
- realistic
- highly detailed
- production-ready
- pixel-perfect
- visually balanced

Use:
- modern spacing
- subtle gradients
- realistic shadows
- premium typography
- balanced composition
- strong visual hierarchy
- clean alignment

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STRICTLY FORBIDDEN
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

- Multiple screens
- Multiple phones
- Multiple browser windows
- Figma boards
- Dribbble showcases
- Behance presentations
- UI galleries
- Floating previews
- Perspective mockups
- Product showcase layouts
- Floating mini dashboards
- Browser mockups
- Device mockups
- Android + iOS mixing
- Content leakage from other screens
- Duplicate layouts
- Repeated widgets
- Empty compositions
- Presentation-style rendering
- Measurement labels or spec annotations
- Rulers, guides, or grid callouts
- Alphabetic section markers like A, B, C

Generate EXACTLY ONE complete realistic application screen.
"""


def get_active_nav_label(screen_name: str, navigation: dict) -> str:
    for item in navigation.get("items", []):
        if item.get("screen", "").lower() == screen_name.lower():
            return item.get("label", "")
    items = navigation.get("items", [])
    return items[0].get("label", "") if items else ""


def generate_style_guide(
    query: str,
    platform: str,
    navigation: dict,
    reference_bytes: Optional[bytes] = None,
    filename: str = "ui_style_guide.png",
) -> tuple[Path, bytes]:
    prompt = build_style_guide_prompt(query, platform, navigation)
    return generate_image(prompt, reference_image=reference_bytes, filename=filename)


# ──────────────────────────────────────────────────────────────────────────────
# ANCHOR RESOLUTION
# Priority: user_upload > previous_image_b64 payload > session last image
# ──────────────────────────────────────────────────────────────────────────────

def resolve_anchor(
    ref_b64:    Optional[str],
    prev_b64:   Optional[str],
    session_id: str,
    panel:      str,
) -> Optional[bytes]:
    chosen = ref_b64 or prev_b64
    if chosen:
        return base64.b64decode(chosen)
    return _session_last_image(session_id, panel)


@app.websocket("/ws/ui")
async def ws_ui(websocket: WebSocket):
    """Keep the UI websocket alive for the lifetime of the session."""
    await websocket.accept()
    current_session_id: Optional[str] = None
    output_token = _CURRENT_OUTPUT_DIR.set(OUTPUT_DIR)
    try:
        while True:
            raw = await websocket.receive_json()
            new_session_id = _normalize_session_id(raw.get("session_id") or raw.get("sessionId"))
            if new_session_id != current_session_id:
                current_session_id = new_session_id
                _CURRENT_OUTPUT_DIR.reset(output_token)
                output_token = _CURRENT_OUTPUT_DIR.set(_session_output_dir(current_session_id))
            await _process_ui_message(websocket, raw)
    except WebSocketDisconnect:
        pass
    finally:
        _CURRENT_OUTPUT_DIR.reset(output_token)


# ──────────────────────────────────────────────────────────────────────────────
# 1.  UI DESIGN  /ws/ui
# ──────────────────────────────────────────────────────────────────────────────

async def _process_ui_message(websocket: WebSocket, raw: dict):
    """
    Conversational UI flow:
    1) Chat mode (UI strategy advice)
    2) Anchor selection mode (generate first anchor screen, ask for approval)
    3) On approve -> generate remaining screens using anchor as reference
    4) On revise -> regenerate anchor using user feedback
    5) On explicit specific-screen ask -> generate only that screen
    """
    session_id      = _normalize_session_id(raw.get("session_id") or raw.get("sessionId"))
    query           = raw.get("query", "").strip()
    forced_platform = raw.get("platform")
    screens_override= raw.get("screens")
    ref_b64         = raw.get("reference_image_b64")
    ui_action       = (raw.get("ui_action") or "").strip().lower()
    anchor_feedback = (raw.get("anchor_feedback") or "").strip()

    try:

        state = _get_session_state(session_id)
        ui_flow = state.setdefault("ui_flow", {}).get("ui", {})
        user_ref_bytes: Optional[bytes] = base64.b64decode(ref_b64) if ref_b64 else None

        # Explicit action path from frontend controls
        if ui_action in {"approve_anchor", "revise_anchor", "generate_specific_screen"}:
            if not ui_flow:
                await ws_send(websocket, "error", {
                    "message": "No pending UI anchor found. Start a new UI generation first."
                })
                return

            flow_query    = ui_flow.get("query", "")
            flow_platform = ui_flow.get("platform", "mobile")
            flow_screens  = ui_flow.get("screens", [])
            flow_nav      = ui_flow.get("navigation", {})
            anchor_bytes  = base64.b64decode(ui_flow.get("anchor_bytes_b64", "")) if ui_flow.get("anchor_bytes_b64") else None
            anchor_screen = ui_flow.get("anchor_screen", flow_screens[0] if flow_screens else "Dashboard")

            if ui_action == "revise_anchor":
                if not anchor_feedback and not query:
                    await ws_send(websocket, "error", {
                        "message": "Please provide what to change in the selected design."
                    })
                    return

                feedback = anchor_feedback or query
                await ws_send(websocket, "status", {"message": "Regenerating anchor with your feedback…"})
                active_nav = get_active_nav_label(anchor_screen, flow_nav)
                prompt = (
                    build_screen_prompt(flow_query, flow_platform, anchor_screen, flow_nav, active_nav)
                    + f"\n\nUSER REVISION REQUEST:\n{feedback}\n"
                    + "Apply these changes while preserving overall design quality and viewport completeness."
                )
                filename = f"ui_0_{_safe_slug(anchor_screen)}_revised.png"

                try:
                    _, new_anchor = await asyncio.to_thread(generate_image, prompt, anchor_bytes, filename)
                except Exception as exc:
                    await ws_send(websocket, "error", {"message": str(exc)})
                    return

                ui_flow["anchor_bytes_b64"] = _bytes_to_base64(new_anchor)
                ui_flow["approved"] = False
                state["ui_flow"]["ui"] = ui_flow

                await ws_send(websocket, "anchor_preview", {
                    "image_b64": _bytes_to_base64(new_anchor),
                    "filename": filename,
                    "screen": anchor_screen,
                    "platform": flow_platform,
                })
                await ws_send(websocket, "assistant_message", {
                    "message": "I regenerated the anchor. Approve it to continue, or ask for more changes."
                })
                await ws_send(websocket, "done", {})
                return

            if ui_action == "approve_anchor":
                if not anchor_bytes:
                    await ws_send(websocket, "error", {
                        "message": "Anchor image missing. Regenerate anchor first."
                    })
                    return

                ui_flow["approved"] = True
                state["ui_flow"]["ui"] = ui_flow

                remaining = flow_screens[1:] if len(flow_screens) > 1 else []
                if not remaining:
                    await ws_send(websocket, "assistant_message", {
                        "message": "Anchor approved. No remaining screens in the plan."
                    })
                    await ws_send(websocket, "done", {})
                    return

                for i, screen in enumerate(remaining, start=1):
                    await ws_send(websocket, "status", {
                        "message": f"Generating screen {i+1}/{len(flow_screens)}: {screen} [{flow_platform}]"
                    })
                    active_nav = get_active_nav_label(screen, flow_nav)
                    prompt     = build_screen_prompt(flow_query, flow_platform, screen, flow_nav, active_nav)
                    filename   = f"ui_{i}_{_safe_slug(screen)}.png"
                    try:
                        _, raw_bytes = await asyncio.to_thread(generate_image, prompt, anchor_bytes, filename)
                    except Exception as exc:
                        # Don't abort the whole flow on a single-screen failure; skip and continue.
                        _log = f"Failed to generate {filename}: {exc}"
                        print(f"[ws_ui] {_log}")
                        await ws_send(websocket, "status", {"message": f"Failed to generate {screen}: {str(exc)} — skipping."})
                        await ws_send(websocket, "assistant_message", {"message": f"Could not generate {screen}; skipping to next screen."})
                        # wait a short backoff before trying the next screen to avoid immediate throttling
                        await asyncio.sleep(2)
                        continue

                    _remember_turn(session_id, "ui", "assistant",
                                   summary=f"Generated {screen}", prompt=prompt,
                                   raw_bytes=raw_bytes, filename=filename, intent="ui", platform=flow_platform)

                    await ws_send(websocket, "screen", {
                        "index":     i,
                        "name":      screen,
                        "platform":  flow_platform,
                        "image_b64": _bytes_to_base64(raw_bytes),
                        "filename":  filename,
                    })
                    if i < len(flow_screens) - 1:
                        await asyncio.sleep(8)

                await ws_send(websocket, "done", {})
                return

            # ui_action == generate_specific_screen
            specific = (query or raw.get("specific_screen") or "").strip()
            if not specific:
                await ws_send(websocket, "error", {
                    "message": "Please specify which screen to generate."
                })
                return

            await ws_send(websocket, "status", {
                "message": f"Generating specific screen: {specific} [{flow_platform}]"
            })
            active_nav = get_active_nav_label(specific, flow_nav)
            prompt = build_screen_prompt(flow_query, flow_platform, specific, flow_nav, active_nav)
            filename = f"ui_specific_{_safe_slug(specific)}.png"

            try:
                _, raw_bytes = await asyncio.to_thread(generate_image, prompt, anchor_bytes, filename)
            except Exception as exc:
                await ws_send(websocket, "error", {"message": str(exc)})
                return

            _remember_turn(session_id, "ui", "assistant",
                           summary=f"Generated specific screen {specific}", prompt=prompt,
                           raw_bytes=raw_bytes, filename=filename, intent="ui", platform=flow_platform)
            await ws_send(websocket, "screen", {
                "index":     0,
                "name":      specific,
                "platform":  flow_platform,
                "image_b64": _bytes_to_base64(raw_bytes),
                "filename":  filename,
            })
            await ws_send(websocket, "done", {})
            return

        # Natural-language path: classify chat intent first
        await ws_send(websocket, "status", {"message": "Understanding your request…"})
        chat_meta = await asyncio.to_thread(classify_ui_chat_intent, query, forced_platform)
        mode = chat_meta.get("mode", "chat")

        if mode == "chat":
            reply = chat_meta.get("reply") or "Happy to help with UI strategy. Ask me to generate when you are ready."
            await ws_send(websocket, "assistant_message", {"message": reply})
            await ws_send(websocket, "done", {})
            return

        if mode == "approve_anchor":
            await ws_send(websocket, "assistant_message", {
                "message": "Use the anchor approval button to continue generation."
            })
            await ws_send(websocket, "done", {})
            return

        if mode == "revise_anchor":
            if not ui_flow:
                await ws_send(websocket, "error", {
                    "message": "No anchor exists yet. Start generation first."
                })
                return
            raw["ui_action"] = "revise_anchor"
            raw["anchor_feedback"] = chat_meta.get("anchor_feedback", query)
            await ws_send(websocket, "assistant_message", {
                "message": "Use the anchor revise control. I have captured your feedback intent."
            })
            await ws_send(websocket, "done", {})
            return

        # mode start_ui or generate_specific_screen without explicit ui_action
        if mode == "generate_specific_screen" and ui_flow:
            specific = chat_meta.get("specific_screen", "").strip()
            if specific:
                flow_query    = ui_flow.get("query", "")
                flow_platform = ui_flow.get("platform", "mobile")
                flow_nav      = ui_flow.get("navigation", {})
                anchor_bytes  = base64.b64decode(ui_flow.get("anchor_bytes_b64", "")) if ui_flow.get("anchor_bytes_b64") else None

                await ws_send(websocket, "status", {
                    "message": f"Generating specific screen: {specific} [{flow_platform}]"
                })
                active_nav = get_active_nav_label(specific, flow_nav)
                prompt = build_screen_prompt(flow_query, flow_platform, specific, flow_nav, active_nav)
                filename = f"ui_specific_{_safe_slug(specific)}.png"

                try:
                    _, raw_bytes = await asyncio.to_thread(generate_image, prompt, anchor_bytes, filename)
                except Exception as exc:
                    await ws_send(websocket, "error", {"message": str(exc)})
                    return

                await ws_send(websocket, "screen", {
                    "index":     0,
                    "name":      specific,
                    "platform":  flow_platform,
                    "image_b64": _bytes_to_base64(raw_bytes),
                    "filename":  filename,
                })
                await ws_send(websocket, "done", {})
                return

        # Fresh UI generation path (anchor first)
        await ws_send(websocket, "status", {"message": "Classifying UI structure…"})
        meta = await asyncio.to_thread(classify_intent, query, None if forced_platform == "auto" else forced_platform)

        platform = (
            forced_platform
            if forced_platform and forced_platform != "auto"
            else chat_meta.get("platform")
            if chat_meta.get("platform") in {"mobile", "web", "tablet"}
            else meta.get("platform", "mobile")
        )
        screens = screens_override or chat_meta.get("screens") or meta.get("screens", [])
        screens = normalize_ui_screens(query, platform, screens)

        navigation = meta.get("navigation") or {
            "type":  _spec(platform)["nav_type"],
            "items": [
                {"label": "Dashboard", "icon": "dashboard", "screen": "Dashboard"},
                {"label": "Activity",  "icon": "monitoring", "screen": "Activity"},
                {"label": "Profile",   "icon": "person", "screen": "Profile"},
                {"label": "Settings",  "icon": "settings", "screen": "Settings"},
            ],
        }

        _remember_turn(session_id, "ui", "user", query=query, intent="ui", platform=platform)

        await ws_send(websocket, "status", {
            "message": f"Generating {platform} design system style guide…"
        })
        try:
            _, style_bytes = await asyncio.to_thread(
                generate_style_guide, query, platform, navigation,
                user_ref_bytes, "ui_style_guide.png"
            )
        except Exception as exc:
            await ws_send(websocket, "error", {"message": f"Style guide failed: {exc}"})
            return

        await ws_send(websocket, "style_guide", {
            "image_b64": _bytes_to_base64(style_bytes),
            "filename":  "ui_style_guide.png",
            "platform":  platform,
        })

        anchor_screen = screens[0]
        await ws_send(websocket, "status", {
            "message": f"Generating anchor screen: {anchor_screen} [{platform}]"
        })
        active_nav = get_active_nav_label(anchor_screen, navigation)
        anchor_prompt = build_screen_prompt(query, platform, anchor_screen, navigation, active_nav)
        anchor_filename = f"ui_0_{_safe_slug(anchor_screen)}.png"

        try:
            _, anchor_bytes = await asyncio.to_thread(
                generate_image, anchor_prompt, style_bytes, anchor_filename
            )
        except Exception as exc:
            await ws_send(websocket, "error", {"message": str(exc)})
            return

        state["ui_flow"]["ui"] = {
            "query": query,
            "platform": platform,
            "screens": screens,
            "navigation": navigation,
            "style_bytes_b64": _bytes_to_base64(style_bytes),
            "anchor_bytes_b64": _bytes_to_base64(anchor_bytes),
            "anchor_screen": anchor_screen,
            "approved": False,
        }

        _remember_turn(session_id, "ui", "assistant",
                       summary=f"Generated anchor {anchor_screen}", prompt=anchor_prompt,
                       raw_bytes=anchor_bytes, filename=anchor_filename, intent="ui", platform=platform)

        await ws_send(websocket, "anchor_preview", {
            "image_b64": _bytes_to_base64(anchor_bytes),
            "filename":  anchor_filename,
            "screen":    anchor_screen,
            "platform":  platform,
            "remaining_screens": screens[1:],
        })
        await ws_send(websocket, "assistant_message", {
            "message": "This anchor design is selected as style reference. Approve to generate remaining screens, or request changes."
        })
        await ws_send(websocket, "done", {})

    except WebSocketDisconnect:
        pass
    except Exception as exc:
        await ws_send(websocket, "error", {"message": str(exc)})


# ──────────────────────────────────────────────────────────────────────────────
# 2.  LOGO  /ws/logo
# ──────────────────────────────────────────────────────────────────────────────

@app.websocket("/ws/logo")
async def ws_logo(websocket: WebSocket):
    await websocket.accept()
    try:
        raw        = await websocket.receive_json()
        session_id = _normalize_session_id(raw.get("session_id") or raw.get("sessionId"))
        _CURRENT_OUTPUT_DIR.set(_session_output_dir(session_id))
        query      = raw.get("query", "")
        ref_b64    = raw.get("reference_image_b64")
        prev_b64   = raw.get("previous_image_b64")

        anchor_bytes = resolve_anchor(ref_b64, prev_b64, session_id, "logo")
        ctx          = _session_context(session_id, "logo")

        await ws_send(websocket, "status", {"message": "Classifying intent…"})
        meta    = await asyncio.to_thread(classify_intent, query)
        is_edit = meta.get("is_edit", False) and anchor_bytes is not None

        _remember_turn(session_id, "logo", "user",
                       query=query, intent="logo", is_edit=is_edit)

        if is_edit and anchor_bytes:
            prompt   = (f"Modify this logo image based on: {query}. "
                        "Keep all other styles, fonts, and layouts identical.")
            filename = "logo_updated.png"
        elif anchor_bytes:
            prompt   = (f"Using this image as a strict style and consistency reference, "
                        f"generate a logo for: {query}. "
                        "Maintain same design language, color palette, and typography. "
                        "High-fidelity, clean vector-style, transparent or clean background.")
            filename = "logo_design.png"
        else:
            prompt   = (f"Professional logo design: {query}. "
                        "High-fidelity, clean vector-style, transparent or clean background.")
            filename = "logo_design.png"

        if ctx:
            prompt = f"[Session history]\n{ctx}\n\n{prompt}"

        await ws_send(websocket, "status", {"message": "Generating logo…"})
        try:
            _, raw_bytes = await asyncio.to_thread(generate_image, prompt, anchor_bytes, filename)
        except Exception as exc:
            await ws_send(websocket, "error", {"message": str(exc)})
            return

        _remember_turn(session_id, "logo", "assistant",
                       summary="Generated logo", prompt=prompt,
                       raw_bytes=raw_bytes, filename=filename, intent="logo", is_edit=is_edit)

        await ws_send(websocket, "logo", {
            "image_b64": _bytes_to_base64(raw_bytes),
            "filename":  filename,
            "is_edit":   is_edit,
        })
        await ws_send(websocket, "done", {})

    except WebSocketDisconnect:
        pass
    except Exception as exc:
        await ws_send(websocket, "error", {"message": str(exc)})


# ──────────────────────────────────────────────────────────────────────────────
# 3.  ILLUSTRATION  /ws/illustration
# ──────────────────────────────────────────────────────────────────────────────

@app.websocket("/ws/illustration")
async def ws_illustration(websocket: WebSocket):
    await websocket.accept()
    try:
        raw        = await websocket.receive_json()
        session_id = _normalize_session_id(raw.get("session_id") or raw.get("sessionId"))
        _CURRENT_OUTPUT_DIR.set(_session_output_dir(session_id))
        query      = raw.get("query", "")
        ref_b64    = raw.get("reference_image_b64")
        prev_b64   = raw.get("previous_image_b64")

        anchor_bytes = resolve_anchor(ref_b64, prev_b64, session_id, "illustration")
        ctx          = _session_context(session_id, "illustration")

        meta    = await asyncio.to_thread(classify_intent, query)
        is_edit = meta.get("is_edit", False) and anchor_bytes is not None

        _remember_turn(session_id, "illustration", "user",
                       query=query, intent="illustration", is_edit=is_edit)

        if is_edit and anchor_bytes:
            prompt   = (f"Modify this illustration based on: {query}. "
                        "Keep all other styles, colors, and composition identical.")
            filename = "illustration_updated.png"
        elif anchor_bytes:
            prompt   = (f"Using this image as a style reference, create a new illustration: {query}. "
                        "Maintain same artistic style, color palette, and visual language.")
            filename = "illustration_design.png"
        else:
            prompt   = f"Professional illustration: {query}."
            filename = "illustration_design.png"

        if ctx:
            prompt = f"[Session history]\n{ctx}\n\n{prompt}"

        await ws_send(websocket, "status", {"message": "Generating illustration…"})
        try:
            _, raw_bytes = await asyncio.to_thread(generate_image, prompt, anchor_bytes, filename)
        except Exception as exc:
            await ws_send(websocket, "error", {"message": str(exc)})
            return

        _remember_turn(session_id, "illustration", "assistant",
                       summary="Generated illustration", prompt=prompt,
                       raw_bytes=raw_bytes, filename=filename, intent="illustration", is_edit=is_edit)

        await ws_send(websocket, "illustration", {
            "image_b64": _bytes_to_base64(raw_bytes),
            "filename":  filename,
            "is_edit":   is_edit,
        })
        await ws_send(websocket, "done", {})

    except WebSocketDisconnect:
        pass
    except Exception as exc:
        await ws_send(websocket, "error", {"message": str(exc)})


# ──────────────────────────────────────────────────────────────────────────────
# 4.  SOCIAL MEDIA  /ws/social_media
# ──────────────────────────────────────────────────────────────────────────────

@app.websocket("/ws/social_media")
async def ws_social_media(websocket: WebSocket):
    await websocket.accept()
    try:
        raw        = await websocket.receive_json()
        session_id = _normalize_session_id(raw.get("session_id") or raw.get("sessionId"))
        _CURRENT_OUTPUT_DIR.set(_session_output_dir(session_id))
        query      = raw.get("query", "")
        forced_plt = raw.get("platform")
        ref_b64    = raw.get("reference_image_b64")
        prev_b64   = raw.get("previous_image_b64")

        anchor_bytes = resolve_anchor(ref_b64, prev_b64, session_id, "social_media")
        ctx          = _session_context(session_id, "social_media")

        meta     = await asyncio.to_thread(classify_intent, query, forced_plt)
        platform = forced_plt or meta.get("platform", "instagram")
        is_edit  = meta.get("is_edit", False) and anchor_bytes is not None

        _remember_turn(session_id, "social_media", "user",
                       query=query, intent="social_media", platform=platform, is_edit=is_edit)

        if is_edit and anchor_bytes:
            prompt   = (f"Modify this social media image based on: {query}. "
                        "Keep all other styles, fonts, and layouts identical.")
            filename = "social_media_updated.png"
        elif anchor_bytes:
            prompt   = (f"Using this image as a brand consistency reference, create a {platform} post: {query}. "
                        "Maintain same visual identity, color palette, and design language.")
            filename = "social_media_design.png"
        else:
            prompt   = f"Professional {platform} social media post: {query}."
            filename = "social_media_design.png"

        if ctx:
            prompt = f"[Session history]\n{ctx}\n\n{prompt}"

        await ws_send(websocket, "status", {"message": f"Generating {platform} asset…"})
        try:
            _, raw_bytes = await asyncio.to_thread(generate_image, prompt, anchor_bytes, filename)
        except Exception as exc:
            await ws_send(websocket, "error", {"message": str(exc)})
            return

        _remember_turn(session_id, "social_media", "assistant",
                       summary=f"Generated {platform} asset", prompt=prompt,
                       raw_bytes=raw_bytes, filename=filename,
                       intent="social_media", platform=platform, is_edit=is_edit)

        await ws_send(websocket, "social_media", {
            "image_b64": _bytes_to_base64(raw_bytes),
            "filename":  filename,
            "platform":  platform,
            "is_edit":   is_edit,
        })
        await ws_send(websocket, "done", {})

    except WebSocketDisconnect:
        pass
    except Exception as exc:
        await ws_send(websocket, "error", {"message": str(exc)})


# ──────────────────────────────────────────────────────────────────────────────
# 5.  PRACTICE  /ws/practice
# ──────────────────────────────────────────────────────────────────────────────

@app.websocket("/ws/practice")
async def ws_practice(websocket: WebSocket):
    """
    Unified practice socket. Auto-detects intent and routes accordingly.
    BUG FIXED: session_context / ctx now defined before use in every branch.
    BUG FIXED: UI branch uses style-guide pipeline matching /ws/ui.
    """
    await websocket.accept()
    try:
        raw        = await websocket.receive_json()
        session_id = _normalize_session_id(raw.get("session_id") or raw.get("sessionId"))
        _CURRENT_OUTPUT_DIR.set(_session_output_dir(session_id))
        query      = raw.get("query", "")
        ref_b64    = raw.get("reference_image_b64")
        prev_b64   = raw.get("previous_image_b64")

        user_ref_bytes: Optional[bytes] = base64.b64decode(ref_b64) if ref_b64 else None

        await ws_send(websocket, "status", {"message": "Classifying intent…"})
        meta     = await asyncio.to_thread(classify_intent, query)
        intent   = meta.get("intent", "illustration")
        platform = meta.get("platform", "mobile" if intent == "ui" else "none")
        screens  = meta.get("screens", [])
        is_edit  = meta.get("is_edit", False) and user_ref_bytes is not None

        _remember_turn(session_id, "practice", "user",
                       query=query, intent=intent, platform=platform, is_edit=is_edit)

        await ws_send(websocket, "intent", {
            "intent": intent, "platform": platform,
            "screens": screens, "is_edit": is_edit,
        })

        # ── UI ───────────────────────────────────────────────────────────────
        if intent == "ui":
            navigation = meta.get("navigation") or {
                "type":  _spec(platform)["nav_type"],
                "items": [
                    {"label": "Home",    "icon": "home",    "screen": "Home"},
                    {"label": "Search",  "icon": "search",  "screen": "Search"},
                    {"label": "Profile", "icon": "person",  "screen": "Profile"},
                    {"label": "Settings","icon": "settings","screen": "Settings"},
                ],
            }

            await ws_send(websocket, "status", {"message": f"Generating {platform} style guide…"})
            try:
                _, style_bytes = await asyncio.to_thread(
                    generate_style_guide, query, platform, navigation,
                    user_ref_bytes, "practice_ui_style_guide.png"
                )
            except Exception as exc:
                await ws_send(websocket, "error", {"message": f"Style guide failed: {exc}"})
                return

            await ws_send(websocket, "style_guide", {
                "image_b64": _bytes_to_base64(style_bytes),
                "filename":  "practice_ui_style_guide.png",
                "platform":  platform,
            })
            _remember_turn(session_id, "practice", "assistant",
                           summary="Style guide", raw_bytes=style_bytes,
                           intent="ui", platform=platform)
            await asyncio.sleep(5)

            for i, screen in enumerate(screens):
                await ws_send(websocket, "status", {
                    "message": f"Generating screen {i+1}/{len(screens)}: {screen} [{platform}]"
                })
                active_nav = get_active_nav_label(screen, navigation)
                prompt     = build_screen_prompt(query, platform, screen, navigation, active_nav)
                filename   = f"practice_ui_{i}_{_safe_slug(screen)}.png"

                try:
                    _, raw_bytes = await asyncio.to_thread(
                        generate_image, prompt, style_bytes, filename
                    )
                except Exception as exc:
                    await ws_send(websocket, "error", {"message": str(exc)})
                    return

                _remember_turn(session_id, "practice", "assistant",
                               summary=f"Generated {screen}", prompt=prompt,
                               raw_bytes=raw_bytes, filename=filename, intent="ui", platform=platform)

                await ws_send(websocket, "screen", {
                    "index":     i,
                    "name":      screen,
                    "platform":  platform,
                    "image_b64": _bytes_to_base64(raw_bytes),
                    "filename":  filename,
                })
                if i < len(screens) - 1:
                    await asyncio.sleep(10)

        # ── LOGO ─────────────────────────────────────────────────────────────
        elif intent == "logo":
            anchor_bytes = resolve_anchor(ref_b64, prev_b64, session_id, "practice")
            ctx          = _session_context(session_id, "practice")  # defined before use

            if is_edit and anchor_bytes:
                prompt   = (f"Modify this logo image based on: {query}. "
                            "Keep all other styles, fonts, and layouts identical.")
                filename = "practice_logo_updated.png"
            elif anchor_bytes:
                prompt   = (f"Using this image as a style reference, generate a logo for: {query}. "
                            "Maintain same design language, color palette, and typography. "
                            "High-fidelity, clean vector-style, transparent or clean background.")
                filename = "practice_logo_design.png"
            else:
                prompt   = (f"Professional logo design: {query}. "
                            "High-fidelity, clean vector-style, transparent or clean background.")
                anchor_bytes = None
                filename = "practice_logo_design.png"

            if ctx:
                prompt = f"[Session history]\n{ctx}\n\n{prompt}"

            await ws_send(websocket, "status", {"message": "Generating logo…"})
            try:
                _, raw_bytes = await asyncio.to_thread(generate_image, prompt, anchor_bytes, filename)
            except Exception as exc:
                await ws_send(websocket, "error", {"message": str(exc)})
                return

            _remember_turn(session_id, "practice", "assistant",
                           summary="Generated logo", prompt=prompt,
                           raw_bytes=raw_bytes, filename=filename, intent="logo", is_edit=is_edit)

            await ws_send(websocket, "logo", {
                "image_b64": _bytes_to_base64(raw_bytes),
                "filename":  filename,
                "is_edit":   is_edit,
            })

        # ── SOCIAL MEDIA ─────────────────────────────────────────────────────
        elif intent == "social_media":
            anchor_bytes = resolve_anchor(ref_b64, prev_b64, session_id, "practice")
            ctx          = _session_context(session_id, "practice")  # defined before use

            if is_edit and anchor_bytes:
                prompt   = (f"Modify this social media image based on: {query}. "
                            "Keep all other styles, fonts, and layouts identical.")
                filename = "practice_social_updated.png"
            elif anchor_bytes:
                prompt   = (f"Using this image as a brand consistency reference, create a {platform} post: {query}. "
                            "Maintain same visual identity, color palette, and design language.")
                filename = "practice_social_design.png"
            else:
                prompt   = f"Professional {platform} social media post: {query}."
                anchor_bytes = None
                filename = "practice_social_design.png"

            if ctx:
                prompt = f"[Session history]\n{ctx}\n\n{prompt}"

            await ws_send(websocket, "status", {"message": f"Generating {platform} asset…"})
            try:
                _, raw_bytes = await asyncio.to_thread(generate_image, prompt, anchor_bytes, filename)
            except Exception as exc:
                await ws_send(websocket, "error", {"message": str(exc)})
                return

            _remember_turn(session_id, "practice", "assistant",
                           summary=f"Generated {platform} asset", prompt=prompt,
                           raw_bytes=raw_bytes, filename=filename,
                           intent="social_media", platform=platform, is_edit=is_edit)

            await ws_send(websocket, "social_media", {
                "image_b64": _bytes_to_base64(raw_bytes),
                "filename":  filename,
                "platform":  platform,
                "is_edit":   is_edit,
            })

        # ── ILLUSTRATION (default) ────────────────────────────────────────────
        else:
            anchor_bytes = resolve_anchor(ref_b64, prev_b64, session_id, "practice")
            ctx          = _session_context(session_id, "practice")  # defined before use

            if is_edit and anchor_bytes:
                prompt   = (f"Modify this illustration based on: {query}. "
                            "Keep all other styles, colors, and composition identical.")
                filename = "practice_illustration_updated.png"
            elif anchor_bytes:
                prompt   = (f"Using this image as a style reference, create a new illustration: {query}. "
                            "Maintain same artistic style, color palette, and visual language.")
                filename = "practice_illustration_design.png"
            else:
                prompt   = f"Professional illustration: {query}."
                anchor_bytes = None
                filename = "practice_illustration_design.png"

            if ctx:
                prompt = f"[Session history]\n{ctx}\n\n{prompt}"

            await ws_send(websocket, "status", {"message": "Generating illustration…"})
            try:
                _, raw_bytes = await asyncio.to_thread(generate_image, prompt, anchor_bytes, filename)
            except Exception as exc:
                await ws_send(websocket, "error", {"message": str(exc)})
                return

            _remember_turn(session_id, "practice", "assistant",
                           summary="Generated illustration", prompt=prompt,
                           raw_bytes=raw_bytes, filename=filename, intent="illustration", is_edit=is_edit)

            await ws_send(websocket, "illustration", {
                "image_b64": _bytes_to_base64(raw_bytes),
                "filename":  filename,
                "is_edit":   is_edit,
            })

        await ws_send(websocket, "done", {})

    except WebSocketDisconnect:
        pass
    except Exception as exc:
        await ws_send(websocket, "error", {"message": str(exc)})


# ──────────────────────────────────────────────────────────────────────────────
# REST HELPERS
# ──────────────────────────────────────────────────────────────────────────────

@app.post("/upload")
async def upload_reference(file: UploadFile = File(...)):
    data  = await file.read()
    fname = f"upload_{file.filename}"
    (OUTPUT_DIR / fname).write_bytes(data)
    return {"filename": fname, "image_b64": _bytes_to_base64(data)}


@app.get("/health")
async def health():
    return {"status": "ok", "model": IMAGE_MODEL, "version": "3.0.0"}


# ──────────────────────────────────────────────────────────────────────────────
# ENTRY POINT
# ──────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8001, reload=True)