"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Paperclip, RefreshCw, Send, X, Check, Eye, ChevronDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { postJson } from "@/lib/auth-api";
import { cn } from "@/lib/utils";

type ChatRole = "user" | "assistant" | "system";

type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: string;
  imageUrl?: string;
  isStyleGuide?: boolean;
};

type BackendUploadResult =
  | { type: "pdf" | "docx"; text: string }
  | { type: "image"; base64: string }
  | { error: string };

type UiDesignerImage = {
  id: string;
  url: string;
  filename: string;
  page_name?: string;
  created_at?: string;
};

type PendingAnchor = {
  image_b64: string;
  filename: string;
  screen: string;
  platform: string;
  remaining_screens: string[];
};

type GenerationIntent = "logo" | "mobile" | "poster" | "web" | "generic";

const WS_INITIAL_BACKOFF_MS = 800;
const WS_MAX_BACKOFF_MS = 30_000;
const WS_OUTBOUND_QUEUE_CAP = 20;

/** Base URL for UI designer FastAPI (WebSocket + uploads). Set in `.env.local` as `NEXT_PUBLIC_UIDESIGNER_BACKEND_URL`. */
const UIDESIGNER_BACKEND_BASE =
  process.env.NEXT_PUBLIC_UIDESIGNER_BACKEND_URL?.trim() || "http://localhost:8001";

function projectSessionKey(projectId: string, activeScreenId?: string) {
  return `uiDesignerSession.${projectId}.${activeScreenId || "default"}`;
}

function createSessionId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `session-${crypto.randomUUID()}`;
  }
  return `session-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function toWsBase(backendBase: string) {
  const b = backendBase.trim();
  if (b.startsWith("https://")) return b.replace(/^https:\/\//, "wss://");
  if (b.startsWith("http://")) return b.replace(/^http:\/\//, "ws://");
  if (b.startsWith("ws://") || b.startsWith("wss://")) return b;
  return b;
}

function getImageSrc(backendBase: string, url: string) {
  if (!url) return "";
  return url.startsWith("/") ? `${backendBase}${url}` : url;
}

function inferIntentFromPrompt(text: string): GenerationIntent {
  const t = (text || "").toLowerCase();
  if (/\blogo\b|\bbrand mark\b|\bwordmark\b/.test(t)) return "logo";
  if (/\bmobile\b|\bios\b|\bandroid\b|\bapp screen\b|\bphone\b/.test(t)) return "mobile";
  if (/\bposter\b|\binstagram\b|\bflyer\b|\bbanner\b|\bsocial\b/.test(t)) return "poster";
  if (/\bwebsite\b|\bweb\b|\blanding page\b|\bdashboard\b|\bdesktop\b/.test(t)) return "web";
  return "generic";
}

function isEditStylePrompt(text: string) {
  const t = (text || "").toLowerCase();
  return /\bedit\b|\bupdate\b|\bchange\b|\brefine\b|\bvariant\b|\biterate\b|\bkeep\b/.test(t);
}

function intentInstruction(intent: GenerationIntent): string {
  if (intent === "logo") {
    return [
      "TARGET TYPE: LOGO",
      "Generate logo-focused output only (no full mobile/desktop UI screen).",
      "Use centered logo composition with clean whitespace and brand mark/text treatment.",
    ].join("\n");
  }
  if (intent === "mobile") {
    return [
      "TARGET TYPE: MOBILE UI",
      "Generate a portrait mobile app UI layout (phone-style composition).",
      "Do not output desktop/web canvas proportions.",
    ].join("\n");
  }
  if (intent === "poster") {
    return [
      "TARGET TYPE: POSTER / SOCIAL CREATIVE",
      "Generate poster-style visual composition suitable for social/campaign creative.",
      "Do not output dashboard-style UI layout.",
    ].join("\n");
  }
  if (intent === "web") {
    return [
      "TARGET TYPE: WEB UI",
      "Generate desktop/web UI composition (not mobile-first poster composition).",
    ].join("\n");
  }
  return "TARGET TYPE: AUTO";
}

/** Matches project kind string to respective WebSocket endpoint in ui_image_designer.py */
function getWsEndpointForKind(kind?: string): string {
  const k = (kind || "").toLowerCase().trim();
  if (k === "logo design") {
    return "/ws/logo";
  }
  if (k === "social media design") {
    return "/ws/social_media";
  }
  if (k === "practice") {
    return "/ws/practice";
  }
  // Landing page, multi-page website, website design, product design, etc.
  return "/ws/ui";
}

function getPlatformForKind(kind?: string): string {
  const k = (kind || "").toLowerCase().trim();
  if (k === "product design - app") {
    return "mobile";
  }
  if (k === "product design - desktop" || k === "website design" || k === "landing page" || k === "multi-page website") {
    return "web";
  }
  return "auto";
}

export function UIDesignerEditorChatPanel({
  projectId,
  projectKind,
  onImagesChange,
  activeScreenId,
  onCreateDefaultScreen,
  activeScreen,
}: {
  projectId: string;
  projectKind?: string;
  onImagesChange?: (images: UiDesignerImage[]) => void;
  activeScreenId?: string;
  onCreateDefaultScreen?: () => string;
  activeScreen?: any;
}) {
  const [sessionId, setSessionId] = useState<string>("");
  const lastIntentRef = useRef<GenerationIntent>("generic");
  const [storedDocument, setStoredDocument] = useState<string | null>(null);
  const [referenceImage, setReferenceImage] = useState<string | null>(null);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [images, setImages] = useState<UiDesignerImage[]>([]);
  const imageIdSetRef = useRef<Set<string>>(new Set());

  const [draft, setDraft] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [statusText, setStatusText] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const unmountedRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  const [pendingAnchor, setPendingAnchor] = useState<PendingAnchor | null>(null);
  const [revisionText, setRevisionText] = useState("");
  const [showRevisionInput, setShowRevisionInput] = useState(false);
  const [zoomUrl, setZoomUrl] = useState<string | null>(null);

  // Auto-scroll chat panel to bottom when messages or loading states change
  useEffect(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
    }
  }, [messages, statusText]);

  useEffect(() => {
    if (images.length === 0) return;
    onImagesChange?.(images);
  }, [images, onImagesChange]);

  useEffect(() => {
    if (!projectId || images.length === 0) return;
    let cancelled = false;
    const timeoutId = window.setTimeout(() => {
      if (cancelled) return;
      void postJson(`/api/projects/${projectId}/assets`, {
        sessionId,
        source: "ui-designer",
        images,
      }).catch(() => {
        // Non-blocking persistence path
      });
    }, 500);
    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [images, projectId, sessionId]);

  // Per-project/per-screen UI designer session id (persisted so refresh keeps server session).
  useEffect(() => {
    if (!activeScreenId) return;
    try {
      const skey = projectSessionKey(projectId, activeScreenId);
      let sid = window.localStorage.getItem(skey);
      if (!sid) {
        sid = createSessionId();
        window.localStorage.setItem(skey, sid);
      }
      setSessionId(sid);
    } catch {
      setSessionId(createSessionId());
    }
  }, [projectId, activeScreenId]);

  // Cleanup websocket when panel unmounts
  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
      if (wsRef.current) {
        try {
          wsRef.current.close();
        } catch {
          // ignore
        }
      }
    };
  }, []);

  // Load messages & images whenever activeScreenId changes!
  useEffect(() => {
    if (!activeScreenId) {
      setMessages([]);
      setImages([]);
      imageIdSetRef.current = new Set();
      return;
    }
    // Load messages from localStorage
    const msgKey = `uiDesigner.messages.${projectId}.${activeScreenId}`;
    const storedMsg = window.localStorage.getItem(msgKey);
    if (storedMsg) {
      try {
        setMessages(JSON.parse(storedMsg));
      } catch {
        setMessages([]);
      }
    } else {
      setMessages([]);
    }

    // Load images from localStorage
    const imgKey = `uiDesigner.images.${projectId}.${activeScreenId}`;
    const storedImg = window.localStorage.getItem(imgKey);
    if (storedImg) {
      try {
        const parsed = JSON.parse(storedImg) as UiDesignerImage[];
        setImages(parsed);
        imageIdSetRef.current = new Set(parsed.map((img) => img.id).filter(Boolean) as string[]);
      } catch {
        setImages([]);
        imageIdSetRef.current = new Set();
      }
    } else {
      setImages([]);
      imageIdSetRef.current = new Set();
    }
  }, [projectId, activeScreenId]);

  // Save images to localStorage whenever they change
  useEffect(() => {
    if (!activeScreenId) return;
    const imgKey = `uiDesigner.images.${projectId}.${activeScreenId}`;
    try {
      window.localStorage.setItem(imgKey, JSON.stringify(images));
    } catch (e) {
      console.warn("localStorage quota exceeded for images cache", e);
    }
  }, [images, projectId, activeScreenId]);

  const addMessage = useCallback((role: ChatRole, content: string, imageUrl?: string, isStyleGuide?: boolean) => {
    const createdAt = new Date().toISOString();
    setMessages((prev) => {
      const updated = [
        ...prev,
        { id: crypto.randomUUID(), role, content, createdAt, imageUrl, isStyleGuide },
      ];
      if (activeScreenId) {
        const msgKey = `uiDesigner.messages.${projectId}.${activeScreenId}`;
        try {
          window.localStorage.setItem(msgKey, JSON.stringify(updated));
        } catch (e) {
          console.warn("localStorage quota exceeded for messages cache", e);
        }
      }
      return updated;
    });
  }, [projectId, activeScreenId]);

  const mergeImages = useCallback(
    (incoming: UiDesignerImage[]) => {
      if (!incoming?.length) return;
      const nextImages: UiDesignerImage[] = [];
      const set = imageIdSetRef.current;

      for (const img of incoming) {
        if (!img?.id) continue;
        if (set.has(img.id)) continue;
        set.add(img.id);
        nextImages.push({ ...img, url: getImageSrc(UIDESIGNER_BACKEND_BASE, img.url) });
      }
      if (!nextImages.length) return;
      setImages((prev) => [...prev, ...nextImages]);
    },
    [setImages],
  );

  /** Unified WebSocket pipeline handler for sending messages & actions */
  const executeWebSocketAction = useCallback(
    (payload: any) => {
      if (wsRef.current) {
        try {
          wsRef.current.close();
        } catch (e) {
          // ignore
        }
        wsRef.current = null;
      }

      setIsGenerating(true);
      setStatusText("Connecting to AI Designer pipeline…");

      const base = UIDESIGNER_BACKEND_BASE.trim();
      const wsBase = toWsBase(base);
      const endpoint = getWsEndpointForKind(projectKind);
      const wsUrl = `${wsBase}${endpoint}`;

      try {
        const socket = new WebSocket(wsUrl);
        wsRef.current = socket;

        socket.onopen = () => {
          setStatusText("Connected. Submitting request…");
          socket.send(JSON.stringify(payload));
        };

        socket.onmessage = (event) => {
          let data: any;
          try {
            data = JSON.parse(event.data);
          } catch {
            return;
          }

          const eventType = data.event || data.type;
          if (!eventType) return;

          switch (eventType) {
            case "status":
              setStatusText(data.message || "Working…");
              break;

            case "assistant_message":
              if (data.message) {
                addMessage("assistant", data.message);
              }
              break;

            case "style_guide": {
              const newImg: UiDesignerImage = {
                id: crypto.randomUUID(),
                url: `data:image/png;base64,${data.image_b64}`,
                filename: data.filename || "style_guide.png",
                page_name: activeScreenId ? `[ScreenID:${activeScreenId}] Style Guide` : "Style Guide",
                created_at: new Date().toISOString(),
              };
              setImages((prev) => [...prev, newImg]);
              addMessage(
                "assistant",
                "🎨 Generated beautiful brand style guide to match your request:",
                undefined,
                true
              );
              break;
            }

            case "anchor_preview": {
              const newImg: UiDesignerImage = {
                id: crypto.randomUUID(),
                url: `data:image/png;base64,${data.image_b64}`,
                filename: data.filename || "anchor.png",
                page_name: activeScreenId ? `[ScreenID:${activeScreenId}] ${data.screen || "Anchor Screen"}` : (data.screen || "Anchor Screen"),
                created_at: new Date().toISOString(),
              };
              setImages((prev) => [...prev, newImg]);
              setPendingAnchor({
                image_b64: data.image_b64,
                filename: data.filename || "anchor.png",
                screen: data.screen || "Anchor Screen",
                platform: data.platform || "desktop",
                remaining_screens: data.remaining_screens || [],
              });
              addMessage(
                "assistant",
                `⚓ Anchor screen generated: "${data.screen || "Dashboard"}". Let's verify the aesthetic. Do you want to Approve or Revise it?`
              );
              break;
            }

            case "screen": {
              const newImg: UiDesignerImage = {
                id: crypto.randomUUID(),
                url: `data:image/png;base64,${data.image_b64}`,
                filename: data.filename || `screen_${data.index}.png`,
                page_name: activeScreenId ? `[ScreenID:${activeScreenId}] ${data.name || `Screen ${data.index}`}` : (data.name || `Screen ${data.index}`),
                created_at: new Date().toISOString(),
              };
              setImages((prev) => [...prev, newImg]);
              addMessage(
                "assistant",
                `✨ Screen generated: "${data.name || `Screen ${data.index}`}"`
              );
              break;
            }

            case "logo":
            case "illustration":
            case "social_media": {
              const label =
                eventType === "logo"
                  ? "Brand Logo"
                  : eventType === "illustration"
                  ? "Illustration"
                  : "Social Post";
              const newImg: UiDesignerImage = {
                id: crypto.randomUUID(),
                url: `data:image/png;base64,${data.image_b64}`,
                filename: data.filename || `${eventType}.png`,
                page_name: activeScreenId ? `[ScreenID:${activeScreenId}] ${label}` : label,
                created_at: new Date().toISOString(),
              };
              setImages((prev) => [...prev, newImg]);
              addMessage(
                "assistant",
                `✦ Generated beautiful custom ${label}:`
              );
              break;
            }

            case "error":
              addMessage("system", data.message || "Pipeline encountered a generation error.");
              toast.error(data.message || "Generation error");
              setStatusText(null);
              setIsGenerating(false);
              break;

            case "done":
              setStatusText(null);
              setIsGenerating(false);
              break;

            default:
              break;
          }
        };

        socket.onerror = () => {
          toast.error("WebSocket server error occurred.");
          setStatusText(null);
          setIsGenerating(false);
        };

        socket.onclose = () => {
          setStatusText(null);
          setIsGenerating(false);
        };
      } catch (e: any) {
        toast.error(`Connection failed: ${e.message}`);
        setStatusText(null);
        setIsGenerating(false);
      }
    },
    [projectKind, addMessage, activeScreenId],
  );

  const onPickFile = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const uploadFile = useCallback(
    async (file: File) => {
      const base = UIDESIGNER_BACKEND_BASE.trim();
      if (!base) return;
      if (!file) return;
      if (file.size > 20 * 1024 * 1024) {
        toast.error("File is too large. Please select a file under 20MB.");
        return;
      }

      addMessage("system", `Uploading context: ${file.name}…`);
      try {
        const formData = new FormData();
        formData.append("file", file);

        // Corrected upload path
        const res = await fetch(`${base}/upload`, { method: "POST", body: formData });
        const json = (await res.json()) as BackendUploadResult & { [k: string]: any };
        if (!res.ok) {
          const err = (json as any)?.error || "Upload failed.";
          addMessage("system", `Upload failed: ${err}`);
          return;
        }

        if ((json as any).error) {
          addMessage("system", `Upload error: ${(json as any).error}`);
          return;
        }

        if (json.image_b64) {
          setReferenceImage(json.image_b64);
          addMessage("system", "Loaded image as strict aesthetic style guide reference.");
          return;
        }

        if ((json as any).type === "pdf" || (json as any).type === "docx") {
          const extracted = (json as any).text || "";
          setStoredDocument(extracted);
          const preview = extracted ? extracted.slice(0, 200) + (extracted.length > 200 ? "…" : "") : "";
          addMessage("system", `Loaded document (${extracted.length} chars). Ready to generate.`);
          if (preview) addMessage("system", `Preview: "${preview}"`);
          return;
        }

        if ((json as any).type === "image") {
          const b64 = (json as any).base64;
          setReferenceImage(b64);
          addMessage("system", "Loaded image as strict aesthetic style guide reference.");
          return;
        }
      } catch (e: any) {
        addMessage("system", `Upload error: ${e?.message ?? String(e)}`);
      }
    },
    [addMessage],
  );

  /** Triggers standard design request */
  const sendToBackend = useCallback(() => {
    const text = draft.trim();
    if (!text) return;
    if (!sessionId) return;

    let currentActiveId = activeScreenId;
    if (!currentActiveId && onCreateDefaultScreen) {
      currentActiveId = onCreateDefaultScreen();
    }

    addMessage("user", text);
    setDraft("");

    const currentIntent = inferIntentFromPrompt(text);
    const previousIntent = lastIntentRef.current;
    const switchedIntent =
      currentIntent !== "generic" &&
      previousIntent !== "generic" &&
      currentIntent !== previousIntent &&
      !isEditStylePrompt(text);

    let finalMessage = text;
    if (storedDocument) {
      finalMessage = `[DOCUMENT CONTEXT]\n${storedDocument}\n\n[USER REQUEST]\n${text}`;
      setStoredDocument(null);
    }
    if (switchedIntent) {
      finalMessage = `start over\n${finalMessage}`;
    }
    finalMessage = `${finalMessage}\n\n[GENERATION SPEC]\n${intentInstruction(currentIntent)}`;
    lastIntentRef.current = currentIntent;

    const refImg = referenceImage;
    if (referenceImage) setReferenceImage(null);

    const payload: any = {
      session_id: sessionId,
      project_id: projectId,
      query: finalMessage,
      platform: getPlatformForKind(projectKind),
      width: activeScreen?.width,
      height: activeScreen?.height,
      format_label: activeScreen?.formatLabel,
      screen_name: activeScreen?.name,
    };
    if (refImg) {
      payload.reference_image_b64 = refImg; // Corrected field name
    }

    executeWebSocketAction(payload);
  }, [draft, sessionId, projectId, activeScreenId, onCreateDefaultScreen, referenceImage, storedDocument, addMessage, executeWebSocketAction, activeScreen]);

  /** Approves anchor design and generates remainder screens */
  const handleApproveAnchor = useCallback(() => {
    if (!pendingAnchor) return;
    setPendingAnchor(null);
    setShowRevisionInput(false);
    addMessage("user", "✓ Approve anchor design style");

    const payload = {
      session_id: sessionId,
      project_id: projectId,
      query: "",
      ui_action: "approve_anchor",
      platform: getPlatformForKind(projectKind),
      width: activeScreen?.width,
      height: activeScreen?.height,
      format_label: activeScreen?.formatLabel,
      screen_name: activeScreen?.name,
    };

    executeWebSocketAction(payload);
  }, [pendingAnchor, sessionId, projectId, addMessage, executeWebSocketAction, activeScreen]);

  /** Revises anchor design with user feedback */
  const handleReviseAnchor = useCallback(() => {
    const text = revisionText.trim();
    if (!text) {
      toast.error("Please describe what revisions to apply.");
      return;
    }
    setPendingAnchor(null);
    setShowRevisionInput(false);
    setRevisionText("");
    addMessage("user", `✎ Revision request: "${text}"`);

    const payload = {
      session_id: sessionId,
      project_id: projectId,
      query: text,
      ui_action: "revise_anchor",
      anchor_feedback: text,
      platform: getPlatformForKind(projectKind),
      width: activeScreen?.width,
      height: activeScreen?.height,
      format_label: activeScreen?.formatLabel,
      screen_name: activeScreen?.name,
    };

    executeWebSocketAction(payload);
  }, [revisionText, sessionId, projectId, addMessage, executeWebSocketAction, activeScreen]);

  const clearReference = useCallback(() => {
    setReferenceImage(null);
    toast.message("Reference style image cleared.");
  }, []);

  const clearDocument = useCallback(() => {
    setStoredDocument(null);
    toast.message("Document structure cleared.");
  }, []);

  return (
    <div className="flex flex-col h-full overflow-hidden bg-background">
      {/* Dynamic Status Progress Bar */}
      {statusText && (
        <div className="shrink-0 flex items-center justify-between gap-3 border-b border-white/5 bg-white/[0.02] px-5 py-3 text-[0.72rem] text-zinc-400">
          <div className="flex items-center gap-2 min-w-0">
            <RefreshCw className="size-3.5 animate-spin text-[#eca8d6] shrink-0" />
            <span className="truncate font-medium">{statusText}</span>
          </div>
          <span className="text-[0.6rem] font-bold tracking-widest text-[#eca8d6] uppercase animate-pulse">Running</span>
        </div>
      )}

      {/* Messages Stream */}
      <div ref={scrollContainerRef} className="p-6 pb-2 space-y-4 thin-scrollbar overflow-y-auto flex-1">
        {storedDocument && (
          <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 flex items-center justify-between gap-3 animate-in fade-in duration-300">
            <div className="text-[0.75rem] text-zinc-300 font-medium">Document attached ({storedDocument.length} chars)</div>
            <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-zinc-400 hover:text-white" onClick={clearDocument}>
              <X className="size-4" />
            </Button>
          </div>
        )}

        {referenceImage && (
          <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 flex items-center justify-between gap-3 animate-in fade-in duration-300">
            <div className="text-[0.75rem] text-zinc-300 font-medium">Style guide image loaded</div>
            <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-zinc-400 hover:text-white" onClick={clearReference}>
              <X className="size-4" />
            </Button>
          </div>
        )}

        <div className="mt-2">
          <div className="text-xs font-mono uppercase tracking-[0.25em] text-zinc-600">Workspace Logs</div>
          <div className="mt-4 space-y-4">
            {messages.length === 0 ? (
              <div className="rounded-3xl border border-white/5 bg-white/[0.01] p-6 text-[0.8rem] text-zinc-400 leading-relaxed text-center">
                Describe your desired screen or asset below to start generating high-fidelity UI layouts.
              </div>
            ) : (
              messages.map((m) => (
                <div
                  key={m.id}
                  className={cn(
                    "rounded-3xl p-5 text-[0.82rem] leading-relaxed border transition-all duration-300 animate-in fade-in slide-in-from-bottom-2",
                    m.role === "user"
                      ? "bg-white/[0.02] border-white/10 border-dashed"
                      : m.role === "assistant"
                        ? "bg-[#eca8d6]/[0.02] border-[#eca8d6]/10"
                        : "bg-white/[0.01] border-white/5"
                  )}
                >
                  <div className={cn("text-[0.6rem] font-bold uppercase tracking-[0.2em] mb-3", m.role === "user" ? "text-zinc-500" : "text-[#eca8d6]")}>
                    {m.role === "user" ? "You" : m.role === "assistant" ? "AI Designer" : "System"}
                  </div>
                  <div className="text-zinc-200 font-medium whitespace-pre-wrap">{m.content}</div>

                  {m.imageUrl && (
                    <div className="relative group mt-4 overflow-hidden rounded-2xl border border-white/10 bg-black/40">
                      <img
                        src={m.imageUrl}
                        alt="Generated layout"
                        className="w-full object-cover max-h-64 cursor-zoom-in group-hover:scale-[1.02] transition-transform duration-500"
                        onClick={() => setZoomUrl(m.imageUrl || null)}
                      />
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
                        <Eye className="size-6 text-white" />
                      </div>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        {/* Dynamic Glassmorphic Approval & Revision Card */}
        {pendingAnchor && (
          <div className="rounded-[32px] border border-[#eca8d6]/25 bg-black/40 backdrop-blur-2xl p-6 space-y-5 animate-in zoom-in-95 duration-500 shadow-2xl">
            <div className="text-[0.65rem] font-bold uppercase tracking-widest text-[#eca8d6] flex items-center gap-1.5">
              <span>⚓</span> Anchor Approval Request
            </div>

            <div className="relative group rounded-2xl border border-white/10 overflow-hidden bg-black">
              <img
                src={`data:image/png;base64,${pendingAnchor.image_b64}`}
                alt="Anchor layout"
                className="w-full object-cover max-h-56 cursor-zoom-in group-hover:scale-[1.02] transition-transform duration-500"
                onClick={() => setZoomUrl(`data:image/png;base64,${pendingAnchor.image_b64}`)}
              />
              <div className="absolute top-3 left-3 bg-black/60 backdrop-blur-md text-[0.62rem] font-bold px-3 py-1.5 rounded-full border border-white/15 tracking-wide text-zinc-300">
                {pendingAnchor.screen} ({pendingAnchor.platform})
              </div>
            </div>

            <p className="text-[0.78rem] text-zinc-400 leading-relaxed font-medium">
              Anchor design is complete. Approve this style guide to generate the remaining screens automatically:
              <br />
              <span className="inline-block mt-2 px-3 py-1 bg-white/[0.04] border border-white/5 rounded-lg text-zinc-300 font-mono text-[0.7rem]">
                {pendingAnchor.remaining_screens.join(", ")}
              </span>
            </p>

            {showRevisionInput ? (
              <div className="space-y-3 animate-in slide-in-from-top-2 duration-300">
                <Textarea
                  value={revisionText}
                  onChange={(e) => setRevisionText(e.target.value)}
                  placeholder="Describe your design revisions clearly (e.g. 'Make the main header font bold, change background style to a premium gradient')…"
                  className="bg-black/60 border border-white/10 rounded-2xl text-[0.8rem] min-h-[72px] placeholder:text-zinc-600 focus-visible:ring-1 focus-visible:ring-white/20"
                />
                <div className="flex gap-2">
                  <Button
                    onClick={handleReviseAnchor}
                    className="flex-1 rounded-xl bg-white text-black hover:bg-zinc-200 text-xs font-semibold"
                  >
                    Submit Revision
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => setShowRevisionInput(false)}
                    className="rounded-xl border border-white/10 hover:bg-white/5 text-zinc-300 text-xs"
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex gap-2 pt-1">
                <Button
                  onClick={handleApproveAnchor}
                  className="flex-1 rounded-xl bg-[#eca8d6] hover:bg-[#eb9cd1] text-black text-xs font-semibold shadow-xl shadow-[#eca8d6]/10 flex items-center justify-center gap-1.5"
                >
                  <Check className="size-4" />
                  Approve Style
                </Button>
                <Button
                  onClick={() => setShowRevisionInput(true)}
                  className="flex-1 rounded-xl bg-transparent border border-white/10 hover:bg-white/5 text-zinc-300 text-xs font-semibold"
                >
                  Request Revision
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Input Draft Area */}
      <div className="p-6 pt-2 shrink-0">
        <div className="relative group bg-zinc-950/60 rounded-[28px] border border-white/10 p-2 focus-within:ring-1 focus-within:ring-[#eca8d6]/30 focus-within:border-[#eca8d6]/20 transition-all shadow-xl">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Describe screen/design requirements…"
            disabled={isGenerating || pendingAnchor !== null}
            className="min-h-[56px] w-full resize-none border-0 bg-transparent px-4 py-3 text-[0.85rem] placeholder:text-zinc-600 focus-visible:ring-0 no-scrollbar text-zinc-200"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                sendToBackend();
              }
            }}
          />
          <div className="flex items-center justify-between px-4 pb-2 pt-1">
            <div className="flex items-center gap-4 text-zinc-500">
              <Paperclip
                className="size-4 cursor-pointer hover:text-white transition-colors"
                onClick={isGenerating || pendingAnchor !== null ? undefined : onPickFile}
              />
              <span className="text-[0.62rem] font-bold uppercase tracking-wider text-zinc-600 font-mono">
                {projectKind || "Web Layout"}
              </span>
            </div>
            <Button
              size="icon"
              className="size-9 rounded-xl bg-white text-black hover:bg-zinc-200 shadow-xl transition-all flex items-center justify-center shrink-0"
              type="button"
              onClick={sendToBackend}
              disabled={!draft.trim() || isGenerating || pendingAnchor !== null}
            >
              <Send className="size-3.5 fill-current" />
            </Button>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              void uploadFile(file);
              e.currentTarget.value = "";
            }}
            accept=".pdf,.docx,.png,.jpg,.jpeg,.webp"
          />
        </div>
      </div>

      {/* Lightbox / Zoom Modal */}
      {zoomUrl && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/90 backdrop-blur-xl animate-in fade-in duration-300">
          <button
            onClick={() => setZoomUrl(null)}
            className="absolute top-6 right-6 size-12 rounded-full border border-white/10 bg-white/5 hover:bg-white/10 text-white flex items-center justify-center shadow-2xl transition-all"
          >
            <X className="size-6" />
          </button>
          <img
            src={zoomUrl}
            alt="Expanded visual layout"
            className="max-w-[92vw] max-h-[88vh] rounded-3xl border border-white/10 shadow-2xl object-contain animate-in zoom-in-95 duration-300"
          />
        </div>
      )}
    </div>
  );
}
