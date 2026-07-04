import { useEffect } from "react";
import { AppState } from "react-native";
import { focusManager, useQueryClient } from "@tanstack/react-query";
import EventSource from "react-native-sse";
import { api } from "./api";
import { useActiveWorkspace } from "./store/connection";

type StreamEvent = "request_created" | "request_updated" | "message_created" | "review_changed" | "notification";

/**
 * Mirrors the web app's SSE hook (apps/web/src/lib/sse.ts): one stream per
 * session; server events invalidate the matching queries so threads, lists,
 * and badges stay live without waiting for the next poll.
 *
 * React Native has no built-in EventSource, hence react-native-sse.
 */
export function useRealtime(): void {
  const ws = useActiveWorkspace();
  const token = ws?.token ?? null;
  const origin = ws?.origin ?? null;
  const qc = useQueryClient();

  // Tell react-query about app foreground/background so refetchOnWindowFocus
  // and refetchInterval behave correctly on native.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      focusManager.setFocused(state === "active");
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!token || !origin) return;

    const invalidate = (...keys: string[][]) => {
      for (const key of keys) void qc.invalidateQueries({ queryKey: key });
    };

    const es = new EventSource<StreamEvent>(api.streamUrl(), { pollingInterval: 5000 });

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
    es.addEventListener("notification", () => invalidate(["notifications"]));

    // The stream is dead while the app is backgrounded — refetch everything
    // once on return so missed events can't leave stale screens behind.
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void qc.invalidateQueries();
    });

    return () => {
      sub.remove();
      es.removeAllEventListeners();
      es.close();
    };
  }, [token, origin, qc]);
}

function safeParse(raw: string | null | undefined): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}
