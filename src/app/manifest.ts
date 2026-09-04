import type { MetadataRoute } from "next";

// Web app manifest (served at /manifest.webmanifest and auto-linked by Next). Makes the dashboard
// installable — "Add to Home Screen" opens it standalone with the SenseAgri icon and a dark splash.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "SenseAgri — Farm Portal",
    short_name: "SenseAgri",
    description: "Real-time IoT sensor dashboard and farm logging for poultry operations",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#002E35",
    theme_color: "#002E35",
    categories: ["business", "productivity", "utilities"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
