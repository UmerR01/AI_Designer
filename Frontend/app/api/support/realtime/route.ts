import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/server";
import { sql } from "@/lib/db";
import { subscribeSupportEvents } from "@/lib/support/realtime";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ detail: "Unauthorized." }, { status: 401 });

  // Agents get all events, Users only get events for their own conversations.
  const isAgent = await sql()<{ is_support_agent: boolean }>`
    select is_support_agent from users where id = ${user.id} limit 1
  `.then((r: { is_support_agent: boolean }[]) => !!r[0]?.is_support_agent);

  const encoder = new TextEncoder();
  let closeStream: (() => void) | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let unsubscribe: (() => void) | null = null;

      const safeClose = () => {
        if (closed) return;
        closed = true;
        try {
          unsubscribe?.();
        } catch {
          // ignore
        }
        unsubscribe = null;
        try {
          controller.close();
        } catch {
          // ignore
        }
      };
      closeStream = safeClose;

      // When the client disconnects, Next/Fetch will abort the request.
      // This is the most reliable way to stop timers in SSE handlers.
      try {
        req.signal.addEventListener("abort", safeClose, { once: true });
      } catch {
        // ignore
      }

      const send = (obj: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
        } catch {
          // Stream got closed by client; stop timers and listeners.
          safeClose();
        }
      };

      // initial hello (no periodic pings; avoids timer writes after disconnect in some runtimes)
      send({ type: "hello", ts: Date.now() });

      unsubscribe = subscribeSupportEvents(async (evt) => {
        if (isAgent) {
          send(evt);
          return;
        }

        // For users, only send if the conversation belongs to them.
        if (evt.type === "message.created" || evt.type === "call.ring") {
          // Optimization: If we already attached targetUserId to the event, use it.
          if (evt.targetUserId !== undefined) {
            // Match exactly if user_id exists, or if both are null (guest)
            if (evt.targetUserId === user.id || (evt.targetUserId === null && !user)) {
              send(evt);
            }
          } else {
            // Fallback: Query the DB
            try {
              const rows = await sql()<{ user_id: string | null }>`
                select user_id from support_conversations where id = ${evt.conversationId} limit 1
              `;
              // Match if it belongs to this user
              if (rows[0]?.user_id === user.id) {
                send(evt);
              }
            } catch {
              // ignore
            }
          }
        }
      });

      // When the consumer cancels, ReadableStream will call `cancel()` below; this is a no-op.
      // We still return a cleanup function for runtimes that honor it.
      return safeClose;
    },
    cancel() {
      // Ensure cleanup in runtimes that call cancel without aborting the request.
      closeStream?.();
    },
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

