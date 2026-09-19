# دليل التشغيل والتكاملات (عربي)

شرحٌ داخليٌّ لكل واجهة برمجية (API) أو ربط خارجي قد يحتاجه النظام: **ما هو
المطلوب منك، وكيف تحصل عليه، وأين تضعه، وكيف تتأكد أنه يعمل.** هذا الملف مرجعُ
تشغيلٍ للمشغّل/الأدمن، ويُكمِّل الدليل الإنجليزي التقني في
[`docs/INTEGRATIONS_SETUP.md`](./INTEGRATIONS_SETUP.md).

> **قبل كل شيء — ميزة تصدير المؤثرين (Export CSV) لا تحتاج أي مفتاح أو ربط
> خارجي.** تعمل مباشرةً لأي مستخدم مسجَّل الدخول، لأنها تقرأ بياناتك المخزّنة
> عندك فقط. المفاتيح أدناه كلها للتكاملات الأخرى (جلب بيانات السوشال آلياً)،
> وليست شرطاً لعمل التصدير. تفاصيل التصدير في آخر الملف.

كل القيم أدناه تُوضَع في ملف البيئة: محلياً في `.env` (انسخه من `.env.example`)،
وفي الإنتاج في `.env.production` أو في مخزن الأسرار لديك (المرجع
`.env.production.example`). **الأسرار تبقى في الخادم فقط ولا تصل المتصفح إطلاقاً.**

---

## 1) الأساسيات الإلزامية (بدونها لا يعمل النظام)

هذه ليست "تكاملات خارجية" بل بنية تحتية لا بد منها. الـ API يتحقق منها عند
الإقلاع ويتوقف فوراً مع رسالة واضحة إن نقص شيء (`apps/api/src/env.ts`).

| المتغير | إلزامي؟ | لماذا | كيف تجهّزه |
|---|---|---|---|
| `DATABASE_URL` | **نعم** | اتصال قاعدة PostgreSQL أثناء التشغيل | ثبّت PostgreSQL 16، أنشئ قاعدة، ثم `postgresql://user:pass@host:5432/influenceos?schema=public` |
| `DIRECT_DATABASE_URL` | مُستحسن | اتصال مباشر (غير مجمّع) لهجرات Prisma | نفس القيمة في التطوير؛ في الإنتاج وجّهه للأساسي (لا لـ pgbouncer) |
| `REDIS_URL` | نعم عملياً | طوابير BullMQ للـ worker (المراقبة/المقاييس) وحدّ المعدّل المشترك | ثبّت Redis ثم `redis://localhost:6379` |
| `AUTH_SECRET` | **نعم** | توقيع جلسات الدخول (JWT) واشتقاق مفتاح تشفير الأسرار المخزّنة | ولّد قيمة عشوائية قوية (انظر أدناه). **في الإنتاج: ≥ 32 محرفاً وغير القيمة الافتراضية** |
| `AUTH_SESSION_TTL` | اختياري | عمر جلسة التحديث بالثواني (افتراضي 7 أيام) | اتركه أو عيّن رقماً |
| `WEB_ORIGIN` | مُستحسن | أصول الويب المسموح لها بمناداة الـ API (CORS) | `https://app.example.com` (يفصل بينها فاصلة) |
| `NEXT_PUBLIC_APP_URL` | مُستحسن | عنوان الويب العام (روابط، إعادة توجيه OAuth) | `https://app.example.com` |
| `INTERNAL_API_URL` | مُستحسن | كيف يصل خادم الويب إلى الـ API داخلياً | `http://api:4000` في دوكر |

**توليد `AUTH_SECRET`:**
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

**تهيئة القاعدة وإنشاء أول أدمن (bootstrap):**
```bash
pnpm db:deploy       # تطبيق الهجرات (إنشاء الجداول)
pnpm db:bootstrap    # إنشاء أول حساب أدمن (مرة واحدة فقط)
```
متغيرات إنشاء الأدمن (`packages/database/prisma/bootstrap.ts`):

| المتغير | افتراضي | ملاحظة |
|---|---|---|
| `BOOTSTRAP_ADMIN_EMAIL` | `info@influence-op.com` | بريد الأدمن الأساسي — أنت من يتحكم به من البيئة |
| `BOOTSTRAP_ADMIN_PASSWORD` | (يُولَّد في التطوير ويُطبع مرة) | **في الإنتاج إلزامي** — لا يُولَّد ولا يُطبع في السجلات أبداً؛ 10 محارف فأكثر |
| `BOOTSTRAP_ADMIN_NAME` | `Administrator` | اسم العرض |

الأمر يعمل مرة واحدة: إن وُجد أي مستخدم مسبقاً يتخطّى دون تغيير. بعد أول دخول
غيّر كلمة السر من **Settings → Security**.

---

## 2) تخزين الملفات (المرفقات/الصور)

خياران — تختار واحداً عبر `STORAGE_DRIVER`:

- **`local` (الافتراضي):** يخزّن على قرص الخادم. **لا يحتاج أي مفتاح.** مناسب
  للتطوير أو خادم واحد.
- **`s3`:** لخدمة S3 أو MinIO (موصى به في الإنتاج/التوسّع). عند اختياره تصبح
  هذه إلزامية (يتحقق منها الإقلاع):

| المتغير | ماذا يعني |
|---|---|
| `S3_INTERNAL_ENDPOINT` | العنوان الذي يصل منه الخادم للتخزين (أو `S3_ENDPOINT` القديم) |
| `S3_PUBLIC_ENDPOINT` | العنوان الذي يوقّع به الروابط للمتصفح |
| `S3_BUCKET` | اسم الـ bucket |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | مفتاحا الوصول |
| `S3_REGION` / `S3_FORCE_PATH_STYLE` | المنطقة ونمط المسار (MinIO: `true`) |
| `MAX_UPLOAD_MB` | أقصى حجم رفع (افتراضي 100) |

**كيف تحصل عليها:** من لوحة مزوّد S3 (AWS/Cloudflare R2/…) أنشئ bucket ومفتاح
وصول، أو شغّل MinIO محلياً وأنشئ المفاتيح من واجهته.

---

## 3) تكاملات مزوّدي التواصل الاجتماعي (كلها **اختيارية**)

النظام يعمل بالكامل في **الوضع اليدوي** بدون أي منها: تُدخل الأرقام يدوياً. كل
مفتاح يرفع منصةً واحدة من "يدوي" إلى "جلب تلقائي". أسماء المتغيرات مأخوذة من
الكود (`packages/domain/src/context.ts`).

### 3.1 YouTube — الأسهل والموصى به أولاً (مفتاح فقط)
يجلب إحصاءات القناة + **مقاييس الفيديو (مشاهدات/إعجابات/تعليقات)** آلياً.

- **المطلوب:** `YOUTUBE_API_KEY`
- **الطريقة:** Google Cloud Console → أنشئ مشروعاً → فعّل **YouTube Data API v3**
  → APIs & Services → Credentials → **API key** → قيّده على YouTube Data API.
- **بلا OAuth وبلا مراجعة.** هذه المنصة الوحيدة التي تعطي مقاييس محتوى كاملة
  بمجرد مفتاح.

### 3.2 X (تويتر) — مفتاح فقط، حسب باقة الوصول
يجلب `public_metrics` للحساب ومقاييس التغريدة (حسب باقتك).

- **المطلوب:** `X_API_BEARER_TOKEN`
- **الطريقة:** X Developer Portal → المشروع/التطبيق → **Bearer Token** (مصادقة
  التطبيق).
- **ملاحظة:** الباقة المجانية محدودة جداً؛ رفض `403` يظهر في النظام كـ "يتطلب
  تفويض التطبيق".

### 3.3 Instagram / Meta — الملف الشخصي فقط (حساب أعمال)
يعمل عبر **Business Discovery** ويحتاج حساب انستغرام **Professional
(Business/Creator)**. يعطي: الاسم والصورة والنبذة وعدد المتابعين للحسابات
الاحترافية فقط.

- **المطلوب (كلاهما معاً وإلا يبقى غير مفعّل):**
  - `INSTAGRAM_ACCESS_TOKEN` — توكن طويل الأمد بصلاحيات
    `instagram_basic`, `pages_read_engagement` والوصول لـ Business Discovery.
  - `INSTAGRAM_BUSINESS_ACCOUNT_ID` — معرّف حساب الأعمال المتصل عندك (هو "الذات"
    التي يمرّ عبرها البحث).
- **الطريقة:** اربط حساب انستغرام Business بصفحة فيسبوك تملكها → Meta for
  Developers → أنشئ تطبيقاً → أضف **Instagram Graph API** → ولّد التوكن
  الطويل → استخرج معرّف حساب الأعمال.
- **لا يعطي** إعجابات/مشاهدات منشورات مؤثّرٍ عشوائي — هذا يحتاج تفويض المؤثر
  نفسه (Creator-OAuth، القسم 5).
- `INSTAGRAM_APP_ID` / `INSTAGRAM_APP_SECRET` ليسا مطلوبين هنا؛ هما لـ
  Creator-OAuth لاحقاً.

### 3.4 TikTok — عرض/تضمين فقط (المفاتيح احتياطية لـ OAuth)
التضمين وفحص التوفّر يعملان بلا مفاتيح. **الإحصاءات تحتاج Creator-OAuth**
(القسم 5). `TIKTOK_CLIENT_KEY` / `TIKTOK_CLIENT_SECRET` مخصّصان لذلك.

### 3.5 Snapchat — يدوي
لا API عام للملف/المحتوى. الاعتماد على الروابط وفحص توفّر أفضل جهد فقط
(`SNAPCHAT_CLIENT_ID` / `SNAPCHAT_CLIENT_SECRET` غير مستخدمة للجلب).

---

## 4) طريقتان لإدخال مفاتيح المزوّدين

**أ) عبر ملف البيئة (`.env`)** — ضع القيمة ثم **أعد تشغيل** الـ API والـ worker.

**ب) عبر شاشة الأدمن — مخزن أسرار مشفّر (INT-4، مستحسن للتشغيل):**
- من الواجهة: **Settings → Integrations → "Provider API keys"** (تظهر للأدمن
  فقط). أدخل المفتاح فيُخزَّن **مشفّراً (AES-256-GCM)** ويُفضَّل على متغير
  البيئة فوراً دون إعادة تشغيل.
- القيم "للكتابة فقط": النظام يعرض حالة مُقنّعة (المصدر + آخر 4 محارف) ولا يعيد
  السر أبداً.
- عبر الـ API (أدمن):
  - `GET /api/v1/integrations/credentials` — حالة كل مفتاح (مُقنّعة).
  - `POST /api/v1/integrations/credentials` — الجسم `{ "key": "YOUTUBE_API_KEY", "value": "..." }`.
  - `DELETE /api/v1/integrations/credentials/:key` — يعيد الاعتماد لمتغير البيئة.

المفاتيح المسموح تخزينها: `YOUTUBE_API_KEY`, `X_API_BEARER_TOKEN`,
`INSTAGRAM_ACCESS_TOKEN`, `INSTAGRAM_BUSINESS_ACCOUNT_ID`, `INSTAGRAM_APP_ID`,
`INSTAGRAM_APP_SECRET`, `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`,
`SNAPCHAT_CLIENT_ID`, `SNAPCHAT_CLIENT_SECRET`.

---

## 5) Creator-OAuth — جلب مقاييس منشورات المؤثر نفسه (Instagram / TikTok)

الطريقة الوحيدة المشروعة للحصول على مقاييس منشورات مؤثّرٍ بعينه هي أن **يفوّض
المؤثر نفسه** التطبيق عبر OAuth، **ويجتاز تطبيقك مراجعة المنصّة** (Meta/TikTok).

الأساس البرمجي جاهز وموصول من الطرفين (INT-3) لكنه **معطّل بأمانة** حتى تُفعّله:
عند الضغط "Connect" وهو غير مهيّأ يظهر "not configured" بدل التظاهر.

**للتفعيل:**
1. أنشئ تطبيق Meta / TikTok وأكمل **مراجعة التطبيق** لصلاحيات المقاييس.
2. سجّل الـ redirect URI:
   `<OAUTH_CALLBACK_BASE_URL>/api/v1/integrations/<platform>/oauth/callback`
3. عيّن مفاتيح التطبيق:
   - Instagram: `INSTAGRAM_APP_ID` + `INSTAGRAM_APP_SECRET`
   - TikTok: `TIKTOK_CLIENT_KEY` + `TIKTOK_CLIENT_SECRET`
   - و`OAUTH_CALLBACK_BASE_URL` (العنوان العام الذي يُعاد إليه؛ يجب أن يطابق
     تماماً الـ redirect URI المسجَّل. يأخذ افتراضياً قيمة `NEXT_PUBLIC_APP_URL`).

المسارات: `POST /influencers/:id/creator-connections/:platform/start` (يعيد رابط
التفويض) — `GET /integrations/:platform/oauth/callback` (يتبادل الرمز ويخزّن
التوكن مشفّراً) — `GET /influencers/:id/creator-connections` (الحالة) —
`DELETE …/:platform` (فصل). **هذا قيدٌ من المنصّة (المراجعة)، لا نقصٌ برمجي.**

---

## 6) كيف تتحقق أن أي تكامل يعمل الآن

```bash
API=https://api.example.com
TOKEN=... # توكن دخول أدمن

# 1) قدرات كل منصة، وهل الـ API مفعّل فعلاً الآن؟
curl -s "$API/api/v1/integrations/capabilities" -H "authorization: Bearer $TOKEN"
#    ابحث عن "apiConfigured": true للمنصة التي هيّأتها.

# 2) جلب حي لملف حقيقي (يثبت المسار من الطرف للطرف):
curl -s -X POST "$API/api/v1/influencers/resolve" -H "authorization: Bearer $TOKEN" \
     -H 'content-type: application/json' \
     -d '{"input":"https://www.youtube.com/@mkbhd","platform":"YOUTUBE"}'
#    source:"OFFICIAL_API" بأرقام حقيقية = مفعّل؛ source:"MANUAL" = غير مهيّأ.
```
كما توجد في شاشة **Integrations** حالةُ كل منصة وزر "test connection".

---

## 7) ملخّص: ماذا تحتاج فعلاً؟

- **لتشغيل النظام:** PostgreSQL + Redis + `AUTH_SECRET` + إنشاء أدمن. لا غير.
- **لتخزين ملفات على S3:** مفاتيح `S3_*` (اختياري؛ الافتراضي قرص محلي).
- **لجلب سوشال آلي (اختياري، منصة بمنصة):**
  - YouTube: `YOUTUBE_API_KEY` (الأسهل، مقاييس كاملة).
  - X: `X_API_BEARER_TOKEN`.
  - Instagram (ملف فقط): `INSTAGRAM_ACCESS_TOKEN` + `INSTAGRAM_BUSINESS_ACCOUNT_ID`.
  - مقاييس منشورات المؤثر (IG/TikTok): مسار Creator-OAuth + مراجعة تطبيق.
- **لميزة تصدير المؤثرين:** **لا شيء** — تعمل فوراً.

كل مفاتيح السوشال اختيارية وقابلة للإضافة لاحقاً دون إعادة نشر (عبر شاشة الأدمن
المشفّرة). ابدأ بـ YouTube إن أردت أثراً سريعاً.

---

## 8) ميزة تصدير المؤثرين ومعلوماتهم (بلا أي ربط خارجي)

- **من الواجهة:** صفحة **Influencers** → زر **"Export CSV"** أعلى الصفحة. ينزّل
  ملفاً يحترم الفلاتر النشطة (بحث/منصة/حالة العلاقة/دولة/تصنيف/حدود المتابعين)،
  أي يطابق ما تراه على الشاشة.
- **عبر الـ API (لأي مستخدم مسجّل):**
  - `GET /api/v1/influencers/export` → ملف CSV مرفق.
  - `GET /api/v1/influencers/export?format=json` → صفوف منظّمة (للموبايل/البرمجة).
  - يقبل نفس الفلاتر: `q`, `platform`, `relationshipStatus`, `country`,
    `category`, `minFollowers`, `maxFollowers`.
- **الأعمدة (24):** المعرّف، الاسم، الاسم الكامل، اليوزر، المنصة الأساسية، كل
  المنصات، إجمالي المتابعين، التصنيف، الدولة، المدينة، حالة العلاقة، الأولوية،
  صحة الجمهور، البريد، الجوال، واتساب، اسم المدير، تواصل المدير، طريقة التواصل
  المفضّلة، اللغات، الوسوم، المالك، الحالة، تاريخ الإضافة.
- المصادقة إلزامية (401 دون دخول)، وحدٌ أقصى 50 ألف صف حمايةً من التحميل غير
  المحدود.
