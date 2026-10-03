import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

const CORE_TARGET = process.env["PAPERWITHA_CORE_URL"] ?? "http://127.0.0.1:4130";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [react()],
  server: {
    port: 4173,
    strictPort: true,
    proxy: {
      "/api": { target: CORE_TARGET, changeOrigin: true, ws: true },
    },
  },
  build: { outDir: "dist", emptyOutDir: true },
});
