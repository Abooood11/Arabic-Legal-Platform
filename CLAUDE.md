# تشريع (Tashree) — منصة النصوص القانونية السعودية والعربية

> **هذا الملف هو المرجع الوحيد والإلزامي.** اقرأه كاملاً في بداية كل جلسة.

---

## 0. تعليمات العمل الإلزامية

### عند بدء أي جلسة جديدة:
1. **اقرأ هذا الملف كاملاً أولاً** — لا تبدأ أي عمل قبل قراءته
2. **اقرأ git log آخر 10 commits** — لمعرفة آخر التحديثات: `git log --oneline -10`
3. **لا تفترض أي شيء** — معلومات الاستضافة والبنية والتقنيات كلها موثقة هنا

### عند الانتهاء من أي جلسة:
1. **حدّث قسم "آخر التحديثات"** في هذا الملف بملخص ما تم إنجازه
2. **حدّث قسم "مشاكل محلولة"** إذا حللت مشكلة جديدة
3. **اعمل commit** للتحديثات على هذا الملف مع بقية التغييرات

### قواعد ذهبية:
- **لا تعيد اختراع العجلة** — كل معلومة تحتاجها موجودة هنا أو في git log
- **لا تفترض التقنيات** — المنصة تعمل بـ PM2 وليس Docker، على Contabo وليس Railway
- **لا تنشئ ملفات توثيق جديدة** — هذا الملف هو الوحيد. لا docs/claude/ ولا ملفات CHANGELOG متناثرة

---

## آخر التحديثات

| التاريخ | الملخص |
|---------|--------|
| 2026-02-16 | تمييز المُعرَّفات القانونية بلون أخضر داكن (isDefinitionContext prop) |
| 2026-02-16 | إصلاح تكرار badge "نظام" في المكتبة + إزالة خطوط الكشيدة من الأحكام المصرية |
| 2026-02-16 | إخفاء قسم المبدأ القضائي للأحكام المصرية (مشتت للقارئ) |
| 2026-02-16 | إصلاح إزاحة التعريفات القانونية (marginRight→marginInlineStart + dataLevel=0 check) |
| 2026-02-16 | توحيد التوثيق في CLAUDE.md وحذف docs/claude/ |
| 2026-02-16 | تحسينات الأحكام: sa_all tab، Saudi case info، BOG badge، OCR fixes |

---

## 1. الاستضافة والنشر

| البند | القيمة |
|-------|--------|
| **الدومين** | https://tashree.app |
| **الاستضافة** | Contabo VPS — IP: `62.171.152.213` — Ubuntu 24.04 |
| **لوحة التحكم** | https://my.contabo.com |
| **GitHub** | https://github.com/Abooood11/Arabic-Legal-Platform.git (branch: `master`) |
| **النشر** | يدوي — SSH → `git pull` → `npm run build` → PM2 restart |
| **مسار التطبيق على السيرفر** | `/opt/tashree/` |
| **إدارة العمليات** | PM2 (اسم التطبيق: `tashree`) |
| **Reverse Proxy** | nginx → node |
| **المنفذ المحلي (dev)** | 3005 |

### خطوات النشر
1. `git push origin master` (من الجهاز المحلي)
2. `ssh root@62.171.152.213`
3. `cd /opt/tashree && git pull`
4. `npm run build`
5. `pm2 restart tashree`
6. `pm2 logs tashree --lines 20` (للتأكد)

---

## 2. التقنيات

| الطبقة | التقنية |
|--------|---------|
| Frontend | React 18 + TypeScript + Vite + TailwindCSS + shadcn/ui + Wouter + TanStack Query |
| Backend | Node.js + Express 5 + Drizzle ORM + better-sqlite3 (SQLite) |
| بحث | SQLite FTS5 (`unicode61 remove_diacritics 2`) |
| ذكاء اصطناعي | OpenAI API (شرح المواد، SSE streaming) |
| مصادقة | Google OAuth 2.0 + JWT (HS256) (`server/authSystem.ts`) |
| اللغة | عربية RTL بالكامل، خط Noto Sans Arabic |

---

## 3. قاعدة البيانات

**الملف:** `data.db` (~5.4GB) — SQLite WAL mode — **gitignored** (موجود على السيرفر فقط).

| الجدول | العدد | الوصف |
|--------|-------|-------|
| `judgments` | 568,562 | أحكام (sa_judicial + bog_judicial + eg_naqd) |
| `judgments_fts` | 568,562 | FTS5 بحث |
| `law_articles` / `law_articles_fts` | — | مواد الأنظمة |
| `gazette_index` / `gazette_fts` | 61,138 | فهرس أم القرى |
| `crsd_principles` | 353 | مبادئ لجنة الأوراق المالية |

**مصادر الأحكام:**
- `eg_naqd` — 553,891 حكم نقض مصري (4 أقسام)
- `bog_judicial` — 6,258 حكم ديوان المظالم
- `sa_judicial` — 8,413 حكم من بوابة القضاء السعودي

---

## 4. هيكل المشروع والملفات الرئيسية

```
client/src/pages/LawDetail.tsx          — عرض النظام ومواده (PreambleSection, فقرات, جداول, تعديلات)
client/src/pages/Judgments.tsx           — قائمة الأحكام (تبويبات: الكل, سعودي sa_all, مصري)
client/src/pages/JudgmentDetail.tsx      — تفاصيل حكم (BOG metadata, Saudi case info, مبدأ مصري)
client/src/components/ArticleReferenceText.tsx — ربط إحالات المواد + تنسيق الفقرات
client/src/components/NumberedItem.tsx   — فقرة مرقمة (marker + indent بـ paddingInlineStart)
client/src/lib/judgment-parser.ts       — تحليل نصوص الأحكام (OCR fixes, dates, metadata)
server/routes.ts                        — كل API endpoints
server/db.ts                            — SQLite + indexes + facets cache
server/authSystem.ts                    — مصادقة Google OAuth + JWT + admin roles
client/public/data/laws/                — ملفات JSON للأنظمة (3,907 نظام)
scripts/extract_folder1_laws.py         — استخراج أنظمة BOE
```

---

## 5. قواعد التنسيق (RTL) — مهم جداً

### الإزاحة (Indentation)
- **استخدم الخصائص المنطقية فقط:** `marginInlineStart`, `paddingInlineStart`
- **لا تستخدم أبداً:** `marginRight`, `marginLeft`, `paddingRight`, `paddingLeft`
- هذا ينطبق على كل inline styles في JSX

### مستويات المؤشرات
```
أولاً: / ثانياً:     → مستوى 0 (ترتيبي)
1- / 2- / ٣-          → مستوى 1 (رقمي)
أ- / ب- / جـ-         → مستوى 2 (حرفي)
(بدون مؤشر)           → dataLevel=0 → بدون إزاحة (تعريف مستقل)
                        dataLevel>0 → يرث إزاحة المؤشر السابق
```

### قاعدة ذهبية
فقرات بدون مؤشر (`marker=""`) وبـ `dataLevel=0` هي تعريفات مستقلة — **لا تُزاح** حتى لو جاءت بعد فقرات بمؤشرات (أ-, ب-, ج-). فقط الفقرات بـ `dataLevel > 0` ترث إزاحة المؤشر السابق.

---

## 6. متغيرات البيئة

| المتغير | الوظيفة |
|---------|---------|
| `PORT` | منفذ السيرفر (3005 محلي، 3002 Docker) |
| `GOOGLE_CLIENT_ID` | Google OAuth |
| `GOOGLE_CLIENT_SECRET` | Google OAuth |
| `ADMIN_EMAILS` | إيميلات المشرفين (comma-separated) |
| `AUTH_JWT_SECRET` | مفتاح JWT |
| `AI_INTEGRATIONS_OPENAI_API_KEY` | OpenAI API |
| `AI_INTEGRATIONS_OPENAI_BASE_URL` | OpenAI base URL |
| `NODE_ENV` | development / production |

---

## 7. أوامر التشغيل

```bash
npm run dev      # تطوير (port 3005)
npm run build    # بناء للإنتاج
npm start        # تشغيل الإنتاج
npm run check    # فحص TypeScript
```

---

## 8. مشاكل محلولة (للرجوع إليها عند تكرار أنماط مشابهة)

### 8.1 إزاحة التعريفات القانونية (2026-02-16)
- **المشكلة:** فقرات تعريف مثل "المريض النفسي:" تظهر مزاحة 28px بعد بنود أ-د
- **السبب:** `marginRight` (فيزيائي) بدل `marginInlineStart` (منطقي) + continuation logic تزيح فقرات `dataLevel=0`
- **الحل:** كل `marginRight` → `marginInlineStart` + فقرات `dataLevel===0` تحصل على إزاحة 0
- **الملفات:** `LawDetail.tsx`, `ArticleReferenceText.tsx`

### 8.2 تسريب span في استخراج BOE
- **الحل:** `_container_to_text()` بدل DOM traversal

### 8.3 ربط المادة 19 بدل 9
- **الحل:** قاموس مرتب من الأطول للأقصر في `ArticleReferenceText.tsx`

### 8.4 Mixed ordinal/numeric levels
- **الحل:** `hasMixedLevels` detection + visual level assignment

### 8.5 جداول التعديلات في مكانها الصحيح
- **الحل:** `content_parts` بدل `description` + `tables` منفصلة

### 8.6 تنظيف أحكام BOG (OCR)
- **الحل:** `judgment-parser.ts` — إصلاح تواريخ، إزالة تسريب أحكام مدمجة، هيئة التثقيف→التدقيق

---

## 9. صفحات المنصة

| المسار | الوصف |
|--------|-------|
| `/` | المكتبة القانونية (3,898 نظام) |
| `/law/:id` | تفاصيل نظام ومواده |
| `/judgments` | قائمة الأحكام (تبويبات + فلاتر) |
| `/judgments/:id` | تفاصيل حكم |
| `/gazette` | فهرس الجريدة الرسمية |
| `/search` | بحث شامل |
| `/auth` | تسجيل دخول (Google OAuth) |
| `/admin` | لوحة المشرف |

---

## 10. API الرئيسية

```
GET  /api/sources                    — مصادر الأنظمة
GET  /api/library                    — قائمة الأنظمة
GET  /api/laws/:id                   — تفاصيل نظام
GET  /api/judgments                   — أحكام (source=sa_all|eg_naqd|sa_judicial|bog_judicial)
GET  /api/judgments/:id              — تفاصيل حكم
GET  /api/judgments/facets           — فلاتر الأحكام (cached)
GET  /api/gazette                    — فهرس الجريدة
POST /api/explain-article            — شرح بالذكاء الاصطناعي (SSE)
GET  /api/auth/user                  — المستخدم الحالي
GET  /api/auth/google                — بدء OAuth
GET  /api/auth/google/callback       — callback OAuth
```
