"""بازنشستگی سید دموهای کتابخانه (فاز ۹).

seed_library_demo پنج آیتم نمایشی عمومی می‌ساخت و چون شمارش‌محور بود
(کمتر از ۵ آیتم یعنی ساختِ دوبارهٔ همهٔ specها، با تکثیر بازمانده‌ها)،
حذف دموها از CRM عملاً ناممکن بود. این تست‌ها قفل می‌کنند که
entrypoint سید (app.seed) دیگر آن را صدا نمی‌زند.

خود ماژول seed_library عمداً سر جایش مانده است (کد مرده)؛ تست دوم
بودنش را بررسی می‌کند تا حذف تصادفی ماژول با بازنشستگی سید قاطی نشود.
اجرای کامل app.seed.main در تست ممکن نیست (موتور/مدیر bootstrap خودش
را می‌خواهد)، پس قفل روی سیم‌کشی entrypoint است، نه روی خروجی سید.
"""
from __future__ import annotations

import inspect


def test_seed_entrypoint_does_not_invoke_library_demo_seed():
    from app import seed

    source = inspect.getsource(seed)
    assert "seed_library_demo" not in source
    assert "seed_library" not in source


def test_library_demo_seed_module_kept_but_unwired():
    from app.modules.library import seed_library

    assert callable(seed_library.seed_library_demo)
