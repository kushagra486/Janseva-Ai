import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "JANSEVA AI — सरकार की बात, आपकी भाषा में",
    short_name: "JANSEVA",
    description: "Decode government notices, find services and schemes, and report civic problems.",
    start_url: "/hi",
    display: "standalone",
    background_color: "#0a0f1c",
    theme_color: "#0a0f1c",
    lang: "hi",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
    ],
  };
}
