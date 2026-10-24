# فاز ۱۷ — Dockerfile production برای وب (Next.js 14)
# بیلد از ریشهٔ ریپو (context: .) چون به packages/design-tokens نیاز دارد.
FROM node:24-alpine AS deps
WORKDIR /app
COPY apps/web/package.json apps/web/package-lock.json ./web/
COPY packages/design-tokens ./packages/design-tokens
WORKDIR /app/web
RUN npm ci --no-audit --no-fund

FROM node:24-alpine AS builder
WORKDIR /app/web
COPY --from=deps /app/web/node_modules ./node_modules
COPY --from=deps /app/packages /app/packages
COPY apps/web/ ./
# API عمومی وب در زمان build تزریق می‌شود — عمداً default ندارد: بیلد بدون
# مقدار صریح، در next.config.mjs با خطای واضح فیل می‌کند (Track 2 / §۱۳ —
# نه fallback خاموش به localhost:8000). مقدار از compose می‌آید:
# docker-compose.prod.yml → build.args.NEXT_PUBLIC_API_URL (WEB_API_URL اجباری).
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
# API_URL سروری هم در زمان build لازم است: `next build` هنگام
# collect-page-data روت‌هندلرها را اجرا می‌کند و آن‌ها lib/api.ts را
# import می‌کنند که در production بدون API_URL صریح throw می‌کند
# (Track 3 — همان دلیلی که job وب در CI هر دو متغیر را می‌گذارد).
# مقدار زمان build در باندل bake نمی‌شود (فقط NEXT_PUBLIC_*ها inline
# می‌شوند)؛ رانتایم از environment سرویس می‌آید (compose: http://api:8000).
ARG API_URL
ENV API_URL=$API_URL
RUN npm run build

FROM node:24-alpine AS runner
WORKDIR /app/web
ENV NODE_ENV=production
# بدون output:standalone در next.config — کل بیلد + node_modules کپی می‌شود
COPY --from=builder /app/web/public ./public
COPY --from=builder /app/web/.next ./.next
COPY --from=builder /app/web/node_modules ./node_modules
COPY --from=builder /app/web/package.json ./package.json
COPY --from=builder /app/web/next.config.mjs ./next.config.mjs
EXPOSE 3000
CMD ["npm", "start"]
