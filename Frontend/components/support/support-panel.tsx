"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X, Phone } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { getJson, getMeCached, postJson } from "@/lib/auth-api";
import type { SupportInboxConversation, SupportMessage, SupportUserContext } from "@/lib/support/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getSharedSupportAudioCtx } from "@/components/support/audio-initializer";


type Me = { user: { id: string; email: string; first_name: string; last_name: string; is_support_agent?: boolean } | null };

type InboxFilters = {
  view: "all" | "unread";
};

const RINGTONE_PREF_KEY = "designer.support.ringtone.enabled";
const RINGTONE_VOL_KEY = "designer.support.ringtone.volume";
const DND_PREF_KEY = "designer.support.dnd.enabled";

function displayName(c: SupportInboxConversation) {
  const f = (c.user_first_name ?? "").trim();
  const l = (c.user_last_name ?? "").trim();
  const n = `${f} ${l}`.trim();
  return n || (c.user_email ?? "Unknown user");
}

function priorityChip(p: SupportInboxConversation["priority"]) {
  if (p === "urgent") return { label: "Urgent", cls: "bg-red-500/15 text-red-200 border-red-500/25" };
  if (p === "high") return { label: "High", cls: "bg-amber-500/15 text-amber-200 border-amber-500/25" };
  if (p === "low") return { label: "Low", cls: "bg-white/5 text-white/70 border-white/10" };
  return { label: "Normal", cls: "bg-[#eca8d6]/10 text-white border-[#eca8d6]/20" };
}

export function SupportPanel() {
  const [me, setMe] = useState<Me["user"] | null>(null);
  const [filters, setFilters] = useState<InboxFilters>({ view: "all" });
  const [query, setQuery] = useState("");

  const [inbox, setInbox] = useState<SupportInboxConversation[]>([]);
  const [loadingInbox, setLoadingInbox] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);

  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [draft, setDraft] = useState("");

  const [context, setContext] = useState<SupportUserContext | null>(null);
  const [loadingContext, setLoadingContext] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [volume, setVolume] = useState(0.8);
  const [dndEnabled, setDndEnabled] = useState(false);
  const activeIdRef = useRef<string | null>(null);
  const soundEnabledRef = useRef(true);
  const dndEnabledRef = useRef(false);

  const filteredInbox = useMemo(() => {
    let list = inbox;
    if (filters.view === "unread") {
      list = list.filter(c => c.last_message_sender_type === "user");
    }
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((c) => {
      const hay = `${c.user_email ?? ""} ${c.user_first_name ?? ""} ${c.user_last_name ?? ""} ${c.id}`.toLowerCase();
      return hay.includes(q);
    });
  }, [inbox, query, filters.view]);

  useEffect(() => {
    (async () => {
      try {
        const res = await getMeCached<Me>();
        setMe(res.user);
      } catch {
        // AppShell will redirect on auth failure; ignore
      }
    })();
  }, []);

  useEffect(() => {
    try {
      const enabled = window.localStorage.getItem(RINGTONE_PREF_KEY) === "1";
      const dnd = window.localStorage.getItem(DND_PREF_KEY) === "1";
      const volRaw = window.localStorage.getItem(RINGTONE_VOL_KEY);
      const vol = volRaw ? Number(volRaw) : 0.8;
      setSoundEnabled(enabled);
      setDndEnabled(dnd);
      if (!Number.isNaN(vol) && vol >= 0 && vol <= 1) setVolume(vol);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  useEffect(() => {
    soundEnabledRef.current = soundEnabled;
  }, [soundEnabled]);

  useEffect(() => {
    dndEnabledRef.current = dndEnabled;
  }, [dndEnabled]);

  useEffect(() => {
    try {
      window.localStorage.setItem(RINGTONE_PREF_KEY, soundEnabled ? "1" : "0");
      window.localStorage.setItem(RINGTONE_VOL_KEY, String(volume));
      window.localStorage.setItem(DND_PREF_KEY, dndEnabled ? "1" : "0");
    } catch {
      // ignore
    }
  }, [soundEnabled, volume, dndEnabled]);

  async function playRingtone() {
    const ctx = getSharedSupportAudioCtx();
    if (!ctx) {
      console.warn("Audio context not initialized. Interaction required.");
      return;
    }
    
    try {
      if (ctx.state === "suspended") await ctx.resume();
      
      const playRing = (startTime: number) => {
        // High frequency dual ring
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
      for (let i = 0; i < 4; i++) {
        playRing(now + (i * 0.75));
      }
    } catch (e) {
      console.error("Ringtone playback failed:", e);
    }
  }

  function bumpTitleUnread() {
    try {
      const base = "Support Panel";
      const m = document.title.match(/^\((\d+)\)\s+/);
      const current = m ? Number(m[1]) : 0;
      const next = Math.min(99, current + 1);
      document.title = `(${next}) ${base}`;
    } catch {
      // ignore
    }
  }

  function clearTitleUnread() {
    try {
      document.title = "Support Panel";
    } catch {
      // ignore
    }
  }

  async function loadInbox() {
    setLoadingInbox(true);
    try {
      const res = await getJson<{ conversations: SupportInboxConversation[] }>(`/api/support/agent/inbox?view=${filters.view}`);
      setInbox(res.conversations);
    } catch (e: any) {
      toast.error(e?.detail ?? e?.message ?? "Failed to load inbox.");
    } finally {
      setLoadingInbox(false);
    }
  }

  useEffect(() => {
    loadInbox();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.view]);

  async function loadConversation(conversationId: string) {
    setLoadingMessages(true);
    setMessages([]);
    try {
      const res = await getJson<{ messages: SupportMessage[] }>(`/api/support/agent/conversations/${conversationId}/messages`);
      setMessages(res.messages);
      queueMicrotask(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }));
    } catch (e: any) {
      toast.error(e?.detail ?? e?.message ?? "Failed to load conversation.");
    } finally {
      setLoadingMessages(false);
    }
  }

  useEffect(() => {
    if (!activeId) return;
    loadConversation(activeId);
    // also load context
    const conv = inbox.find((c) => c.id === activeId);
    const userId = conv?.user_id;
    if (!userId) {
      setContext(null);
      return;
    }
    (async () => {
      setLoadingContext(true);
      try {
        const res = await getJson<SupportUserContext>(`/api/support/agent/users/${userId}/context`);
        setContext(res);
      } catch (e: any) {
        setContext(null);
      } finally {
        setLoadingContext(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  // Realtime via SSE (agent-only)
  useEffect(() => {
    const es = new EventSource("/api/support/realtime");
    es.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data);
        if (data?.type === "message.created") {
          const cid = String(data.conversationId ?? "");
          if (!cid) return;
          // refresh inbox always
          loadInbox();
          const currentActive = activeIdRef.current;
          if (currentActive && cid === currentActive) {
            loadConversation(currentActive);
          }
          
          // Trigger notification ONLY for user messages
          if (data.senderType === 'user' && soundEnabledRef.current && !dndEnabledRef.current) {
            bumpTitleUnread();
            playRingtone().catch(() => {});
          }
        }
      } catch {
        // ignore
      }
    };
    es.onerror = () => {
      // SSE can drop; browser will auto-reconnect.
    };
    return () => {
      es.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Clear unread count when user focuses the panel or switches conversations.
    const onFocus = () => clearTitleUnread();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  useEffect(() => {
    clearTitleUnread();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  async function assignToMe() {
    if (!activeId) return;
    try {
      await postJson(`/api/support/agent/conversations/${activeId}/assign`, {});
      toast.success("Assigned to you.");
      await loadInbox();
    } catch (e: any) {
      toast.error(e?.detail ?? e?.message ?? "Assign failed.");
    }
  }

  async function updateStatus(status: "open" | "pending" | "closed") {
    if (!activeId) return;
    try {
      await postJson(`/api/support/agent/conversations/${activeId}/status`, { status });
      toast.success(`Marked ${status}.`);
      await loadInbox();
    } catch (e: any) {
      toast.error(e?.detail ?? e?.message ?? "Update failed.");
    }
  }

  async function updatePriority(priority: "low" | "normal" | "high" | "urgent") {
    if (!activeId) return;
    try {
      await postJson(`/api/support/agent/conversations/${activeId}/priority`, { priority });
      toast.success(`Priority set to ${priority}.`);
      await loadInbox();
    } catch (e: any) {
      toast.error(e?.detail ?? e?.message ?? "Update failed.");
    }
  }

  async function ringUser() {
    if (!activeId) return;
    try {
      await postJson(`/api/support/agent/conversations/${activeId}/ring`, {});
      toast.success("Ringing user...");
    } catch (e: any) {
      toast.error(e?.detail ?? e?.message ?? "Ring failed.");
    }
  }

  async function sendReply() {
    const text = draft.trim();
    if (!text || !activeId) return;
    setDraft("");
    try {
      await postJson(`/api/support/agent/conversations/${activeId}/messages`, { body: text });
      await loadConversation(activeId);
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    } catch (e: any) {
      toast.error(e?.detail ?? e?.message ?? "Send failed.");
      setDraft(text);
    }
  }

  const topChip = (label: string, active: boolean) =>
    cn(
      "rounded-full border px-3 py-1.5 text-[0.7rem] font-medium transition-colors",
      active ? "border-[#eca8d6]/30 bg-[#eca8d6]/10 text-white" : "border-white/10 bg-white/5 text-white/70 hover:text-white"
    );

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col font-sans overflow-hidden">
      {/* Cinematic Background Video */}
      <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden text-black">
        <video
          autoPlay
          muted
          loop
          playsInline
          className="w-full h-full object-cover scale-[1.02] opacity-50"
        >
          <source src="/images/marketing/hero.mp4" type="video/mp4" />
        </video>
        <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-black/60" />
      </div>

      {/* Small Pink Header */}
      <div className="h-10 px-4 flex items-center justify-between shrink-0 border-b border-white/5 bg-black/20 backdrop-blur-md z-10">
        <div className="text-[10px] font-mono uppercase tracking-[0.3em] text-[#eca8d6] font-bold">Support Console</div>
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2.5 rounded-md border border-white/5 bg-white/[0.02] text-[9px] font-mono uppercase tracking-wider text-white/40 hover:text-white hover:bg-white/10"
            onClick={playRingtone}
          >
            Test Console Notifications
          </Button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden border-t border-white/10 z-10">
        {/* Inbox Sidebar */}
        <section className="w-[380px] shrink-0 border-r border-white/10 flex flex-col bg-black/10 backdrop-blur-lg">
          <div className="p-4 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <div className="text-xl font-display tracking-tight text-white">Chats</div>
              <div className="text-[10px] font-mono text-white/20 uppercase tracking-widest">
                {loadingInbox ? "..." : `${filteredInbox.length}`}
              </div>
            </div>

            <div className="relative">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-white/20" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search or start new chat"
                className="h-9 rounded-lg border-none bg-white/[0.05] pl-10 text-sm text-white placeholder:text-white/20 focus-visible:ring-1 focus-visible:ring-white/10"
              />
            </div>

            <div className="flex items-center gap-2">
              <button 
                className={cn(
                  "px-3 py-1 text-[11px] font-semibold rounded-full transition-all border",
                  filters.view === "all" ? "bg-white text-black border-white" : "border-white/10 text-white/40 hover:text-white/70"
                )}
                onClick={() => setFilters({ view: "all" })}
              >
                All
              </button>
              <button 
                className={cn(
                  "px-3 py-1 text-[11px] font-semibold rounded-full transition-all border",
                  filters.view === "unread" ? "bg-[#eca8d6] text-black border-[#eca8d6]" : "border-white/10 text-white/40 hover:text-white/70"
                )}
                onClick={() => setFilters({ view: "unread" })}
              >
                Unread
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto thin-scrollbar">
            {loadingInbox ? (
              Array.from({ length: 12 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-3 animate-pulse border-b border-white/[0.03]">
                  <div className="size-12 rounded-full bg-white/5" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 w-1/3 bg-white/5 rounded" />
                    <div className="h-3 w-2/3 bg-white/5 rounded" />
                  </div>
                </div>
              ))
            ) : filteredInbox.length === 0 ? (
              <div className="px-4 py-12 text-center text-sm text-white/30">No chats available.</div>
            ) : (
              filteredInbox.map((c) => {
                const active = c.id === activeId;
                return (
                  <button
                    key={c.id}
                    onClick={() => setActiveId(c.id)}
                    className={cn(
                      "w-full flex items-center gap-3 px-4 py-3 transition-colors relative border-b border-white/[0.03] group",
                      active ? "bg-white/[0.07]" : "hover:bg-white/[0.04]"
                    )}
                  >
                    <Avatar className="size-12 shrink-0">
                      <AvatarFallback className="bg-white/5 text-white/60 text-sm font-mono ring-1 ring-white/10">
                        {displayName(c).substring(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between mb-0.5">
                        <div className={cn("text-sm truncate", active ? "font-semibold text-white" : "font-medium text-white/90")}>
                          {displayName(c)}
                        </div>
                        <div className="text-[10px] text-white/20">
                          {new Date(c.last_message_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </div>
                      
                      <div className="flex items-center justify-between gap-1">
                        <div className="text-[13px] text-white/40 truncate leading-tight flex-1">
                          {c.last_message_body || "No messages yet"}
                        </div>
                        {c.last_message_sender_type === 'user' && c.id !== activeId && (
                          <div className="size-2 rounded-full bg-[#eca8d6] shrink-0 ml-2" />
                        )}
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </section>


        {/* Thread Component */}
        <section className="flex-1 flex flex-col bg-black/5 min-w-0">
          {activeId && (inbox.find(c => c.id === activeId)) && (
            <div className="h-16 px-6 border-b border-white/10 flex items-center justify-between shrink-0 bg-white/[0.02] backdrop-blur-md">
              <div className="flex items-center gap-3">
                <Avatar className="size-10">
                  <AvatarFallback className="bg-white/5 text-white/60 text-xs font-mono ring-1 ring-white/10 text-center flex items-center justify-center">
                    {inbox.find(c => c.id === activeId)?.user_first_name?.[0] || "U"}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-white truncate">
                    {displayName(inbox.find(c => c.id === activeId) as any)}
                  </div>
                </div>
              </div>
              
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  className="h-8 px-3 rounded-md border border-[#eca8d6]/20 bg-[#eca8d6]/5 text-[10px] font-mono uppercase tracking-wider text-[#eca8d6] hover:bg-[#eca8d6]/10"
                  onClick={ringUser}
                >
                  <Phone className="size-3 mr-2" />
                  Ring User
                </Button>

                <Button
                  type="button"
                  variant="ghost"
                  className="size-8 p-0 rounded-full text-white/20 hover:text-white hover:bg-white/5"
                  onClick={() => setActiveId(null)}
                >
                  <X className="size-4" />
                </Button>
              </div>
            </div>
          )}

          <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-8 space-y-4 thin-scrollbar bg-transparent">
            {loadingMessages ? (
              <div className="space-y-6">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className={cn("flex", i % 2 === 0 ? "justify-start" : "justify-end")}>
                    <Skeleton className={cn("h-16 w-3/4 rounded-2xl bg-white/5", i % 2 === 0 ? "rounded-bl-none" : "rounded-br-none")} />
                  </div>
                ))}
              </div>
            ) : !activeId ? (
              <div className="h-full flex flex-col items-center justify-center text-center select-none opacity-20">
                <div className="text-[13px] font-medium">Select a chat to view messages and customer context.</div>
              </div>
            ) : messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center select-none opacity-20">
                <div className="text-[13px] font-medium">No messages yet. Start the conversation!</div>
              </div>
            ) : (
              messages.map((m) => {
                const mine = m.sender_type === "agent";
                return (
                  <div key={m.id} className={cn("flex", mine ? "justify-end" : "justify-start")}>
                    <div
                      className={cn(
                        "max-w-[75%] rounded-2xl px-3.5 py-2.5 text-[14px] leading-relaxed relative",
                        mine ? "rounded-tr-none bg-[#eca8d6] text-black shadow-lg" : "rounded-tl-none bg-white/5 backdrop-blur-md text-white border border-white/10"
                      )}
                    >
                      <div className="whitespace-pre-wrap">{m.body}</div>
                      <div className={cn("mt-1.5 text-[9px] font-mono text-right", mine ? "text-black/50" : "text-white/30")}>
                        {new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div className="h-20 px-6 flex items-center gap-3 shrink-0 bg-white/[0.02] backdrop-blur-md border-t border-white/5">
            <div className="flex-1 relative">
              <Input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    sendReply();
                  }
                }}
                placeholder="Type a message..."
                className="h-11 w-full rounded-xl border-none bg-white/[0.05] px-4 text-sm text-white focus-visible:ring-1 focus-visible:ring-white/10"
                disabled={!activeId}
              />
            </div>
            <Button
              type="button"
              variant="ghost"
              className="size-11 rounded-full bg-[#eca8d6] p-0 text-black hover:bg-[#eca8d6]/90 shrink-0 flex items-center justify-center"
              onClick={sendReply}
              disabled={!activeId || !draft.trim()}
            >
              <svg className="size-5 rotate-45 -ml-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            </Button>
          </div>
        </section>

      </div>
    </div>
  );
}
