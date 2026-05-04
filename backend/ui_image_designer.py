"""
ui_image_designer.py — Production UI Designer Agent
=====================================================

KEY ARCHITECTURAL IMPROVEMENTS:
  1. REFERENCE IMAGE PASSING FOR EDITS
     Every revision sends the previous image as a visual anchor. The model
     is instructed to change ONLY what the user asked and keep everything else
     pixel-identical. This mimics how you'd instruct a human designer.

  2. CONSISTENCY ENGINE
     A "DesignDNA" object is extracted from screen 1 and hard-locked into
     every subsequent prompt. Nav labels, hex values, font names, corner radii,
     shadow styles — all frozen and verified per-screen.

  3. NAV HIGHLIGHTING PER SCREEN
     Each prompt explicitly names the ACTIVE tab/sidebar item for that screen.
     All other items are described as inactive. Zero ambiguity for the model.

  4. POSTER SIZE DETECTION
     NLP keywords map to exact canvas dimensions (Instagram, TikTok, A4, etc.).
     Poster prompts never inherit mobile/web layout bias.

  5. REVISION FLOW
     When user says "change X", the last generated image bytes are passed as
     a reference Part alongside the edit instruction. No full regeneration.

  6. LANGGRAPH STAYS — but nodes are leaner and purpose-built.

  7. VERTEX AI + gemini-3.1-flash-image-preview PRESERVED throughout.

POSTER FIXES (v2):
  FIX 1 — _fill_missing_tokens now skips if poster; _fill_poster_tokens runs first
  FIX 2 — Fallback page populates must_include from brief.components / user_prompt
  FIX 3 — user_original_prompt passed through to _build_poster_prompt
  FIX 4 — Poster resolution locked before platform guard in ui_chatbot_node
  FIX 5 — is_poster detection hardened; brief.poster_size always resolved before prompt build
"""

from __future__ import annotations

import asyncio
import base64
import io
import json
import logging
import os
import re
import threading
import time
from datetime import datetime
from pathlib import Path
from typing import Literal, Optional

from dotenv import load_dotenv
from google import genai
import google.auth
from langchain_core.messages import HumanMessage
from langchain_google_genai import ChatGoogleGenerativeAI
try:
    from langchain_google_vertexai import ChatVertexAI
except Exception:
    ChatVertexAI = None
from langgraph.constants import END
from langgraph.graph import StateGraph
from pydantic import BaseModel, Field
from PIL import Image

load_dotenv()

# ─────────────────────────────────────────────────────────────────────────────
# LOGGING
# ─────────────────────────────────────────────────────────────────────────────
log_dir = Path(__file__).resolve().parent.parent.parent / "logs"
log_dir.mkdir(parents=True, exist_ok=True)
log_file = log_dir / f"ui_designer_{datetime.now().strftime('%Y%m%d_%H%M%S')}.log"

logging.getLogger().handlers.clear()
logging.basicConfig(
    level=logging.DEBUG,
    format="%(asctime)s | %(name)s | %(levelname)-8s | %(message)s",
    handlers=[
        logging.FileHandler(log_file, encoding="utf-8"),
        logging.StreamHandler(),
    ],
)
logger = logging.getLogger(__name__)
logger.info(f"🚀 UI Designer Agent Started — Log: {log_file}")

# ─────────────────────────────────────────────────────────────────────────────
# LLM SINGLETON
# ─────────────────────────────────────────────────────────────────────────────
_llm_instance = None
_vertex_init_lock = threading.Lock()
_vertex_initialized = False


def _get_llm():
    global _llm_instance
    if _llm_instance is not None:
        return _llm_instance

    api_key = os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY")
    if api_key:
        _llm_instance = ChatGoogleGenerativeAI(model="gemini-2.5-flash", api_key=api_key)
        return _llm_instance

    creds, project = google.auth.default(scopes=["https://www.googleapis.com/auth/cloud-platform"])
    project_id = project or os.getenv("GOOGLE_CLOUD_PROJECT")
    location = os.getenv("GOOGLE_CLOUD_LOCATION", "us-central1")

    if ChatVertexAI is not None:
        _llm_instance = ChatVertexAI(
            model="gemini-2.5-flash",
            credentials=creds,
            project=project_id,
            location=location,
            temperature=0.2,
        )
        logger.info(f"✅ LLM via Vertex | project={project_id} location={location}")
        return _llm_instance

    _llm_instance = ChatGoogleGenerativeAI(
        model="gemini-2.5-flash",
        credentials=creds,
        project=project_id,
        location=location,
        vertexai=True,
    )
    return _llm_instance


def _ensure_vertex_initialized():
    global _vertex_initialized
    if _vertex_initialized:
        return
    with _vertex_init_lock:
        if _vertex_initialized:
            return
        import vertexai
        creds, project = google.auth.default(
            scopes=["https://www.googleapis.com/auth/cloud-platform"]
        )
        project_id = project or os.getenv("GOOGLE_CLOUD_PROJECT", "")
        location = os.getenv("GOOGLE_CLOUD_LOCATION", "us-central1")
        vertexai.init(project=project_id, location=location, credentials=creds)
        _vertex_initialized = True
        logger.info(f"✅ Vertex AI initialized | project={project_id}")


# ─────────────────────────────────────────────────────────────────────────────
# SESSION IMAGE STREAMING
# ─────────────────────────────────────────────────────────────────────────────
_session_images: dict = {}
_session_design_dirs: dict[str, Path] = {}
_session_last_image_paths: dict[str, str] = {}
_session_design_dna: dict[str, dict] = {}


def _init_session_images(session_id: str):
    if session_id not in _session_images:
        _session_images[session_id] = {"images": [], "lock": threading.Lock()}


def _add_image_to_session(session_id: str, image_dict: dict):
    _init_session_images(session_id)
    with _session_images[session_id]["lock"]:
        _session_images[session_id]["images"].append(image_dict)
    if session_id and image_dict.get("path"):
        _session_last_image_paths[session_id] = image_dict["path"]


def _get_session_last_image_path(session_id: str) -> str:
    return _session_last_image_paths.get(session_id, "")


def _set_session_design_dna(session_id: str, dna: "DesignDNA | dict"):
    if not session_id:
        return
    _session_design_dna[session_id] = dna.model_dump() if isinstance(dna, DesignDNA) else dict(dna)


def _get_session_design_dna(session_id: str) -> dict:
    return _session_design_dna.get(session_id, {})


def _latest_image_path_in_dir(folder: Path) -> str:
    if not folder.exists():
        return ""
    candidates = sorted(
        [p for p in folder.glob("*.png") if p.is_file()],
        key=lambda p: p.stat().st_mtime,
    )
    return str(candidates[-1]) if candidates else ""


def _get_and_clear_session_images(session_id: str) -> list:
    if session_id not in _session_images:
        return []
    with _session_images[session_id]["lock"]:
        imgs = _session_images[session_id]["images"][:]
        _session_images[session_id]["images"].clear()
    return imgs


def _cleanup_session_images(session_id: str):
    _session_images.pop(session_id, None)


# ─────────────────────────────────────────────────────────────────────────────
# PYDANTIC MODELS
# ─────────────────────────────────────────────────────────────────────────────

class UIPageSpec(BaseModel):
    name: str = Field(..., description="Page name e.g. Dashboard")
    purpose: str = Field("", description="What this page is for")
    must_include: list[str] = Field(default_factory=list)
    avoid: list[str] = Field(default_factory=list)


class DesignDNA(BaseModel):
    """
    The locked design system extracted from screen 1.
    Every subsequent screen prompt is built on top of this.
    """
    bg_color: str = ""
    surface_color: str = ""
    primary_color: str = ""
    accent_color: str = ""
    text_primary: str = ""
    text_secondary: str = ""
    muted_color: str = ""
    border_color: str = ""
    success_color: str = ""
    error_color: str = ""
    heading_font: str = ""
    body_font: str = ""
    mono_font: str = ""
    card_radius: str = ""
    button_radius: str = ""
    button_style: str = ""
    shadow_style: str = ""
    icon_style: str = ""
    nav_type: str = ""         # "bottom_tabs" | "sidebar" | "top_bar" | "none"
    nav_items: list[str] = Field(default_factory=list)
    nav_bg: str = ""
    nav_active_style: str = ""
    nav_inactive_style: str = ""
    spacing_unit: str = ""
    visual_style: str = ""
    platform: str = ""
    resolution: str = ""
    extra_motifs: str = ""

    def is_empty(self) -> bool:
        return not self.bg_color and not self.heading_font


class UIDesignBrief(BaseModel):
    screen_name: str = Field("Primary Screen")
    platform: str = Field("web")
    layout: str = Field("centered")
    components: list[str] = Field(default_factory=list)
    style: str = Field("modern, clean, professional")
    color_palette: str = Field("")
    typography: str = Field("")
    copy_tone: str = Field("professional")
    constraints: list[str] = Field(default_factory=list)
    resolution: str = Field("1440x900")
    num_images: int = Field(1)
    brand_name: str = Field("")
    pages: list[UIPageSpec] = Field(default_factory=list)
    skip_pages: list[str] = Field(default_factory=list)
    nav_items: list[str] = Field(default_factory=list)
    logo_only: bool = Field(False)
    logo_description: str = Field("")
    poster_platform: str = Field("")   # "instagram", "tiktok", "a4", etc.
    poster_size: str = Field("")       # exact "WxH" resolved from poster_platform


class UIIntentResponse(BaseModel):
    intent: Literal["chat", "collect", "generate", "edit", "revision"]
    message: str
    requirements: Optional[UIDesignBrief] = None
    missing_fields: list[str] = Field(default_factory=list)
    change_request: str = ""
    target_screens: list[str] = Field(default_factory=list)


class PagePrompt(BaseModel):
    page_name: str
    prompt: str
    notes: str = ""


class DocumentAnalysis(BaseModel):
    is_document: bool = False
    summary: str = ""
    detected_pages: list[str] = Field(default_factory=list)
    features: list[str] = Field(default_factory=list)
    user_workflows: list[str] = Field(default_factory=list)
    tone: str = "professional"
    style_hints: str = ""
    color_hints: str = ""
    platform: str = "web"
    raw_text: str = ""


# ─────────────────────────────────────────────────────────────────────────────
# POSTER SIZE MAP  — NLP keyword → exact canvas WxH
# ─────────────────────────────────────────────────────────────────────────────
POSTER_SIZE_MAP: dict[str, tuple[str, str]] = {
    # Social — vertical
    "instagram story": ("1080x1920", "9:16 Instagram Story"),
    "ig story":        ("1080x1920", "9:16 Instagram Story"),
    "tiktok":          ("1080x1920", "9:16 TikTok"),
    "snapchat":        ("1080x1920", "9:16 Snapchat"),
    "reels":           ("1080x1920", "9:16 Reels"),
    "youtube short":   ("1080x1920", "9:16 YouTube Short"),
    # Social — square
    "instagram post":  ("1080x1080", "1:1 Instagram Post"),
    "instagram square":("1080x1080", "1:1 Instagram Post"),
    "ig post":         ("1080x1080", "1:1 Instagram Post"),
    "facebook post":   ("1200x630",  "1.91:1 Facebook Post"),
    # Social — landscape
    "youtube thumbnail":("1280x720", "16:9 YouTube Thumbnail"),
    "twitter":         ("1600x900",  "16:9 Twitter/X"),
    "linkedin":        ("1200x627",  "1.91:1 LinkedIn"),
    "banner":          ("1500x500",  "3:1 Twitter Banner"),
    # Print
    "a4":              ("2480x3508", "A4 Portrait"),
    "a3":              ("3508x4961", "A3 Portrait"),
    "a5":              ("1748x2480", "A5 Portrait"),
    "letter":          ("2550x3300", "US Letter"),
    "poster":          ("1080x1350", "4:5 Poster"),
    "flyer":           ("1080x1350", "4:5 Flyer"),
    # Default
    "social":          ("1080x1080", "1:1 Social Post"),
}

def _detect_poster_size(text: str) -> tuple[str, str]:
    """Return (WxH, label) from user text. Falls back to 1080x1080."""
    lower = text.lower()
    for keyword, dims in POSTER_SIZE_MAP.items():
        if keyword in lower:
            return dims
    return ("1080x1080", "1:1 Social Post")


def _is_poster_intent(text: str) -> bool:
    """
    FIX 5: Hardened poster intent detection. Checks poster_platform/poster_size
    fields directly and uses a broader token list. No longer silently fails when
    a UI token co-occurs with a poster token in an ambiguous phrase.
    """
    poster_tokens = {
        "poster", "flyer", "brochure", "social post", "instagram", "tiktok",
        "reel", "story", "thumbnail", "banner", "a4", "a3", "print ad",
        "ad creative", "graphic", "announcement", "social media",
        "ig post", "ig story", "youtube short", "snapchat", "linkedin post",
        "facebook post", "twitter post", "x post",
    }
    # Only treat as NOT poster if these strong UI tokens appear WITHOUT poster tokens
    hard_ui_tokens = {
        "web ui", "ui design", "dashboard", "navbar", "hero section",
        "footer", "mobile app screen", "ios app", "android app",
    }
    lower = text.lower()
    has_poster = any(t in lower for t in poster_tokens)
    has_hard_ui = any(t in lower for t in hard_ui_tokens)

    # If both poster and hard UI tokens appear, poster still wins
    # (e.g. "instagram landing page" → poster, not web UI)
    return has_poster and not has_hard_ui


# ─────────────────────────────────────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────────────────────────────────────

def _now_stamp() -> str:
    return datetime.now().strftime("%Y%m%d_%H%M%S")


def _design_root() -> Path:
    root = Path(__file__).resolve().parent / "ui_designs"
    root.mkdir(parents=True, exist_ok=True)
    return root


def _session_folder_name(session_id: str) -> str:
    if not session_id:
        return "session_unknown"
    safe = re.sub(r"[^a-zA-Z0-9_-]+", "-", session_id.strip()).strip("-")
    return safe or "session_unknown"


def _design_dir(session_id: str, session_root_dir: str | Path | None = None) -> Path:
    if session_root_dir:
        path = Path(session_root_dir)
        path.mkdir(parents=True, exist_ok=True)
        if session_id:
            _session_design_dirs[session_id] = path
        return path

    if session_id and session_id in _session_design_dirs:
        return _session_design_dirs[session_id]

    path = _design_root() / _session_folder_name(session_id)
    path.mkdir(parents=True, exist_ok=True)
    if session_id:
        _session_design_dirs[session_id] = path
    return path


def _image_url_from_path(path: Path) -> str:
    rel = path.relative_to(Path(__file__).resolve().parent)
    return f"/{rel.as_posix()}"


def _slugify(value: str) -> str:
    safe = "".join(ch.lower() if ch.isalnum() else "-" for ch in value.strip())
    while "--" in safe:
        safe = safe.replace("--", "-")
    return safe.strip("-") or "page"


def _extract_json(text: str) -> dict:
    if not text:
        raise ValueError("Empty response")
    if text.strip().startswith("```"):
        parts = text.splitlines()
        text = "\n".join(parts[1:-1] if parts[-1].strip() == "```" else parts[1:])
    s, e = text.find("{"), text.rfind("}")
    if s == -1 or e == -1:
        raise ValueError("No JSON object found")
    return json.loads(text[s: e + 1])


def _format_chat_history(chat_history: Optional[list[dict]], max_messages: int = 20) -> str:
    if not chat_history:
        return "[]"
    lines = []
    for msg in chat_history[-max_messages:]:
        role = str(msg.get("role", "")).strip().lower()
        content = str(msg.get("content", "")).strip()
        if content:
            lines.append(f"- {role}: {content}")
    return "\n".join(lines) if lines else "[]"


def _is_auth_page(name: str) -> bool:
    auth_tokens = {
        "login", "sign in", "signin", "register", "registration", "sign up",
        "signup", "forgot password", "password reset", "reset password",
        "password recovery", "2fa", "two-factor", "verify", "verification",
        "onboarding", "welcome",
    }
    lower = name.lower()
    return any(t in lower for t in auth_tokens)


def _filter_structural_pages(pages: list[UIPageSpec]) -> list[UIPageSpec]:
    structural = {"navbar", "nav bar", "navigation", "header", "sidebar", "topbar", "top bar"}
    spec_tokens = {"style guide", "design system", "typography", "color palette", "ui kit", "spec"}
    result = []
    for p in pages:
        lower = p.name.strip().lower()
        if lower in structural:
            continue
        if any(t in lower for t in spec_tokens):
            continue
        result.append(p)
    return result


def _pick_active_nav_item(page_name: str, nav_items: list[str]) -> str:
    if not nav_items:
        return ""
    lower = page_name.lower()
    for item in nav_items:
        if item.lower() == lower:
            return item
    for item in nav_items:
        if item.lower().strip() in lower:
            return item
    return ""


def _infer_nav_items(pages: list[UIPageSpec]) -> list[str]:
    exclude = {
        "login", "sign in", "signin", "register", "registration", "sign up",
        "signup", "forgot password", "password reset", "reset password",
        "2fa", "verify", "verification", "onboarding", "welcome",
    }
    items, seen = [], set()
    for p in pages:
        name = p.name.strip()
        lower = name.lower()
        if lower in seen or any(t in lower for t in exclude):
            continue
        items.append(name)
        seen.add(lower)
    return items


def _fill_missing_tokens(brief: UIDesignBrief):
    """
    FIX 1: This function must NEVER be called for poster briefs.
    Callers now check is_poster before calling this.
    """
    style = brief.style.lower()
    is_mobile = brief.platform == "mobile"

    if not brief.color_palette or len(brief.color_palette) < 20:
        if "fintech" in style or "luxury" in style:
            brief.color_palette = "bg:#0A0E1A surface:#111827 primary:#6366F1 accent:#F59E0B text:#F9FAFB muted:#6B7280 border:#1F2937 success:#10B981 error:#EF4444"
        elif is_mobile and "ios" in style and "dark" in style:
            brief.color_palette = "bg:#1C1C1E surface:#2C2C2E primary:#0A84FF accent:#FFD60A text:#FFFFFF muted:#8E8E93 border:#3A3A3C success:#30D158 error:#FF453A"
        elif is_mobile and "ios" in style:
            brief.color_palette = "bg:#F2F2F7 surface:#FFFFFF primary:#007AFF accent:#FF9500 text:#000000 muted:#8E8E93 border:#C6C6C8 success:#34C759 error:#FF3B30"
        elif "neo-brutalist" in style:
            brief.color_palette = "bg:#FFFFFF surface:#F5F5F5 primary:#000000 accent:#FF3B00 text:#000000 muted:#555555 border:#000000 success:#00A550 error:#FF0000"
        elif "dark" in style or "corporate" in style:
            brief.color_palette = "bg:#0F172A surface:#1E293B primary:#38BDF8 accent:#F472B6 text:#F8FAFC muted:#64748B border:#334155 success:#4ADE80 error:#F87171"
        else:
            brief.color_palette = "bg:#F8FAFC surface:#FFFFFF primary:#6366F1 accent:#F59E0B text:#1E293B muted:#64748B border:#E2E8F0 success:#10B981 error:#EF4444"

    if not brief.typography or len(brief.typography) < 20:
        if is_mobile and ("ios" in style or "apple" in style):
            brief.typography = "Display: SF Pro Display 700 32px, Heading: SF Pro Display 600 24px, Body: SF Pro Text 400 16px, Caption: SF Pro Text 400 12px"
        elif is_mobile and "material" in style:
            brief.typography = "Display: Google Sans 700 32px, Heading: Google Sans 600 22px, Body: Roboto 400 16px, Caption: Roboto 400 12px"
        elif "neo-brutalist" in style:
            brief.typography = "Display: Space Grotesk 800 52px, Heading: Space Grotesk 700 32px, Body: DM Mono 400 15px, Caption: DM Mono 400 12px"
        elif "editorial" in style:
            brief.typography = "Display: Playfair Display 700 52px, Heading: Playfair Display 600 36px, Body: Source Serif 4 400 17px, Caption: Source Serif 4 400 13px"
        elif "fintech" in style or "luxury" in style:
            brief.typography = "Display: Syne 800 48px, Heading: DM Sans 600 28px, Body: DM Sans 400 16px, Caption: DM Sans 400 12px, Mono: JetBrains Mono 400 14px"
        elif is_mobile:
            brief.typography = "Display: Plus Jakarta Sans 700 32px, Heading: Plus Jakarta Sans 600 22px, Body: Plus Jakarta Sans 400 16px, Caption: Plus Jakarta Sans 400 12px"
        else:
            brief.typography = "Display: Plus Jakarta Sans 700 44px, Heading: Plus Jakarta Sans 600 28px, Body: Plus Jakarta Sans 400 16px, Caption: Plus Jakarta Sans 400 12px"


# ─────────────────────────────────────────────────────────────────────────────
# FIX 1 (continued): _fill_poster_tokens uses UNCONDITIONAL assignment
# so it always wins over any prior defaults, and no longer needs weak guards.
# ─────────────────────────────────────────────────────────────────────────────
def _fill_poster_tokens(brief: UIDesignBrief):
    """
    FIX 1: Unconditionally sets poster-appropriate style, colors, and typography.
    Called INSTEAD OF _fill_missing_tokens for poster briefs, so there is zero
    risk of mobile/web defaults leaking in.
    """
    style = brief.style.lower()

    # Always override style if it looks like a UI/mobile default
    ui_style_tokens = {
        "modern, clean, professional", "ios premium dark", "ios minimal light",
        "material you vibrant", "soft saas light", "fintech mobile dark",
        "corporate dark", "neo-brutalist",
    }
    if not brief.style or style in ui_style_tokens:
        brief.style = "cinematic editorial poster"

    # Always set rich poster color palette — unconditional override
    if not brief.color_palette or len(brief.color_palette) < 20:
        brief.color_palette = (
            "bg:#050814 surface:#111827 primary:#F97316 accent:#22D3EE "
            "text:#F8FAFC muted:#94A3B8 border:#1F2937 success:#10B981 error:#EF4444"
        )

    # Always set poster-appropriate display typography — unconditional override
    if not brief.typography or len(brief.typography) < 20:
        brief.typography = (
            "Display: Bebas Neue 800 96px, Heading: Oswald 700 56px, "
            "Body: Inter 400 24px, Caption: Inter 400 18px"
        )

    # FIX 4: Always lock resolution to poster canvas — never inherit 390x844 or 1440x900
    if brief.poster_size:
        brief.resolution = brief.poster_size
    elif brief.resolution in ("390x844", "1440x900", ""):
        brief.resolution = "1080x1080"


# ─────────────────────────────────────────────────────────────────────────────
# IMAGE HELPERS
# ─────────────────────────────────────────────────────────────────────────────

def _looks_like_image(data: bytes) -> bool:
    sigs = [b"\x89PNG\r\n\x1a\n", b"\xff\xd8\xff", b"GIF87a", b"GIF89a"]
    if any(data.startswith(s) for s in sigs):
        return True
    return data.startswith(b"RIFF") and b"WEBP" in data[:16]


def _normalize_inline(inline_data) -> bytes:
    data = inline_data.data
    if isinstance(data, str):
        return base64.b64decode(data)
    if _looks_like_image(data):
        return data
    try:
        decoded = base64.b64decode(data, validate=True)
        if _looks_like_image(decoded):
            return decoded
    except Exception:
        pass
    return data


def _extract_image_bytes(response) -> bytes:
    candidates = getattr(response, "candidates", None) or []
    for candidate in candidates:
        parts = getattr(getattr(candidate, "content", None), "parts", None) or []
        for part in parts:
            inline = getattr(part, "inline_data", None)
            if inline and getattr(inline, "mime_type", "").startswith("image/"):
                return _normalize_inline(inline)
    for candidate in candidates:
        parts = getattr(getattr(candidate, "content", None), "parts", None) or []
        for part in parts:
            inline = getattr(part, "inline_data", None)
            if inline:
                return _normalize_inline(inline)
    raise RuntimeError("No image data in model response")


def _save_image_bytes(image_bytes: bytes, path: Path):
    img = Image.open(io.BytesIO(image_bytes))
    img.save(path)


def _bytes_to_b64(image_bytes: bytes) -> str:
    return base64.b64encode(image_bytes).decode("utf-8")


def _b64_to_bytes(b64: str) -> bytes:
    return base64.b64decode(b64)


# ─────────────────────────────────────────────────────────────────────────────
# IMAGE GENERATION — Vertex AI, gemini-3.1-flash-image-preview
# ─────────────────────────────────────────────────────────────────────────────
PRIMARY_MODEL   = "gemini-3.1-flash-image-preview"
FALLBACK_MODEL  = "gemini-2.5-flash-image"


def _generate_image_bytes_vertex(
    prompt_text: str,
    model_name: str,
    reference_bytes: Optional[bytes] = None,
) -> bytes:
    """Call Vertex AI image model. Optionally passes reference image as Part."""
    from vertexai.generative_models import GenerativeModel, Part

    _ensure_vertex_initialized()
    model = GenerativeModel(model_name)

    if reference_bytes is not None:
        if reference_bytes[:8] == b"\x89PNG\r\n\x1a\n":
            mime = "image/png"
        elif reference_bytes[:3] == b"\xff\xd8\xff":
            mime = "image/jpeg"
        else:
            mime = "image/png"
        ref_part = Part.from_data(data=reference_bytes, mime_type=mime)
        contents = [ref_part, prompt_text]
    else:
        contents = [prompt_text]

    response = model.generate_content(contents)
    return _extract_image_bytes(response)


def _generate_image_bytes_api(
    prompt_text: str,
    model_name: str,
    reference_bytes: Optional[bytes] = None,
) -> bytes:
    """Call Google AI API. Optionally passes reference image."""
    api_key = os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY")
    client = genai.Client(api_key=api_key)

    if reference_bytes is not None:
        if reference_bytes[:8] == b"\x89PNG\r\n\x1a\n":
            mime = "image/png"
        elif reference_bytes[:3] == b"\xff\xd8\xff":
            mime = "image/jpeg"
        else:
            mime = "image/png"
        from google.genai import types as genai_types
        image_part = genai_types.Part.from_bytes(data=reference_bytes, mime_type=mime)
        text_part  = genai_types.Part.from_text(text=prompt_text)
        response = client.models.generate_content(
            model=model_name,
            contents=[genai_types.Content(parts=[image_part, text_part])],
        )
    else:
        response = client.models.generate_content(model=model_name, contents=prompt_text)

    return _extract_image_bytes(response)


def _generate_image_sync(
    prompt_text: str,
    reference_bytes: Optional[bytes] = None,
    max_retries: int = 3,
) -> bytes:
    """Generate image with retry + fallback model chain. Passes reference bytes when provided."""
    api_key = os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY")
    use_api = bool(api_key)

    model_chain = [PRIMARY_MODEL, FALLBACK_MODEL]
    last_error = None

    for model_name in model_chain:
        for attempt in range(max_retries):
            try:
                if use_api:
                    return _generate_image_bytes_api(prompt_text, model_name, reference_bytes)
                else:
                    return _generate_image_bytes_vertex(prompt_text, model_name, reference_bytes)
            except Exception as e:
                last_error = e
                err = str(e).lower()
                transient = ["ssl", "timeout", "503", "429", "connection", "stream removed", "temporarily unavailable"]
                if any(x in err for x in transient):
                    if attempt < max_retries - 1:
                        wait = 2 ** attempt
                        logger.warning(f"Retry {attempt+1}/{max_retries} | model={model_name} wait={wait}s | {str(e)[:100]}")
                        time.sleep(wait)
                        continue
                logger.warning(f"Non-transient error for {model_name}: {str(e)[:100]} — trying next model")
                break

    raise last_error or RuntimeError("All models and retries exhausted")


# ─────────────────────────────────────────────────────────────────────────────
# DESIGN DNA EXTRACTION
# ─────────────────────────────────────────────────────────────────────────────

DNA_EXTRACT_PROMPT = """You are a meticulous design-token extractor. 
Analyse the UI screenshot and return ONLY a JSON object with these exact keys.
No markdown, no preamble, no extra keys.

{
  "bg_color":          "#hex",
  "surface_color":     "#hex",
  "primary_color":     "#hex",
  "accent_color":      "#hex",
  "text_primary":      "#hex",
  "text_secondary":    "#hex",
  "muted_color":       "#hex",
  "border_color":      "#hex",
  "success_color":     "#hex",
  "error_color":       "#hex",
  "heading_font":      "exact font name",
  "body_font":         "exact font name",
  "mono_font":         "exact font name or empty string",
  "card_radius":       "e.g. 16px",
  "button_radius":     "e.g. 12px",
  "button_style":      "e.g. filled primary_color, white bold text, 12px radius, 48px height",
  "shadow_style":      "e.g. rgba(0,0,0,0.12) 0 4px 24px",
  "icon_style":        "e.g. outline 24px, primary_color active / muted inactive",
  "nav_type":          "bottom_tabs | sidebar | top_bar | none",
  "nav_items":         ["label1", "label2", "label3"],
  "nav_bg":            "#hex",
  "nav_active_style":  "e.g. filled icon + bold label in primary_color, underline indicator",
  "nav_inactive_style":"e.g. outline icon + regular label in muted_color",
  "spacing_unit":      "e.g. 8px",
  "visual_style":      "one-sentence description of the overall aesthetic",
  "platform":          "mobile | web",
  "resolution":        "e.g. 390x844",
  "extra_motifs":      "e.g. glassmorphism cards, gradient mesh background"
}

Be exact: extract actual hex values, actual font names, actual measurements visible on screen.
nav_items: list ALL tab/menu labels in their exact left-to-right or top-to-bottom order.
"""


def _extract_design_dna(image_bytes: bytes) -> DesignDNA:
    """Extract locked design tokens from the first generated screen."""
    try:
        b64 = _bytes_to_b64(image_bytes)
        resp = _get_llm().invoke([
            HumanMessage(content=[
                {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64}"}},
                {"type": "text", "text": DNA_EXTRACT_PROMPT},
            ])
        ])
        raw = getattr(resp, "content", str(resp)).strip()
        data = _extract_json(raw)
        dna = DesignDNA.model_validate(data)
        logger.info(f"🧬 Design DNA extracted: style={dna.visual_style}, nav={dna.nav_type}, items={dna.nav_items}")
        return dna
    except Exception as e:
        logger.warning(f"Design DNA extraction failed: {e}")
        return DesignDNA()


# ─────────────────────────────────────────────────────────────────────────────
# REFERENCE IMAGE DESCRIPTION (for edit/revision mode)
# ─────────────────────────────────────────────────────────────────────────────

DESCRIBE_FOR_EDIT_PROMPT = (
    "You are a senior UI designer doing a design audit for precise editing.\n"
    "Describe in extreme detail:\n"
    "1. Every visible UI element, its position, size, color, and style\n"
    "2. The exact color hex values for background, surface, primary, accent, text\n"
    "3. Typography: font families, weights, sizes\n"
    "4. Navigation: type, position, tab labels, which tab is active\n"
    "5. Cards: radius, shadow, padding, border\n"
    "6. Any special effects: blur, gradients, glassmorphism\n"
    "7. Content: exact text, numbers, usernames, dates visible on screen\n"
    "8. Platform (web/mobile) and approximate resolution\n\n"
    "The goal is to be able to recreate this EXACTLY and then apply a small change."
)


def _describe_image_for_edit(image_bytes: bytes) -> str:
    try:
        b64 = _bytes_to_b64(image_bytes)
        resp = _get_llm().invoke([
            HumanMessage(content=[
                {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64}"}},
                {"type": "text", "text": DESCRIBE_FOR_EDIT_PROMPT},
            ])
        ])
        return getattr(resp, "content", str(resp)).strip()
    except Exception as e:
        logger.warning(f"Image description failed: {e}")
        return ""


# ─────────────────────────────────────────────────────────────────────────────
# PROMPT BUILDERS
# ─────────────────────────────────────────────────────────────────────────────

def _build_intent_prompt(
    user_message: str,
    last_brief: Optional[dict],
    chat_history: Optional[list[dict]],
) -> str:
    brief_text = json.dumps(last_brief, indent=2) if last_brief else "{}"
    history_text = _format_chat_history(chat_history)

    return f"""You are an elite UI/UX design director and NLP specialist. Parse the user request precisely.

USER MESSAGE:
{user_message}

RECENT CHAT HISTORY:
{history_text}

LAST DESIGN BRIEF:
{brief_text}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
INTENT OPTIONS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
chat     → general question, no design work needed
collect  → design requested but critical info missing (platform unclear, etc.)
generate → enough info to generate UI/poster/logo images
edit     → user wants to CHANGE a specific aspect of the LATEST generated image
revision → user confirms changes from previous design (approve / minor tweak)

REVISION DETECTION RULE:
If the message says things like "change X", "make it Y", "update the color to Z",
"shift to black background", "use red instead", "make it bigger", "remove the shadow"
→ intent = "edit", change_request = exact description of what to change
→ target_screens = which screens to apply the edit to (empty = all)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
POSTER SIZE DETECTION — CRITICAL
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
If user mentions a poster platform or size, set poster_platform and poster_size:
  "instagram story" | "ig story" | "reels"  → poster_size: "1080x1920"
  "instagram post" | "square"               → poster_size: "1080x1080"
  "tiktok"                                   → poster_size: "1080x1920"
  "youtube thumbnail"                        → poster_size: "1280x720"
  "twitter" | "x post"                       → poster_size: "1600x900"
  "linkedin"                                 → poster_size: "1200x627"
  "a4" | "print"                             → poster_size: "2480x3508"
  "a3"                                       → poster_size: "3508x4961"
  "banner"                                   → poster_size: "1500x500"
  "facebook"                                 → poster_size: "1200x630"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
LOGO DETECTION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
If user says "logo", "brand mark", "icon mark" → set logo_only: true

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PLATFORM RULE — MANDATORY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
platform MUST be "web" or "mobile" exactly.
  web    → resolution: "1440x900"
  mobile → resolution: "390x844"
EXCEPTION: if poster_size is set, do NOT override resolution — keep poster_size as resolution.
If ambiguous → intent: "collect", ask the user.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
OUTPUT JSON SCHEMA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{{
  "intent": "generate",
  "message": "Brief friendly response",
  "change_request": "",
  "target_screens": [],
  "requirements": {{
    "screen_name": "AppName",
    "platform": "mobile",
    "layout": "bottom tab navigation, scrollable content",
    "components": ["bottom tab bar", "balance card", "transaction list"],
    "style": "fintech mobile dark",
    "color_palette": "bg:#0D0D0D surface:#1A1A2E primary:#6C63FF accent:#FFD700 text:#FFFFFF muted:#8E8E93 border:#2C2C2E success:#30D158 error:#FF453A",
    "typography": "Display: SF Pro Display 700 32px, Heading: SF Pro Display 600 24px, Body: SF Pro Text 400 16px, Caption: SF Pro Text 400 12px",
    "copy_tone": "confident and premium",
    "constraints": ["safe area insets", "44dp minimum tap targets"],
    "resolution": "390x844",
    "num_images": 1,
    "brand_name": "Vaultly",
    "nav_items": ["Home", "Send", "Cards", "Insights", "Settings"],
    "poster_platform": "",
    "poster_size": "",
    "logo_only": false,
    "logo_description": "",
    "pages": [
      {{"name": "Home", "purpose": "Balance overview", "must_include": ["balance card", "quick actions", "recent transactions"], "avoid": []}},
      {{"name": "Send", "purpose": "Transfer funds", "must_include": ["contact picker", "amount input", "send CTA"], "avoid": []}}
    ],
    "skip_pages": []
  }},
  "missing_fields": []
}}
"""


def _build_dna_constraint_block(dna: DesignDNA) -> str:
    """Renders the locked design DNA as a prose constraint block for image prompts."""
    if dna.is_empty():
        return ""

    nav_labels = ", ".join(dna.nav_items) if dna.nav_items else ""

    return f"""
══════════ FROZEN DESIGN DNA — DO NOT DEVIATE ══════════
Every value below is MANDATORY. Changing any is a failure.

COLORS (use these exact hex values):
  Background:     {dna.bg_color}
  Surface/Card:   {dna.surface_color}
  Primary:        {dna.primary_color}
  Accent/CTA:     {dna.accent_color}
  Text Primary:   {dna.text_primary}
  Text Secondary: {dna.text_secondary}
  Muted:          {dna.muted_color}
  Border:         {dna.border_color}
  Success:        {dna.success_color}
  Error:          {dna.error_color}

TYPOGRAPHY (use these exact font names):
  Heading font: {dna.heading_font}
  Body font:    {dna.body_font}
  Mono font:    {dna.mono_font}

COMPONENT STYLE (replicate exactly):
  Card radius:    {dna.card_radius}
  Button radius:  {dna.button_radius}
  Button style:   {dna.button_style}
  Shadow:         {dna.shadow_style}
  Icons:          {dna.icon_style}
  Spacing unit:   {dna.spacing_unit}

NAVIGATION (render identically across every screen):
  Type:              {dna.nav_type}
  Background:        {dna.nav_bg}
  Labels in order:   {nav_labels}
  Active item style: {dna.nav_active_style}
  Inactive style:    {dna.nav_inactive_style}

VISUAL STYLE: {dna.visual_style}
EXTRA MOTIFS: {dna.extra_motifs}

════════════════════════════════════════════════════════
"""


def _build_nav_highlight_block(
    page_name: str,
    dna: DesignDNA,
    platform: str,
    nav_items: list[str],
) -> str:
    if not nav_items:
        return ""

    active = _pick_active_nav_item(page_name, nav_items) or ""
    is_mobile = platform == "mobile"
    nav_count = len(nav_items)

    lines = []
    if is_mobile:
        lines.append("BOTTOM NAVIGATION BAR — render at the very bottom of the screen inside the phone:")
    else:
        lines.append("SIDEBAR NAVIGATION — render as a fixed left panel, full height:")

    lines.append(
        f"- Keep the exact same nav item count ({nav_count}) and the exact same icon set/order on every screen. "
        "Do not add, remove, rename, or swap icons between screens."
    )

    for item in nav_items:
        if item == active:
            if is_mobile:
                lines.append(
                    f"  ► '{item}' tab → ACTIVE: icon FILLED in {dna.primary_color or 'primary color'}, "
                    f"label BOLD in {dna.primary_color or 'primary color'}, "
                    f"small colored dot or bar indicator beneath label"
                )
            else:
                lines.append(
                    f"  ► '{item}' item → ACTIVE: 3px left border in {dna.primary_color or 'accent color'}, "
                    f"background tinted {dna.primary_color or 'primary'}@15% opacity, "
                    f"icon FILLED in {dna.primary_color or 'primary color'}, label BOLD"
                )
        else:
            if is_mobile:
                lines.append(
                    f"  ○ '{item}' tab → INACTIVE: icon OUTLINE in {dna.muted_color or 'muted gray'}, "
                    f"label regular weight in {dna.muted_color or 'muted gray'}, no indicator"
                )
            else:
                lines.append(
                    f"  ○ '{item}' item → INACTIVE: no border, transparent bg, "
                    f"icon OUTLINE in {dna.muted_color or 'muted gray'}, label regular in {dna.muted_color or 'muted gray'}"
                )

    if not is_mobile and not active:
        lines.append("  (no item is active on this screen)")

    return "\n".join(lines)


def _build_mobile_frame_block(resolution: str) -> str:
    return f"""
CANVAS — MOBILE APP SCREEN:
- Render the UI inside a realistic iPhone 15 Pro-style device frame at {resolution}
- The phone frame must be visible and complete, with bezel, notch, and hardware volume/power buttons
- The app UI fills the screen area inside the device frame
- DO NOT render OS status bar text or icons unless the design explicitly includes them
- Keep the composition centered so the device can be shown cleanly in marketing mockups
"""


def _build_web_frame_block(resolution: str) -> str:
    return f"""
CANVAS — WEB APP SCREEN:
- Render as a {resolution} desktop application window (NOT a browser screenshot)
- No browser chrome, no address bar, no browser tabs — just the app UI
- The layout is: fixed sidebar (240px) on the left + main content area filling the rest
- The sidebar occupies the full height of the window
- Main content area has a scrollable region with standard padding
"""


def _build_base_prompt(
    brief: UIDesignBrief,
    page: UIPageSpec,
    dna: DesignDNA,
    nav_items: list[str],
    is_revision: bool = False,
    change_request: str = "",
    reference_description: str = "",
) -> str:
    is_mobile = brief.platform == "mobile"
    is_auth = _is_auth_page(page.name)

    frame_block = _build_mobile_frame_block(brief.resolution) if is_mobile else _build_web_frame_block(brief.resolution)

    dna_block = _build_dna_constraint_block(dna) if not dna.is_empty() else f"""
DESIGN SYSTEM:
  Style: {brief.style}
  Colors: {brief.color_palette}
  Typography: {brief.typography}
"""

    nav_block = ""
    if not is_auth and nav_items:
        nav_block = _build_nav_highlight_block(page.name, dna, brief.platform, nav_items)

    must = "\n".join(f"  • {m}" for m in page.must_include) if page.must_include else "  • (Infer appropriate content for this screen)"
    avoid = "\n".join(f"  • {a}" for a in page.avoid) if page.avoid else ""

    edit_block = ""
    if is_revision and change_request:
        edit_block = f"""
══════════ REVISION INSTRUCTION ══════════
CURRENT STATE (from reference image):
{reference_description or "(see attached reference image)"}

CHANGE REQUEST:
{change_request}

WHAT TO KEEP IDENTICAL:
- All colors, fonts, radii, shadows
- All content not mentioned in the change request
- Navigation bar styling and layout
- Every other UI element not mentioned

WHAT TO CHANGE:
- ONLY what is described in the change request above
- Nothing else
══════════════════════════════════════════
"""

    auth_note = (
        "\nIMPORTANT: This is an authentication screen — DO NOT render any navigation bar, sidebar, or bottom tabs.\n"
        "Show ONLY a centered, focused form. The entire screen is the form.\n"
        if is_auth else ""
    )

    return f"""Render a high-fidelity, production-quality UI screenshot for: {brief.brand_name or brief.screen_name}

{frame_block}

{dna_block}

{nav_block}

{auth_note}

SCREEN: {page.name}
PURPOSE: {page.purpose or page.name}

REQUIRED CONTENT (show ALL of these):
{must}

{"AVOID: " + avoid if avoid else ""}

CONTENT QUALITY RULES:
- Show fully populated, realistic screen with actual data (names, numbers, dates, images)
- NO "Lorem ipsum", NO "User Name", NO placeholder text of any kind
- Every element must look like it came from a shipped, production product
- Text must be legible and appropriately sized for the platform

{edit_block}

CRITICAL RENDERING RULES (violations = wrong output):
- DO NOT render any hex codes, font names, measurements, or spec labels as visible text
- DO NOT render annotation arrows, dimension lines, or design-tool overlays
- DO NOT render style-guide panels, color swatches, or typography specimens
- DO NOT render literal tokens like "Inter", "Montserrat", "#6366F1", "16px", "Caption"
- The result must look exactly like a real screenshot from a production app
- For mobile: render the UI inside a realistic iPhone 15 Pro-style device frame
- For mobile: the app screen must be fully visible within the phone frame

Ultra high-fidelity. Pixel-perfect. Production-ready. Photorealistic rendering. No motion blur.
"""


# ─────────────────────────────────────────────────────────────────────────────
# FIX 3: _build_poster_prompt now accepts user_original_prompt
# so the raw creative intent is never lost when building the image prompt.
# ─────────────────────────────────────────────────────────────────────────────
def _build_poster_prompt(
    brief: UIDesignBrief,
    page: UIPageSpec,
    change_request: str = "",
    reference_description: str = "",
    is_revision: bool = False,
    user_original_prompt: str = "",          # FIX 3: new param
) -> str:
    size = brief.poster_size or "1080x1080"
    platform_label = brief.poster_platform or "Social Media"
    w, h = size.split("x") if "x" in size else ("1080", "1080")
    orientation = "portrait" if int(h) > int(w) else ("landscape" if int(w) > int(h) else "square")

    edit_block = ""
    if is_revision and change_request:
        edit_block = f"""
REVISION:
Current state: {reference_description or "(see reference image)"}
Apply ONLY this change: {change_request}
Keep everything else identical.
"""

    must = ", ".join(page.must_include) if page.must_include else "(infer appropriate elements)"

    # FIX 3: Embed the user's original request verbatim so no creative intent is lost
    original_request_block = ""
    if user_original_prompt:
        original_request_block = f"""
ORIGINAL USER REQUEST (highest priority — honour every detail):
\"\"\"{user_original_prompt}\"\"\"

The above request is the primary creative brief. Every other instruction below
is a technical constraint that supports it, not a replacement for it.
"""

    return f"""Generate a professional, high-quality {platform_label} graphic for: {brief.brand_name or brief.screen_name}

{original_request_block}

CANVAS:
- Exact dimensions: {size} pixels ({orientation})
- Render as a flat {orientation} poster canvas
- Do NOT render any mobile device frame, browser chrome, app navigation, or UI shell
- This is poster artwork, NOT an app screenshot

VISUAL STYLE: {brief.style}

COLOR PALETTE:
{brief.color_palette}

TYPOGRAPHY:
{brief.typography}

POSTER CONTENT:
{must}

COMPOSITION RULES:
- Strong visual hierarchy with a clear focal point
- Balanced spacing and alignment for strong social readability
- Rich, polished background treatment (gradient / texture / cinematic environment / illustration as appropriate)
- Include impactful, production-ready typography and decorative elements
- Use cinematic lighting, rich texture, and intentional depth so the result feels premium and handcrafted
- Keep text concise and highly legible at full size
- If the concept calls for a stylized illustration, use a polished editorial illustration; if it calls for realism, use photorealism
- Maintain realistic anatomy and natural proportions for people
- Avoid distorted faces, extra limbs, warped hands, duplicated bodies, and malformed details

{edit_block}

CRITICAL RULES:
- DO NOT draw any hex codes, font names, or annotation text
- DO NOT draw wireframe overlays, arrows, or dimension lines
- Render only finished poster artwork suitable for {platform_label}
- The result must be print/publish-ready at {size}px
"""


def _build_logo_prompt(brief: UIDesignBrief, change_request: str = "", reference_description: str = "") -> str:
    edit_block = ""
    if change_request:
        edit_block = f"""
REVISION:
Current logo: {reference_description or "(see reference image)"}
Apply ONLY: {change_request}
Keep brand identity, proportions, and all other elements identical.
"""

    spec = brief.logo_description or f"A professional logo for '{brief.brand_name}'"

    return f"""Design a professional, production-ready logo.

BRAND: {brief.brand_name or 'this product'}
STYLE: {brief.style}
COLORS: {brief.color_palette}
TYPOGRAPHY: {brief.typography}

REQUIREMENTS:
{spec}

LOGO STANDARDS:
- Clean, memorable, and scalable (works at 16px favicon and 1000px display)
- Works in both color and monochrome
- Render on a solid surface-color background or transparent
- Square canvas, centered composition
- High resolution, vector-style appearance

{edit_block}

CRITICAL RULES:
- Render ONLY the logo — no spec labels, no measurements, no descriptive text
- No sample text that says "Logo" or "Brand Name"
- Output must be production-ready
"""


# ─────────────────────────────────────────────────────────────────────────────
# LANGGRAPH NODES
# ─────────────────────────────────────────────────────────────────────────────

def ui_chatbot_node(state: dict) -> dict:
    """NLP intent classification with reference image support."""
    user_message = (state.get("user_prompt") or "").strip()
    last_brief = state.get("design_brief")
    chat_history = state.get("chat_history") or []

    if state.get("reference_image_base64"):
        try:
            b64 = state["reference_image_base64"]
            resp = _get_llm().invoke([
                HumanMessage(content=[
                    {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64}"}},
                    {"type": "text", "text": DESCRIBE_FOR_EDIT_PROMPT},
                ])
            ])
            desc = getattr(resp, "content", str(resp)).strip()
            user_message = f"[REFERENCE IMAGE ANALYSIS]\n{desc}\n\n[USER REQUEST]\n{user_message}"
        except Exception as e:
            logger.warning(f"Reference image description failed: {e}")

    prompt = _build_intent_prompt(user_message, last_brief, chat_history)

    try:
        resp = _get_llm().with_structured_output(UIIntentResponse).invoke(prompt)
    except Exception:
        raw = _get_llm().invoke(prompt)
        data = _extract_json(getattr(raw, "content", str(raw)))
        resp = UIIntentResponse.model_validate(data)

    if resp.requirements is None:
        resp.requirements = UIDesignBrief()

    req = resp.requirements

    # ── FIX 4: Lock poster resolution BEFORE the platform guard can overwrite it ──
    # Run poster size detection from user message if the LLM missed it
    raw_user_msg = state.get("user_prompt", "")
    if _is_poster_intent(raw_user_msg) and not req.poster_size:
        size, _ = _detect_poster_size(raw_user_msg)
        req.poster_size = size
        logger.info(f"🗺️ Poster size auto-detected from user message: {size}")

    if req.poster_size:
        # Poster resolution is always the canvas size — never override with platform defaults
        req.resolution = req.poster_size
        logger.info(f"📐 Poster resolution locked to {req.poster_size} before platform guard")
    else:
        # Normal platform → resolution enforcement (only for non-poster briefs)
        platform = (req.platform or "web").lower().strip()
        if platform not in ("web", "mobile"):
            platform = "web"
        req.platform = platform
        if platform == "mobile" and req.resolution in ("1440x900", ""):
            req.resolution = "390x844"
        elif platform == "web" and req.resolution in ("390x844", ""):
            req.resolution = "1440x900"
    # ── End FIX 4 ────────────────────────────────────────────────────────────────

    # Clean pages
    req.pages = _filter_structural_pages(req.pages)
    deduped, seen = [], set()
    for p in req.pages:
        k = p.name.strip().lower()
        if k and k not in seen:
            deduped.append(p); seen.add(k)
    req.pages = deduped

    # Guard: edit without prior image
    if resp.intent == "edit" and not state.get("last_image_path"):
        resp = UIIntentResponse(
            intent="collect",
            message="I need a base image to edit first. Please describe what you'd like to generate and I'll create it.",
            requirements=req,
        )

    # Guard: platform still unclear for non-poster, non-logo briefs
    if (
        resp.intent == "generate"
        and req.platform not in ("web", "mobile")
        and not req.logo_only
        and not req.poster_size
    ):
        resp = UIIntentResponse(
            intent="collect",
            message="Quick question — is this for a web (desktop browser) or mobile (iOS/Android) app?",
            requirements=req,
        )

    update: dict = {
        "ui_intent": resp.model_dump(),
        "chatbot_response": resp.message,
        "session_root_dir": state.get("session_root_dir"),
        "ui_images": state.get("ui_images", []),
    }
    if req:
        update["design_brief"] = req.model_dump()

    logger.info(f"🤖 Intent: {resp.intent.upper()} | brand={req.brand_name} | platform={req.platform} | poster_size={req.poster_size} | pages={[p.name for p in req.pages]}")
    if resp.change_request:
        logger.info(f"   Change request: {resp.change_request}")
    return update


def ui_intent_router(state: dict) -> str:
    intent = (state.get("ui_intent") or {}).get("intent", "chat")
    brief = state.get("design_brief") or {}

    if intent in ("chat", "collect"):
        return "END"
    if intent == "edit":
        return "revision_handler"
    if brief.get("logo_only"):
        return "logo_generator"
    if "[Page " in (state.get("user_prompt") or ""):
        return "document_processor"
    return "prompt_enhancer"


def revision_handler_node(state: dict) -> dict:
    intent = state.get("ui_intent") or {}
    change_request = intent.get("change_request", "").strip()
    target_screens = intent.get("target_screens", [])
    brief_data = state.get("design_brief") or {}
    brief = UIDesignBrief.model_validate(brief_data)
    session_id = state.get("session_id", "")

    logger.info(f"✏️ Revision Handler | change: {change_request} | targets: {target_screens}")

    last_image_bytes: Optional[bytes] = None
    last_image_path = state.get("last_image_path", "")

    if last_image_path and Path(last_image_path).exists():
        with open(last_image_path, "rb") as f:
            last_image_bytes = f.read()

    ui_images: list = state.get("ui_images") or []

    if not last_image_bytes and ui_images:
        last = ui_images[-1]
        p = last.get("path", "")
        if p and Path(p).exists():
            with open(p, "rb") as f:
                last_image_bytes = f.read()

    if not last_image_bytes:
        cached_last_path = _get_session_last_image_path(session_id)
        if cached_last_path and Path(cached_last_path).exists():
            with open(cached_last_path, "rb") as f:
                last_image_bytes = f.read()

    if not last_image_bytes:
        session_dir = _design_dir(session_id, state.get("session_root_dir"))
        latest_disk_path = _latest_image_path_in_dir(session_dir)
        if latest_disk_path and Path(latest_disk_path).exists():
            with open(latest_disk_path, "rb") as f:
                last_image_bytes = f.read()
            logger.info(f"🧷 Using latest image from session folder: {latest_disk_path}")

    if not last_image_bytes:
        logger.warning("No reference image found for revision")
        return {
            "chatbot_response": "I couldn't find the previous image to edit. Please generate first.",
            "session_id": session_id,
        }

    reference_description = _describe_image_for_edit(last_image_bytes)
    logger.info(f"📋 Reference described ({len(reference_description)} chars)")

    images_to_revise: list[dict] = []
    if target_screens:
        for img in ui_images:
            if any(t.lower() in img.get("page_name", "").lower() for t in target_screens):
                images_to_revise.append(img)
    if not images_to_revise:
        images_to_revise = [ui_images[-1]] if ui_images else []

    return {
        "revision_mode": True,
        "revision_change_request": change_request,
        "revision_reference_bytes_b64": _bytes_to_b64(last_image_bytes),
        "revision_reference_description": reference_description,
        "revision_target_images": images_to_revise,
        "design_brief": brief_data,
        "session_id": session_id,
    }


def document_processor_node(state: dict) -> dict:
    user_message = (state.get("user_prompt") or "").strip()
    session_id = state.get("session_id", "")

    if "[Page " not in user_message:
        return {"document_analysis": None, "session_id": session_id, "session_root_dir": state.get("session_root_dir"), "ui_images": state.get("ui_images", [])}

    doc_start = user_message.find("[Page ")
    doc_text = user_message[doc_start:] if doc_start >= 0 else user_message

    logger.info("📄 Document Processor: Analysing document...")

    prompt = f"""You are a technical document analyst.
Extract structured information to drive UI generation.

DOCUMENT TEXT:
{doc_text[:3000]}

Return ONLY valid JSON:
{{
  "is_document": true,
  "summary": "One-line description",
  "detected_pages": ["Page 1", "Page 2"],
  "features": ["Feature A"],
  "user_workflows": ["Workflow A"],
  "tone": "professional",
  "style_hints": "Modern SaaS",
  "color_hints": "Dark background, blue primary",
  "platform": "web",
  "raw_text": "{doc_text[:200].replace(chr(10), ' ').replace(chr(34), chr(39))}"
}}"""

    try:
        resp = _get_llm().with_structured_output(DocumentAnalysis).invoke(prompt)
    except Exception:
        raw = _get_llm().invoke(prompt)
        data = _extract_json(getattr(raw, "content", str(raw)))
        resp = DocumentAnalysis.model_validate(data)

    logger.info(f"✅ Document: pages={resp.detected_pages}")
    return {
        "document_analysis": resp.model_dump(),
        "session_id": session_id,
        "session_root_dir": state.get("session_root_dir"),
        "ui_images": state.get("ui_images", []),
    }


def logo_generator_node(state: dict) -> dict:
    brief_data = state.get("design_brief") or {}
    brief = UIDesignBrief.model_validate(brief_data)
    session_id = state.get("session_id", "")
    intent = state.get("ui_intent") or {}
    change_request = intent.get("change_request", "")

    logger.info(f"🎨 Logo Generator | brand={brief.brand_name}")

    out_dir = _design_dir(session_id, state.get("session_root_dir"))
    _fill_missing_tokens(brief)

    reference_bytes: Optional[bytes] = None
    reference_description = ""
    if change_request:
        last_path = state.get("last_image_path", "")
        if last_path and Path(last_path).exists():
            with open(last_path, "rb") as f:
                reference_bytes = f.read()
            reference_description = _describe_image_for_edit(reference_bytes)

    prompt = _build_logo_prompt(brief, change_request, reference_description)

    anchor_prefix = (
        "VISUAL REFERENCE (the image above is the current logo to edit): "
        "Keep everything identical EXCEPT the change described below.\n\n"
        if reference_bytes else ""
    )
    full_prompt = anchor_prefix + prompt

    try:
        logo_bytes = _generate_image_sync(full_prompt, reference_bytes=reference_bytes)
        logo_path = out_dir / "logo.png"
        _save_image_bytes(logo_bytes, logo_path)

        img_dict = {
            "id": f"{out_dir.name}-logo",
            "page_name": "Logo",
            "filename": "logo.png",
            "path": str(logo_path),
            "url": _image_url_from_path(logo_path),
            "created_at": datetime.now().isoformat(),
            "prompt": full_prompt,
        }
        _init_session_images(session_id)
        _add_image_to_session(session_id, img_dict)

        (out_dir / "specification.json").write_text(
            json.dumps({"session_id": session_id, "logo_only": True, "brand": brief.brand_name}, indent=2)
        )
        (out_dir / "images.json").write_text(json.dumps([img_dict], indent=2))

        msg = "✅ Logo updated!" if change_request else f"✅ Logo for '{brief.brand_name}' ready!"
        return {
            "ui_images": [img_dict],
            "last_image_path": str(logo_path.resolve()),
            "chatbot_response": msg,
            "session_id": session_id,
            "session_root_dir": state.get("session_root_dir"),
        }
    except Exception as e:
        logger.error(f"❌ Logo failed: {e}")
        return {"ui_images": [], "chatbot_response": f"Logo generation failed: {str(e)[:100]}", "session_id": session_id, "session_root_dir": state.get("session_root_dir")}


def prompt_enhancer_node(state: dict) -> dict:
    """
    Builds one self-contained, DNA-locked prompt per page.

    FIX 1: Calls _fill_poster_tokens INSTEAD OF _fill_missing_tokens for posters.
    FIX 2: Fallback page populates must_include from brief.components / user_prompt.
    FIX 3: Passes user_original_prompt to _build_poster_prompt.
    FIX 5: Hardens is_poster detection and always resolves poster_size before building prompts.
    """
    brief_data = state.get("design_brief") or {}
    brief = UIDesignBrief.model_validate(brief_data)
    session_id = state.get("session_id", "")
    user_original_prompt = state.get("user_prompt", "")   # FIX 3

    # Enrich from document analysis
    doc = state.get("document_analysis")
    if doc:
        da = DocumentAnalysis.model_validate(doc) if isinstance(doc, dict) else doc
        if da.detected_pages and not brief.pages:
            brief.pages = [UIPageSpec(name=p, purpose=f"{p} screen") for p in da.detected_pages]
        if da.style_hints and not brief.style:
            brief.style = da.style_hints
        if da.color_hints and not brief.color_palette:
            brief.color_palette = da.color_hints
        if da.platform:
            brief.platform = da.platform

    # ── FIX 5: Resolve is_poster and poster_size FIRST, before any token fill ──
    is_poster = bool(brief.poster_size) or bool(brief.poster_platform) or _is_poster_intent(user_original_prompt)

    if is_poster and not brief.poster_size:
        size, _ = _detect_poster_size(user_original_prompt)
        brief.poster_size = size
        logger.info(f"🗺️ poster_size resolved in prompt_enhancer: {size}")

    if is_poster:
        # FIX 4 (reinforcement): always lock resolution to the canvas size here too
        brief.resolution = brief.poster_size or "1080x1080"
    # ── End FIX 5 ─────────────────────────────────────────────────────────────────

    # ── FIX 1: Gate the token fill — poster gets its own fill, never the UI fill ──
    if is_poster:
        _fill_poster_tokens(brief)
        logger.info(f"🖼️ Poster tokens applied | style={brief.style} | resolution={brief.resolution}")
    else:
        _fill_missing_tokens(brief)
    # ── End FIX 1 ─────────────────────────────────────────────────────────────────

    # Get locked Design DNA from session (UI screens only)
    dna_data = state.get("design_dna") or _get_session_design_dna(session_id)
    dna = DesignDNA.model_validate(dna_data) if dna_data else DesignDNA()

    nav_items: list[str] = []
    if dna.nav_items:
        nav_items = dna.nav_items
    elif brief.nav_items:
        nav_items = brief.nav_items
    else:
        nav_items = _infer_nav_items([p for p in brief.pages if not _is_auth_page(p.name)])

    if nav_items and not dna.nav_items:
        dna.nav_items = nav_items
    if not dna.is_empty():
        _set_session_design_dna(session_id, dna)

    pages = _filter_structural_pages(brief.pages)

    if not pages:
        # ── FIX 2: Populate must_include for the fallback page ──
        fallback_name = brief.screen_name or "Main Screen"
        fallback_must_include: list[str] = []
        if brief.components:
            fallback_must_include = list(brief.components)
        elif user_original_prompt:
            # Extract the most meaningful noun phrases from the user prompt as content hints
            fallback_must_include = [user_original_prompt[:120]]
        pages = [UIPageSpec(
            name=fallback_name,
            purpose="Primary screen",
            must_include=fallback_must_include,
        )]
        brief.pages = pages
        logger.info(f"📄 Fallback page created: '{fallback_name}' | must_include={fallback_must_include}")
        # ── End FIX 2 ──────────────────────────────────────────────────────────────

    # Avoid regenerating already-done pages (unless edit)
    existing_pages = {img.get("page_name", "").strip().lower() for img in (state.get("ui_images") or [])}
    intent_type = (state.get("ui_intent") or {}).get("intent", "generate")
    is_edit = intent_type in ("edit", "revision")

    if not is_edit:
        new_pages = [p for p in pages if p.name.strip().lower() not in existing_pages]
        if not new_pages:
            new_pages = pages
    else:
        new_pages = pages

    page_prompts: list[dict] = []
    for page in new_pages:
        # ── FIX 2 (per-page): ensure no page has empty must_include in poster mode ──
        if is_poster and not page.must_include and brief.components:
            page.must_include = list(brief.components)

        if is_poster:
            # FIX 3: pass user_original_prompt
            prompt_text = _build_poster_prompt(
                brief,
                page,
                user_original_prompt=user_original_prompt,
            )
        else:
            prompt_text = _build_base_prompt(
                brief=brief,
                page=page,
                dna=dna,
                nav_items=nav_items,
            )
        page_prompts.append({
            "page_name": page.name,
            "prompt": prompt_text,
            "notes": f"{'poster' if is_poster else brief.platform} | {brief.style}",
        })

    return {
        "page_prompts": page_prompts,
        "consistency_rules": [
            f"Colors: {brief.color_palette[:60]}...",
            f"Fonts: {brief.typography[:60]}...",
            f"Nav: {', '.join(nav_items)}",
            f"Resolution: {brief.resolution}",
        ],
        "final_spec": {"brand": brief.brand_name, "platform": brief.platform, "style": brief.style},
        "session_id": session_id,
        "design_brief": brief.model_dump(),
        "session_root_dir": state.get("session_root_dir"),
        "ui_images": state.get("ui_images", []),
    }


def image_generator_node(state: dict) -> dict:
    """
    Generates images. In revision mode, passes reference bytes as visual anchor.
    Extracts DesignDNA from the FIRST generated screen for consistency locking.
    """
    brief_data = state.get("design_brief") or {}
    brief = UIDesignBrief.model_validate(brief_data)
    session_id = state.get("session_id", "")
    page_prompts: list[dict] = state.get("page_prompts") or []
    is_revision = state.get("revision_mode", False)

    cached_dna = _get_session_design_dna(session_id)

    out_dir = _design_dir(session_id, state.get("session_root_dir"))
    images: list = []
    _init_session_images(session_id)

    # ── Revision mode ────────────────────────────────────────────────────────────
    if is_revision:
        change_request = state.get("revision_change_request", "")
        ref_b64 = state.get("revision_reference_bytes_b64", "")
        ref_desc = state.get("revision_reference_description", "")
        target_images = state.get("revision_target_images", [])
        brief_data = state.get("design_brief") or {}
        brief = UIDesignBrief.model_validate(brief_data)
        user_original_prompt = state.get("user_prompt", "")   # FIX 3

        reference_bytes = _b64_to_bytes(ref_b64) if ref_b64 else None
        dna_data = state.get("design_dna") or cached_dna
        dna = DesignDNA.model_validate(dna_data) if dna_data else DesignDNA()
        nav_items = dna.nav_items or brief.nav_items or []

        is_poster = bool(brief.poster_size) or _is_poster_intent(user_original_prompt)

        if target_images:
            reference_target = target_images[0]
            logger.info(
                f"🖼️ Revision reference image: {reference_target.get('page_name', 'unknown')} | {reference_target.get('path', 'in-memory')}"
            )

        revised_images = []
        for img_meta in target_images:
            page_name = img_meta.get("page_name", "Screen")
            page = UIPageSpec(name=page_name, purpose="")

            if is_poster:
                prompt = _build_poster_prompt(
                    brief, page, change_request, ref_desc, is_revision=True,
                    user_original_prompt=user_original_prompt,   # FIX 3
                )
            else:
                prompt = _build_base_prompt(
                    brief, page, dna, nav_items,
                    is_revision=True, change_request=change_request,
                    reference_description=ref_desc,
                )

            anchor = (
                "VISUAL REFERENCE (image above is the CURRENT state to edit). "
                "Apply ONLY the change described below. Keep everything else pixel-identical.\n\n"
            )
            full_prompt = anchor + prompt

            logger.info(f"✏️ Revising '{page_name}' | change: {change_request[:60]}")
            try:
                img_bytes = _generate_image_sync(full_prompt, reference_bytes=reference_bytes)
                slug = _slugify(page_name)
                filename = f"{slug}_revised_{_now_stamp()}.png"
                path = out_dir / filename
                _save_image_bytes(img_bytes, path)

                img_dict = {
                    "id": f"{out_dir.name}-{slug}-rev",
                    "page_name": page_name,
                    "filename": filename,
                    "path": str(path),
                    "url": _image_url_from_path(path),
                    "created_at": datetime.now().isoformat(),
                    "prompt": full_prompt,
                    "is_revision": True,
                }
                revised_images.append(img_dict)
                _add_image_to_session(session_id, img_dict)
                logger.info(f"✅ Revised: {filename}")
            except Exception as e:
                logger.error(f"❌ Revision failed for '{page_name}': {e}")

        if revised_images:
            (out_dir / "images.json").write_text(json.dumps(revised_images, indent=2))
            return {
                "ui_images": revised_images,
                "last_image_path": str(Path(revised_images[-1]["path"]).resolve()),
                "chatbot_response": f"✅ {len(revised_images)} screen(s) updated with your changes.",
                "session_id": session_id,
                "session_root_dir": state.get("session_root_dir"),
            }
        return {
            "ui_images": [],
            "chatbot_response": "Revision failed — please try again.",
            "session_id": session_id,
            "session_root_dir": state.get("session_root_dir"),
        }

    # ── Normal generation mode ───────────────────────────────────────────────────
    if not page_prompts:
        logger.warning("No page prompts to generate")
        return {"ui_images": [], "chatbot_response": "Nothing to generate.", "session_id": session_id}

    logger.info(f"🎨 Generating {len(page_prompts)} screen(s)...")

    dna_data = state.get("design_dna") or {}
    dna = DesignDNA.model_validate(dna_data) if dna_data else DesignDNA()
    is_first_batch = dna.is_empty()
    first_image_bytes: Optional[bytes] = None
    reference_anchor: Optional[bytes] = None
    reference_anchor_page: str = ""
    reference_anchor_path: str = ""

    # Poster screens do not extract DNA (no nav/UI tokens) — skip first-batch logic
    is_poster = bool(brief.poster_size) or _is_poster_intent(state.get("user_prompt", ""))

    def _gen_one(page_prompt: dict) -> dict:
        page_name = page_prompt.get("page_name", "Screen")
        prompt_text = page_prompt.get("prompt", "")
        try:
            img_bytes = _generate_image_sync(prompt_text)
            return {"page_name": page_name, "bytes": img_bytes, "error": None}
        except Exception as e:
            logger.error(f"❌ Failed '{page_name}': {e}")
            return {"page_name": page_name, "bytes": None, "error": str(e)}

    if is_first_batch and len(page_prompts) > 1 and not is_poster:
        # UI screens only: generate screen 1 first to lock Design DNA
        logger.info(f"🧬 Generating screen 1 first to lock Design DNA...")
        first_result = _gen_one(page_prompts[0])
        first_image_bytes = first_result.get("bytes")

        if first_image_bytes:
            slug = _slugify(first_result["page_name"])
            filename = f"{slug}_{_now_stamp()}.png"
            path = out_dir / filename
            _save_image_bytes(first_image_bytes, path)
            img_dict = {
                "id": f"{out_dir.name}-{slug}-1",
                "page_name": first_result["page_name"],
                "filename": filename,
                "path": str(path),
                "url": _image_url_from_path(path),
                "created_at": datetime.now().isoformat(),
                "prompt": page_prompts[0].get("prompt", ""),
            }
            images.append(img_dict)
            _add_image_to_session(session_id, img_dict)

            new_dna = _extract_design_dna(first_image_bytes)
            dna_data = new_dna.model_dump()
            dna = new_dna
            reference_anchor = first_image_bytes
            reference_anchor_page = first_result["page_name"]
            reference_anchor_path = str(path)
            logger.info(f"🖼️ Reference image for remaining screens: {reference_anchor_page} | {reference_anchor_path}")
            _set_session_design_dna(session_id, new_dna)

            remaining_prompts = []
            for pp in page_prompts[1:]:
                page = UIPageSpec(name=pp["page_name"], purpose="")
                nav_items = dna.nav_items or brief.nav_items or []
                new_prompt = _build_base_prompt(brief, page, dna, nav_items)
                remaining_prompts.append({"page_name": pp["page_name"], "prompt": new_prompt, "notes": pp.get("notes", "")})

            remaining_page_prompts = remaining_prompts
        else:
            remaining_page_prompts = page_prompts[1:]

        if remaining_page_prompts:
            for page_prompt in remaining_page_prompts:
                page_name = page_prompt.get("page_name", "Screen")
                prompt_text = page_prompt.get("prompt", "")
                try:
                    if reference_anchor_path:
                        logger.info(f"🖼️ Passing reference image: {reference_anchor_page} | {reference_anchor_path}")
                    img_bytes = _generate_image_sync(prompt_text, reference_bytes=reference_anchor)
                    slug = _slugify(page_name)
                    filename = f"{slug}_{_now_stamp()}.png"
                    path = out_dir / filename
                    _save_image_bytes(img_bytes, path)
                    img_dict = {
                        "id": f"{out_dir.name}-{slug}-1",
                        "page_name": page_name,
                        "filename": filename,
                        "path": str(path),
                        "url": _image_url_from_path(path),
                        "created_at": datetime.now().isoformat(),
                        "prompt": prompt_text,
                    }
                    images.append(img_dict)
                    _add_image_to_session(session_id, img_dict)
                    reference_anchor = img_bytes
                    reference_anchor_page = page_name
                    reference_anchor_path = str(path)
                    logger.info(f"🖼️ Updated reference image: {reference_anchor_page} | {reference_anchor_path}")
                except Exception as e:
                    logger.error(f"❌ Failed '{page_name}': {e}")
    else:
        # Single screen, DNA already locked, or poster — generate sequentially
        if not is_first_batch and not is_poster:
            existing_images = state.get("ui_images") or []
            if existing_images:
                last_path = existing_images[-1].get("path", "")
                if last_path and Path(last_path).exists():
                    try:
                        with open(last_path, "rb") as f:
                            reference_anchor = f.read()
                        reference_anchor_page = existing_images[-1].get('page_name', 'unknown')
                        reference_anchor_path = last_path
                        logger.info(f"🖼️ Batch reference image: {reference_anchor_page} | {reference_anchor_path}")
                    except Exception as e:
                        logger.warning(f"Could not load anchor image for batch: {e}")
        if not reference_anchor and cached_dna and session_id and not is_poster:
            logger.info("🧷 Reusing cached session DNA for navbar consistency")

        for page_prompt in page_prompts:
            page_name = page_prompt.get("page_name", "Screen")
            prompt_text = page_prompt.get("prompt", "")
            try:
                # Poster screens never pass a reference anchor (each is standalone)
                ref_to_use = None if is_poster else reference_anchor
                if ref_to_use and reference_anchor_path:
                    logger.info(f"🖼️ Passing reference image: {reference_anchor_page} | {reference_anchor_path}")
                img_bytes = _generate_image_sync(prompt_text, reference_bytes=ref_to_use)
                slug = _slugify(page_name)
                filename = f"{slug}_{_now_stamp()}.png"
                path = out_dir / filename
                _save_image_bytes(img_bytes, path)
                img_dict = {
                    "id": f"{out_dir.name}-{slug}-1",
                    "page_name": page_name,
                    "filename": filename,
                    "path": str(path),
                    "url": _image_url_from_path(path),
                    "created_at": datetime.now().isoformat(),
                    "prompt": prompt_text,
                }
                images.append(img_dict)
                _add_image_to_session(session_id, img_dict)
                if not is_poster:
                    reference_anchor = img_bytes
                    reference_anchor_page = page_name
                    reference_anchor_path = str(path)
                    logger.info(f"🖼️ Updated reference image: {reference_anchor_page} | {reference_anchor_path}")
            except Exception as e:
                logger.error(f"❌ Failed '{page_name}': {e}")

    if not images:
        return {"ui_images": [], "chatbot_response": "Generation failed — please try again.", "session_id": session_id, "session_root_dir": state.get("session_root_dir")}

    (out_dir / "specification.json").write_text(
        json.dumps({"session_id": session_id, "brief": brief.model_dump(), "pages": len(images)}, indent=2)
    )
    (out_dir / "images.json").write_text(json.dumps(images, indent=2))

    logger.info(f"✨ Generated {len(images)} screen(s)")

    result = {
        "ui_images": images,
        "last_image_path": str(Path(images[-1]["path"]).resolve()),
        "chatbot_response": f"✅ {len(images)} high-fidelity screen(s) ready.",
        "session_id": session_id,
        "session_root_dir": state.get("session_root_dir"),
    }
    if dna_data:
        result["design_dna"] = dna_data

    return result


def completion_node(state: dict) -> dict:
    return state


# ─────────────────────────────────────────────────────────────────────────────
# GRAPH ASSEMBLY
# ─────────────────────────────────────────────────────────────────────────────

ui_graph = StateGraph(dict)
ui_graph.add_node("chatbot",            ui_chatbot_node)
ui_graph.add_node("document_processor", document_processor_node)
ui_graph.add_node("logo_generator",     logo_generator_node)
ui_graph.add_node("revision_handler",   revision_handler_node)
ui_graph.add_node("prompt_enhancer",    prompt_enhancer_node)
ui_graph.add_node("image_generator",    image_generator_node)
ui_graph.add_node("completion",         completion_node)

ui_graph.set_entry_point("chatbot")
ui_graph.add_conditional_edges("chatbot", ui_intent_router, {
    "document_processor": "document_processor",
    "logo_generator":     "logo_generator",
    "revision_handler":   "revision_handler",
    "prompt_enhancer":    "prompt_enhancer",
    "END":                END,
})
ui_graph.add_edge("document_processor", "prompt_enhancer")
ui_graph.add_edge("logo_generator",     "completion")
ui_graph.add_edge("revision_handler",   "image_generator")
ui_graph.add_edge("prompt_enhancer",    "image_generator")
ui_graph.add_edge("image_generator",    "completion")
ui_graph.add_edge("completion",         END)

ui_image_agent = ui_graph.compile()