/// <reference types="vitest/config" />
import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, loadEnv } from "vite";

// GitHub Pages serves the app under /bauwerk/. Locally the base stays "/".
// The deploy workflow sets VITE_BASE_PATH=/bauwerk/.
const base = process.env.VITE_BASE_PATH ?? "/";

export default defineConfig(({ mode }) => {
  // Ports of the LoD2 API and the vision service come from the root .env, like theirs do.
  const env = loadEnv(mode, ".", "");
  const apiPort = env.LOD2_API_PORT || "8788";
  const visionPort = env.LOD2_VISION_PORT || "8790";
  const collabPort = env.BAUWERK_SERVER_PORT || "8789";
  // The dev server talks to the collaboration server that `npm run dev` starts. A build
  // without VITE_API_URL (GitHub Pages) stays a local editor.
  if (mode === "development" && !env.VITE_API_URL) process.env.VITE_API_URL = "/collab";
  return {
    base,
    plugins: [react(), tailwindcss()],
    server: {
      // One origin for the browser: the LoD2 API under /api, the SAM 3 service under /vision.
      proxy: {
        "/api": {
          target: `http://127.0.0.1:${apiPort}`,
          rewrite: (p: string) => p.replace(/^\/api/, ""),
        },
        "/collab": {
          target: `http://127.0.0.1:${collabPort}`,
          ws: true,
          rewrite: (p: string) => p.replace(/^\/collab/, ""),
        },
        "/vision": {
          target: `http://127.0.0.1:${visionPort}`,
          rewrite: (p: string) => p.replace(/^\/vision/, ""),
        },
      },
    },
    build: {
      // Three.js plus drei is about 1 MB minified and maplibre about 800 kB; each lives in its
      // own cached chunk.
      chunkSizeWarningLimit: 1100,
      rolldownOptions: {
        output: {
          codeSplitting: {
            groups: [
              { name: "three", test: /node_modules[\\/]three[\\/]/ },
              { name: "r3f", test: /node_modules[\\/]@react-three[\\/]/ },
              { name: "map", test: /node_modules[\\/]maplibre-gl[\\/]/ },
              {
                name: "react",
                test: /node_modules[\\/](react|react-dom|scheduler|zustand|immer)[\\/]/,
              },
            ],
          },
        },
      },
    },
    resolve: {
      alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
    },
    test: {
      globals: true,
      environment: "jsdom",
      include: ["src/**/*.test.{ts,tsx}"],
      // The panel tests render the whole app with jsdom; CI runners need more than the 5 s default.
      testTimeout: 20000,
      coverage: { include: ["src/geometry/**", "src/store/**"] },
    },
  };
});
