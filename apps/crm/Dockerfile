# فاز ۱۷ — Dockerfile production برای CRM (Vite SPA → nginx)
# بیلد از ریشهٔ ریپو (context: .).
FROM node:20-alpine AS builder
WORKDIR /app/crm
COPY apps/crm/package.json apps/crm/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY apps/crm/ ./
RUN npm run build

FROM nginx:1.27-alpine AS runner
COPY --from=builder /app/crm/dist /usr/share/nginx/html
# SPA fallback: همهٔ مسیرها به index.html (روتینگ سمت‌کلاینت)
RUN printf 'server {\n  listen 80;\n  root /usr/share/nginx/html;\n  index index.html;\n  location / { try_files $uri $uri/ /index.html; }\n  location ~* \\.(js|css|png|jpg|jpeg|svg|woff2)$ {\n    expires 30d;\n    add_header Cache-Control "public, immutable";\n  }\n}\n' > /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
