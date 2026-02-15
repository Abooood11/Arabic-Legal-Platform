# Changelog — 2026-02-15

## ملخص اليوم
استيراد 562,304 حكم نقض مصري، تحسين أداء قاعدة البيانات، تدقيق جودة البيانات، وفصل المبدأ القضائي عن نص الحكم.

---

### 1. التحقق من استيراد أحكام النقض المصرية (EMJ)
**الحالة:** مكتمل (من جلسة سابقة)

- 562,304 حكم مستورد من 4 أقسام:
  - مدني (266,634) | جنائي (287,352) | دستوري (7,133) | اقتصادي (1,185)
- المصدر: EMJ API (`w.emj-eg.com/AhkamT/GetAhkambyYearsbypage`)
- السكربت: `scripts/import_emj_rulings.ts`
- يحفظ بـ `source='eg_naqd'` في جدول `judgments`

---

### 2. إصلاح أداء قاعدة البيانات
**المشكلة:** صفحة الأحكام المصرية لا تحمّل (timeout على 568K صف بدون indexes)

**الملفات المعدلة:**
- `server/db.ts` — إضافة 7 indexes على جدول judgments
- `server/routes.ts` — استبدال Drizzle ORM facets بـ raw SQL + in-memory cache

**التفاصيل:**
- Indexes: source, source+date DESC, date DESC, court_body, year_hijri, city, case_id
- Facets cache: Map مع TTL ساعة + pre-warming عند بدء السيرفر
- Count cache: لتقليل عمليات COUNT المتكررة

**النتيجة:**
- COUNT: من timeout → 38ms
- قائمة الأحكام: 0.24s
- Facets: 0.21s (cached)

---

### 3. التحقق من اكتمال نصوص الأحكام
**السكربتات المنشأة:**
- `scraper/check_full_text.js` — تحقق من أن `facts_text` يحتوي النص الكامل
- `scraper/analyze_emj_api.js` — استكشاف حقول EMJ API

**النتيجة:** نصوص الأحكام كاملة:
- تبدأ بـ "بعد الاطلاع على الأوراق"
- تنتهي بـ "أمين السر - نائب رئيس المحكمة"
- الدستورية: متوسط 8,472 حرف | الاقتصادية: 7,828 | المدنية: 1,127 | الجنائية: 788

---

### 4. تدقيق جودة البيانات
**السكربت:** `scraper/audit_emj_data.js`

**النتائج:**
- نسبة الجودة: **94.07%** (528,965 سجل سليم من 562,304)
- 28,193 كلا الحقلين فارغ (5%)
- 5,090 نصوص متطابقة (principle = facts) (0.9%)
- 7,569 حالة خلط بين المبدأ والوقائع (1.3%)
- 58,176 قيمة placeholder في المبدأ ("-", "0")
- 0 بقايا HTML | 0 مشاكل تاريخ

---

### 5. فصل المبدأ القضائي عن نص الحكم
**السياق:** سكربت الاستيراد دمج `principle_text` + `facts_text` في عمود `text` واحد.

**الملفات المعدلة:**
- `shared/models/judgments.ts` — إضافة حقل `principleText: text("principle_text")`
- `server/db.ts` — ALTER TABLE migration لإضافة العمود

**الملفات المنشأة:**
- `scripts/migrate_principles.ts` — سكربت ترحيل المبادئ من JSON الأصلية

**نتائج الترحيل:**
- 332,083 حكم أصبح لديه مبدأ قضائي منفصل (59%)
- 224,996 تم تخطيها (مبدأ فارغ/placeholder في المصدر)
- 0 أخطاء مطابقة
- عمود `text` لم يُعدَّل

**تحديث الواجهة:**
- `client/src/pages/JudgmentDetail.tsx`:
  - قسم "المبدأ القضائي" بخلفية emerald (للأحكام المصرية فقط)
  - قسم "نص الحكم" بعنوان amber (يظهر فقط عند وجود مبدأ)
  - النسخ والبحث وعدد الكلمات يشملان كلا القسمين
  - الأحكام بدون مبدأ: تُعرض كالسابق
  - الأحكام السعودية: لا تتأثر

**API:** `/api/judgments/:id` يرجع `principleText` تلقائياً (Drizzle select)

---

### 6. محاولة استخراج أحكام من cc.gov.eg
**النتيجة:** غير مجدية

- جميع endpoints تتطلب تسجيل دخول (302 redirect)
- Wayback Machine: 1,404 صفحة محفوظة فقط (قليل جداً)
- ELPAI (بوابة الحكومة المصرية): 255,809 حكم لكن تتطلب اشتراك
- **الخلاصة:** بيانات EMJ كافية وأكثر شمولاً

---

## الملفات المعدلة/المنشأة اليوم

| الملف | الحالة | الوصف |
|-------|--------|-------|
| `server/db.ts` | معدل | indexes, facets cache, ALTER TABLE |
| `server/routes.ts` | معدل | raw SQL facets, count cache, warm cache |
| `shared/models/judgments.ts` | معدل | إضافة principleText |
| `client/src/pages/JudgmentDetail.tsx` | معدل | قسم المبدأ القضائي |
| `scripts/import_emj_rulings.ts` | منشأ | استيراد أحكام EMJ |
| `scripts/migrate_principles.ts` | منشأ | ترحيل المبادئ |
| `scraper/audit_emj_data.js` | منشأ | تدقيق جودة البيانات |
| `scraper/check_full_text.js` | منشأ | التحقق من اكتمال النصوص |
| `scraper/analyze_emj_api.js` | منشأ | استكشاف EMJ API |
| `scraper/check_facts.js` | منشأ | فحص تغطية facts_text |
