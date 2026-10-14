// client/vite.config.js
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    // API_PROXY lets local dev point at the deployed backend, e.g. the EB URL.
    proxy: { "/api": process.env.API_PROXY ?? "http://localhost:4000" },
  },
});
