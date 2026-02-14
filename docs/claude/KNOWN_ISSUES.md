# Known Issues

## 2026-02-14

### 1. AUTH_JWT_SECRET using default value in production
- **Severity:** HIGH (security)
- **Description:** JWT secret is `dev-change-me` (hardcoded default) on production. Anyone who knows this can forge tokens.
- **Repro:** Check Render.com env vars — AUTH_JWT_SECRET is not set
- **Root cause:** Never configured a production secret
- **Fix:** Add strong random AUTH_JWT_SECRET to Render.com (or Hetzner) env vars
- **Diagnostic:** `curl` the production API with a forged JWT using the default secret

### 2. Google OAuth consent screen in "Testing" mode
- **Severity:** MEDIUM
- **Description:** Google OAuth app is in Testing mode, limited to 100 test users. External users may not be able to log in.
- **Repro:** Try logging in with a Google account not in the test users list
- **Root cause:** New OAuth apps default to Testing mode; publishing requires Google verification
- **Fix:** Submit app for Google verification or add test users manually
- **Diagnostic:** Check Google Cloud Console → OAuth consent screen → Publishing status

### 3. Render.com free tier spindown
- **Severity:** MEDIUM (user experience)
- **Description:** Free Render instance spins down after inactivity, causing 50+ second cold starts
- **Repro:** Visit https://arabic-legal-platform.onrender.com after 15+ minutes of no traffic
- **Root cause:** Render free tier limitation
- **Fix:** Migrate to Hetzner VPS (decided, not yet done) or upgrade Render plan
- **Diagnostic:** First request after idle shows long loading time

### 4. GOOGLE_CLIENT_ID value on Render might be incomplete
- **Severity:** LOW-MEDIUM
- **Description:** When entering GOOGLE_CLIENT_ID via Render UI, the numeric prefix `158253149316-` may not have been typed correctly initially. Was corrected via JavaScript injection but should be verified.
- **Repro:** Check Render env vars → reveal GOOGLE_CLIENT_ID → verify it starts with `158253149316-`
- **Root cause:** Browser automation typing issue with numeric strings
- **Fix:** Verify and re-enter if needed on Render.com
- **Diagnostic:** Try Google OAuth on production — if redirect fails, the client ID is wrong

### 5. Local server port 3005 occupied
- **Severity:** LOW (dev only)
- **Description:** Port 3005 was occupied by an old server process running from user's terminal
- **Repro:** Run `npm run dev` — may fail with EADDRINUSE
- **Root cause:** Previous server instance not properly terminated
- **Fix:** Kill the process using port 3005: `netstat -ano | findstr :3005` then `taskkill /PID <pid> /F`
- **Diagnostic:** `netstat -ano | findstr :3005`

### 6. DATABASE_URL points to PostgreSQL but app uses SQLite
- **Severity:** LOW (cosmetic)
- **Description:** `.env` has `DATABASE_URL=postgresql://...` but the app exclusively uses SQLite via better-sqlite3
- **Root cause:** Legacy config from initial project template
- **Fix:** Remove or document that DATABASE_URL is unused
- **Diagnostic:** Grep for DATABASE_URL usage in server code
