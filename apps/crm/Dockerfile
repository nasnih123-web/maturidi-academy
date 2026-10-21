# فاز ۱۷ — Dockerfile production برای CRM (Vite SPA → nginx)
# بیلد از ریشهٔ ریپو (context: .) چون به packages/ui-web نیاز دارد.
FROM node:24-alpine AS builder
WORKDIR /app/crm
# Track 2 / §۱۴ — وابستگی file: به @maturidi/ui-web: باید *قبل* از npm ci
# در ایمیج باشد، وگرنه npm ci روی file:../../packages/ui-web فیل می‌کند.
# (ui-web فقط peerDep به react/react-dom دارد که از همین‌جا تأمین می‌شود؛
#  design-tokens را لازم ندارد — توکن‌ها به‌صورت tokens.css محلی‌اند.)
COPY packages/ui-web ../packages/ui-web
COPY apps/crm/package.json apps/crm/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY apps/crm/ ./
# Track 2 / §۱۳ — VITE_API_URL عمداً default ندارد: بیلد production بدون مقدار
# صریح در vite.config.ts با خطای واضح فیل می‌کند (نه fallback خاموش به localhost).
ARG VITE_API_URL
RUN npm run build

FROM nginx:1.27-alpine AS runner
COPY --from=builder /app/crm/dist /usr/share/nginx/html
# SPA fallback: همهٔ مسیرها به index.html (روتینگ سمت‌کلاینت)
RUN printf 'server {\n  listen 80;\n  root /usr/share/nginx/html;\n  index index.html;\n  location / { try_files $uri $uri/ /index.html; }\n  location ~* \\.(js|css|png|jpg|jpeg|svg|woff2)$ {\n    expires 30d;\n    add_header Cache-Control "public, immutable";\n  }\n}\n' > /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
