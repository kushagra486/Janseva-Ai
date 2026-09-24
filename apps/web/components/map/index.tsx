"use client";
import dynamic from "next/dynamic";

// Leaflet touches `window` at import time, so the map only renders in the browser.
export const MapView = dynamic(() => import("./map-view"), {
  ssr: false,
  loading: () => <div className="h-80 animate-pulse rounded-xl bg-surface-2" />,
});
export type { MapPin } from "./map-view";

export const CATEGORY_COLORS: Record<string, string> = {
  waste: "#a3e635",
  water_drainage: "#38bdf8",
  roads: "#ff9933",
  streetlights: "#facc15",
  public_infra: "#c084fc",
};
