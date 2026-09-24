"use client";
import { useEffect, useRef } from "react";
import { getBrowserSupabase } from "./supabase/client";

/**
 * Calls `refresh` whenever the watched tables change. Uses Supabase Realtime when configured,
 * and falls back to polling in demo mode.
 */
export function useLive(tables: string[], refresh: () => void, pollMs = 5000) {
  const cb = useRef(refresh);
  useEffect(() => {
    cb.current = refresh;
  }, [refresh]);
  const key = tables.join(",");

  useEffect(() => {
    const supabase = getBrowserSupabase();
    if (!supabase) {
      const id = window.setInterval(() => cb.current(), pollMs);
      return () => window.clearInterval(id);
    }
    const channel = supabase.channel(`live:${key}`);
    for (const table of key.split(",")) {
      channel.on("postgres_changes", { event: "*", schema: "janseva", table }, () => cb.current());
    }
    channel.subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [key, pollMs]);
}
