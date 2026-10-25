#!/bin/sh
# web start: next روی پورت داخلی 3000 + nginx جلوی آن روی $PORT (Railway).
# اگر هر کدام از دو پروسس بمیرد، اسکریپت با کد غیرصفر خارج می‌شود تا
# Railway کانتینر را ری‌استارت کند (نه اینکه با 502 زنده بماند).
set -e
PORT="${PORT:-8080}"
sed "s/__PORT__/$PORT/g" ./nginx.conf.template > /tmp/nginx.conf
./node_modules/.bin/next start -p 3000 &
NEXT_PID=$!
# صبر کن تا next واقعاً روی 3000 گوش بدهد (حداکثر 30 ثانیه) تا nginx
# قبل از آماده‌شدن upstream، 502 ندهد.
READY=0
i=0
while [ "$i" -lt 30 ]; do
  if node -e "require('net').connect(3000,'127.0.0.1').on('connect',()=>process.exit(0)).on('error',()=>process.exit(1))" 2>/dev/null; then
    READY=1
    break
  fi
  sleep 1
  i=$((i + 1))
done
if [ "$READY" != "1" ]; then
  echo "[web] next did not listen on port 3000 within 30s" >&2
  kill $NEXT_PID 2>/dev/null || true
  exit 1
fi
nginx -c /tmp/nginx.conf -g 'daemon off;' &
NGINX_PID=$!
# هر کدام زودتر مرد، دیگری را بکش و با خطا خارج شو.
wait -n $NEXT_PID $NGINX_PID || true
kill $NEXT_PID $NGINX_PID 2>/dev/null || true
exit 1
