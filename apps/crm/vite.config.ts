import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// CRM dev server: http://localhost:5173 — API base comes from VITE_API_URL.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
  },
});
