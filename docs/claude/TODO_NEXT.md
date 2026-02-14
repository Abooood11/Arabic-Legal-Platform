# TODO Next

## P0 — Critical / Immediate

### 1. Migrate to Hetzner VPS
- **Target:** Server infrastructure
- **Context:** User decided to move from Render.com (free tier, spins down) to Hetzner VPS (~€4.5/mo)
- **Acceptance:** Platform running on Hetzner with domain, SSL, persistent data.db
- **Steps:**
  1. Create Hetzner account and provision CX22 VPS (Frankfurt)
  2. Install Node.js, nginx, certbot
  3. Clone repo, upload data.db
  4. Set up systemd service for the Node app
  5. Configure nginx reverse proxy with SSL
  6. Set all env vars (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, ADMIN_EMAILS, etc.)
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

### 4. Local server restart and testing
- **Target:** Local dev environment
- **Context:** Port 3005 was occupied by an old process in previous session
- **Acceptance:** Server running locally, Google OAuth testable
- **Validate:** `npm run dev` starts, visit `http://localhost:3005/auth`

### 5. Add custom domain
- **Target:** DNS + hosting config
- **Acceptance:** Platform accessible via a custom domain (not .onrender.com)
- **Validate:** `curl -s https://CUSTOM_DOMAIN` returns HTML

---

## P2 — Nice to Have / Future

### 6. Clean up untracked files
- **Target:** Root directory
- **Context:** Multiple test files and scripts cluttering the repo
- **Files:** `test_date_fixes.cjs`, `test_ha5.cjs`, `test_ho.cjs`, `test_western_dates.cjs`, `DEPLOYMENT_NOTES.md`, various `scripts/bog_*.py`
- **Acceptance:** Untracked files either committed or gitignored
- **Validate:** `git status` shows clean working tree

### 7. Add AUTH_JWT_SECRET to production
- **Target:** Render.com / Hetzner env vars
- **Context:** Currently using default `dev-change-me` secret in production (insecure)
- **Acceptance:** Strong random JWT secret set in production env
- **Validate:** Check env var is set, existing sessions still work after restart

### 8. Google OAuth consent screen: publish for production
- **Target:** Google Cloud Console
- **Context:** OAuth app is in "Testing" mode (limited to 100 users)
- **Acceptance:** App published for all users (requires Google review)
- **Validate:** Non-test users can log in via Google
