import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import path from "node:path";
import { defineConfig } from "vite";

// Keep esbuild's scratch files inside the project: some Windows sandboxes and
// locked-down %TEMP% directories deny the delete esbuild performs after a
// transform, which breaks the build with "Access is denied".
const localTemp = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..", ".tmp");
process.env.TMP = localTemp;
process.env.TEMP = localTemp;

export default defineConfig({
  base: "/app/",
  plugins: [react()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
});
