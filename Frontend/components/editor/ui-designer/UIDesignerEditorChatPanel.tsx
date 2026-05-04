"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Paperclip, RefreshCw, Send, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { postJson } from "@/lib/auth-api";
import { cn } from "@/lib/utils";

type ChatRole = "user" | "assistant" | "system";
type ChatMessage = { id: string; role: ChatRole; content: string; createdAt: string };

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

type GenerationIntent = "logo" | "mobile" | "poster" | "web" | "generic";

type WsPayload =
  | {
    type: "node_start";
    node_name?: string;
    message?: string;
    data?: { progress?: number };
    timestamp?: string;
  }
  | { type: "message"; message?: string; data?: any; timestamp?: string }
  | { type: "ui_images"; data?: { images?: UiDesignerImage[] }; timestamp?: string }
  | {
    type: "node_end";
    node_name?: string;
    data?: any;
    timestamp?: string;
  }
  | { type: "error"; message?: string; data?: any; timestamp?: string };

type OutboundWsPayload = {
  message: string;
  session_id: string;
  project_id: string;
  reference_image?: string | null;
};

const WS_INITIAL_BACKOFF_MS = 800;
const WS_MAX_BACKOFF_MS = 30_000;
const WS_OUTBOUND_QUEUE_CAP = 20;

function nextReconnectDelayMs(attemptIndex: number): number {
  const capped = Math.min(WS_INITIAL_BACKOFF_MS * 2 ** attemptIndex, WS_MAX_BACKOFF_MS);
  const jitter = capped * (0.88 + Math.random() * 0.24);
  return Math.round(jitter);
}

/** Base URL for UI designer FastAPI (WebSocket + uploads). Set in `.env.local` as `NEXT_PUBLIC_UIDESIGNER_BACKEND_URL`. */
const UIDESIGNER_BACKEND_BASE =
  process.env.NEXT_PUBLIC_UIDESIGNER_BACKEND_URL?.trim() || "http://localhost:8002";

function projectSessionKey(projectId: string) {
  return `uiDesignerSession.${projectId}`;
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

export function UIDesignerEditorChatPanel({
  projectId,
  onImagesChange,
}: {
  projectId: string;
  onImagesChange?: (images: UiDesignerImage[]) => void;
}) {
  const [sessionId, setSessionId] = useState<string>("");
  const lastIntentRef = useRef<GenerationIntent>("generic");
  const [storedDocument, setStoredDocument] = useState<string | null>(null);
  const [referenceImage, setReferenceImage] = useState<string | null>(null);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [images, setImages] = useState<UiDesignerImage[]>([]);
  const imageIdSetRef = useRef<Set<string>>(new Set());

  const [draft, setDraft] = useState("");
  const [wsStatus, setWsStatus] = useState<"disconnected" | "connecting" | "reconnecting" | "connected" | "error">(
    "disconnected",
  );
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const [queuedSendCount, setQueuedSendCount] = useState(0);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const reconnectAttemptRef = useRef(0);
  const outboundQueueRef = useRef<OutboundWsPayload[]>([]);
  const unmountedRef = useRef(false);
  const queuedToastShownRef = useRef(false);
  const prevWsSessionRef = useRef<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const draftRef = useRef(draft);
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

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
        // Non-blocking persistence path; primary save flow still exists.
      });
    }, 500);
    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [images, projectId, sessionId]);

  const addMessage = useCallback((role: ChatRole, content: string) => {
    const createdAt = new Date().toISOString();
    setMessages((prev) => [...prev, { id: crypto.randomUUID(), role, content, createdAt }]);
  }, []);

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

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current != null) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const flushOutboundQueue = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    while (outboundQueueRef.current.length > 0) {
      const payload = outboundQueueRef.current[0];
      try {
        ws.send(JSON.stringify(payload));
        outboundQueueRef.current.shift();
      } catch {
        break;
      }
    }
    setQueuedSendCount(outboundQueueRef.current.length);
    if (outboundQueueRef.current.length === 0) {
      queuedToastShownRef.current = false;
    }
  }, []);

  const openSocketRef = useRef<(() => void) | null>(null);

  // Per-project UI designer session id (persisted so refresh keeps server session).
  useEffect(() => {
    try {
      const skey = projectSessionKey(projectId);
      let sid = window.localStorage.getItem(skey);
      if (!sid) {
        sid = createSessionId();
        window.localStorage.setItem(skey, sid);
      }
      setSessionId(sid);
    } catch {
      setSessionId(createSessionId());
    }
  }, [projectId]);

  // WebSocket lifecycle: connect, auto-reconnect with backoff, outbound queue flush on open
  useEffect(() => {
    unmountedRef.current = false;
    clearReconnectTimer();
    reconnectAttemptRef.current = 0;
    setReconnectAttempt(0);

    const base = UIDESIGNER_BACKEND_BASE.trim();
    const sid = sessionId;
    const sessionChanged = prevWsSessionRef.current !== null && prevWsSessionRef.current !== sid;
    if (sessionChanged) {
      outboundQueueRef.current = [];
      setQueuedSendCount(0);
      queuedToastShownRef.current = false;
    }
    prevWsSessionRef.current = sid;

    if (!sid) return;

    const scheduleReconnect = () => {
      if (unmountedRef.current) return;
      clearReconnectTimer();
      const attemptIdx = reconnectAttemptRef.current;
      const delay = nextReconnectDelayMs(attemptIdx);
      reconnectAttemptRef.current = attemptIdx + 1;
      setReconnectAttempt(attemptIdx + 1);
      setWsStatus("reconnecting");

      reconnectTimerRef.current = window.setTimeout(() => {
        reconnectTimerRef.current = null;
        if (unmountedRef.current) return;
        openSocket();
      }, delay);
    };

    const openSocket = () => {
      const w = wsRef.current;
      if (w) {
        try {
          w.close();
        } catch {
          // ignore
        }
        wsRef.current = null;
      }

      const wsBase = toWsBase(base);
      const wsUrl = `${wsBase}/ws-ui/${sid}`;
      setWsStatus(reconnectAttemptRef.current > 0 ? "reconnecting" : "connecting");

      try {
        const socket = new WebSocket(wsUrl);
        wsRef.current = socket;

        socket.onopen = () => {
          if (unmountedRef.current) return;
          reconnectAttemptRef.current = 0;
          setReconnectAttempt(0);
          setWsStatus("connected");
          flushOutboundQueue();
        };

        socket.onmessage = (event) => {
          let payload: WsPayload | null = null;
          try {
            payload = JSON.parse(event.data) as WsPayload;
          } catch {
            // ignore
          }
          if (!payload) return;

          if (payload.type === "node_start") {
            if (payload.message) addMessage("system", payload.message);
            return;
          }

          if (payload.type === "error") {
            addMessage("system", payload.message || "Backend error");
            setWsStatus("error");
            return;
          }

          if (payload.type === "message") {
            if (payload.message) addMessage("assistant", payload.message);
            return;
          }

          if (payload.type === "ui_images") {
            const imgs = payload.data?.images ?? [];
            mergeImages(imgs);
            return;
          }

          if (payload.type === "node_end" && payload.node_name === "image_generator") {
            const uiImages = payload.data?.ui_images ?? payload.data?.images ?? [];
            if (Array.isArray(uiImages)) mergeImages(uiImages);
            return;
          }
        };

        socket.onerror = () => {
          // Browser gives no useful detail; onclose handles reconnect. Avoid blaming "URL" for every blip.
        };

        socket.onclose = (ev) => {
          if (ev.target !== wsRef.current) return;
          wsRef.current = null;
          if (unmountedRef.current) {
            setWsStatus("disconnected");
            return;
          }
          scheduleReconnect();
        };
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        setWsStatus("error");
        toast.error(msg || "Could not connect to UI backend.");
        scheduleReconnect();
      }
    };

    openSocketRef.current = openSocket;
    openSocket();

    return () => {
      unmountedRef.current = true;
      clearReconnectTimer();
      const w = wsRef.current;
      wsRef.current = null;
      try {
        w?.close();
      } catch {
        // ignore
      }
    };
  }, [sessionId, addMessage, mergeImages, clearReconnectTimer, flushOutboundQueue]);

  const retryConnectNow = useCallback(() => {
    clearReconnectTimer();
    reconnectAttemptRef.current = 0;
    setReconnectAttempt(0);
    openSocketRef.current?.();
  }, [clearReconnectTimer]);

  const onPickFile = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const uploadFile = useCallback(
    async (file: File) => {
      const base = UIDESIGNER_BACKEND_BASE.trim();
      if (!base) return;
      if (!file) return;
      if (file.size > 20 * 1024 * 1024) {
        toast.error("File too large. Please upload a file under 20MB.");
        return;
      }

      addMessage("system", `Uploading: ${file.name}…`);
      try {
        const formData = new FormData();
        formData.append("file", file);

        const res = await fetch(`${base}/api/upload`, { method: "POST", body: formData });
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

        if ((json as any).type === "pdf" || (json as any).type === "docx") {
          const extracted = (json as any).text || "";
          setStoredDocument(extracted);
          const preview = extracted ? extracted.slice(0, 200) + (extracted.length > 200 ? "…" : "") : "";
          addMessage("system", `Loaded ${json.type.toUpperCase()} (${extracted.length} chars). Now describe what to generate.`);
          if (preview) addMessage("system", `Preview: ${preview}`);
          return;
        }

        if ((json as any).type === "image") {
          const b64 = (json as any).base64;
          setReferenceImage(b64);
          addMessage("system", "Loaded reference image. Next message will keep style consistent.");
          return;
        }
      } catch (e: any) {
        addMessage("system", `Upload error: ${e?.message ?? String(e)}`);
      }
    },
    [addMessage],
  );

  const sendToBackend = useCallback(() => {
    const text = draftRef.current.trim();
    if (!text) return;
    if (!sessionId) return;

    const socketOpen = Boolean(wsRef.current && wsRef.current.readyState === WebSocket.OPEN);
    if (!socketOpen && outboundQueueRef.current.length >= WS_OUTBOUND_QUEUE_CAP) {
      toast.error("Too many messages are waiting to send. Wait for the connection or use Retry.");
      return;
    }

    const userText = text;
    setDraft("");
    addMessage("user", userText);

    const currentIntent = inferIntentFromPrompt(userText);
    const previousIntent = lastIntentRef.current;
    const switchedIntent =
      currentIntent !== "generic" &&
      previousIntent !== "generic" &&
      currentIntent !== previousIntent &&
      !isEditStylePrompt(userText);

    let finalMessage = userText;
    if (storedDocument) {
      finalMessage = `[DOCUMENT CONTEXT]\n${storedDocument}\n\n[USER REQUEST]\n${userText}`;
      setStoredDocument(null);
    }
    if (switchedIntent) {
      finalMessage = `start over\n${finalMessage}`;
    }
    finalMessage = `${finalMessage}\n\n[GENERATION SPEC]\n${intentInstruction(currentIntent)}`;
    lastIntentRef.current = currentIntent;

    const refImg = referenceImage;
    if (referenceImage) setReferenceImage(null);

    const msg: OutboundWsPayload = {
      message: finalMessage,
      session_id: sessionId,
      project_id: projectId,
    };
    if (refImg) msg.reference_image = refImg;

    const sendNow = () => {
      const w = wsRef.current;
      if (!w || w.readyState !== WebSocket.OPEN) return false;
      try {
        w.send(JSON.stringify(msg));
        return true;
      } catch {
        return false;
      }
    };

    if (sendNow()) return;

    if (outboundQueueRef.current.length >= WS_OUTBOUND_QUEUE_CAP) {
      toast.error("Too many messages are waiting to send. Wait for the connection or use Retry.");
      return;
    }

    outboundQueueRef.current.push(msg);
    setQueuedSendCount(outboundQueueRef.current.length);
    if (!queuedToastShownRef.current) {
      queuedToastShownRef.current = true;
      toast.message("Connection lost. Your message is queued and will send automatically when the link is back.");
    }
  }, [addMessage, projectId, referenceImage, sessionId, storedDocument]);

  const clearReference = useCallback(() => {
    setReferenceImage(null);
    toast.message("Reference image cleared.");
  }, []);

  const clearDocument = useCallback(() => {
    setStoredDocument(null);
    toast.message("Document context cleared.");
  }, []);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {(wsStatus === "connecting" || wsStatus === "reconnecting") && (
        <div className="shrink-0 flex items-center justify-between gap-2 border-b border-white/10 bg-white/[0.04] px-4 py-2 text-[0.72rem] text-white/80">
          <span className="min-w-0 truncate">
            {wsStatus === "reconnecting"
              ? `Reconnecting to UI backend… (attempt ${reconnectAttempt})`
              : "Connecting to UI backend…"}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 shrink-0 gap-1.5 text-white/90 hover:text-white hover:bg-white/10"
            onClick={() => retryConnectNow()}
          >
            <RefreshCw className="size-3.5" />
            Retry now
          </Button>
        </div>
      )}

      {queuedSendCount > 0 && (
        <div className="shrink-0 border-b border-amber-500/25 bg-amber-500/10 px-4 py-1.5 text-center text-[0.7rem] text-amber-100/90">
          {queuedSendCount} message{queuedSendCount === 1 ? "" : "s"} queued — will send when connected
        </div>
      )}

      <div className="p-6 pb-2 space-y-3 thin-scrollbar overflow-y-auto flex-1">
        {storedDocument ? (
          <div className="rounded-2xl border border-[#eca8d6]/20 bg-[#eca8d6]/5 p-3 flex items-center justify-between gap-3">
            <div className="text-[0.78rem] text-white/90">Document loaded ({storedDocument.length} chars)</div>
            <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-white" onClick={clearDocument}>
              <X className="size-4" />
            </Button>
          </div>
        ) : null}

        {referenceImage ? (
          <div className="rounded-2xl border border-[#eca8d6]/20 bg-[#eca8d6]/5 p-3 flex items-center justify-between gap-3">
            <div className="text-[0.78rem] text-white/90">Reference image loaded</div>
            <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-white" onClick={clearReference}>
              <X className="size-4" />
            </Button>
          </div>
        ) : null}

        <div className="mt-4">
          <div className="text-xs font-mono uppercase tracking-[0.2em] text-muted-foreground/40">Chat</div>
          <div className="mt-3 space-y-3">
            {messages.length === 0 ? (
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-[0.78rem] text-white/70">
                Ask anything to start generating UI screens.
              </div>
            ) : (
              messages.map((m) => (
                <div
                  key={m.id}
                  className={cn(
                    "rounded-2xl p-4 text-[0.85rem] leading-[1.6] border",
                    m.role === "user"
                      ? "bg-foreground/[0.03] border-white/5 border-dashed"
                      : m.role === "assistant"
                        ? "bg-[#eca8d6]/[0.02] border-[#eca8d6]/10"
                        : "bg-white/[0.02] border-white/10"
                  )}
                >
                  <div className={cn("text-[0.55rem] font-bold uppercase tracking-[0.2em] mb-2", m.role === "user" ? "text-muted-foreground/50" : "text-[#eca8d6]")}>
                    {m.role === "user" ? "You" : m.role === "assistant" ? "Designer" : "System"}
                  </div>
                  <div className="text-foreground/90 font-medium whitespace-pre-wrap">{m.content}</div>
                </div>
              ))
            )}
          </div>
        </div>

      </div>

      <div className="p-6 pt-2 shrink-0">
        <div className="relative group bg-zinc-900/50 rounded-[28px] border border-white/10 p-1.5 focus-within:ring-1 focus-within:ring-white/20 transition-all">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Ask anything…"
            className="min-h-[52px] w-full resize-none border-0 bg-transparent px-4 py-3 text-[0.9rem] placeholder:text-zinc-600 focus-visible:ring-0 no-scrollbar"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                sendToBackend();
              }
            }}
          />
          <div className="flex items-center justify-between px-4 pb-2">
            <div className="flex items-center gap-4 text-zinc-500">
              <Paperclip className="size-4 cursor-pointer hover:text-white transition-colors" onClick={onPickFile} />
            </div>
            <Button
              size="icon"
              className="size-9 rounded-xl bg-white text-black hover:bg-zinc-200 shadow-xl transition-all"
              type="button"
              onClick={sendToBackend}
              disabled={!draft.trim()}
              title={wsStatus !== "connected" ? "Sends when connected (or queues if offline)" : "Send"}
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
    </div>
  );
}

