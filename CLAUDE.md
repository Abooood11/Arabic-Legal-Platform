# Arabic Legal Platform - منصة البحث في الأنظمة السعودية

## 📋 نظرة عامة
منصة ويب للبحث في الأنظمة واللوائح السعودية مع شرح المواد بالذكاء الاصطناعي.

## 🛠️ التقنيات المستخدمة

### Frontend
- **React 18** + **TypeScript**
- **Vite** للـ bundling
- **TailwindCSS** للتنسيق
- **shadcn/ui** لمكونات الواجهة
- **Wouter** للـ routing
- **TanStack Query** لإدارة الـ state

### Backend
- **Node.js** + **Express 5**
- **Drizzle ORM** للتعامل مع قاعدة البيانات
- **PostgreSQL** قاعدة البيانات

### AI Integration
- **OpenAI API** لشرح المواد القانونية

## 📁 هيكل المشروع

```
Arabic-Legal-Platform/
├── client/                 # Frontend React
│   ├── src/
│   │   ├── components/     # مكونات React
│   │   ├── pages/          # الصفحات
│   │   ├── hooks/          # Custom hooks
│   │   └── lib/            # مكتبات مساعدة
│   └── public/
│       └── data/
│           └── laws/       # ملفات JSON للأنظمة
├── server/                 # Backend Express
│   ├── index.ts            # نقطة الدخول
│   ├── routes.ts           # API endpoints
│   ├── storage.ts          # التعامل مع الملفات
│   └── db.ts               # اتصال قاعدة البيانات
├── shared/                 # كود مشترك
│   ├── schema.ts           # Drizzle schema
│   └── routes.ts           # تعريف الـ API routes
└── script/
    └── build.ts            # سكربت البناء
```

## 🚀 أوامر التشغيل

```bash
# تثبيت المتطلبات
npm install

# تشغيل في وضع التطوير
npm run dev

# بناء للإنتاج
npm run build

# تشغيل الإنتاج
npm start

# فحص TypeScript
npm run check

# تحديث قاعدة البيانات
npm run db:push
```

## 🔧 متغيرات البيئة المطلوبة

```env
# قاعدة البيانات
DATABASE_URL=postgresql://user:password@host:5432/database

# OpenAI للشرح بالذكاء الاصطناعي
AI_INTEGRATIONS_OPENAI_API_KEY=sk-...
AI_INTEGRATIONS_OPENAI_BASE_URL=https://api.openai.com/v1

# المشرفين (اختياري)
ADMIN_USER_IDS=user_id_1,user_id_2
```

## 📄 الصفحات الرئيسية

1. **/** أو **/library** - المكتبة القانونية (قائمة الأنظمة)
2. **/law/:id** - تفاصيل النظام ومواده
3. **/about** - عن المنصة
4. **/admin/reports** - تقارير الأخطاء (للمشرفين)

## 🔌 API Endpoints

### عام
- `GET /api/sources` - مصادر الأنظمة
- `GET /api/library` - قائمة الأنظمة
- `GET /api/laws/:id` - تفاصيل نظام معين

### المواد
- `GET /api/articles/:lawId/overrides` - التعديلات على المواد
- `GET /api/articles/:lawId/:articleNumber` - مادة معينة
- `PATCH /api/articles/:lawId/:articleNumber/override` - تعديل مادة (مشرف)
- `DELETE /api/articles/:lawId/:articleNumber/override` - حذف تعديل (مشرف)

### الذكاء الاصطناعي
- `POST /api/explain-article` - شرح مادة بالذكاء الاصطناعي (SSE streaming)

### تقارير الأخطاء
- `POST /api/error-reports` - إرسال تقرير خطأ
- `GET /api/error-reports` - قائمة التقارير (مشرف)
- `PATCH /api/error-reports/:id/resolve` - حل تقرير (مشرف)
- `DELETE /api/error-reports/:id` - حذف تقرير (مشرف)

## 📊 قاعدة البيانات (Drizzle Schema)

```typescript
// جدول تعديلات المواد
articleOverrides: {
  lawId: string,
  articleNumber: string,
  overrideText: string,
  updatedAt: timestamp,
  updatedBy: string
}

// جدول تقارير الأخطاء
errorReports: {
  id: serial,
  lawId: string,
  articleNumber: integer,
  description: text,
  status: string, // 'pending' | 'resolved'
  createdAt: timestamp,
  resolvedAt: timestamp
}
```

## 🌐 اللغة والاتجاه
- اللغة الأساسية: **العربية**
- اتجاه الواجهة: **RTL** (من اليمين لليسار)
- الخط: **Noto Sans Arabic**

## ⚠️ ملاحظات مهمة

1. **البيانات القانونية** موجودة في `/client/public/data/laws/` كملفات JSON
2. **التوثيق** يدعم Authentication عبر Replit Auth (يحتاج تعديل لمنصات أخرى)
3. **الشرح بالذكاء الاصطناعي** يستخدم Server-Sent Events للـ streaming
4. **النظامان المتوفران حالياً**:
   - نظام المعاملات المدنية (civil_transactions_sa)
   - نظام المرافعات الشرعية (sharia_procedures)

## 🔄 للنشر على منصات أخرى

### Vercel + Supabase
1. غيّر نظام المصادقة من Replit Auth
2. أضف DATABASE_URL من Supabase
3. انشر الـ Frontend على Vercel
4. استخدم Vercel Functions للـ Backend

### Render
1. أنشئ Web Service للتطبيق كامل
2. أنشئ PostgreSQL database
3. أضف متغيرات البيئة
