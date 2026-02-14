# Changelog — 2026-02-14

## Chronological Changes

### 1. ~09:55 — Google OAuth 2.0 Implementation (commit `c0d0722`)
**Files modified:**
- `server/authSystem.ts` (+155 lines) — Added Google OAuth routes, DB migration for google_id/auth_provider columns
- `client/src/pages/AuthPortal.tsx` (+85/-19 lines) — Added GoogleIcon SVG, Google login button, removed age range field
- `.env.example` (+13 lines) — Added Google OAuth and JWT env var documentation

**Summary:** Full Google OAuth 2.0 authorization code flow. Three new routes: `/api/auth/google` (redirect to Google), `/api/auth/google/callback` (exchange code for tokens, create/link user), `/api/auth/google/status` (check if configured). Handles: new users, linking existing email accounts, returning Google users.

---

### 2. ~09:57 — Google button always visible (commit `7311f49`)
**Files modified:**
- `client/src/pages/AuthPortal.tsx` (+21/-33 lines) — Removed conditional rendering based on API status
- `server/authSystem.ts` (+2/-2 lines) — Changed `/api/auth/google` to redirect with error instead of returning 500 JSON

**Summary:** Fixed UX issue where Google button was hidden when env vars were empty. Now button always shows; if not configured, server redirects to `/auth?error=not_configured` with Arabic error message.

---

### 3. ~09:30–10:00 — Google Cloud Console Setup (browser automation, no commit)
**Actions:**
- Created OAuth consent screen (app name: "Tashree", external audience)
- Created OAuth Client ID (Web application, redirect URIs for localhost:3005 and onrender.com)
- Retrieved Client ID and Client Secret
- Added credentials to `.env` (local, gitignored)

---

### 4. ~10:00–10:25 — Render.com Environment Variables (browser automation, no commit)
**Actions:**
- Navigated to Render.com dashboard → arabic-legal-platform → Environment
- Added `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`
- Triggered rebuild and deploy

---

### 5. ~10:40 — Admin Role Assignment (commit `4e6696d`)
**Files modified:**
- `server/authSystem.ts` (+11 lines) — Added startup migration to promote ADMIN_EMAILS users to admin
- `.env.example` (+1/-1 lines) — Set default ADMIN_EMAILS to abooood01@gmail.com

**Summary:** Added code that runs on every server startup to UPDATE app_users SET role='admin' for all users whose email matches ADMIN_EMAILS. Also updated `.env` (local) and `.env.example`.

---

### 6. ~10:45 — Render.com ADMIN_EMAILS (browser automation, no commit)
**Actions:**
- Added `ADMIN_EMAILS=abooood01@gmail.com` to Render.com env vars
- Triggered rebuild and deploy

---

### 7. ~10:45 — Push to GitHub
**Action:** `git push` — commit `4e6696d` pushed to `origin/master`
**Result:** Auto-deploy triggered on Render.com

---

## Commits Today (in order)
1. `c0d0722` — feat: تسجيل الدخول والتسجيل عبر حساب Google OAuth 2.0
2. `7311f49` — fix: إظهار زر Google دائماً مع رسالة خطأ عند عدم التفعيل
3. `4e6696d` — feat: تعيين abooood01@gmail.com كمسؤول المنصة
