import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    // Production source maps are disabled deliberately: shipped maps leak
    // internal structure and were a review finding against sibling portals.
    sourcemap: false,
    target: "es2023"
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"]
  }
});
