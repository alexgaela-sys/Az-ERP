# نشر نسخة كلاود جديدة لعميل — دليل التنفيذ

كل عميل كلاود يحصل على نسخته الخاصة بالكامل: مشروع Supabase مستقل + مشروع
Cloudflare Workers مستقل (كلاهما متصل بنفس الكود المصدري الواحد على
GitHub). هذا الدليل يحوّل الخطوات اللي كانت بتتعمل يدويًا واحدة واحدة إلى
تسلسل واضح وسريع، معظمه أوامر جاهزة بدل ما كل حاجة تتكتب من الصفر.

ما ينفعش يتحول لسكريبت واحد يتشغل لوحده بالكامل — إنشاء مشروع Supabase
جديد وربط مشروع Cloudflare جديد بالريبو هي خطوات لازم تتعمل عبر الأدوات
الإدارية (MCP / لوحة التحكم)، مش عبر bash وحده. لكن كل خطوة فيها بقت أمر
واحد جاهز أو ملف SQL واحد بدل التجميع اليدوي.

**الوقت المتوقع لكل عميل جديد: حوالي 20-30 دقيقة** (بدل الساعة اللي كانت
بتتاخد قبل كده).

---

## 0) قبل ما تبدأ — المعلومات المطلوبة من العميل

- اسم الشركة/العميل (هيظهر كـ `customer_name` في جدول التراخيص).
- عدد الأجهزة المسموح بيها (`max_devices`).
- مدة الترخيص (سنة/سنتين/3 سنين... إلخ) → تاريخ `expires_at`.
- اسم فرعي مناسب للمشروع (مثلاً `yz-erp-<اسم-العميل>`) يُستخدم في اسم
  مشروع Supabase ومشروع Cloudflare.

---

## 1) إنشاء مشروع Supabase جديد

عبر أداة `mcp__Supabase__create_project`:

```
organization_id: fntzqwozdblciirzymmu   (نفس المنظمة المستخدمة حاليًا)
name: yz-erp-<اسم-العميل>
region: (الأقرب لموقع العميل، أو نفس region المستخدم حاليًا)
```

انتظر حتى تصبح حالة المشروع `ACTIVE_HEALTHY` (عبر `get_project`) قبل أي
خطوة تالية.

## 2) تطبيق قاعدة البيانات (migration واحد، ثم إضافات المنصة)

شغّل الملفين التاليين بالترتيب عبر `mcp__Supabase__apply_migration`
(المحتوى الكامل جاهز في الريبو، idempotent، آمن التكرار):

1. `supabase/cloud-store/001_erp_store.sql` — المخطط الأساسي للـ ERP
   (الجداول، الصلاحيات، منطق المزامنة).
2. `supabase/cloud-store/003_platform_addons.sql` — تحصين أمني + جداول
   الترخيص (`app_licenses`/`app_license_devices`) + النسخ الاحتياطي
   التلقائي اليومي (`pg_cron` + `app_backups`).

> ملحوظة: لو احتجت لاحقًا معرفة محتوى أي migration سابق مباشرة من قاعدة
> بيانات حية (مش من الريبو)، الجدول `supabase_migrations.schema_migrations`
> بيحتفظ بالنص الكامل لكل migration اتطبق — مفيد للمراجعة أو لاستخراج أي
> تعديل منسي من الريبو.

## 3) نشر الـ Edge Functions

عبر `mcp__Supabase__deploy_edge_function`، انشر الاثنين التاليين
(المصدر الكامل جاهز في الريبو):

- `supabase/functions/erp-admin-users/index.ts` — إدارة مستخدمي الـ ERP
  (قبول/رفض الأعضاء).
- `supabase/functions/license-check/index.ts` — فحص/تفعيل ترخيص
  البرنامج نفسه. **لازم `verify_jwt: true`** (يبقى قابل للاستدعاء بالـ
  anon key لأنه هو نفسه JWT صالح).

## 4) الحصول على بيانات الاتصال

عبر `mcp__Supabase__get_project_url` و `mcp__Supabase__get_publishable_keys`
للمشروع الجديد — هتحتاج:

- `project_url` → تستخدم كـ `VITE_SUPABASE_URL`
- الـ anon/legacy key (JWT) → تستخدم كـ `VITE_SUPABASE_ANON_KEY`

## 5) إصدار ترخيص العميل

اتبع الوصفات الجاهزة في `supabase/scripts/issue-license.sql` (قسم
"إصدار ترخيص جديد") على قاعدة بيانات العميل الجديدة — نفّذه عبر
`mcp__Supabase__execute_sql`، بالقيم المتفق عليها معاه (`max_devices`،
`expires_at`، `customer_name`). احتفظ بالـ `license_key` الناتج —
هيحتاجه العميل عند أول تشغيل للبرنامج.

## 6) إنشاء مشروع Cloudflare Workers جديد (نفس الريبو، بيانات اتصال مختلفة)

كل عميل كلاود = مشروع Cloudflare Workers Builds منفصل، متصل **بنفس
الريبو** (`alexgaela-sys/Az-ERP`) على فرع `main`، لكن بمتغيرات بناء
(Build Variables) خاصة به فقط:

في لوحة تحكم Cloudflare → Workers & Pages → Create → Connect to Git:

```
Repository: alexgaela-sys/Az-ERP
Branch: main
Build command: bun run build
Build output directory: dist
```

Build Variables (Settings → Build → Variables — خاصة بهذا المشروع فقط):

```
VITE_ERP_STORAGE = supabase
VITE_SUPABASE_URL = <project_url من الخطوة 4>
VITE_SUPABASE_ANON_KEY = <anon key من الخطوة 4>
```

> هذه الخطوة فقط هي اللي لسه بتتعمل يدويًا من لوحة تحكم Cloudflare (ربط
> مشروع جديد بريبو GitHub عبر تطبيق GitHub المثبت) — باقي الخطوات كلها
> عبر أدوات MCP مباشرة من هنا.

بعد أول بناء ناجح (`build_outcome: "success"`)، هيكون عندك رابط Worker
جاهز (`https://<اسم-المشروع>.<account-subdomain>.workers.dev`) تقدر
تضيف عليه دومين مخصص للعميل لو حبيت.

## 7) تسليم العميل

- رابط النسخة السحابية الخاصة به.
- الـ `license_key` من الخطوة 5.
- أول حساب Supabase Auth (دعوة العميل يعمل تسجيل دخول، ثم وافق على
  عضويته عبر `erp-admin-users` أو مباشرة من جدول `erp_members`).

---

## الحالة الحالية (المرجع الحي)

مشروع `az-erp` (الشركة نفسها، `swbvoesiqpogmniitytl`) هو المرجع اللي
اتسحبت منه كل الملفات أعلاه، ومفروض يفضل شغال بدون أي تغيير بهذا الدليل.
