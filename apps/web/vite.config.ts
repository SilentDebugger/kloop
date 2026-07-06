import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg"],
      manifest: {
        name: "kloop",
        short_name: "kloop",
        description: "Ask once. Answered forever.",
        theme_color: "#F4F2EC",
        background_color: "#F4F2EC",
        display: "standalone",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
        ],
      },
      workbox: {
        // never cache the API — it's live data; offline drafts are handled in-app
        navigateFallbackDenylist: [/^\/api/, /^\/\.well-known/],
        runtimeCaching: [],
      },
    }),
  ],
  server: {
    host: true, // listen on the LAN so phones on the same Wi-Fi can open dev links
    port: 5173,
    proxy: {
      "/api": { target: "http://localhost:8787", changeOrigin: false },
      "/.well-known": { target: "http://localhost:8787", changeOrigin: false },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
  },
});
