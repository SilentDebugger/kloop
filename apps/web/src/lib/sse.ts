import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import { useAuth } from "./auth";

/**
 * One SSE connection per session. Server events invalidate the matching
 * queries so lists, threads, and badges stay live without polling.
 */
export function useRealtime(): void {
  const token = useAuth((s) => s.token);
  const qc = useQueryClient();

  useEffect(() => {
    if (!token) return;
    let es: EventSource | null = null;
    let closed = false;
    let retry = 1000;

    const connect = () => {
      if (closed) return;
      es = new EventSource(api.streamUrl());
      es.onopen = () => {
        retry = 1000;
      };
      es.onerror = () => {
        es?.close();
        if (!closed) {
          setTimeout(connect, retry);
          retry = Math.min(retry * 2, 15_000);
        }
      };

      const invalidate = (...keys: string[][]) => {
        for (const key of keys) qc.invalidateQueries({ queryKey: key });
      };

      es.addEventListener("request_created", () => invalidate(["requests"]));
      es.addEventListener("request_updated", (e) => {
        const data = safeParse(e.data);
        invalidate(["requests"]);
        if (data?.id) invalidate(["request", String(data.id)]);
      });
      es.addEventListener("message_created", (e) => {
        const data = safeParse(e.data);
        invalidate(["requests"]);
        if (data?.requestId) invalidate(["request", String(data.requestId)]);
      });
      es.addEventListener("review_changed", () => invalidate(["reviews"], ["review-counts"]));
      es.addEventListener("ai_activity", (e) => {
        const data = safeParse(e.data);
        invalidate(["ai-activity"]);
        if (data?.requestId) invalidate(["request", String(data.requestId)]);
      });
      es.addEventListener("notification", () => invalidate(["notifications"]));
    };

    connect();
    return () => {
      closed = true;
      es?.close();
    };
  }, [token, qc]);
}

function safeParse(raw: string): Record<string, unknown> | null {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}
