# نظام الحسابات والصلاحيات والاشتراكات (جاهزية الدفع)

تم إضافة نظام مصادقة محلي متكامل يتضمن:

- حسابات مستخدمين ومسؤولين مع أدوار (`user`, `admin`).
- تسجيل/دخول ببريد وكلمة مرور قوية.
- جلسات آمنة عبر Access Token قصير العمر + Refresh Token طويل العمر ضمن `HttpOnly cookies`.
- تحقق ثنائي TOTP (Google Authenticator ونحوه) عبر endpoints إعداد وتفعيل.
- سجل تدقيق لمحاولات تسجيل الدخول.
- حقول اشتراك جاهزة للتكامل مع بوابات الدفع.

## الجداول الجديدة
- `app_users`: بيانات المصادقة/الدور/الاشتراك لكل مستخدم.
- `auth_sessions`: جلسات refresh token القابلة للإبطال.
- `login_audit_logs`: توثيق محاولات تسجيل الدخول.

## واجهات API الأساسية
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/user`
- `GET /api/auth/admin-status`
- `POST /api/auth/mfa/setup`
- `POST /api/auth/mfa/verify`
- `GET /api/auth/subscription/me`

## واجهات API إدارية
- `GET /api/admin/users`
- `PATCH /api/admin/users/:id/subscription`

## واجهة المستخدم
- صفحة بوابة الحسابات: `/auth`.
- تسجيل الدخول السري في Footer يوجه الآن إلى `/auth`.

## ملاحظات أمنية
- تعيين `AUTH_JWT_SECRET` في بيئة الإنتاج إلزامي.
- تعيين `ADMIN_EMAILS` لتحديد المشرفين أثناء التسجيل الأولي.
- في الإنتاج يتم إضافة `Secure` للكوكي تلقائيًا.
- هذه البنية تمهّد لتوصيل Stripe/Moyasar: عبر `payment_customer_id`, `subscription_tier`, `subscription_status`, `subscription_expires_at`.
