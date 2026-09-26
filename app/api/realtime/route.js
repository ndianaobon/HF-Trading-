import { getSession } from "@/lib/auth/session";
import { subscribe } from "@/lib/realtime/bus";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Server-Sent Events stream of user-scoped events (orders, trades, wallet,
 * notifications). Clients fall back to polling if the stream is unavailable.
 * A dedicated WebSocket gateway can replace this behind the same event shape.
 */
export async function GET(req) {
  const session = await getSession();
  if (!session) return new Response(JSON.stringify({ error: { code: "UNAUTHENTICATED", message: "Please log in." } }), { status: 401 });

  const encoder = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream({
    start(controller) {
      const send = (payload) => {
        try {
          controller.enqueue(encoder.encode(payload));
        } catch {
          cleanup();
        }
      };
      send(`retry: 5000\nevent: ready\ndata: {"ok":true}\n\n`);
      const unsubscribe = subscribe(session.user.id, (event) => send(`data: ${JSON.stringify(event)}\n\n`));
      const heartbeat = setInterval(() => send(`: ping ${Date.now()}\n\n`), 25_000);
      // Re-check the session periodically so revoked sessions stop receiving events.
      const expiry = setInterval(() => {
        if (session.expiresAt < new Date()) cleanup();
      }, 60_000);
      cleanup = () => {
        clearInterval(heartbeat);
        clearInterval(expiry);
        unsubscribe();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      req.signal.addEventListener("abort", () => cleanup());
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
