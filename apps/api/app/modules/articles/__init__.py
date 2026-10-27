"""ماژول مقالات وردپرسی — آینهٔ فهرست وردپرسی فتوا (PR #55) برای مقالات.

روترها نازک؛ همهٔ منطق در service.py. گردش‌کار وضعیت از ماشین
مشترک app.core.workflow می‌آید (draft → in_review → approved →
published → archived؛ archived فقط به draft برمی‌گردد).
"""
