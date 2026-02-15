# TODO Next

## P0 — Critical / Immediate

### 1. Migrate to Hetzner VPS
- **Target:** Server infrastructure
- **Context:** User decided to move from Render.com (free tier, spins down) to Hetzner VPS (~€4.5/mo). data.db is now ~5.4GB.
- **Acceptance:** Platform running on Hetzner with domain, SSL, persistent data.db
- **Steps:**
  1. Create Hetzner account and provision CX22 VPS (Frankfurt)
  2. Install Node.js, nginx, certbot
  3. Clone repo, upload data.db (~5.4GB) and scraper/data/ (~2GB)
  4. Set up systemd service for the Node app
  5. Configure nginx reverse proxy with SSL
  6. Set all env vars (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, ADMIN_EMAILS, AUTH_JWT_SECRET)
  7. Update Google OAuth redirect URIs to new domain
  8. Test all functionality
- **Validate:** `curl -s https://NEW_DOMAIN/api/auth/google/status` returns `{"enabled":true}`

### 2. Verify Google OAuth end-to-end on production
- **Target:** `server/authSystem.ts`, Render.com / new host
- **Acceptance:** User can click "المتابعة عبر حساب Google" → redirect → login → redirect back → authenticated
- **Validate:** Login with Google on production, check `/api/auth/user` returns user data

### 3. Verify admin access for abooood01@gmail.com
- **Target:** `server/authSystem.ts`
- **Acceptance:** After login, `/api/auth/admin-status` returns `{ isAdmin: true }`, `/admin` page loads
- **Validate:** Login as abooood01@gmail.com, navigate to `/admin`

---

## P1 — Important / Soon

### 4. Add custom domain
- **Target:** DNS + hosting config
- **Acceptance:** Platform accessible via a custom domain (not .onrender.com)
- **Validate:** `curl -s https://CUSTOM_DOMAIN` returns HTML

### 5. إعادة استخراج السجلات الفارغة (28,193 حكم مصري)
- **Target:** `scraper/refetch_empty.js` (لم يُنشأ بعد)
- **Context:** 28,193 حكم (5%) بدون نص من EMJ API الأصلي. قد تكون متاحة الآن.
- **Steps:**
  1. كتابة سكربت يبحث في DB عن سجلات `eg_naqd` بنص قصير (<100 حرف)
  2. إعادة جلبها من EMJ API: `GetAhkambyYearsbypage?id={section}&year={year}&page={page}`
  3. تحديث فقط السجلات التي كانت فارغة وأصبح لها نص
- **Validate:** `SELECT count(*) FROM judgments WHERE source='eg_naqd' AND length(text) < 100` يقل

### 6. معالجة حالات الخلط بين المبدأ ونص الحكم (7,569 حالة)
- **Target:** سكربت تنظيف جديد
- **Context:** 1.3% من الأحكام المصرية فيها خلط: نص حكم في حقل المبدأ أو العكس
- **Approach:** أنماط regex موثوقة (>85% دقة) لإعادة التوزيع
- **Rule:** لا يُختلق نص — فقط إعادة توزيع ما هو موجود
- **Validate:** إعادة تشغيل `scraper/audit_emj_data.js` ومقارنة النتائج

---

## P2 — Nice to Have / Future

### 7. Clean up untracked files
- **Target:** Root directory
- **Context:** Multiple test files and scripts cluttering the repo
- **Files:** `test_date_fixes.cjs`, `test_ha5.cjs`, `test_ho.cjs`, `test_western_dates.cjs`, `DEPLOYMENT_NOTES.md`, various `scripts/bog_*.py`
- **Acceptance:** Untracked files either committed or gitignored
- **Validate:** `git status` shows clean working tree

### 8. Add AUTH_JWT_SECRET to production
- **Target:** Hetzner env vars
- **Context:** Currently using default `dev-change-me` secret in production (insecure)
- **Acceptance:** Strong random JWT secret set in production env
- **Validate:** Check env var is set, existing sessions still work after restart

### 9. Google OAuth consent screen: publish for production
- **Target:** Google Cloud Console
- **Context:** OAuth app is in "Testing" mode (limited to 100 users)
- **Acceptance:** App published for all users (requires Google review)
- **Validate:** Non-test users can log in via Google

### 10. إضافة المبدأ القضائي لفهرس البحث FTS
- **Target:** `server/db.ts`
- **Context:** حالياً FTS يبحث في `text` فقط. إضافة `principle_text` للبحث الشامل.
- **Approach:** إعادة بناء FTS table بحقل إضافي أو إنشاء FTS منفصل للمبادئ
- **Validate:** بحث عن مصطلح موجود فقط في المبدأ يرجع نتائج
