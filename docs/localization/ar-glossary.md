# Arabic Terminology Glossary

The canonical Arabic terminology guide for InfluenceOS. Every developer and
translator working on Arabic copy reuses these terms — do not introduce a
competing synonym for a concept already listed here without updating this
file and every existing usage.

**Register:** professional Modern Standard Arabic (MSA) — clear, modern,
concise, appropriate for enterprise software used in the GCC/MENA region.
Not colloquial dialect, not overly literary or bureaucratic.

**Never translate:** the product name `InfluenceOS`, social platform names
(Instagram, TikTok, YouTube, Snapchat, X), brand names (JUVELAB, MEDEE,
Vitamin Factory), courier names (DHL, Aramex), or any user/database content
(creator names, campaign names, captions, notes, addresses, tracking
numbers). See `docs/localization/README.md` for the full proper-noun and
database-content rules.

## Core concepts

| English | Arabic | Notes |
|---|---|---|
| InfluenceOS | InfluenceOS | Never transliterated |
| Influencer | المؤثر / المؤثرون (pl.) | The default term throughout the UI |
| Creator | صانع المحتوى / صنّاع المحتوى (pl.) | Use only where the concept is genuinely "content creator" rather than "influencer" (e.g. UGC-specific contexts). Do not alternate randomly with المؤثر for the same concept. |
| Brand | العلامة التجارية / العلامات التجارية (pl.) | Short "العلامة" only where context is unambiguous |
| Campaign | الحملة / الحملات (pl.) | |
| Mission Control | مركز العمليات | NOT مركز القيادة (too literal/military) |
| Live Content | المحتوى المنشور | NOT المحتوى المباشر (implies livestreaming) |
| Published Content | المحتوى المنشور | Same term as Live Content — same underlying concept |
| Content | المحتوى | |
| Deliverable | المحتوى المطلوب | The primary term for a creator's content obligation. Use المهمة المطلوبة only where a compact count/item label needs it. Do not alternate. |

## UGC

- First/expanded mention where helpful: `محتوى UGC (المحتوى الذي ينشئه المستخدم)`
- Everyday operational UI: `محتوى UGC` (do not repeat the long explanation everywhere)

## Submission / Draft / Review

| English | Arabic |
|---|---|
| Submission (noun, the object) | التسليم |
| Submission version | نسخة التسليم |
| Submitted | تم التسليم |
| Draft | مسودة |
| Review (noun) | مراجعة |
| Review (verb, "review this") | مراجعة |
| In Review | قيد المراجعة |
| Awaiting Review | بانتظار المراجعة |
| Reviewed | تمت المراجعة |
| Mark Reviewed (button) | تحديد كمراجَع |

## Content review states (per-user, Content Command Center)

| State | Arabic |
|---|---|
| NEW | جديد |
| SEEN | تم الاطلاع |
| REVIEWED | تمت المراجعة |
| REVIEW LATER | مراجعة لاحقًا |

`UNASSIGNED` has **two distinct meanings — never the same Arabic word**:
- Content lacking a Campaign/Influencer association → **غير مرتبط**
- Work/queue item lacking an employee assignee (e.g. a Logistics queue row) → **غير مُسند**

## Content alerts

| English | Arabic |
|---|---|
| Content Alerts | تنبيهات المحتوى |
| Removed | تمت الإزالة |
| Private | خاص |
| Unavailable | غير متاح |
| Broken Link | رابط غير صالح |
| Unknown | غير معروف |
| Live (content URL still live/available — **not** livestreaming) | متاح |

## What's New / Needs Attention

| English | Arabic |
|---|---|
| What's New | الجديد |
| What's New Since Your Last Visit | الجديد منذ زيارتك الأخيرة |
| Needs Attention | بحاجة إلى متابعة | NOT يحتاج إلى انتباه (too literal) |

## Campaign Operations

| English | Arabic |
|---|---|
| Campaign Operations | عمليات الحملة |
| Operations Board | لوحة عمليات الحملة |
| Operations Manager | مدير العمليات |
| Control Room (concept) | مركز العمليات | Avoid غرفة التحكم unless literally describing a physical control room |

## Logistics

| English | Arabic |
|---|---|
| Logistics (primary) | الخدمات اللوجستية |
| Logistics (compact nav label) | اللوجستيات |
| Shipment / Shipments | الشحنة / الشحنات |
| Shipping | الشحن |
| My Queue | قائمتي |
| Ready to Process | جاهز للمعالجة |
| Waiting for Details | بانتظار البيانات |
| Address Issue | مشكلة في العنوان |
| Request Address Clarification | طلب توضيح العنوان |
| Address Clarification Requested | تم طلب توضيح العنوان |

### Logistics status

| Status | Arabic |
|---|---|
| PENDING | بانتظار المعالجة |
| SHIPPED | تم الشحن |
| IN_TRANSIT | قيد النقل |
| DELIVERED | تم التسليم |
| RETURNED | مرتجع |
| FAILED | تعذر التسليم |

### Country terminology — operationally critical distinction

Never label both of the following simply "الدولة" when they coexist on the
same surface:

| English | Arabic |
|---|---|
| Creator Country / Influencer Country | دولة المؤثر |
| Shipment Destination Country | دولة وجهة الشحنة |

## Saved Views

| English | Arabic |
|---|---|
| Saved Views | طرق العرض المحفوظة |
| Save View | حفظ طريقة العرض |
| Shared View | طريقة عرض مشتركة |

## Bulk Operations

| English | Arabic |
|---|---|
| Bulk Actions | إجراءات جماعية |
| Bulk Operations | عمليات جماعية |
| Preview | معاينة |
| Execute | تنفيذ |
| Selected | المحدد |
| Will Update | سيتم تحديثه |
| Skipped | تم التخطي |
| Failed | فشل |
| Succeeded | تم بنجاح |

## Data Quality

| English | Arabic |
|---|---|
| Data Quality | جودة البيانات |
| Missing Information | بيانات ناقصة |
| Data Quality Center | مركز جودة البيانات |
| Possible Duplicate | تكرار محتمل |
| Possible Existing Creator | قد يكون هذا المؤثر مسجلاً مسبقًا |
| Exact Match | تطابق تام |
| Strong Possible Match | احتمال تطابق مرتفع |
| Possible Match | تطابق محتمل |
| Proceed Anyway | المتابعة على أي حال |
| Open Existing | فتح السجل الموجود |

## Activity / Timeline

| English | Arabic |
|---|---|
| Activity | سجل النشاط |
| Recent Activity | آخر الأنشطة |
| Timeline (chronological operational history) | السجل الزمني |

## Collaboration

| English | Arabic |
|---|---|
| Team | الفريق |
| Team Discussion | مناقشة الفريق |
| Campaign Chat | محادثة الحملة |
| Team Chat | محادثة الفريق |
| Logistics Team Chat | محادثة فريق الخدمات اللوجستية |
| Comments | التعليقات |
| Reply / Replies | رد / الردود |
| Mention / Mentions | إشارة / الإشارات |
| Pin / Unpin / Pinned | تثبيت / إلغاء التثبيت / مثبّت |
| Manager Callout | ملاحظة إدارية مهمة |

## Trends & Inspiration

| English | Arabic |
|---|---|
| Trends & Inspiration | الترندات والإلهام |

## Finance

| English | Arabic |
|---|---|
| Total Spend | إجمالي الإنفاق |
| Budget | الميزانية |
| Planned Budget | الميزانية المخططة |
| Cost | التكلفة |
| Payment | الدفع |
| Unpaid | غير مدفوع |
| Partially Paid | مدفوع جزئيًا |
| Paid | مدفوع |
| Payment Pending | الدفع معلّق |

## Usage Rights

| English | Arabic |
|---|---|
| Usage Rights | حقوق الاستخدام |
| Organic | استخدام عضوي |
| Paid Ads | إعلانات مدفوعة |
| Whitelisting | التفويض الإعلاني |
| Broadcast | البث |
| Exclusive | حصري |
| Expires / Expired | ينتهي / منتهي الصلاحية |
| Revoked | ملغى |

## Roles

| English | Arabic |
|---|---|
| System Admin | مسؤول النظام |
| General Manager | المدير العام |
| Operations Manager | مدير العمليات |
| Logistics (role) | مسؤول الخدمات اللوجستية |
| Influencer Manager | مسؤول متابعة المؤثرين |
| Viewer | مشاهِد |

## Permissions

| English | Arabic |
|---|---|
| Permissions | الصلاحيات |
| Capability / Capabilities | صلاحية / الصلاحيات |
| Role Profile | الدور الوظيفي |
| Brand Scope | نطاق العلامات التجارية |
| Country Scope | نطاق الدول |
| Access | الوصول |
| Grant | منح |
| Revoke | إلغاء |

Never surface a raw capability key (e.g. `LOGISTICS_ADDRESS_EDIT`) as the
primary UI label — always its localized label (`تعديل عناوين الشحن` /
`Edit shipping addresses`). The raw key may appear secondarily for
developer/admin diagnostics.

## User Management

| English | Arabic |
|---|---|
| Users | المستخدمون |
| Active | نشط |
| Inactive | غير نشط |
| Deactivate User | تعطيل المستخدم |
| Role | الدور |

## Settings

| English | Arabic |
|---|---|
| Settings | الإعدادات |
| General | عام |
| Security | الأمان |
| Integrations | التكاملات |
| Storage | التخزين |
| Platform & API | المنصة وواجهة API |
| Audit | سجل التدقيق |

## Reports

| English | Arabic |
|---|---|
| Reports | التقارير |
| Executive Daily Brief | الملخص التنفيذي اليومي |
| Executive Brief | الملخص التنفيذي |

## Notifications

| English | Arabic |
|---|---|
| Notifications | الإشعارات |
| Unread | غير مقروء |
| Mark as Read | تحديد كمقروء |
| Mark All as Read | تحديد الكل كمقروء |

## Campaign objectives, deal types, statuses

See `apps/web/messages/ar/enums.json` for the complete, authoritative set —
every enum family (campaign status/objective, deliverable type/status,
submission status, participation status, relationship status, candidate
status, shipment status, content status, payment status, expense type,
priority, usage-right type/status, logistics-issue type/status, address
health, role profile, capability, integration status) is translated there
and consumed via `apps/web/src/lib/enum-labels.ts`. This glossary lists the
concepts that recur in prose/UI chrome outside a simple enum badge; the JSON
file is the source of truth for the enum label text itself.

## Consistency rules — competing synonyms to avoid

| Concept | Use only | Never randomly alternate with |
|---|---|---|
| Campaign | الحملة | كمبين |
| Influencer/Creator | المؤثر (influencer) / صانع المحتوى (creator, when meant) | مشهور |
| Logistics | الخدمات اللوجستية (or اللوجستيات, compact) | الشحن (that's specifically "Shipping") / اللوجستيك |
| Review | مراجعة | تدقيق / ريفيو |
| Brand | العلامة التجارية | براند |
