import asyncio
import base64
import io
import json
import logging
import os
import re
import threading
from datetime import datetime
from pathlib import Path
from typing import Literal, Optional
from concurrent.futures import ThreadPoolExecutor, as_completed

from dotenv import load_dotenv
from google import genai
from langchain_core.messages import HumanMessage
from langchain_google_genai import ChatGoogleGenerativeAI
from langgraph.constants import END
from langgraph.graph import StateGraph
from pydantic import BaseModel, Field
from PIL import Image

load_dotenv()

# Configure logging to file and console
log_dir = Path(__file__).resolve().parent.parent.parent / "logs"
log_dir.mkdir(parents=True, exist_ok=True)
log_file = log_dir / f"ui_designer_{datetime.now().strftime('%Y%m%d_%H%M%S')}.log"

# Clear existing handlers and set up new ones
logging.getLogger().handlers.clear()
logging.basicConfig(
    level=logging.DEBUG,
    format="%(asctime)s | %(name)s | %(levelname)-8s | %(message)s",
    handlers=[
        logging.FileHandler(log_file, encoding='utf-8'),
        logging.StreamHandler(),
    ]
)
logger = logging.getLogger(__name__)
logger.info(f"🚀 UI Designer Agent Started - Log file: {log_file}")
from google import genai
from langchain_core.messages import HumanMessage
from langchain_google_genai import ChatGoogleGenerativeAI
from langgraph.constants import END
from langgraph.graph import StateGraph
from pydantic import BaseModel, Field
from PIL import Image

load_dotenv()

llm = ChatGoogleGenerativeAI(model="gemini-2.5-flash")

# Track images being generated per session (for streaming to frontend)
_session_images: dict = {}  # session_id -> {"images": [], "lock": threading.Lock()}


# ─────────────────────────────────────────────────────────────────────────────
# PYDANTIC MODELS
# ─────────────────────────────────────────────────────────────────────────────

class UIPageSpec(BaseModel):
    name: str = Field(..., description="Page name, e.g. Sign Up")
    purpose: str = Field("", description="What this page is for")
    must_include: list[str] = Field(default_factory=list)
    avoid: list[str] = Field(default_factory=list)


class UIDesignBrief(BaseModel):
    screen_name: str = Field("Sign Up Page")
    platform: str = Field("web")          # "web" | "mobile"
    layout: str = Field("centered form")
    components: list[str] = Field(default_factory=list)
    style: str = Field("modern, clean, professional")
    color_palette: str = Field("")         # hex values
    typography: str = Field("")            # font names + weights
    copy_tone: str = Field("professional")
    constraints: list[str] = Field(default_factory=list)
    resolution: str = Field("1440x900")   # 1440x900 web | 390x844 mobile
    num_images: int = Field(1)
    brand_name: str = Field("")
    pages: list[UIPageSpec] = Field(default_factory=list)
    skip_pages: list[str] = Field(default_factory=list)
    nav_items: list[str] = Field(default_factory=list)
    logo_only: bool = Field(False)  # Generate only logo, no UI screens
    logo_description: str = Field("")  # Detailed logo requirements


class UIIntentResponse(BaseModel):
    intent: Literal["chat", "collect", "generate", "edit"]
    message: str
    requirements: Optional[UIDesignBrief] = None
    missing_fields: list[str] = Field(default_factory=list)
    change_request: str = ""


class PagePrompt(BaseModel):
    page_name: str
    prompt: str
    notes: str = ""


class UIPromptSpec(BaseModel):
    image_prompt: str
    page_prompts: list[PagePrompt] = Field(default_factory=list)
    consistency_rules: list[str]
    final_spec: dict = Field(default_factory=dict)


class DocumentAnalysis(BaseModel):
    is_document: bool = Field(False)
    summary: str = Field("")
    detected_pages: list[str] = Field(default_factory=list)
    features: list[str] = Field(default_factory=list)
    user_workflows: list[str] = Field(default_factory=list)
    user_roles: list[str] = Field(default_factory=list)
    tone: str = Field("professional")
    style_hints: str = Field("")
    color_hints: str = Field("")
    platform: str = Field("web")
    raw_text: str = Field("")


# ─────────────────────────────────────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────────────────────────────────────

def _now_stamp() -> str:
    return datetime.now().strftime("%Y%m%d_%H%M%S")


def _design_root() -> Path:
    root = Path(__file__).resolve().parent / "ui_designs"
    root.mkdir(parents=True, exist_ok=True)
    return root


def _design_dir(session_id: str) -> Path:
    name = f"design_{_now_stamp()}"
    if session_id:
        safe = session_id.replace("session-", "")[-6:]
        if safe:
            name = f"{name}_{safe}"
    path = _design_root() / name
    path.mkdir(parents=True, exist_ok=True)
    return path


def _image_url_from_path(path: Path) -> str:
    rel = path.relative_to(Path(__file__).resolve().parent)
    return f"/{rel.as_posix()}"


def _slugify(value: str) -> str:
    safe = "".join(ch.lower() if ch.isalnum() else "-" for ch in value.strip())
    while "--" in safe:
        safe = safe.replace("--", "-")
    return safe.strip("-") or "page"


def _filter_pages(brief: UIDesignBrief) -> list[UIPageSpec]:
    skip = {n.strip().lower() for n in brief.skip_pages if n.strip()}
    if not skip:
        return list(brief.pages)
    return [p for p in brief.pages if p.name.strip().lower() not in skip]


def _should_ignore_last_brief(user_message: str) -> bool:
    text = (user_message or "").strip().lower()
    if not text:
        return False

    reset_hints = (
        "start over",
        "from scratch",
        "new project",
        "new design",
        "fresh design",
        "fresh page",
        "fresh screen",
    )
    if any(hint in text for hint in reset_hints):
        return True

    additive_hints = (" also ", " as well", " plus ", " additional", " another", " add ")
    if any(hint in f" {text} " for hint in additive_hints):
        return False

    multi_page_hints = (
        "pages",
        "screens",
        "sections",
        "landing page",
        "dashboard",
        "flow",
        "full website",
    )
    if any(hint in text for hint in multi_page_hints):
        return False

    single_prefixes = ("make a ", "generate a ", "create a ", "design a ")
    if text.startswith(single_prefixes):
        return True

    return len(text.split()) <= 14


def _is_structural_page_name(page_name: str) -> bool:
    name = (page_name or "").strip().lower()
    structural = {
        "navbar",
        "nav bar",
        "navigation",
        "navigation bar",
        "top nav",
        "topbar",
        "top bar",
        "sidebar",
        "side bar",
        "menu",
    }
    return name in structural


def _is_spec_page_name(page_name: str) -> bool:
    name = (page_name or "").strip().lower()
    blocked_tokens = (
        "style guide",
        "design system",
        "token",
        "typography",
        "color palette",
        "ui kit",
        "component spec",
        "spec",
    )
    return any(token in name for token in blocked_tokens)


def _clean_spec_like_text(items: list[str]) -> list[str]:
    if not items:
        return []
    blocked_tokens = (
        "color palette",
        "typography",
        "font",
        "design token",
        "hex",
        "spec",
        "style guide",
        "ui kit",
        "token legend",
    )
    cleaned: list[str] = []
    for item in items:
        text = (item or "").strip()
        if not text:
            continue
        lower = text.lower()
        if any(token in lower for token in blocked_tokens):
            continue
        cleaned.append(text)
    return cleaned


def _infer_single_page_from_prompt(user_message: str) -> str:
    text = (user_message or "").strip().lower()
    if not text:
        return ""

    keyword_map = [
        ("sign up", "Sign Up"),
        ("signup", "Sign Up"),
        ("register", "Sign Up"),
        ("login", "Login"),
        ("log in", "Login"),
        ("forgot password", "Forgot Password"),
        ("reset password", "Reset Password"),
        ("pricing", "Pricing"),
        ("faq", "FAQ"),
        ("contact", "Contact"),
        ("checkout", "Checkout"),
        ("dashboard", "Dashboard"),
        ("profile", "Profile"),
    ]
    for token, name in keyword_map:
        if token in text:
            return name

    match = re.search(r"(?:make|generate|create|design)\s+a\s+([a-z0-9\-\s]{2,30})\s+(?:page|screen)\b", text)
    if match:
        raw = " ".join(match.group(1).split())
        return raw.title()

    return ""


def _expand_landing_sections(brief: UIDesignBrief, user_message: str) -> UIDesignBrief:
    """Expand a single section-heavy landing page into multiple screen specs.

    This prevents one giant collage-style page when the brief clearly contains
    many distinct landing sections.
    """
    if len(brief.pages) != 1:
        return brief

    page = brief.pages[0]
    page_name = page.name.strip().lower()
    if page_name not in {"landing page", "home page", "homepage"}:
        return brief

    must = [m.strip() for m in page.must_include if m and m.strip()]
    if len(must) < 6:
        return brief

    single_page_hints = ("single page", "one page", "one-screen", "single screen")
    if any(hint in (user_message or "").lower() for hint in single_page_hints):
        return brief

    section_map = [
        ("hero", "Hero"),
        ("social", "Social Proof"),
        ("feature", "Features"),
        ("product", "Product Showcase"),
        ("metric", "Metrics"),
        ("workflow", "Workflow"),
        ("testimonial", "Testimonials"),
        ("pricing", "Pricing"),
        ("faq", "FAQ"),
        ("final cta", "Final CTA"),
        ("cta", "Final CTA"),
        ("footer", "Footer"),
        ("navbar", "Navbar"),
        ("navigation", "Navbar"),
    ]

    expanded_names: list[str] = []
    seen: set[str] = set()
    for item in must:
        item_lower = item.lower()
        for token, mapped in section_map:
            if token in item_lower:
                key = mapped.lower()
                if key not in seen:
                    expanded_names.append(mapped)
                    seen.add(key)
                break

    # Keep structural sections out unless explicitly requested as standalone pages.
    explicit_structural_request = any(
        token in (user_message or "").lower()
        for token in ("navbar only", "navigation only", "header only", "sidebar only")
    )
    if not explicit_structural_request:
        expanded_names = [n for n in expanded_names if n.lower() != "navbar"]

    if len(expanded_names) < 4:
        return brief

    brief.pages = [UIPageSpec(name=name, purpose=f"{name} section") for name in expanded_names]
    return brief


def _sanitize_requirements_for_request(brief: UIDesignBrief, user_message: str, ignore_last_brief: bool) -> UIDesignBrief:
    brief = _expand_landing_sections(brief, user_message)

    explicit_structural_request = any(
        token in (user_message or "").lower()
        for token in ("navbar only", "navigation only", "header only", "sidebar only")
    )

    if brief.pages and not explicit_structural_request:
        brief.pages = [
            p for p in brief.pages
            if not _is_structural_page_name(p.name) and not _is_spec_page_name(p.name)
        ]

    for page in brief.pages:
        page.must_include = _clean_spec_like_text(page.must_include)
        page.avoid = _clean_spec_like_text(page.avoid)

    deduped_pages: list[UIPageSpec] = []
    seen: set[str] = set()
    for page in brief.pages:
        key = page.name.strip().lower()
        if not key or key in seen:
            continue
        deduped_pages.append(page)
        seen.add(key)
    brief.pages = deduped_pages

    requested_single = _infer_single_page_from_prompt(user_message)
    if requested_single and (ignore_last_brief or len(brief.pages) > 1):
        chosen = next((p for p in brief.pages if p.name.strip().lower() == requested_single.lower()), None)
        if chosen is None:
            chosen = UIPageSpec(name=requested_single, purpose=f"{requested_single} screen")
        brief.pages = [chosen]
        brief.screen_name = requested_single
        brief.nav_items = []

    return brief


def _extract_json(text: str) -> dict:
    if not text:
        raise ValueError("Empty response")
    if text.strip().startswith("```"):
        parts = text.splitlines()
        text = "\n".join(parts[1:-1] if parts[-1].strip() == "```" else parts[1:])
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end == -1:
        raise ValueError("No JSON found")
    return json.loads(text[start: end + 1])


def _format_chat_history(chat_history: Optional[list[dict]], max_messages: int = 20) -> str:
    if not chat_history:
        return "[]"

    lines: list[str] = []
    for msg in chat_history[-max_messages:]:
        role = str(msg.get("role", "unknown")).strip().lower() or "unknown"
        content = str(msg.get("content", "")).strip()
        if not content:
            continue
        lines.append(f"- {role}: {content}")

    return "\n".join(lines) if lines else "[]"


# ─────────────────────────────────────────────────────────────────────────────
# SESSION IMAGE STREAMING HELPERS
# ─────────────────────────────────────────────────────────────────────────────

def _init_session_images(session_id: str) -> None:
    if session_id not in _session_images:
        _session_images[session_id] = {"images": [], "lock": threading.Lock()}


def _add_image_to_session(session_id: str, image_dict: dict) -> None:
    _init_session_images(session_id)
    with _session_images[session_id]["lock"]:
        _session_images[session_id]["images"].append(image_dict)


def _get_and_clear_session_images(session_id: str) -> list:
    if session_id not in _session_images:
        return []
    with _session_images[session_id]["lock"]:
        images = _session_images[session_id]["images"][:]
        _session_images[session_id]["images"].clear()
    return images


def _cleanup_session_images(session_id: str) -> None:
    if session_id in _session_images:
        del _session_images[session_id]


# ─────────────────────────────────────────────────────────────────────────────
# PROMPT BUILDERS
# ─────────────────────────────────────────────────────────────────────────────

def _build_intent_prompt(user_message: str, last_brief: Optional[dict], chat_history: Optional[list[dict]] = None) -> str:
    brief_text = json.dumps(last_brief, indent=2) if last_brief else "{}"
    history_text = _format_chat_history(chat_history)
    return f"""
You are an elite UI/UX design director. Parse the user request and produce a precise design brief.

USER MESSAGE:
{user_message}

RECENT SESSION CHAT HISTORY (newest at bottom):
{history_text}

LAST KNOWN DESIGN BRIEF (may be empty):
{brief_text}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
INTENT OPTIONS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- chat    → user is asking a general question
- collect → user wants a design but required info is missing
- generate → user has given enough to generate UI images
- edit   → user wants to change the latest generated image

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
REFERENCE IMAGE RULE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
If user_message starts with [REFERENCE IMAGE ANALYSIS]:
  - Auto-fill color_palette and typography from the analysis
  - Do NOT ask the user for colors or fonts again

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DOCUMENT RULE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
If user_message contains "[Page " markers it is extracted document text.
  - Always set intent: "generate"
  - Infer pages from section headings and workflows
  - Infer platform, style, colors from document context

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
LOGO RULE — detect logo-only requests
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
If user_message asks to "design a logo", "create a logo", "make a logo", "logo for":
  - Set intent: "generate"
  - Set logo_only: true
  - Extract brand_name
  - Capture all logo requirements in logo_description
  - Do NOT create pages or navigation items
  - Focus ONLY on logo generation with style/color/composition details

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
LAST_BRIEF_RULE — when to use or ignore previous design
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
IGNORE the LAST_KNOWN_DESIGN_BRIEF (start fresh) if:
  - User says: "make a [page name]" or "generate a [page name]" (no "also", "as well", "plus", "add", "additional")
  - User's request is very short (< 15 words) and doesn't mention previous pages
  - User is requesting ONE specific screen or a completely different product

USE the LAST_KNOWN_DESIGN_BRIEF (add/modify) only if:
  - User explicitly says "also", "as well", "plus", "add", "additional", "another", "more"
  - User references previous context ("for the admin dashboard we already made...")
  - User is clearly building on top of what was created before

EXAMPLE:
- "make a signup screen" → IGNORE last_brief, create ONE new screen for signup
- "make a signup screen as well" → USE last_brief, add signup to existing pages
- "Generate web UI for a new project" → IGNORE last_brief
- "Also add a signup screen to the admin dashboard" → USE last_brief, add signup

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PLATFORM — MANDATORY FIELD
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
platform MUST be exactly "web" or "mobile". No other value is valid.
  "web"    → 1440x900 resolution, mouse/keyboard, sidebar or topbar navigation
  "mobile" → 390x844 resolution (iPhone 14), touch-first, bottom tab or top app-bar navigation
If platform is ambiguous → set intent "collect" and ask: "Is this for web (desktop) or mobile (iOS/Android)?"
Set resolution automatically:
  web    → "1440x900"
  mobile → "390x844"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ALL REQUIRED FIELDS FOR intent: "generate"
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. screen_name   — descriptive name for the product / primary screen
2. platform      — "web" or "mobile" only
3. resolution    — auto-set from platform (do not leave default)
4. layout        — specific structural description
5. style         — named premium design system (see STYLE GUIDE below)
6. color_palette — exact hex values for ALL color tokens
7. typography    — specific font families with weights and sizes
8. copy_tone     — e.g. "professional", "energetic", "minimal"
9. components    — exhaustive list of every UI element on any page
10. pages        — list of page specs
11. nav_items    — navigation labels to show (may be fewer than pages). If user does not provide nav_items, infer a clean subset (exclude auth-only pages like login/forgot/reset/registration/2FA).

PAGE LIST QUALITY RULE:
- Do NOT add standalone pages named "Navbar", "Navigation", "Header", or "Sidebar" unless the user explicitly asks to design those as separate screens.
- Treat navbar/header/sidebar as layout components inside pages, not as independent pages.

SESSION MEMORY RULE:
- Use RECENT SESSION CHAT HISTORY and LAST_KNOWN_DESIGN_BRIEF to avoid asking for information the user already provided earlier in this session.
- Ask follow-up questions only for genuinely missing or conflicting fields.

If ANY field is missing or vague → set intent "collect", ask ONE targeted question.

DEFAULTING RULE FOR STYLE FIELDS:
- If brand_name, color_palette, or typography are missing, do NOT block generation and do NOT ask follow-up just for those fields.
- Set intent to "generate" and let backend defaults populate missing style tokens.
- Use "collect" only when platform/scope is ambiguous or critical requirements conflict.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STYLE GUIDE — always pick a named system
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Web styles:
  "luxury fintech dark"         bg near-black, gold/indigo, glassmorphism cards
  "editorial minimal light"     white bg, one bold accent, dense editorial type
  "neo-brutalist"               raw borders, bold black type, high contrast
  "soft SaaS light"             white, indigo primary, generous rounded cards
  "corporate premium dark"      charcoal, teal/cyan, data-dense tables
  "vibrant consumer"            gradient bg, saturated colors, playful fonts

Mobile styles:
  "iOS premium dark"            #1C1C1E bg, SF Pro, blur cards, iOS nav
  "iOS minimal light"           #F2F2F7 bg, system blue, clean spacing
  "Material You vibrant"        dynamic color, M3 components, bold icons
  "neon gaming mobile"          black bg, neon accents, bold display font
  "health wellness pastel"      soft pink/green, rounded, friendly type
  "fintech mobile dark"         dark navy, gold, data-forward

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
OUTPUT JSON SCHEMA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{{
  "intent": "generate",
  "message": "Brief friendly response to user",
  "requirements": {{
    "screen_name": "Vaultly",
    "platform": "mobile",
    "layout": "Full-screen with bottom tab navigation (5 tabs), scrollable content areas",
    "components": ["bottom tab bar", "balance card", "transaction list", "avatar", "quick action buttons"],
    "style": "fintech mobile dark",
    "color_palette": "bg:#0D0D0D surface:#1A1A2E primary:#6C63FF accent:#FFD700 text:#FFFFFF muted:#8E8E93 border:#2C2C2E success:#30D158 error:#FF453A",
    "typography": "Display: SF Pro Display 700 32px, Heading: SF Pro Display 600 24px, Body: SF Pro Text 400 16px, Caption: SF Pro Text 400 12px",
    "copy_tone": "confident and premium",
    "constraints": ["safe area insets", "44dp minimum tap targets"],
    "resolution": "390x844",
    "num_images": 1,
    "brand_name": "Vaultly",
        "nav_items": ["Home", "Send Money", "Cards", "Insights", "Settings"],
    "pages": [
      {{"name": "Home", "purpose": "Balance overview and recent transactions", "must_include": ["balance card", "quick actions", "recent transactions"], "avoid": ["clutter"]}},
      {{"name": "Send Money", "purpose": "Transfer funds to contacts", "must_include": ["contact picker", "amount input keypad", "send CTA"], "avoid": []}}
    ],
    "skip_pages": [],
    "logo_only": false,
    "logo_description": ""
  }},
  "missing_fields": [],
  "change_request": ""
}}
"""


def _nav_items_from_pages(pages: list[UIPageSpec]) -> list[str]:
    items: list[str] = []
    seen: set[str] = set()
    for page in pages:
        name = page.name.strip()
        if not name:
            continue
        key = name.lower()
        if key in seen:
            continue
        items.append(name)
        seen.add(key)
    return items


def _infer_nav_items(pages: list[UIPageSpec]) -> list[str]:
    items = _nav_items_from_pages(pages)
    if not items:
        return items
    exclude_tokens = {
        "login", "sign in", "signin", "register", "registration", "sign up", "signup",
        "forgot password", "password reset", "reset", "2fa", "two-factor",
        "verify", "verification", "onboarding",
    }
    filtered: list[str] = []
    for name in items:
        lower = name.lower()
        if any(token in lower for token in exclude_tokens):
            continue
        filtered.append(name)
    return filtered or items


def _is_auth_page(page_name: str) -> bool:
    """Check if a page is an auth/onboarding screen (no navigation)."""
    auth_tokens = {
        "login", "sign in", "signin", "register", "registration", "sign up", "signup",
        "forgot password", "password reset", "reset password", "password recovery",
        "2fa", "two-factor", "2factor", "verify", "verification", "onboarding",
    }
    lower = page_name.lower()
    return any(token in lower for token in auth_tokens)


def _pick_active_nav_item(page_name: str, nav_items: list[str]) -> str:
    """Pick a valid active nav label from the locked nav list."""
    if not nav_items:
        return ""

    page_lower = page_name.lower()
    for item in nav_items:
        if item.lower() == page_lower:
            return item

    for item in nav_items:
        token = item.lower().strip()
        if token and token in page_lower:
            return item

    # If no reliable match exists, keep no active item.
    return ""


def _compact_components(components: list[str], max_items: int = 12) -> list[str]:
    """Keep a compact unique component list to avoid prompt bloat and rendered spec leakage."""
    seen: set[str] = set()
    compact: list[str] = []
    for item in components:
        text = item.strip()
        if not text:
            continue
        key = text.lower()
        if key in seen:
            continue
        seen.add(key)
        compact.append(text)
        if len(compact) >= max_items:
            break
    return compact


def _is_poster_request(brief: UIDesignBrief, pages: list[UIPageSpec], user_prompt: str = "") -> bool:
    """
    Detect poster intent conservatively.
    We prefer false-negative over false-positive, because false-positive turns full UI prompts
    into poster composites and breaks website generation.
    """
    explicit_poster_tokens = {
        "poster", "flyer", "brochure", "print ad", "event poster", "movie poster",
        "festival poster", "sale poster", "announcement poster", "a4", "a3",
    }
    social_graphic_tokens = {
        "instagram post", "social post", "linkedin post", "facebook post", "thumbnail",
        "story cover", "reel cover", "ad creative",
    }
    ui_tokens = {
        "website", "web ui", "ui", "landing page", "landing", "navbar", "hero",
        "footer", "faq", "pricing", "testimonials", "product showcase", "dashboard",
        "screen", "section", "responsive", "conversion", "cta",
    }

    signals: list[str] = [brief.screen_name, brief.layout, brief.style, user_prompt]
    signals.extend(brief.components)
    signals.extend(p.name for p in pages)
    combined = " ".join(s.lower() for s in signals if s)

    has_explicit_poster = any(token in combined for token in explicit_poster_tokens)
    has_social_graphic = any(token in combined for token in social_graphic_tokens)
    has_ui_signal = any(token in combined for token in ui_tokens)

    # If user is clearly asking for website/app UI, do not route to poster mode.
    if has_ui_signal and not has_explicit_poster:
        return False

    # Poster mode only when explicit poster language is present, or clearly social-graphic intent
    # with no UI-language conflict.
    return has_explicit_poster or (has_social_graphic and not has_ui_signal)


def _build_logo_prompt(brief: UIDesignBrief) -> str:
    """Build prompt for logo generation."""
    return f"""Generate a professional, modern logo for '{brief.brand_name or 'this product'}'.

STYLE: {brief.style}
COLOR PALETTE: {brief.color_palette}
TYPOGRAPHY: {brief.typography}

Design requirements:
- Logo should be memorable, clean, and scalable
- Use the brand colors and style from the design system above
- Render as a standalone logo (square format, 512x512 pixels)
- No background, transparent or solid surface color background
- Can be icon-only, text-only, or a combination
- Must look professional and premium

CRITICAL RULES:
- Do NOT include any text labels, descriptions, or spec information
- Render ONLY the logo itself
- The result must be a clean, professional logo ready for production use
"""


def _build_auth_spec_block(brief: UIDesignBrief) -> str:
    """Build minimal spec for auth-only screens (no navigation)."""
    is_mobile = brief.platform == "mobile"
    layout_line = (
        f"Render as a flat {brief.resolution} portrait mobile app canvas (edge-to-edge UI only). "
        "Do NOT render a phone device frame, bezel, notch, physical buttons, drop shadow, or outer background. "
        "Do NOT render OS status bar elements (time, battery, signal). "
        "The app UI must fill the entire canvas from edge to edge with no outer margin or inset container."
        if is_mobile
        else f"Render as a {brief.resolution} desktop browser screenshot."
    )

    return f"""Render a high-fidelity, production-quality UI screenshot of {brief.brand_name or 'this product'}.

VISUAL STYLE: {brief.style}

LAYOUT:
{layout_line}
Show a centered form or modal dialog. No sidebar, no navigation bar. The form is the entire focus.

    VISUAL SYSTEM APPLICATION:
    - Apply the locked color and typography system consistently across all UI elements.
    - Keep this invisible to users: never render style tokens, font specs, color codes, or measurement values as visible text.

COMPONENT STANDARDS:
- Cards: rounded corners, surface-color background, soft shadow, generous padding
- Primary button: filled with primary color, white text
- Input fields: subtle border, surface background, placeholder text in muted color
- Spacing: consistent and even

CRITICAL RENDERING RULES:
- Do NOT show any hex codes, font names, measurements, size indicators, or spec labels anywhere
- Do NOT draw annotation arrows, dimension lines, or any design-tool text
- Render ONLY what an end-user would see in a real product
- The result must look like a real screenshot, not a mockup or wireframe
- For mobile: output only the in-app screen canvas, never a handset mockup
- Never render a style-guide/spec panel (no color swatches, no typography specimen list, no token tables)
- Never render literal labels such as "Color palette", "Typography", "Display", "Heading", "Body", or "Caption"
- For mobile: no nested frames or inset previews (never place a phone screen inside another canvas)
- The UI must occupy 100% of the image area; no blank margins around a centered preview
"""


def _build_poster_spec_block(brief: UIDesignBrief, components: list[str]) -> str:
    component_inventory = ", ".join(components) if components else ""
    return f"""Render a high-fidelity, production-quality marketing poster for {brief.brand_name or 'this brand'}.

VISUAL STYLE: {brief.style}

CANVAS:
- Render as a flat poster canvas at {brief.resolution}
- Do NOT render any mobile device frame, iOS status bar, browser chrome, app shell, navigation tabs, or sidebars
- This is poster artwork, not an app screenshot

COLOR PALETTE — use these exact colors:
{brief.color_palette}

TYPOGRAPHY — use these fonts and styles:
{brief.typography}

POSTER COMPONENT INVENTORY:
{component_inventory}

COMPOSITION RULES:
- Strong visual hierarchy with clear focal point
- Balanced spacing and alignment for print/social readability
- Rich, polished background treatment (gradient/texture/illustration as appropriate)
- Include realistic, production-ready typography and decorative elements
- Use cinematic lighting, rich texture, and intentional depth so the result feels premium and handcrafted
- Keep text concise and impactful; avoid long paragraphs unless explicitly requested

CRITICAL RENDERING RULES:
- Do NOT draw any hex codes, font names, measurements, or annotation text
- Do NOT draw wireframe overlays, arrows, or dimension lines
- Render only finished poster artwork suitable for social media or print
- Do NOT render literal spec strings such as font tokens (e.g. "SF Pro Text 400 18px")
- Do NOT render mobile status bars, tab bars, navigation labels, or app-like UI controls
"""


def _build_brand_spec_block(brief: UIDesignBrief, nav_items: list[str], components: list[str]) -> str:
    """
    Build the LOCKED brand spec block prepended to EVERY page prompt.
    Written as PROSE describing what to render — NOT as spec labels the
    image model might draw as visible text annotations.
    """
    is_mobile = brief.platform.lower() == "mobile"

    nav_labels = ", ".join(nav_items) if nav_items else ""
    nav_count = len(nav_items)
    component_inventory = ", ".join(components) if components else ""

    if is_mobile:
        nav_description = (
            "At the bottom of the screen sits a fixed bottom tab bar with evenly spaced tabs. "
            "Each tab has a simple icon above a short label. "
            "The active tab icon and label use the primary color; inactive ones use the muted color. "
            "The tab bar background matches the surface color with a subtle top divider. "
            f"Tab labels (left to right) are exactly: {nav_labels}. Use exactly {nav_count} tabs."
        )
        layout_description = (
            f"Render as a flat {brief.resolution} portrait mobile app canvas (edge-to-edge UI only). "
            "Do NOT render a phone device frame, bezel, notch, hardware buttons, drop shadow, or outer background. "
            "Do NOT render OS status bar elements (time, battery, signal). "
            "Respect safe content spacing. Content scrolls above the bottom tab bar. "
            "The app interface must fill the entire frame with no inset mockup, border matte, or centered preview card."
        )
    else:
        nav_description = (
            "On the left side of the screen is a fixed sidebar with the brand logo at the top. "
            "Below are vertical navigation items with an icon and label. "
            "The active item is highlighted using the primary color. "
            "Inactive items use the muted text color. The sidebar background is the surface color. "
            f"Navigation labels (top to bottom) are exactly: {nav_labels}. Use exactly {nav_count} items. "
            "Do NOT add a second navigation system. No top navbar links."
        )
        layout_description = (
            f"Render as a {brief.resolution} desktop application UI (not a browser screenshot). "
            "No browser chrome, no tabs, no address bar — just the app interface. "
            "The main layout is the sidebar on the left and the content area filling the rest. "
            "Use ONLY the left sidebar for navigation."
        )

    return f"""Render a high-fidelity, production-quality UI screenshot of {brief.brand_name or 'this product'}.

VISUAL STYLE: {brief.style}

LAYOUT:
{layout_description}

    VISUAL SYSTEM APPLICATION:
    - Apply the locked design system consistently for color, contrast, typography, spacing, and hierarchy.
    - Keep all internal style specs invisible: never render token names, font specs, color codes, or sizing values.

NAVIGATION:
{nav_description}

COMPONENT STANDARDS — keep component styling consistent across all screens:
- Cards: rounded corners, surface-color background, soft shadow, generous padding
- Primary button: filled with primary color, white text, consistent radius and height
- Secondary button: transparent background with primary-color border, same radius and height as primary
- Input fields: subtle border, surface background, comfortable padding, muted placeholder text
- Icons: consistent line style and size
- Spacing: consistent grid rhythm with even gaps

CONTENT: Show a fully populated, realistic screen. Use plausible names, real-looking numbers, and authentic dates. No "Lorem ipsum", no "User Name", no placeholder text of any kind.

CRITICAL RENDERING RULES:
- Do NOT draw any hex codes, font names, measurements, or spec labels anywhere on the image
- The image should be clean and polished, as if taken from a real product — no design tool overlays, no annotation arrows, no dimension lines
- Do NOT draw annotation arrows, dimension lines, or any design-tool overlays
- Render ONLY what an end-user would see in the live product
- The result must look like a real screenshot from a shipped product, not a mockup or wireframe
- Never render literal spec tokens like: "Inter", "Montserrat", "Section Title", "Body", "Caption", "px", or "#00C6FB"
- Never render internal guidance words like: "component inventory", "must include", "purpose", or "screen name"
- For mobile screens: output only the app canvas, never a physical phone mockup
- Never render a style-guide/design-system board, swatch strip, or typography specimen card
- Never render literal labels such as "Color palette", "Typography", "Display", "Heading", "Body", or "Caption"
- For mobile: never place the UI inside a smaller rectangle/card; it must be full-bleed edge-to-edge
- Do not render any outer background around the app UI
"""


def _build_page_prompt(
    brief: UIDesignBrief,
    page: UIPageSpec,
    brand_spec: str,
    nav_items: list[str],
    components: list[str],
    is_poster: bool = False,
) -> str:
    """Build the complete, self-contained image generation prompt for a single page."""
    is_mobile = brief.platform.lower() == "mobile"
    is_auth = _is_auth_page(page.name)

    must_include_text = (
        "This screen must contain: " + ", ".join(page.must_include) + "."
        if page.must_include else ""
    )
    avoid_text = (
        "Do not include: " + ", ".join(page.avoid) + "."
        if page.avoid else ""
    )

    if is_poster:
        component_inventory = ", ".join(components) if components else ""
        return f"""{brand_spec}
CRITICAL RULE:
- Do not render any mobile screen, status bar, app navigation, browser frame, or UI chrome

NOW RENDER THIS SPECIFIC POSTER:
Poster name: {page.name}
Purpose: {page.purpose or page.name}

Poster component inventory (use these exact names): {component_inventory}

{must_include_text}
{avoid_text}

Render one complete standalone poster composition for {page.name}. It must look polished, expressive, and production-ready.
"""

    # For auth screens: no navigation, just centered form
    if is_auth:
        return f"""{brand_spec}
CRITICAL RULE:
- Do not render any spec labels, measurements, size indicators, or annotation text in the UI
- This is an authentication screen — do NOT include sidebar, navigation, navigation bar, or any platform elements
- Only show the centered form/modal

NOW RENDER THIS SPECIFIC SCREEN:
Screen name: {page.name}
Purpose: {page.purpose or page.name}

{must_include_text}
{avoid_text}

Render a clean, centered authentication form. The entire screen focuses on the form — no navigation, no sidebar, no distractions, no platform chrome.
"""

    # For platform screens: include navigation
    nav_labels = ", ".join(nav_items) if nav_items else ""
    active_nav = _pick_active_nav_item(page.name, nav_items)
    if is_mobile:
        if active_nav:
            nav_reminder = (
                "The bottom tab bar must be visible at the bottom, identical in styling to every other screen in this product. "
                f"Tab labels (left to right): {nav_labels}. Active tab: {active_nav}."
            )
        else:
            nav_reminder = (
                "The bottom tab bar must be visible at the bottom, identical in styling to every other screen in this product. "
                f"Tab labels (left to right): {nav_labels}. No tab should appear active for this screen."
            )
    else:
        if active_nav:
            nav_reminder = (
                "The left sidebar must be visible on the left edge, identical in styling to every other screen in this product. "
                f"Navigation labels (top to bottom): {nav_labels}. Active item: {active_nav}."
            )
        else:
            nav_reminder = (
                "The left sidebar must be visible on the left edge, identical in styling to every other screen in this product. "
                f"Navigation labels (top to bottom): {nav_labels}. No sidebar item should appear active for this screen."
            )

    return f"""{brand_spec}
CRITICAL RULE:
- Do not render any spec labels, measurements, size indicators, or annotation text in the UI
- Do not render literal token text such as font specifications or color specifications
- If platform is mobile, render only the flat app screen canvas (no device frame, no notch, no phone body)
- This must be a real product screen, not a design-system/spec screen
- Do NOT include color swatch rows, typography specimen lists, token legends, or style reference panels
- For mobile: the UI must be full-bleed and fill the entire image; never inset/center the screen as a preview inside another canvas

NOW RENDER THIS SPECIFIC SCREEN:
Screen name: {page.name}
Purpose: {page.purpose or page.name}

{must_include_text}
{avoid_text}

{nav_reminder}

Do NOT include content that belongs to other screens. Only render the content for this screen.

Render the complete {page.name} screen. Every color, font, spacing value, and component style must match the design system described above exactly. The screen must look pixel-perfect and production-ready.
"""


def _build_document_processor_prompt(document_text: str) -> str:
    # Truncate and sanitize for embedding in the prompt
    truncated = document_text[:3000]
    short = document_text[:300].replace("\n", " ").replace('"', "'")
    return f"""
You are a technical document analyst specializing in product and system design.
Extract structured information from the document below to drive UI generation.

DOCUMENT TEXT:
{truncated}

Return ONLY valid JSON matching this schema exactly:
{{
  "is_document": true,
  "summary": "One-line description of what this document describes",
  "detected_pages": ["Page Name 1", "Page Name 2", "Page Name 3"],
  "features": ["Feature A", "Feature B"],
  "user_workflows": ["Workflow A", "Workflow B"],
  "user_roles": ["Role A", "Role B"],
  "tone": "professional",
  "style_hints": "Modern corporate SaaS with clean data tables",
  "color_hints": "Dark background, blue primary, white text",
  "platform": "web",
  "raw_text": "{short}"
}}

Rules:
- detected_pages: infer 3-7 key UI screens from the document's sections and described workflows
- tone: one of professional | friendly | technical | marketing | minimalist
- platform: default "web" unless document explicitly mentions mobile/app
- style_hints and color_hints: infer from industry context if not stated
"""


# ─────────────────────────────────────────────────────────────────────────────
# IMAGE DESCRIPTION (reference / edit mode)
# ─────────────────────────────────────────────────────────────────────────────

DESCRIBE_IMAGE_PROMPT = (
    "You are a senior UI designer doing a design audit for pixel-perfect recreation.\n\n"
    "Describe the following in detail:\n"
    "1. COLORS: Exact hex values for background, surface, primary, accent, text, muted, border\n"
    "2. TYPOGRAPHY: Font families, weights, sizes for heading/body/caption\n"
    "3. LAYOUT: Sidebar width, column count, gutters, margins, overall structure\n"
    "4. COMPONENTS: Every component with border-radius, shadow, padding, border style\n"
    "5. NAVIGATION: Type (sidebar / topbar / bottom tabs), dimensions, active state style\n"
    "6. VISUAL EFFECTS: Gradients, glassmorphism, blur, shadows\n"
    "7. ICONS: Approximate size, filled or outlined\n"
    "8. CONTENT: What realistic data is shown (names, numbers, labels)\n"
    "9. PLATFORM: Web or mobile\n"
    "10. OVERALL STYLE: One sentence summary\n\n"
    "Be extremely specific — someone must be able to recreate this exactly."
)


def _describe_reference_image(image_path: str) -> str:
    if not image_path or not os.path.exists(image_path):
        return ""
    ext = os.path.splitext(image_path)[1].lower().lstrip(".")
    mime = {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "webp": "image/webp"}.get(ext, "image/png")
    with open(image_path, "rb") as f:
        data = base64.b64encode(f.read()).decode("utf-8")
    return _describe_image_from_base64(data, mime)


def _describe_reference_image_base64(base64_data: str) -> str:
    if not base64_data:
        return ""
    return _describe_image_from_base64(base64_data, "image/png")


def _describe_image_from_base64(b64_data: str, mime: str) -> str:
    try:
        resp = llm.invoke([
            HumanMessage(content=[
                {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{b64_data}"}},
                {"type": "text", "text": DESCRIBE_IMAGE_PROMPT},
            ])
        ])
        return getattr(resp, "content", str(resp)).strip()
    except Exception:
        return ""


# ─────────────────────────────────────────────────────────────────────────────
# IMAGE GENERATION
# ─────────────────────────────────────────────────────────────────────────────

async def _generate_image_bytes(prompt_text: str) -> bytes:
    client = genai.Client(api_key=os.getenv("GOOGLE_API_KEY"))
    response = await client.aio.models.generate_content(
        model="gemini-3.1-flash-image-preview",
        contents=prompt_text,
    )
    for part in response.candidates[0].content.parts:
        if part.inline_data:
            return part.inline_data.data
    raise RuntimeError("No image data returned by model")


def _save_image_bytes(image_bytes: bytes, path: Path) -> None:
    image = Image.open(io.BytesIO(image_bytes))
    image.save(path)


def _generate_image_sync(prompt_text: str, max_retries: int = 3) -> bytes:
    """Synchronous wrapper with exponential-backoff retry."""
    import time
    last_error = None
    for attempt in range(max_retries):
        try:
            return asyncio.run(_generate_image_bytes(prompt_text))
        except Exception as e:
            last_error = e
            err = str(e).lower()
            if any(x in err for x in ["ssl", "decryption", "connection", "timeout", "503", "429"]):
                if attempt < max_retries - 1:
                    wait = 2 ** attempt
                    print(f"[Retry {attempt + 1}/{max_retries}] waiting {wait}s — {str(e)[:80]}")
                    import time as _t; _t.sleep(wait)
                    continue
            raise
    raise last_error or RuntimeError("Image generation failed after retries")


def _generate_images_threaded(page_prompts: list, num_images: int, max_workers: int = 4) -> list:
    """Generate all page images in parallel threads."""
    import logging
    logger = logging.getLogger(__name__)
    image_data = []

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures: dict = {}
        for page_idx, page in enumerate(page_prompts):
            page_name = page.get("page_name", f"Page {page_idx + 1}")
            page_prompt = page.get("prompt", "")
            for variant_idx in range(max(1, num_images)):
                future = executor.submit(_generate_image_sync, page_prompt)
                futures[future] = (page_name, variant_idx)

        for future in as_completed(futures):
            page_name, variant_idx = futures[future]
            try:
                image_bytes = future.result()
                image_data.append({
                    "page_name": page_name,
                    "variant_idx": variant_idx,
                    "image_bytes": image_bytes,
                })
                logger.info(f"✓ Generated: {page_name} v{variant_idx + 1}")
            except Exception as e:
                logger.error(f"✗ Failed: {page_name} v{variant_idx + 1} — {str(e)[:100]}")

    return image_data


# ─────────────────────────────────────────────────────────────────────────────
# DEFAULT PALETTE / TYPOGRAPHY FALLBACKS
# ─────────────────────────────────────────────────────────────────────────────

def _fill_missing_tokens(brief: UIDesignBrief) -> None:
    """Populate color_palette and typography if not set — prevents vague prompts."""
    style_lower = brief.style.lower()
    is_mobile = brief.platform.lower() == "mobile"

    if not brief.color_palette or len(brief.color_palette) < 20:
        if "fintech" in style_lower or "luxury" in style_lower:
            brief.color_palette = "bg:#0A0E1A surface:#111827 primary:#6366F1 accent:#F59E0B text:#F9FAFB muted:#6B7280 border:#1F2937 success:#10B981 error:#EF4444"
        elif is_mobile and "ios" in style_lower and "dark" in style_lower:
            brief.color_palette = "bg:#1C1C1E surface:#2C2C2E primary:#0A84FF accent:#FFD60A text:#FFFFFF muted:#8E8E93 border:#3A3A3C success:#30D158 error:#FF453A"
        elif is_mobile and "ios" in style_lower:
            brief.color_palette = "bg:#F2F2F7 surface:#FFFFFF primary:#007AFF accent:#FF9500 text:#000000 muted:#8E8E93 border:#C6C6C8 success:#34C759 error:#FF3B30"
        elif "neo-brutalist" in style_lower:
            brief.color_palette = "bg:#FFFFFF surface:#F5F5F5 primary:#000000 accent:#FF3B00 text:#000000 muted:#555555 border:#000000 success:#00A550 error:#FF0000"
        elif "pastel" in style_lower or "health" in style_lower or "wellness" in style_lower:
            brief.color_palette = "bg:#FDF6FF surface:#FFFFFF primary:#A78BFA accent:#F9A8D4 text:#1F1F2E muted:#9CA3AF border:#E9D5FF success:#86EFAC error:#FCA5A5"
        elif "dark" in style_lower or "corporate" in style_lower:
            brief.color_palette = "bg:#0F172A surface:#1E293B primary:#38BDF8 accent:#F472B6 text:#F8FAFC muted:#64748B border:#334155 success:#4ADE80 error:#F87171"
        else:
            # Default: clean light SaaS
            brief.color_palette = "bg:#F8FAFC surface:#FFFFFF primary:#6366F1 accent:#F59E0B text:#1E293B muted:#64748B border:#E2E8F0 success:#10B981 error:#EF4444"

    if not brief.typography or len(brief.typography) < 20:
        if is_mobile and ("ios" in style_lower or "apple" in style_lower):
            brief.typography = "Display: SF Pro Display 700 32px, Heading: SF Pro Display 600 24px, Body: SF Pro Text 400 16px, Caption: SF Pro Text 400 12px"
        elif is_mobile and "material" in style_lower:
            brief.typography = "Display: Google Sans 700 32px, Heading: Google Sans 600 22px, Body: Roboto 400 16px, Caption: Roboto 400 12px"
        elif "neo-brutalist" in style_lower:
            brief.typography = "Display: Space Grotesk 800 52px, Heading: Space Grotesk 700 32px, Body: DM Mono 400 15px, Caption: DM Mono 400 12px"
        elif "editorial" in style_lower:
            brief.typography = "Display: Playfair Display 700 52px, Heading: Playfair Display 600 36px, Body: Source Serif 4 400 17px, Caption: Source Serif 4 400 13px"
        elif "fintech" in style_lower or "luxury" in style_lower:
            brief.typography = "Display: Syne 800 48px, Heading: DM Sans 600 28px, Body: DM Sans 400 16px, Caption: DM Sans 400 12px, Mono: JetBrains Mono 400 14px"
        elif is_mobile:
            brief.typography = "Display: Plus Jakarta Sans 700 32px, Heading: Plus Jakarta Sans 600 22px, Body: Plus Jakarta Sans 400 16px, Caption: Plus Jakarta Sans 400 12px"
        else:
            brief.typography = "Display: Plus Jakarta Sans 700 44px, Heading: Plus Jakarta Sans 600 28px, Body: Plus Jakarta Sans 400 16px, Caption: Plus Jakarta Sans 400 12px"


def _fill_poster_tokens(brief: UIDesignBrief) -> None:
    """Populate poster-friendly defaults so poster prompts do not inherit UI/mobile styling bias."""
    style_lower = brief.style.lower()

    weak_styles = {
        "modern, clean, professional",
        "ios premium dark",
        "ios minimal light",
        "material you vibrant",
        "soft saas light",
    }

    if not brief.style or style_lower in weak_styles:
        brief.style = "festival editorial poster"

    if not brief.color_palette or len(brief.color_palette) < 20:
        brief.color_palette = (
            "bg:#F8F6F1 surface:#FFFFFF primary:#C59D5F accent:#0E5A64 "
            "text:#1E1E1E muted:#8E8E93 border:#E8DDB8"
        )

    if not brief.typography or len(brief.typography) < 20:
        brief.typography = (
            "Calligraphy: Noto Naskh Arabic 700, "
            "Headline: Playfair Display 700, "
            "Body: Merriweather 400"
        )

    if brief.resolution in ("390x844", "1440x900", ""):
        brief.resolution = "1080x1350"


# ─────────────────────────────────────────────────────────────────────────────
# LANGGRAPH NODES
# ─────────────────────────────────────────────────────────────────────────────

def ui_chatbot_node(state: dict) -> dict:
    user_message = (state.get("user_prompt") or "").strip()
    last_brief = state.get("design_brief")
    chat_history = state.get("chat_history") or []

    # Auto-analyze reference image — prepend description so LLM auto-fills brief fields
    if state.get("reference_image_base64"):
        ref_desc = _describe_reference_image_base64(state["reference_image_base64"])
        if ref_desc:
            user_message = f"[REFERENCE IMAGE ANALYSIS]\n{ref_desc}\n\n[USER REQUEST]\n{user_message}"

    ignore_last_brief = _should_ignore_last_brief(user_message)
    prompt = _build_intent_prompt(user_message, None if ignore_last_brief else last_brief, chat_history)

    try:
        resp = llm.with_structured_output(UIIntentResponse).invoke(prompt)
    except Exception:
        raw = llm.invoke(prompt)
        data = _extract_json(getattr(raw, "content", str(raw)))
        resp = UIIntentResponse.model_validate(data)

    # Normalise requirements
    if resp.requirements is None:
        resp.requirements = UIDesignBrief()
    elif isinstance(resp.requirements, dict):
        if not resp.requirements.get("screen_name"):
            resp.requirements["screen_name"] = "Primary Screen"
        resp.requirements = UIDesignBrief(**resp.requirements)

    # Enforce platform → resolution consistency
    if resp.requirements:
        platform = resp.requirements.platform.lower().strip()
        if platform not in ("web", "mobile"):
            platform = "web"
        resp.requirements.platform = platform
        if platform == "mobile" and resp.requirements.resolution in ("1440x900", "1440x810", ""):
            resp.requirements.resolution = "390x844"
        elif platform == "web" and resp.requirements.resolution in ("390x844", "1170x2532", ""):
            resp.requirements.resolution = "1440x900"

        resp.requirements = _sanitize_requirements_for_request(
            resp.requirements,
            user_message,
            ignore_last_brief,
        )

    intent = resp.intent

    # Guard: cannot edit if no base image
    if intent == "edit" and not state.get("last_image_path"):
        intent = "collect"
        resp = UIIntentResponse(
            intent="collect",
            message="I can update a UI once we have a base image. Try 'generate a login page UI' first.",
            requirements=resp.requirements,
            missing_fields=["reference_image"],
            change_request=resp.change_request,
        )

    # Guard: force collect if platform is still unclear
    if intent == "generate" and resp.requirements and resp.requirements.platform not in ("web", "mobile"):
        intent = "collect"
        resp = UIIntentResponse(
            intent="collect",
            message="Quick question — is this for web (desktop browser) or mobile (iOS/Android app)?",
            requirements=resp.requirements,
            missing_fields=["platform"],
        )

    update: dict = {
        "ui_intent": resp.model_dump(),
        "chatbot_response": resp.message,
    }
    if resp.requirements:
        update["design_brief"] = resp.requirements.model_dump()
    
    logger.info(f"🤖 Chatbot Intent Detection")
    logger.info(f"   Intent: {resp.intent.upper()}")
    if resp.requirements:
        logger.info(f"   Brand: {resp.requirements.brand_name or 'N/A'}")
        logger.info(f"   Platform: {resp.requirements.platform}")
        logger.info(f"   Style: {resp.requirements.style}")
        logger.info(f"   Pages: {[p.name for p in resp.requirements.pages]}")
        logger.debug(f"   Full design brief: {resp.requirements.model_dump()}")
    if resp.missing_fields:
        logger.info(f"   Missing fields: {resp.missing_fields}")
    
    return update


def ui_intent_router(state: dict) -> str:
    intent = (state.get("ui_intent") or {}).get("intent", "chat")
    if intent in ("chat", "collect"):
        return "END"
    
    # Check if this is a logo-only request
    design_brief = state.get("design_brief") or {}
    if design_brief.get("logo_only"):
        logger.info("🎨 Logo-only request detected, routing to logo_generator")
        return "logo_generator"
    
    if "[Page " in (state.get("user_prompt") or ""):
        return "document_processor"
    return "prompt_enhancer"


def document_processor_node(state: dict) -> dict:
    user_message = (state.get("user_prompt") or "").strip()
    session_id = state.get("session_id", "")

    if "[Page " not in user_message:
        logger.debug("No document markers found - skipping document processing")
        return {"document_analysis": None, "document_context": "", "session_id": session_id}

    doc_start = user_message.find("[Page ")
    doc_text = user_message[doc_start:] if doc_start >= 0 else user_message
    
    logger.info("📄 Document Processor: Analyzing document text...")

    prompt = _build_document_processor_prompt(doc_text)

    try:
        resp = llm.with_structured_output(DocumentAnalysis).invoke(prompt)
    except Exception:
        raw = llm.invoke(prompt)
        data = _extract_json(getattr(raw, "content", str(raw)))
        resp = DocumentAnalysis.model_validate(data)

    logger.info(f"✅ Document analysis complete")
    logger.info(f"   Detected pages: {resp.detected_pages}")
    logger.info(f"   Detected features: {resp.features}")
    logger.info(f"   Platform: {resp.platform}")
    logger.debug(f"   Full analysis: {resp.model_dump()}")

    user_request = ""
    document_context = doc_text
    if "[USER REQUEST]" in user_message:
        parts = user_message.split("[USER REQUEST]")
        user_request = parts[1].strip() if len(parts) > 1 else ""
        document_context = parts[0].strip()

    return {
        "document_analysis": resp.model_dump(),
        "document_context": document_context,
        "user_request": user_request,
        "session_id": session_id,
    }


def logo_generator_node(state: dict) -> dict:
    """Generate or edit logo."""
    brief_data = state.get("design_brief") or {}
    brief = UIDesignBrief.model_validate(brief_data)
    session_id = state.get("session_id", "")
    intent = state.get("ui_intent") or {}
    change_request = intent.get("change_request", "")

    logger.info(f"🎨 Logo Generator Started")
    logger.info(f"   Brand: {brief.brand_name}")
    logger.info(f"   Style: {brief.style}")
    if change_request:
        logger.info(f"   Edit Request: {change_request}")

    out_dir = _design_dir(session_id)
    images: list = []

    # Get reference logo if editing
    reference_desc = ""
    if state.get("reference_image_base64"):
        reference_desc = _describe_reference_image_base64(state["reference_image_base64"])
        logger.info(f"🔍 Analyzing reference logo for edits...")
    elif state.get("last_image_path"):
        reference_desc = _describe_reference_image(state["last_image_path"])
        logger.info(f"🔍 Analyzing reference logo for edits...")

    # Build logo prompt with all specifications
    if brief.logo_description:
        # Use detailed user requirements
        base_prompt = f"""Design a professional logo for '{brief.brand_name}' based on these specifications:

{brief.logo_description}

BRAND STYLE: {brief.style}
COLOR PALETTE: {brief.color_palette}
TYPOGRAPHY: {brief.typography}

CRITICAL RULES:
- Do NOT include any text labels, measurements, or spec information in the image
- Render ONLY the logo itself
- Must be clean, professional, and scalable
- Works in monochrome (black & white) as well as color
- High resolution, vector-style appearance
- Ready for production use on websites, apps, business cards, and dashboards

Generate a high-quality, professional logo that matches all the specifications above.
"""
    else:
        # Use standard logo prompt
        base_prompt = _build_logo_prompt(brief)

    # If editing, append edit instructions
    if change_request and reference_desc:
        logo_prompt = f"""{base_prompt}

EDIT REQUEST: {change_request}

CURRENT LOGO DESCRIPTION:
{reference_desc}

Apply the requested changes to the logo while maintaining the brand identity and professionalism. Keep the logo clean and scalable.
"""
        logger.info(f"✏️ Editing logo with changes: {change_request}")
    else:
        logo_prompt = base_prompt
        logger.info(f"🆕 Generating new logo")

    logger.debug(f"🎨 Logo prompt:\n{logo_prompt}")
    
    try:
        logger.info(f"📥 Generating logo...")
        logo_bytes = _generate_image_sync(logo_prompt)
        logger.info(f"✅ Logo generated successfully ({len(logo_bytes)} bytes)")

        logo_filename = "logo.png"
        logo_path = out_dir / logo_filename
        _save_image_bytes(logo_bytes, logo_path)
        logger.info(f"✅ Saved logo: {logo_filename} ({logo_path})")

        logo_dict = {
            "id": f"{out_dir.name}-logo",
            "page_name": "Logo",
            "filename": logo_filename,
            "path": str(logo_path),
            "url": _image_url_from_path(logo_path),
            "created_at": datetime.now().isoformat(),
            "prompt": logo_prompt,
        }
        images.append(logo_dict)
        _init_session_images(session_id)
        _add_image_to_session(session_id, logo_dict)

        # Save specification
        spec = {
            "session_id": session_id,
            "created_at": datetime.now().isoformat(),
            "design_brief": brief.model_dump(),
            "logo_only": True,
            "pages_generated": [],
            "pages_skipped": [],
        }

        (out_dir / "specification.json").write_text(json.dumps(spec, indent=2), encoding="utf-8")
        (out_dir / "images.json").write_text(json.dumps(images, indent=2), encoding="utf-8")

        if change_request:
            completion_msg = f"✅ Logo updated with your changes!"
        else:
            completion_msg = f"✅ Professional logo for '{brief.brand_name}' ready!"

        return {
            "ui_images": images,
            "last_image_path": str(logo_path.resolve()),
            "chatbot_response": completion_msg,
            "generating_status": "✨ Logo generation complete",
            "session_id": session_id,
        }
    except Exception as e:
        logger.error(f"❌ Logo generation failed: {str(e)}")
        return {
            "ui_images": [],
            "last_image_path": "",
            "chatbot_response": f"❌ Logo generation failed: {str(e)[:100]}",
            "generating_status": "Failed",
            "session_id": session_id,
        }


def prompt_enhancer_node(state: dict) -> dict:
    """
    Builds a locked brand spec and one self-contained prompt per page.
    Consistency is guaranteed because every page prompt starts with the
    IDENTICAL brand spec block — no per-page drift is possible.
    """
    brief_data = state.get("design_brief") or {}
    brief = UIDesignBrief.model_validate(brief_data)
    intent = state.get("ui_intent") or {}
    change_request = intent.get("change_request", "")

    # Get already-generated page names from previous generations
    last_ui_images = state.get("ui_images", [])
    already_generated_pages = {img["page_name"] for img in last_ui_images} if last_ui_images else set()
    
    logger.info(f"📋 Checking for already-generated pages...")
    if already_generated_pages:
        logger.info(f"   Already generated: {already_generated_pages}")
    
    # Reference description for edit mode
    reference_desc = ""
    if state.get("reference_image_base64"):
        reference_desc = _describe_reference_image_base64(state["reference_image_base64"])
    elif state.get("last_image_path"):
        reference_desc = _describe_reference_image(state["last_image_path"])

    # Enrich brief from document analysis
    doc_analysis = state.get("document_analysis")
    if doc_analysis:
        doc = DocumentAnalysis.model_validate(doc_analysis) if isinstance(doc_analysis, dict) else doc_analysis
        if doc.detected_pages and not brief.pages:
            brief.pages = [UIPageSpec(name=p, purpose=f"{p} screen") for p in doc.detected_pages]
            brief.screen_name = brief.screen_name or doc.detected_pages[0]
        if doc.style_hints and (not brief.style or brief.style == "modern, clean, professional"):
            brief.style = doc.style_hints
        if doc.color_hints and not brief.color_palette:
            brief.color_palette = doc.color_hints
        if doc.platform and brief.platform == "web":
            brief.platform = doc.platform
        if doc.features and not brief.components:
            brief.components = doc.features[:10]

    pages = _filter_pages(brief)
    if not pages:
        if brief.pages and brief.skip_pages:
            logger.warning("⚠️ All pages filtered out by skip_pages")
            return {
                "enhanced_prompt": "",
                "page_prompts": [],
                "consistency_rules": [],
                "final_spec": {},
                "skip_all": True,
                "session_id": state.get("session_id", ""),
            }
    poster_mode = _is_poster_request(brief, pages, state.get("user_prompt", ""))

    # Apply type-specific defaults before creating fallback pages
    if poster_mode:
        _fill_poster_tokens(brief)
    else:
        _fill_missing_tokens(brief)

    if not pages:
        fallback = brief.screen_name or "Main Screen"
        if poster_mode and "posters" in fallback.lower():
            pages = [
                UIPageSpec(name=f"{fallback} Variant 1", purpose="Primary celebratory composition"),
                UIPageSpec(name=f"{fallback} Variant 2", purpose="Alternative composition with stronger central symbol"),
                UIPageSpec(name=f"{fallback} Variant 3", purpose="Pattern-rich composition with decorative border"),
                UIPageSpec(name=f"{fallback} Variant 4", purpose="Calligraphy-focused minimalist composition"),
            ]
            brief.pages = pages
            if brief.num_images < 1:
                brief.num_images = 1
        else:
            pages = [UIPageSpec(name=fallback, purpose="Primary screen")]
            brief.pages = pages

    # Filter out already-generated pages — only generate new ones
    new_pages = [p for p in pages if p.name not in already_generated_pages]
    is_edit_request = bool((intent.get("change_request") or "").strip())
    
    if new_pages:
        logger.info(f"📄 Pages to generate NOW: {[p.name for p in new_pages]}")
    else:
        if is_edit_request or not already_generated_pages:
            logger.info("♻️ Regeneration path: generating requested pages.")
            new_pages = pages
        else:
            logger.warning("⚠️ All pages already generated. No new pages to generate.")
            return {
                "enhanced_prompt": "",
                "page_prompts": [],
                "consistency_rules": [],
                "final_spec": {},
                "skip_all": True,
                "session_id": state.get("session_id", ""),
            }
    
    nav_items = [] if poster_mode else (brief.nav_items or _infer_nav_items([p for p in pages if not _is_auth_page(p.name)]))
    raw_components = brief.components or [c for p in pages for c in p.must_include]
    component_inventory = raw_components if poster_mode else _compact_components(raw_components)

    logger.info(f"🎯 Prompt Enhancer Started | Brand: {brief.brand_name} | Platform: {brief.platform} | Style: {brief.style}")
    logger.info(f"🖼️ Asset mode: {'POSTER' if poster_mode else 'UI SCREEN'}")
    logger.info(f"📄 Total pages in brief: {len(pages)}")
    logger.debug(f"   All pages: {[p.name for p in pages]}")
    logger.info(f"🗂️ Navigation items (inferred): {nav_items}")
    logger.info(f"🧩 Component inventory: {component_inventory}")

    # Build the single locked brand spec
    if poster_mode:
        brand_spec = _build_poster_spec_block(brief, component_inventory)
        logger.debug(f"🖼️ Poster spec block (first 500 chars):\n{brand_spec[:500]}...")
    else:
        brand_spec = _build_brand_spec_block(brief, nav_items, component_inventory)
        logger.debug(f"📋 Brand spec block (first 500 chars):\n{brand_spec[:500]}...")
    
    # Build minimal spec for auth pages (no navigation)
    auth_spec = _build_auth_spec_block(brief)
    logger.debug(f"🔐 Auth spec block (first 500 chars):\n{auth_spec[:500]}...")

    # Build one self-contained prompt per page
    page_prompts: list[PagePrompt] = []
    
    for idx, page in enumerate(new_pages, 1):
        # Use appropriate spec based on page type
        if poster_mode:
            spec_to_use = brand_spec
            notes = f"POSTER | Style: {brief.style}"
            page_type = "🖼️ POSTER"
        elif _is_auth_page(page.name):
            spec_to_use = auth_spec
            notes = f"AUTH PAGE (no navigation) | Platform: {brief.platform} | Style: {brief.style}"
            page_type = "🔐 AUTH"
        else:
            spec_to_use = brand_spec
            notes = f"Platform page (with nav) | Platform: {brief.platform} | Style: {brief.style}"
            page_type = "📱 PLATFORM"
        
        if change_request and reference_desc and not _is_auth_page(page.name):
            spec_to_use = (
                f"{brand_spec}\n\n"
                f"EDIT REQUEST: {change_request}\n\n"
                f"CURRENT SCREEN DESCRIPTION:\n{reference_desc}\n\n"
                "Apply the edit request on top of the current screen, keeping everything else identical."
            )
        
        prompt_text = _build_page_prompt(
            brief,
            page,
            spec_to_use,
            nav_items,
            component_inventory,
            is_poster=poster_mode,
        )
        page_prompts.append(PagePrompt(
            page_name=page.name,
            prompt=prompt_text,
            notes=notes,
        ))
        
        logger.info(f"{page_type} PAGE {idx}/{len(new_pages)}: {page.name} | Purpose: {page.purpose or page.name}")
        logger.debug(f"   Full prompt for '{page.name}' (length: {len(prompt_text)} chars):\n{'='*80}\n{prompt_text}\n{'='*80}")

    nav_labels = ", ".join(nav_items) if nav_items else ""
    if poster_mode:
        consistency_rules = [
            f"Colors locked: {brief.color_palette}",
            f"Fonts locked: {brief.typography}",
            f"Poster canvas locked: {brief.resolution}",
            "No mobile frame, no browser chrome, no app navigation",
            "Poster-only composition and typography consistency across all variants",
        ]
    else:
        consistency_rules = [
            f"Colors locked: {brief.color_palette}",
            f"Fonts locked: {brief.typography}",
            f"Navigation: {'bottom tab bar' if brief.platform == 'mobile' else 'left sidebar'} — on platform pages only (NOT on auth screens)",
            f"Navigation labels: {nav_labels}",
            "Cards: rounded corners, surface bg, soft shadow — all pages",
            "Primary buttons: filled with primary color, white text — all pages",
            "Inputs: subtle border, surface background, muted placeholder — all pages",
            f"Resolution locked: {brief.resolution}",
            "Auth pages: NO navigation, centered form only",
        ]
    
    logger.info(f"📐 Consistency Rules:")
    for rule in consistency_rules:
        logger.info(f"   ✓ {rule}")

    final_spec = {
        "brand": brief.brand_name,
        "asset_type": "poster" if poster_mode else "ui",
        "platform": brief.platform,
        "resolution": brief.resolution,
        "style": brief.style,
        "colors": brief.color_palette,
        "fonts": brief.typography,
        "pages_count": len(pages),
    }

    return {
        "enhanced_prompt": brand_spec,
        "page_prompts": [p.model_dump() for p in page_prompts],
        "consistency_rules": consistency_rules,
        "final_spec": final_spec,
        "session_id": state.get("session_id", ""),
    }


def image_generator_node(state: dict) -> dict:
    brief_data = state.get("design_brief") or {}
    brief = UIDesignBrief.model_validate(brief_data)
    prompt = state.get("enhanced_prompt", "")
    session_id = state.get("session_id", "")
    page_prompts = state.get("page_prompts", [])

    if state.get("skip_all"):
        logger.warning("⚠️ Skipping all pages - no pages to generate")
        return {
            "ui_images": [],
            "last_image_path": "",
            "chatbot_response": "No pages to generate. Tell me which pages to keep.",
            "session_id": session_id,
        }

    out_dir = _design_dir(session_id)
    images: list = []

    if not page_prompts and prompt:
        page_prompts = [{"page_name": brief.screen_name, "prompt": prompt, "notes": ""}]

    num_pages = len(page_prompts)
    designing_msg = f"✨ Rendering {num_pages} premium {'screen' if num_pages == 1 else 'screens'}..."
    
    logger.info(f"🎨 Image Generator Starting")
    logger.info(f"📂 Output directory: {out_dir}")
    logger.info(f"📊 Generating {num_pages} {'page' if num_pages == 1 else 'pages'}")
    for page_prompt in page_prompts:
        logger.info(f"   → {page_prompt.get('page_name')} ({page_prompt.get('notes', 'no notes')})")

    _init_session_images(session_id)
    image_data_list = _generate_images_threaded(page_prompts, brief.num_images)

    pages_generated: set = set()
    for img_data in image_data_list:
        page_name = img_data["page_name"]
        variant_idx = img_data["variant_idx"]
        image_bytes = img_data["image_bytes"]
        
        logger.debug(f"📥 Received image data for: {page_name} (variant {variant_idx + 1}, {len(image_bytes)} bytes)")

        page_slug = _slugify(page_name)
        pages_generated.add(page_name)

        filename = f"{page_slug}_{variant_idx + 1}.png"
        path = out_dir / filename
        _save_image_bytes(image_bytes, path)
        logger.info(f"✅ Saved image: {filename} ({path})")

        matching_prompt = next(
            (pp.get("prompt", "") for pp in page_prompts if pp.get("page_name") == page_name),
            page_prompts[0].get("prompt", "") if page_prompts else "",
        )

        image_dict = {
            "id": f"{out_dir.name}-{page_slug}-{variant_idx + 1}",
            "page_name": page_name,
            "filename": filename,
            "path": str(path),
            "url": _image_url_from_path(path),
            "created_at": datetime.now().isoformat(),
            "prompt": matching_prompt,
        }
        images.append(image_dict)
        _add_image_to_session(session_id, image_dict)
    
    spec = {
        "session_id": session_id,
        "created_at": datetime.now().isoformat(),
        "design_brief": brief.model_dump(),
        "consistency_rules": state.get("consistency_rules", []),
        "final_spec": state.get("final_spec", {}),
        "pages_generated": sorted(pages_generated),
        "pages_skipped": brief.skip_pages,
    }

    (out_dir / "specification.json").write_text(json.dumps(spec, indent=2), encoding="utf-8")
    (out_dir / "images.json").write_text(json.dumps(images, indent=2), encoding="utf-8")
    
    logger.info(f"📋 Specification saved: specification.json")
    logger.info(f"🖼️  Images manifest saved: images.json")
    logger.info(f"✨ Image generation complete | Generated {len(images)} items ({len(pages_generated)} pages)")
    logger.debug(f"   Pages generated: {sorted(pages_generated)}")
    if brief.skip_pages:
        logger.debug(f"   Pages skipped: {brief.skip_pages}")

    completion_msg = (
        f"✅ {len(pages_generated)} high-fidelity {'screen' if len(pages_generated) == 1 else 'screens'} ready. "
        f"Total assets: {len(images)}."
    )

    return {
        "ui_images": images,
        "last_image_path": str(Path(images[-1]["path"]).resolve()) if images else "",
        "chatbot_response": completion_msg,
        "generating_status": designing_msg,
        "session_id": session_id,
    }


def completion_node(state: dict) -> dict:
    return state


# ─────────────────────────────────────────────────────────────────────────────
# GRAPH ASSEMBLY
# ─────────────────────────────────────────────────────────────────────────────

ui_graph = StateGraph(dict)
ui_graph.add_node("chatbot", ui_chatbot_node)
ui_graph.add_node("document_processor", document_processor_node)
ui_graph.add_node("logo_generator", logo_generator_node)
ui_graph.add_node("prompt_enhancer", prompt_enhancer_node)
ui_graph.add_node("image_generator", image_generator_node)
ui_graph.add_node("completion", completion_node)

ui_graph.set_entry_point("chatbot")
ui_graph.add_conditional_edges("chatbot", ui_intent_router, {
    "document_processor": "document_processor",
    "logo_generator": "logo_generator",
    "prompt_enhancer": "prompt_enhancer",
    "END": END,
})
ui_graph.add_edge("document_processor", "prompt_enhancer")
ui_graph.add_edge("logo_generator", "completion")
ui_graph.add_edge("prompt_enhancer", "image_generator")
ui_graph.add_edge("image_generator", "completion")
ui_graph.add_edge("completion", END)

ui_image_agent = ui_graph.compile()