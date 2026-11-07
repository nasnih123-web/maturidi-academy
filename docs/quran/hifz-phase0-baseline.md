# فاز ۰ — مبنای مخزن و تست (Baseline)

- تاریخ: ۲۰۲۶-۱۱-۰۷
- مخزن: `nasnih123-web/maturidi-academy`
- Worktree: `~/workspace/quran-hifz-parity`
- شاخه: `feature/hifz-tarteel-parity`
- مبنا: main `47a502610bfa7aef287af4b4caee784c1abbf3d6` (مرج PR #114)
- وضعیت درخت در شروع: تمیز

## Baseline تست (پیش از هر تغییر)

| تست | فرمان | نتیجه |
|---|---|---|
| API pytest کامل | `cd apps/api && ~/workspace/overnight/.venv-item/bin/python -m pytest -q -p no:cacheprovider` | **۱۰۳۳ passed، ۶ skipped**، ۷۱۰ warning، مدت ۳۷۳٫۹۸ ثانیه، exit 0 |
| Ruff baseline | `~/workspace/.venv-ruff/bin/python tools/check_ruff_baseline.py` از ریشهٔ مخزن | **PASS — دقیقاً روی baseline (۱۲۹ خطای شناخته‌شده)** |
| tsc وب | `./node_modules/.bin/tsc --noEmit` (با symlink موقت node_modules از `~/workspace/globe-fixes/apps/web/node_modules`) | **exit 0، بدون خطا** |
| tsc CRM | `./node_modules/.bin/tsc --noEmit` (با symlink موقت node_modules از `~/workspace/articles-slider-editor/apps/crm/node_modules`) | **exit 0، بدون خطا** |

نکته: شمار pytest در PR #114 برابر ۱۰۳۲ بود؛ در مبنای 47a50261 برابر ۱۰۳۳ است (یک تست بیشتر — همان مبنای مرج‌شده، نه تغییر محلی).

## معماری (خلاصهٔ اولیه — جزئیات در فاز ۲)

- Monorepo: `apps/web` (Next.js)، `apps/api` (FastAPI)، `apps/crm`، `apps/mobile` (Expo/React Native)، `apps/desktop` (Tauri).
- حفاظ وب: `apps/web/components/QuranHifzStudy.tsx` (بازسازی PR #114) + `apps/api/app/modules/quran/hifz_*.py`.
- موتور ASR: Zipformer (Quran-Lab v3.1، پیش‌فرض) + Whisper-quran (قابل‌انتخاب در CRM)؛ فایل‌های مدل از Google Drive دانلود می‌شوند، نه git.
- CI: هشت job (backend، web، crm، mobile، postgres، docker، Compose smoke، lint-workflows)؛ روی push به main و pull_request اجرا می‌شود.
