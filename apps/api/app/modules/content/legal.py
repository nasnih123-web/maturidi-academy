"""محتوای حقوقی پلتفرم — فاز ۴.

- LEGAL_TEXT_VERSION: نسخهٔ متن حقوقیِ «جاری». هنگام ثبت‌نام، همین نسخه در
  ردیف‌های user_consent (terms/privacy) ذخیره می‌شود تا بعداً بتوان ثابت کرد
  کاربر دقیقاً کدام نسخه را پذیرفته است.
- هر بار که متن terms/privacy تغییر کرد: این ثابت را بالا ببر، متن‌ها را
  همین‌جا به‌روز کن و seed_legal_pages در app/seed.py را دوباره اجرا کن تا
  صفحه‌های CMS همگام شوند.
"""
from __future__ import annotations

LEGAL_TEXT_VERSION = "v1"

# ---------------------------------------------------------------------------
# متن شرایط استفاده — کوتاه، واقعی، سه‌زبانه
# ---------------------------------------------------------------------------

TERMS_BLOCKS = [
    {
        "type": "heading",
        "text": {
            "fa": "شرایط استفاده از آکادمی ماتریدی",
            "ar": "شروط استخدام أكاديمية الماتريدي",
            "en": "Maturidi Academy — Terms of Use",
        },
    },
    {
        "type": "paragraph",
        "text": {
            "fa": "با ثبت‌نام و استفاده از آکادمی ماتریدی (وب، موبایل و دسکتاپ) شما این شرایط را می‌پذیرید. اگر با بخشی از آن موافق نیستید، از خدمات استفاده نکنید.",
            "ar": "بتسجيلك واستخدامك لأكاديمية الماتريدي (الويب والجوال وسطح المكتب) فإنك تقبل هذه الشروط. إذا لم توافق على أي جزء منها، فلا تستخدم الخدمات.",
            "en": "By registering for and using Maturidi Academy (web, mobile and desktop), you accept these terms. If you do not agree with any part, do not use the services.",
        },
    },
    {
        "type": "heading",
        "text": {"fa": "۱. حساب کاربری", "ar": "١. الحساب", "en": "1. Account"},
    },
    {
        "type": "paragraph",
        "text": {
            "fa": "شما مسئول حفظ محرمانگی گذرواژه و فعالیت‌های حساب خود هستید. حداقل سن استفاده ۱۳ سال است؛ برای افراد زیر ۱۸ سال، رضایت والدین لازم است. ارائهٔ اطلاعات نادرست در ثبت‌نام می‌تواند به تعلیق حساب منجر شود.",
            "ar": "أنت مسؤول عن الحفاظ على سرية كلمة المرور والأنشطة الصادرة عن حسابك. الحد الأدنى لسن الاستخدام ١٣ سنة، ويُشترط موافقة الوالدين لمن هم دون ١٨ سنة. تقديم معلومات غير صحيحة عند التسجيل قد يؤدي إلى تعليق الحساب.",
            "en": "You are responsible for keeping your password confidential and for all activity under your account. The minimum age is 13; users under 18 need parental consent. Providing false information at registration may lead to account suspension.",
        },
    },
    {
        "type": "heading",
        "text": {
            "fa": "۲. محتوای آموزشی و فتوا",
            "ar": "٢. المحتوى التعليمي والفتوى",
            "en": "2. Educational content and fatwas",
        },
    },
    {
        "type": "paragraph",
        "text": {
            "fa": "محتوای آموزشی صرفاً جنبهٔ آموزشی دارد و جایگزین مشاورهٔ تخصصی نیست. پاسخ‌های فقهی (فتوا) بر مبنای مذهب حنفی و کلام ماتریدی تهیه می‌شوند و برای موارد حساس باید با عالم مورداعتماد خود مشورت کنید.",
            "ar": "المحتوى التعليمي لأغراض تعليمية فقط ولا يُغني عن الاستشارة المتخصصة. تُعدّ الإجابات الفقهية (الفتاوى) وفق المذهب الحنفي وعقيدة الماتريدية، وفي المسائل الحساسة يجب استشارة عالم تثق به.",
            "en": "Educational content is for learning purposes only and is not a substitute for professional advice. Religious rulings (fatwas) follow the Hanafi school and Maturidi creed; for sensitive matters consult a scholar you trust.",
        },
    },
    {
        "type": "heading",
        "text": {
            "fa": "۳. رفتار مجاز",
            "ar": "٣. السلوك المسموح",
            "en": "3. Acceptable use",
        },
    },
    {
        "type": "paragraph",
        "text": {
            "fa": "ممنوع است: انتشار محتوای توهین‌آمیز یا خلاف قوانین، تلاش برای نفوذ به سامانه، استخراج انبوه داده بدون مجوز، و واگذاری حساب به دیگری. نقض این بندها می‌تواند به محدودیت یا حذف حساب منجر شود.",
            "ar": "يُحظر: نشر محتوى مسيء أو مخالف للقوانين، ومحاولة اختراق النظام، واستخراج البيانات بكميات كبيرة دون إذن، وتسليم الحساب لشخص آخر. قد يؤدي انتهاك هذه البنود إلى تقييد الحساب أو حذفه.",
            "en": "Prohibited: posting abusive or unlawful content, attempting to breach the system, bulk data extraction without permission, and transferring your account to others. Violations may lead to restriction or deletion of the account.",
        },
    },
    {
        "type": "heading",
        "text": {
            "fa": "۴. مالکیت معنوی",
            "ar": "٤. الملكية الفكرية",
            "en": "4. Intellectual property",
        },
    },
    {
        "type": "paragraph",
        "text": {
            "fa": "همهٔ محتوای پلتفرم (متن، تصویر، ویدیو، نرم‌افزار) متعلق به آکادمی ماتریدی یا صاحبان مجوز آن است. بازنشر تجاری بدون اجازهٔ کتبی ممنوع است؛ نقل‌قول علمی با ذکر منبع مجاز است.",
            "ar": "جميع محتويات المنصة (النصوص والصور والفيديو والبرمجيات) مملوكة لأكاديمية الماتريدي أو لمرخّصيها. يُحظر إعادة النشر التجاري دون إذن كتابي؛ والاقتباس العلمي مع ذكر المصدر مسموح.",
            "en": "All platform content (text, images, video, software) belongs to Maturidi Academy or its licensors. Commercial republication without written permission is prohibited; scholarly quotation with attribution is allowed.",
        },
    },
    {
        "type": "heading",
        "text": {
            "fa": "۵. تغییر و خاتمه",
            "ar": "٥. التعديل والإنهاء",
            "en": "5. Changes and termination",
        },
    },
    {
        "type": "paragraph",
        "text": {
            "fa": "ممکن است این شرایط به‌روز شود؛ نسخهٔ جدید در همین صفحه منتشر و نسخهٔ آن ثبت می‌شود. ادامهٔ استفاده پس از انتشار نسخهٔ جدید به‌منزلهٔ پذیرش آن است. شما می‌توانید هر زمان حسابتان را حذف کنید.",
            "ar": "قد تُحدَّث هذه الشروط؛ تُنشر النسخة الجديدة في هذه الصفحة مع تسجيل رقم إصدارها. استمرار الاستخدام بعد نشر النسخة الجديدة يعني قبولها. يمكنك حذف حسابك في أي وقت.",
            "en": "These terms may be updated; the new version is published on this page with its version recorded. Continued use after publication means acceptance. You may delete your account at any time.",
        },
    },
]

# ---------------------------------------------------------------------------
# متن حریم‌خصوصی — کوتاه، واقعی، سه‌زبانه
# ---------------------------------------------------------------------------

PRIVACY_BLOCKS = [
    {
        "type": "heading",
        "text": {
            "fa": "سیاست حریم‌خصوصی آکادمی ماتریدی",
            "ar": "سياسة الخصوصية لأكاديمية الماتريدي",
            "en": "Maturidi Academy — Privacy Policy",
        },
    },
    {
        "type": "paragraph",
        "text": {
            "fa": "این سیاست توضیح می‌دهد چه داده‌هایی جمع‌آوری می‌کنیم، چرا، و چه حقوقی دارید. ما داده‌های شما را نمی‌فروشیم.",
            "ar": "توضح هذه السياسة البيانات التي نجمعها ولماذا وما هي حقوقك. نحن لا نبيع بياناتك.",
            "en": "This policy explains what data we collect, why, and what rights you have. We do not sell your data.",
        },
    },
    {
        "type": "heading",
        "text": {
            "fa": "۱. داده‌هایی که جمع می‌کنیم",
            "ar": "١. البيانات التي نجمعها",
            "en": "1. Data we collect",
        },
    },
    {
        "type": "paragraph",
        "text": {
            "fa": "اطلاعات حساب (نام، ایمیل یا تلفن)، گذرواژهٔ هش‌شده (هرگز به‌صورت متن ساده ذخیره نمی‌شود)، سوابق یادگیری (دوره‌ها، آزمون‌ها)، لاگ‌های امنیتی (ورودها، دستگاه‌ها) و رضایت‌های ثبت‌شدهٔ شما. دادهٔ حساس مذهبیِ اضافی بدون رضایت صریح جمع نمی‌شود.",
            "ar": "معلومات الحساب (الاسم والبريد الإلكتروني أو الهاتف)، وكلمة المرور المُجزَّأة (لا تُخزَّن أبدًا كنص عادي)، وسجلات التعلم (الدورات والاختبارات)، وسجلات الأمان (تسجيلات الدخول والأجهزة)، وموافقاتك المسجلة. لا تُجمع بيانات دينية حساسة إضافية دون موافقة صريحة.",
            "en": "Account information (name, email or phone), hashed password (never stored in plain text), learning records (courses, quizzes), security logs (logins, devices) and your recorded consents. No additional sensitive religious data is collected without explicit consent.",
        },
    },
    {
        "type": "heading",
        "text": {
            "fa": "۲. چرا داده جمع می‌کنیم",
            "ar": "٢. لماذا نجمع البيانات",
            "en": "2. Why we collect data",
        },
    },
    {
        "type": "paragraph",
        "text": {
            "fa": "ارائهٔ خدمات آموزشی، احراز هویت و امنیت حساب، بهبود کیفیت محتوا، و اطلاع‌رسانی‌های مرتبط با خدمات. پیام‌های تبلیغاتی فقط با رضایت جداگانهٔ شما ارسال می‌شود.",
            "ar": "لتقديم الخدمات التعليمية، والتحقق من الهوية وأمان الحساب، وتحسين جودة المحتوى، والإشعارات المتعلقة بالخدمات. تُرسل الرسائل الترويجية فقط بموافقتك المنفصلة.",
            "en": "To provide educational services, authenticate and secure your account, improve content quality, and send service-related notices. Marketing messages are sent only with your separate consent.",
        },
    },
    {
        "type": "heading",
        "text": {
            "fa": "۳. اشتراک‌گذاری و نگهداری",
            "ar": "٣. المشاركة والاحتفاظ",
            "en": "3. Sharing and retention",
        },
    },
    {
        "type": "paragraph",
        "text": {
            "fa": "داده‌ها با اشخاص ثالث به‌اشتراک گذاشته نمی‌شود مگر برای ارائه‌دهندگان زیرساخت (مثل میزبانی و ارسال ایمیل) تحت قرارداد محرمانگی، یا الزام قانونی. داده‌های حساب تا زمان فعال بودن حساب و سپس حداکثر ۱۲ ماه نگهداری می‌شود؛ لاگ‌های امنیتی طبق نیاز امنیتی آرشیو می‌شوند.",
            "ar": "لا تُشارَك البيانات مع أطراف ثالثة إلا مع مزودي البنية التحتية (كالاستضافة وإرسال البريد) بموجب اتفاقية سرية، أو عند الالتزام القانوني. تُحفَظ بيانات الحساب طالما الحساب نشط ثم ١٢ شهرًا كحد أقصى؛ وتُؤرشَف سجلات الأمان حسب الحاجة الأمنية.",
            "en": "Data is not shared with third parties except infrastructure providers (such as hosting and email delivery) under confidentiality agreements, or when legally required. Account data is kept while the account is active and up to 12 months after; security logs are archived as needed.",
        },
    },
    {
        "type": "heading",
        "text": {
            "fa": "۴. حقوق شما",
            "ar": "٤. حقوقك",
            "en": "4. Your rights",
        },
    },
    {
        "type": "paragraph",
        "text": {
            "fa": "شما حق دسترسی به داده‌های خود، اصلاح، حذف حساب و داده‌ها، انصراف از پیام‌های تبلیغاتی، و دریافت خروجی داده‌هایتان را دارید. برای اعمال این حقوق از بخش تنظیمات حساب یا پشتیبانی اقدام کنید.",
            "ar": "لك الحق في الوصول إلى بياناتك وتصحيحها وحذف حسابك وبياناتك وإلغاء الاشتراك في الرسائل الترويجية والحصول على نسخة من بياناتك. لممارسة هذه الحقوق استخدم إعدادات الحساب أو تواصل مع الدعم.",
            "en": "You have the right to access, correct, and delete your data and account, opt out of marketing messages, and receive an export of your data. Use account settings or contact support to exercise these rights.",
        },
    },
    {
        "type": "heading",
        "text": {"fa": "۵. امنیت", "ar": "٥. الأمان", "en": "5. Security"},
    },
    {
        "type": "paragraph",
        "text": {
            "fa": "گذرواژه‌ها با Argon2id هش می‌شوند، نشست‌ها قابل ابطال‌اند، و دسترسی ادمین‌ها ثبت و محدود است. هیچ سامانه‌ای صددرصد امن نیست؛ در صورت نشت احتمالی، طبق قانون اطلاع‌رسانی می‌کنیم.",
            "ar": "تُجزَّأ كلمات المرور بخوارزمية Argon2id، والجلسات قابلة للإبطال، ووصول المسؤولين مسجَّل ومقيَّد. لا يوجد نظام آمن تمامًا؛ وفي حال تسرب محتمل سنُخطِرك وفق القانون.",
            "en": "Passwords are hashed with Argon2id, sessions are revocable, and admin access is logged and limited. No system is fully secure; in case of a potential breach we will notify you as required by law.",
        },
    },
]

TERMS_TITLE = {
    "fa": "شرایط استفاده",
    "ar": "شروط الاستخدام",
    "en": "Terms of Use",
}

PRIVACY_TITLE = {
    "fa": "سیاست حریم‌خصوصی",
    "ar": "سياسة الخصوصية",
    "en": "Privacy Policy",
}
