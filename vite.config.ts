import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
const inventoryVersion = JSON.parse(readFileSync(new URL("./public/data/parking.json", import.meta.url), "utf8")).updated;
export default defineConfig({
  plugins: [react()],
  base: "/projects/park-in-paris/",
  define: { "import.meta.env.VITE_INVENTORY_VERSION": JSON.stringify(inventoryVersion) },
});
