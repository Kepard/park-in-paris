import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
const inventoryVersion = JSON.parse(readFileSync(new URL("./public/data/parking.json", import.meta.url), "utf8")).updated;
export default defineConfig({
  plugins: [react()],
  base: "/",
  server: { proxy: { "/api": "http://127.0.0.1:3001" } },
  define: { "import.meta.env.VITE_INVENTORY_VERSION": JSON.stringify(inventoryVersion) },
});
