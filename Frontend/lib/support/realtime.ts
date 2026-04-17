import { sql } from "@/lib/db";

export type SupportRealtimeEvent =
  | { type: "ping"; ts: number }
  | { type: "call.ring"; conversationId: string; targetUserId?: string | null }
  | { type: "message.created"; conversationId: string; messageId: string; senderType: "user" | "agent" | "system"; createdAt: string; targetUserId?: string | null };

// Simple in-memory pubsub for local instance updates.
type Listener = (evt: SupportRealtimeEvent) => void;

declare global {
  // eslint-disable-next-line no-var
  var __designerSupportRealtimeListeners: Set<Listener> | undefined;
  // eslint-disable-next-line no-var
  var __designerSupportLastEventTime: number | undefined;
}

function listeners(): Set<Listener> {
  if (!globalThis.__designerSupportRealtimeListeners) {
    globalThis.__designerSupportRealtimeListeners = new Set();
    startCrossInstancePoller();
  }
  return globalThis.__designerSupportRealtimeListeners;
}

/**
 * Publishes an event to the local instance memory AND persists to DB
 * so other instances can pick it up via polling.
 */
export async function publishSupportEvent(evt: SupportRealtimeEvent) {
  // Try to find the user_id for this conversation to help the SSE filter skip DB hits
  if (evt.type === "message.created" || evt.type === "call.ring") {
    if (!evt.targetUserId) {
      try {
        const rows = await sql()<{ user_id: string | null }>`
          select user_id from support_conversations where id = ${evt.conversationId} limit 1
        `;
        if (rows[0]) {
          evt.targetUserId = rows[0].user_id;
        }
      } catch { /* ignore */ }
    }
  }

  // 1. Notify local listeners immediately for lowest latency
  notifyLocal(evt);

  // 2. Persist to DB for cross-instance sync
  if (evt.type === "message.created" || evt.type === "call.ring") {
    try {
      await sql()`
        insert into support_events (conversation_id, type, payload)
        values (${evt.conversationId}, ${evt.type}, ${JSON.stringify(evt)})
      `;
    } catch {
      // ignore persistence error; local already notified
    }
  }
}

function notifyLocal(evt: SupportRealtimeEvent) {
  for (const fn of listeners()) {
    try {
      fn(evt);
    } catch {
      // ignore
    }
  }
}

export function subscribeSupportEvents(fn: Listener) {
  const s = listeners();
  s.add(fn);
  return () => s.delete(fn);
}

/**
 * In serverless multi-instance (Vercel), instances don't share memory.
 * This poller checks the DB for events created by other instances.
 */
function startCrossInstancePoller() {
  if (typeof window !== "undefined") return; // Server-only

  // 1 second poll for faster responsiveness in multi-instance or local dev
  const interval = 1000;
  setInterval(async () => {
    if (listeners().size === 0) return;

    try {
      const since = globalThis.__designerSupportLastEventTime || Date.now();
      const rows = await sql()<{ payload: any; created_at: string }>`
        select payload, created_at
        from support_events
        where created_at > ${new Date(since).toISOString()}
        order by created_at asc
        limit 50
      `;

      for (const row of rows) {
        const evt = row.payload as SupportRealtimeEvent;
        const ts = new Date(row.created_at).getTime();
        globalThis.__designerSupportLastEventTime = Math.max(globalThis.__designerSupportLastEventTime || 0, ts);
        
        // Notify local listeners of the external event
        notifyLocal(evt);
      }

      if (rows.length === 0) {
        globalThis.__designerSupportLastEventTime = Date.now();
      }
    } catch {
      // ignore
    }
  }, interval);
}


