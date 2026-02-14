# Decisions Log

## 2026-02-14

### 1. Google OAuth without additional packages
- **Decision:** Implemented Google OAuth using native `fetch()` instead of passport-google-oauth20 or openid-client
- **Rationale:** Both passport and openid-client were installed but unused. Native fetch is simpler, fewer dependencies, and the OAuth 2.0 authorization code flow is straightforward enough.
- **Tradeoffs:** No automatic token refresh, no session management via passport. But since we use custom JWT anyway, passport would add unnecessary abstraction.
- **Alternatives considered:** passport-google-oauth20 (too heavy for this setup), openid-client (OIDC overkill)

### 2. Google button always visible (not conditional)
- **Decision:** Show Google login button always, redirect to error page if not configured
- **Rationale:** Initially the button was hidden when GOOGLE_CLIENT_ID was empty (API returned `enabled: false`). User couldn't see the button and got confused.
- **Tradeoffs:** Users see a button that might not work if env vars are missing. But the error message is clear ("تسجيل الدخول عبر Google غير مُفعّل حالياً").
- **Alternatives considered:** Conditional rendering (rejected — confusing when env vars missing)

### 3. CSRF protection via state cookie
- **Decision:** Use a random state token stored in a cookie for OAuth CSRF protection
- **Rationale:** Standard OAuth 2.0 security practice. State token is generated before redirect, verified on callback.
- **Tradeoffs:** Requires cookie support. SameSite=Lax works for the OAuth redirect flow.

### 4. Admin promotion on startup (not just registration)
- **Decision:** Run UPDATE query on every server startup to promote ADMIN_EMAILS users
- **Rationale:** Setting ADMIN_EMAILS only affected new registrations. If a user registered before being added to ADMIN_EMAILS, they stayed as "user" forever.
- **Tradeoffs:** Small overhead on startup (single SQL UPDATE). But ensures admin status is always in sync with env var.
- **Alternatives considered:** Manual SQL update (rejected — not automated), migration-only approach (rejected — wouldn't handle env var changes)

### 5. Hetzner VPS over Render.com upgrade
- **Decision:** User chose Hetzner VPS (€4.5/mo) over Render Starter ($7/mo)
- **Rationale:** Full server control, closer to Saudi Arabia (Frankfurt), better value, persistent storage native, no sleep/spindown issues.
- **Tradeoffs:** More setup work (nginx, SSL, systemd), user responsible for updates. But much more flexible.
- **Status:** Decision made, not yet implemented
