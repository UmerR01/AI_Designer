"use client";

import Image from "next/image";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { MessageCircle, Send, X } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { getJson, postJson } from "@/lib/auth-api";
import { Button } from "@/components/ui/button";
import { getSharedSupportAudioCtx } from "@/components/support/audio-initializer";

const LAUNCHER_SRC = "/images/chat-support.png";

type ChatLine = { id: string; role: "agent" | "user"; text: string; time: string };

const QUICK_PROMPTS = ["Billing & plans", "Something’s broken", "How do I…"];

export function FloatingChatSupport() {
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const [launcherOk, setLauncherOk] = useState(true);
  const [draft, setDraft] = useState("");
  const [lines, setLines] = useState<ChatLine[]>([
    {
      id: "hello",
      role: "agent",
      text: "Hi — you’re chatting with Designer support. How can we help today?",
      time: "Now",
    },
  ]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const lastSeenCount = useRef(0);

  const fmtTime = useCallback((d: Date) => d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }), []);

  const mapMessages = useCallback(
    (msgs: { id: string; sender_type: "user" | "agent" | "system"; body: string; created_at: string }[]) => {
      return msgs
        .filter((m) => m.sender_type !== "system")
        .map<ChatLine>((m) => ({
          id: m.id,
          role: m.sender_type === "agent" ? "agent" : "user",
          text: m.body,
          time: fmtTime(new Date(m.created_at)),
        }));
    },
    [fmtTime],
  );

  const loadMessages = useCallback(
    async (cid: string) => {
      const res = await getJson<{ messages: { id: string; sender_type: "user" | "agent" | "system"; body: string; created_at: string }[] }>(
        `/api/support/conversations/${cid}/messages`,
      );
      const mapped = mapMessages(res.messages);
      setLines((prev) => {
        // Keep the initial greeting only if there are no agent messages yet.
        const hasAny = mapped.length > 0;
        return hasAny ? mapped : prev;
      });
      lastSeenCount.current = mapped.length;
    },
    [mapMessages],
  );

  const playRingtone = useCallback(async () => {
    const ctx = getSharedSupportAudioCtx();
    if (!ctx) return;
    try {
      if (ctx.state === "suspended") await ctx.resume();
      const playRing = (startTime: number) => {
        [440, 480].forEach(freq => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = "sine";
          osc.frequency.setValueAtTime(freq, startTime);
          gain.connect(ctx.destination);
          osc.connect(gain);
          gain.gain.setValueAtTime(0, startTime);
          gain.gain.linearRampToValueAtTime(0.5, startTime + 0.05);
          gain.gain.linearRampToValueAtTime(0.5, startTime + 0.45);
          gain.gain.linearRampToValueAtTime(0, startTime + 0.5);
          osc.start(startTime);
          osc.stop(startTime + 0.5);
        });
      };
      const now = ctx.currentTime;
      for (let i = 0; i < 4; i++) playRing(now + (i * 0.75));
    } catch { /* ignore */ }
  }, []);

  // Ensure a conversation exists when the panel opens.
  useEffect(() => {
    if (!open) return;
    (async () => {
      try {
        const res = await postJson<{ conversationId: string }>("/api/support/conversations", {});
        setConversationId(res.conversationId);
        await loadMessages(res.conversationId);
      } catch (e: any) {
        toast.error(e?.detail ?? e?.message ?? "Support chat unavailable. Please sign in again.");
      }
    })();
  }, [open, loadMessages]);

  // Real-time updates via SSE
  useEffect(() => {
    if (!open || !conversationId) return;
    const es = new EventSource("/api/support/realtime");
    es.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data);
        if (data?.type === "message.created" && data.conversationId === conversationId) {
          loadMessages(conversationId);
          if (data.senderType === 'agent') {
            playRingtone();
          }
        }
        if (data?.type === "call.ring" && data.conversationId === conversationId) {
          playRingtone();
          toast("Support is calling you...", { icon: "🔔" });
        }
      } catch {
        // ignore
      }
    };
    return () => es.close();
  }, [open, conversationId, loadMessages]);

  useEffect(() => {
    if (!open) return;
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [open, lines]);

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => inputRef.current?.focus(), 150);
    return () => window.clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const sendDraft = useCallback(async () => {
    const text = draft.trim();
    if (!text) return;
    const cid = conversationId;
    if (!cid) return;

    const optimistic: ChatLine = { id: `optimistic-${crypto.randomUUID()}`, role: "user", text, time: fmtTime(new Date()) };
    setLines((prev) => [...prev, optimistic]);
    setDraft("");

    try {
      await postJson(`/api/support/conversations/${cid}/messages`, { body: text });
      await loadMessages(cid);
    } catch (e: any) {
      toast.error(e?.detail ?? e?.message ?? "Could not send message.");
      // revert optimistic line
      setLines((prev) => prev.filter((l) => l.id !== optimistic.id));
      setDraft(text);
    }
  }, [draft, conversationId, fmtTime, loadMessages]);

  return (
    <>
      {/* Light dismiss — click outside closes; sits under the panel */}
      {open ? (
        <div
          className="fixed inset-0 z-[45] bg-black/30 backdrop-blur-[2px] transition-opacity"
          aria-hidden
          onClick={() => setOpen(false)}
        />
      ) : null}

      <div
        className="pointer-events-none fixed bottom-0 left-0 z-50 pb-3 pl-3 sm:pb-4 sm:pl-4"
        aria-live="polite"
      >
        <div className="pointer-events-auto flex max-h-[100dvh] flex-col items-start justify-end gap-2">
          {/* Panel only when open — avoids invisible panel pushing the FAB up */}
          {open ? (
            <div
              id={panelId}
              role="dialog"
              aria-modal="true"
              aria-label="Support chat"
              onClick={(e) => e.stopPropagation()}
              className="flex max-h-[min(100dvh-5rem,32rem)] w-[min(calc(100vw-1.5rem),22rem)] flex-col overflow-hidden rounded-3xl border border-foreground/10 bg-background/85 shadow-[0_24px_80px_-12px_rgba(0,0,0,0.55)] backdrop-blur-2xl"
            >
          {/* Header */}
          <div className="relative shrink-0 border-b border-foreground/10 px-4 pb-3 pt-4">
            <div
              className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_90%_80%_at_20%_0%,rgba(236,168,214,0.2),transparent_55%)]"
              aria-hidden
            />
            <div className="relative flex items-start gap-3">
              <div className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-[#eca8d6]/25 bg-[#eca8d6]/10 shadow-[0_0_24px_rgba(236,168,214,0.15)]">
                {launcherOk ? (
                  <Image
                    src={LAUNCHER_SRC}
                    alt=""
                    width={44}
                    height={44}
                    className="size-11 object-cover"
                    onError={() => setLauncherOk(false)}
                    unoptimized
                  />
                ) : (
                  <MessageCircle className="size-5 text-[#eca8d6]" strokeWidth={2} />
                )}
              </div>
              <div className="min-w-0 flex-1 self-center pt-0.5">
                <div className="font-display text-lg leading-none tracking-tight">Support</div>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-9 shrink-0 rounded-xl text-muted-foreground hover:text-foreground"
                onClick={() => setOpen(false)}
                aria-label="Close chat"
              >
                <X className="size-4" />
              </Button>
            </div>

            {/* Quick prompts */}
            <div className="relative mt-3 flex flex-wrap gap-2">
              {QUICK_PROMPTS.map((label) => (
                <button
                  key={label}
                  type="button"
                  className={cn(
                    "rounded-full border border-foreground/10 bg-foreground/[0.04] px-3 py-1.5 text-[0.7rem] font-medium text-muted-foreground",
                    "transition-colors hover:border-[#eca8d6]/35 hover:bg-[#eca8d6]/8 hover:text-foreground",
                  )}
                  onClick={() => setDraft(label)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
            {lines.map((m) => (
              <div
                key={m.id}
                className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}
              >
                <div
                  className={cn(
                    "max-w-[92%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed shadow-sm",
                    m.role === "user"
                      ? "rounded-br-md bg-[#eca8d6] text-background"
                      : "rounded-bl-md border border-foreground/8 bg-foreground/[0.06] text-foreground",
                  )}
                >
                  {m.text}
                </div>
              </div>
            ))}
          </div>

          {/* Composer */}
          <div className="shrink-0 border-t border-foreground/10 p-3">
            <div className="flex gap-2 rounded-2xl border border-foreground/10 bg-foreground/[0.04] p-1.5 focus-within:border-[#eca8d6]/30 focus-within:ring-2 focus-within:ring-[#eca8d6]/15">
              <textarea
                ref={inputRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Type a message…"
                rows={1}
                className="placeholder:text-muted-foreground min-h-[44px] max-h-28 flex-1 resize-none border-0 bg-transparent px-2 py-2.5 text-sm text-foreground shadow-none outline-none focus-visible:ring-0"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    sendDraft();
                  }
                }}
              />
              <Button
                type="button"
                size="icon"
                className="size-10 shrink-0 rounded-xl bg-[#eca8d6] text-background hover:bg-[#eca8d6]/90"
                disabled={!draft.trim()}
                aria-label="Send message"
                onClick={sendDraft}
              >
                <Send className="size-4" />
              </Button>
            </div>
            <p className="mt-2 text-center text-[0.65rem] text-muted-foreground/80">
              You’re chatting with a live support inbox. Replies may take a moment.
            </p>
          </div>
            </div>
          ) : null}

          {/* Launcher — hidden while chat is open */}
          {!open ? (
            <button
              type="button"
              aria-expanded={false}
              aria-controls={panelId}
              aria-label="Open support chat"
              onClick={() => setOpen(true)}
              className={cn(
                "group relative flex size-14 items-center justify-center overflow-hidden rounded-full border border-[#eca8d6]/30 bg-background/60 shadow-[0_12px_40px_-8px_rgba(236,168,214,0.45)] backdrop-blur-xl transition-transform duration-200 hover:scale-[1.05] active:scale-[0.98]",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#eca8d6]/50",
              )}
            >
              <span
                className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(236,168,214,0.35),transparent_55%)] opacity-80 transition-opacity group-hover:opacity-100"
                aria-hidden
              />
              {launcherOk ? (
                <Image
                  src={LAUNCHER_SRC}
                  alt=""
                  width={56}
                  height={56}
                  className="relative size-12 object-cover"
                  onError={() => setLauncherOk(false)}
                  unoptimized
                />
              ) : (
                <MessageCircle className="relative size-7 text-[#eca8d6]" strokeWidth={2} />
              )}
            </button>
          ) : null}
        </div>
      </div>
    </>
  );
}
