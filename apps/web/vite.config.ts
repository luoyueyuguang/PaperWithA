import { defineConfig } from "vite";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  server: { port: 4173, strictPort: true },
  build: { outDir: "dist", emptyOutDir: true },
});
