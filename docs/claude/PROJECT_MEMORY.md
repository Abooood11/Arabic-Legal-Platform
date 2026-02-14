# READ FIRST (Claude Code)
Before doing anything in a new session:
1) Read this file fully.
2) Read docs/claude/TODO_NEXT.md.
3) Then proceed.

---

## Executive Summary
Arabic Legal Platform ("تشريع" / Tashree) is a Saudi/Arab legal research platform built with:
- **Backend:** Express.js + SQLite (better-sqlite3) with FTS5 full-text search
- **Frontend:** React + Vite + TanStack Query + Tailwind CSS + shadcn/ui
- **Auth:** Custom JWT (HS256) with Google OAuth 2.0 support
- **Data:** 3,907 laws (JSON), 6,258 court judgments (SQLite FTS5), 61,138 gazette entries (SQLite FTS5)
- **Database:** `data.db` (285MB, gitignored, deployed via GitHub Release asset)
- **Deployment:** Render.com (free tier, auto-deploy from `master` branch)
- **Admin:** Role-based (ADMIN_EMAILS env var), admin dashboard at `/admin`
- **Language:** Full Arabic RTL interface
- **Port:** 3005 (local dev)

---

## What We Changed Today (2026-02-14)

### Commit `c0d0722` — Google OAuth 2.0
- **Files:** `server/authSystem.ts`, `client/src/pages/AuthPortal.tsx`, `.env.example`
- **What:** Added full Google OAuth 2.0 login/register flow
- **Why:** User requested "اضف امكانية التسجيل وتسجيل الدخول عبر تسجيل الدخول لحساب قوقل"
- **Impact:** New routes `/api/auth/google`, `/api/auth/google/callback`, `/api/auth/google/status`. Added `google_id` and `auth_provider` columns to users table. Removed age range field and TOTP from register form.

### Commit `7311f49` — Google button always visible
- **Files:** `client/src/pages/AuthPortal.tsx`, `server/authSystem.ts`
- **What:** Made Google login button always visible (not conditional on API status). If Google OAuth is not configured, server redirects to `/auth?error=not_configured` with Arabic error message.
- **Why:** Button was hidden when env vars were empty, user couldn't see it.
- **Impact:** Better UX - button always shows, graceful error if not configured.

### Commit `4e6696d` — Admin role assignment
- **Files:** `server/authSystem.ts`, `.env.example`
- **What:** Added startup migration to promote existing users in ADMIN_EMAILS to admin role. Set `abooood01@gmail.com` as default admin.
- **Why:** ADMIN_EMAILS only worked on new registrations; existing users stayed as "user" role.
- **Impact:** On every server startup, users matching ADMIN_EMAILS get upgraded to admin.

### Google Cloud Console Setup (browser automation)
- **What:** Created OAuth consent screen + OAuth Client ID on Google Cloud Console
- **Client ID:** Stored in `.env` and Render.com env vars
- **Redirect URIs:** `http://localhost:3005/api/auth/google/callback` + `https://arabic-legal-platform.onrender.com/api/auth/google/callback`

### Render.com Environment Variables
- **What:** Added `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `ADMIN_EMAILS` to Render.com service env vars
- **Impact:** Google OAuth and admin role active on production

---

## Current State

### Working
- Law browsing and search (FTS5)
- Judgment browsing and search (FTS5)
- Gazette index browsing and search (FTS5)
- Unified search page (`/search`)
- User registration and login (email/password)
- Google OAuth login (configured on Render.com)
- Admin dashboard (`/admin`) with analytics
- Admin role assignment via ADMIN_EMAILS
- Error reports management (admin only)
- Search analytics (admin only)

### Partially Working
- Google OAuth locally (port 3005 was occupied by another process in previous session; needs server restart to test)

### Not Verified
- End-to-end Google OAuth flow on production (deploy was triggered but not tested)
- Admin access for abooood01@gmail.com on production (deploy was triggered)

---

## How to Run / Build / Test

```bash
# Install dependencies
npm ci

# Development (port 3005)
npm run dev

# Type check
npm run check

# Production build
npm run build

# Start production
npm start
```

**Important:** `data.db` (285MB) is gitignored. For deployment, it's attached as a GitHub Release asset and downloaded during Render build.

---

## Environment Variables (NAMES ONLY)

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | PostgreSQL connection (unused, SQLite is actual DB) |
| `PORT` | Server port (default 3005) |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret |
| `ADMIN_EMAILS` | Comma-separated admin emails |
| `AUTH_JWT_SECRET` | JWT signing secret |
| `NODE_ENV` | Environment (development/production) |
| `AI_INTEGRATIONS_OPENAI_API_KEY` | OpenAI API key for article explanations |
| `AI_INTEGRATIONS_OPENAI_BASE_URL` | OpenAI API base URL |

---

## Key File Paths

| File | Purpose |
|------|---------|
| `server/authSystem.ts` | Auth system (JWT, Google OAuth, admin roles, schema) |
| `server/routes.ts` | All API routes (~58KB, includes search, admin, articles) |
| `server/db.ts` | SQLite connection + FTS5 indexes |
| `server/index.ts` | Express app entry point |
| `client/src/pages/AuthPortal.tsx` | Login/register page with Google button |
| `client/src/pages/UnifiedSearch.tsx` | Unified search page |
| `client/src/pages/AdminDashboard.tsx` | Admin dashboard |
| `client/src/hooks/use-auth.ts` | Auth hook (TanStack Query) |
| `client/src/hooks/use-admin.ts` | Admin status hook |
| `client/src/components/Navbar.tsx` | Navigation bar |
| `client/src/App.tsx` | Routes and app structure |
| `client/public/data/library.json` | Law library index |
| `client/public/data/laws/` | Individual law JSON files |
| `data.db` | SQLite database (285MB, gitignored) |
| `.env` | Local environment variables (gitignored) |
| `.env.example` | Environment variables template |

---

## Data Pipeline

```
JSON law files (client/public/data/laws/) → FTS5 index (law_articles_fts in data.db) at startup
BOG judgments (scraped) → SQLite judgments table + FTS5 (judgments_fts)
Gazette entries → SQLite gazette table + FTS5 (gazette_fts)
```

---

## Verification Checklist

1. [ ] `npm run check` passes (TypeScript)
2. [ ] `npm run dev` starts on port 3005
3. [ ] `/auth` page shows Google login button
4. [ ] `/api/auth/google` redirects to Google consent screen (when env vars set)
5. [ ] `/api/auth/google/callback` completes OAuth flow
6. [ ] `/api/auth/admin-status` returns `{ isAdmin: true }` for admin email
7. [ ] `/admin` page loads for admin user
8. [ ] `/search` unified search works
9. [ ] Render.com has env vars: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, ADMIN_EMAILS, NODE_ENV
10. [ ] Production site loads: https://arabic-legal-platform.onrender.com
11. [ ] Google OAuth works on production
12. [ ] Admin dashboard accessible on production for abooood01@gmail.com
