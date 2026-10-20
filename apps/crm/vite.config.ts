import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// @types/node در این پکیج نصب نیست (رجیستری npm در دسترس نیست)؛
// برای همین اعلان حداقلی process.env همین‌جا — فقط چیزی که لازم است.
declare const process: { env: Record<string, string | undefined> };

// Track 2 / §۱۳ — بیلد production CRM هرگز نباید بی‌صدا به localhost:8000
// fallback کند: VITE_API_URL در باندل عمومی (nginx) bake می‌شود.
// در CI مقدار صریح از env job تزریق می‌شود — .github/workflows/ci.yml
if (process.env.NODE_ENV === "production" && !process.env.VITE_API_URL) {
  throw new Error(
    "[crm] VITE_API_URL is required for production builds — " +
      "refusing to silently fall back to http://localhost:8000. " +
      "Set it explicitly (docker build --build-arg VITE_API_URL=...)."
  );
}

// CRM dev server: http://localhost:5173 — API base comes from VITE_API_URL.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
  },
});
