# bootstrap.ps1 — نصب و اجرای خودکار «آکادمی ماتریدی» روی ویندوز
#
#   اجرا در PowerShell (داخل پوشهٔ پروژه):
#     powershell -ExecutionPolicy Bypass -File bootstrap.ps1
#
# این اسکریپت همه‌چیز را آماده می‌کند:
#   ۱) بررسی پیش‌نیازها (Python 3.11+ ، Node 20+ ، npm)
#   ۲) ساخت venv و نصب وابستگی‌های API + اجرای migration + seed اولیه
#   ۳) npm install برای وب و CRM (فقط اگر قبلاً نصب نشده باشند)
#   ۴) اجرای هر سه سرویس در پنجره‌های جدا و نمایش آدرس‌ها
$ErrorActionPreference = "Stop"

try {
  $ROOT = Split-Path -Parent $MyInvocation.MyCommand.Path

  function Say($m)  { Write-Host ""; Write-Host ">>> $m" -ForegroundColor Green }
  function Warn($m) { Write-Host "!!! $m" -ForegroundColor Yellow }
  function Die($m)  { Write-Host ""; Write-Host "خطا: $m" -ForegroundColor Red; Read-Host "Enter برای خروج"; exit 1 }

  function Test-Version($ver, $minMajor, $minMinor) {
    $p = $ver.Split(".")
    return ([int]$p[0] -gt $minMajor) -or (([int]$p[0] -eq $minMajor) -and ([int]$p[1] -ge $minMinor))
  }

  # ---------- ۱) پیش‌نیازها ----------
  Say "بررسی پیش‌نیازها…"

  # این پروژه به Python 3.14 نیاز دارد (Phase-1 v1.1.0: کل استک
  # requirements.txt روی 3.14 پین و راستی‌آزمایی شده است).
  $pyExe = "python"; $pyPre = @(); $pyv = ""
  try {
    $t = (py -3.14 --version 2>&1).ToString()
    if ($t -match "Python (3\.14\.\d+)") { $pyv = $Matches[1]; $pyExe = "py"; $pyPre = @("-3.14") }
  } catch {}
  if ([string]::IsNullOrWhiteSpace($pyv)) {
    try { $pyv = (python --version 2>&1).ToString().Split()[1] } catch { Die "پایتون پیدا نشد. نسخهٔ 3.14 را نصب کنید: winget install Python.Python.3.14" }
  }
  if (-not $pyv.StartsWith("3.14")) { Die "نسخهٔ پایتون شما $pyv است؛ این پروژه به Python 3.14 نیاز دارد. نصب کنید: winget install Python.Python.3.14" }

  try { $nodev = (node --version 2>&1).ToString().TrimStart("v") } catch { Die "نود پیدا نشد. نصب کنید: https://nodejs.org/ (نسخهٔ LTS)" }
  if (-not (Test-Version $nodev 20 0)) { Die "نسخهٔ Node شما $nodev است؛ نسخهٔ ۲۰ یا جدیدتر لازم است." }

  try { npm --version | Out-Null } catch { Die "npm پیدا نشد (همراه Node.js نصب می‌شود)." }
  Write-Host "  Python $pyv  ✓    Node $nodev  ✓"

  # ---------- ۲) بک‌اند (API) ----------
  Say "آماده‌سازی بک‌اند…"
  $apiDir = Join-Path $ROOT "apps\api"
  # فایل .env برای API (فقط اگر وجود ندارد) — فعال‌سازی CORS برای وب و CRM؛
  # بدون این، مرورگر درخواست‌های فرانت‌اند به API را بلاک می‌کند و لاگین شکست می‌خورد.
  $envFile = Join-Path $apiDir ".env"
  if (-not (Test-Path $envFile)) {
    Write-Host "  ساخت .env برای API (CORS)…"
    [System.IO.File]::WriteAllText($envFile, "CORS_ALLOW_ORIGINS=http://localhost:3000,http://localhost:5173`r`n")
  }
  if (-not (Test-Path (Join-Path $apiDir ".venv"))) {
    Write-Host "  ساخت venv…"
    & $pyExe @pyPre -m venv (Join-Path $apiDir ".venv")
  }
  Write-Host "  نصب وابستگی‌ها… (کمی طول می‌کشد)"
  & (Join-Path $apiDir ".venv\Scripts\pip.exe") install -q --default-timeout=180 --retries=10 -r (Join-Path $apiDir "requirements.txt")

  Write-Host "  اجرای migrationها…"
  Push-Location $apiDir
  # نکته: باید قبل از migration چک شود، چون خود migration فایل dev.db را می‌سازد
  $isFreshInstall = -not (Test-Path (Join-Path $apiDir "dev.db"))
  & (Join-Path $apiDir ".venv\Scripts\alembic.exe") upgrade head
  if ($isFreshInstall) {
    Write-Host "نصب اول است — یک مدیر ارشد برای ورود به CRM می‌سازیم."
    $adminEmail = Read-Host "  ایمیل مدیر [admin@example.com]"
    if ([string]::IsNullOrWhiteSpace($adminEmail)) { $adminEmail = "admin@example.com" }
    $sec = Read-Host "  رمز عبور مدیر (حداقل ۸ کاراکتر)" -AsSecureString
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
    $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
    if ($plain.Length -lt 8) { Die "رمز عبور باید حداقل ۸ کاراکتر باشد." }
    $env:ADMIN_EMAIL = $adminEmail; $env:ADMIN_PASSWORD = $plain
    & (Join-Path $apiDir ".venv\Scripts\python.exe") -m app.seed
    $env:ADMIN_PASSWORD = $null; $plain = $null
  } else {
    Write-Host "  دیتابیس موجود است ✓"
  }
  Pop-Location

  # ---------- ۳) فرانت‌اندها ----------
  Say "نصب وابستگی‌های وب…"
  $webDir = Join-Path $ROOT "apps\web"
  if (-not (Test-Path (Join-Path $webDir "node_modules"))) { Push-Location $webDir; npm install; Pop-Location }
  else { Write-Host "  قبلاً نصب شده ✓" }

  Say "نصب وابستگی‌های CRM…"
  $crmDir = Join-Path $ROOT "apps\crm"
  if (-not (Test-Path (Join-Path $crmDir "node_modules"))) { Push-Location $crmDir; npm install; Pop-Location }
  else { Write-Host "  قبلاً نصب شده ✓" }

  # ---------- ۴) اجرا ----------
  Say "اجرای سرویس‌ها در پنجره‌های جدا…"
  Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$apiDir'; .\.venv\Scripts\uvicorn app.main:app --reload --port 8000"
  Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$webDir'; npm run dev -- --port 3000"
  Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$crmDir'; npm run dev -- --port 5173"

  function Wait-For($name, $url, $timeoutSec) {
    $elapsed = 0
    Write-Host "  در انتظار $name" -NoNewline
    while ($elapsed -lt $timeoutSec) {
      try { Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 3 | Out-Null; Write-Host " ✓"; return }
      catch { Write-Host "." -NoNewline; Start-Sleep -Seconds 2; $elapsed += 2 }
    }
    Write-Host ""; Warn "$name بالا نیامد؛ پنجرهٔ آن را بررسی کنید."
  }

  Wait-For "API" "http://127.0.0.1:8000/health" 90
  Wait-For "CRM" "http://127.0.0.1:5173/" 120
  Wait-For "WEB" "http://127.0.0.1:3000/fa" 240

  Say "همه‌چیز آماده است 🎉"
  Write-Host @"

    ┌──────────────────────────────────────────────────┐
    │  وب (فارسی) :  http://localhost:3000/fa           │
    │  وب (عربی)  :  http://localhost:3000/ar           │
    │  وب (انگلیسی): http://localhost:3000/en           │
    │  CRM        :  http://localhost:5173              │
    │  مستندات API:  http://localhost:8000/docs         │
    └──────────────────────────────────────────────────┘

    ورود به CRM با همان ایمیل و رمز مدیری که ساختید.
    برای توقف، هر سه پنجرهٔ PowerShell را ببندید.
"@

  Start-Process "http://localhost:3000/fa"
  Read-Host "Enter برای پایان"

} catch {
  Write-Host ""
  Write-Host ("خطای غیرمنتظره: " + $_.Exception.Message) -ForegroundColor Red
  Read-Host "Enter برای خروج"
  exit 1
}
