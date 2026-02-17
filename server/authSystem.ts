import type { Express, Request, RequestHandler } from "express";
import crypto from "crypto";
import { sqlite } from "./db";

const ACCESS_COOKIE = "alp_access";
const REFRESH_COOKIE = "alp_refresh";
const ACCESS_TTL_SECONDS = 15 * 60;
const REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60;

// Fail-fast: require a strong JWT secret in production
const JWT_SECRET = process.env.AUTH_JWT_SECRET || "dev-change-me";
if (process.env.NODE_ENV === "production" && JWT_SECRET === "dev-change-me") {
  console.error("FATAL: AUTH_JWT_SECRET must be set in production. Exiting.");
  process.exit(1);
}

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || "").split(",").map((v) => v.trim().toLowerCase()).filter(Boolean);

// ── Rate Limiting (in-memory, per IP+email) ──────────────────────────
const loginAttempts = new Map<string, { count: number; firstAt: number; lockedUntil: number }>();
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_ATTEMPTS = 10;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes lockout

function checkRateLimit(key: string): { allowed: boolean; retryAfterSec?: number } {
  const now = Date.now();
  const entry = loginAttempts.get(key);

  if (!entry) return { allowed: true };

  // Check lockout
  if (entry.lockedUntil > now) {
    return { allowed: false, retryAfterSec: Math.ceil((entry.lockedUntil - now) / 1000) };
  }

  // Reset if window expired
  if (now - entry.firstAt > RATE_LIMIT_WINDOW_MS) {
    loginAttempts.delete(key);
    return { allowed: true };
  }

  if (entry.count >= MAX_ATTEMPTS) {
    entry.lockedUntil = now + LOCKOUT_DURATION_MS;
    return { allowed: false, retryAfterSec: Math.ceil(LOCKOUT_DURATION_MS / 1000) };
  }

  return { allowed: true };
}

function recordFailedAttempt(key: string) {
  const now = Date.now();
  const entry = loginAttempts.get(key);
  if (!entry || now - entry.firstAt > RATE_LIMIT_WINDOW_MS) {
    loginAttempts.set(key, { count: 1, firstAt: now, lockedUntil: 0 });
  } else {
    entry.count++;
  }
}

function clearAttempts(key: string) {
  loginAttempts.delete(key);
}

// Cleanup stale entries every 30 minutes
setInterval(() => {
  const now = Date.now();
  loginAttempts.forEach((entry, key) => {
    if (now - entry.firstAt > RATE_LIMIT_WINDOW_MS && entry.lockedUntil < now) {
      loginAttempts.delete(key);
    }
  });
}, 30 * 60 * 1000);

function nowUnix() {
  return Math.floor(Date.now() / 1000);
}

function base64Url(input: Buffer | string) {
  return Buffer.from(input).toString("base64url");
}

function signJwt(payload: Record<string, unknown>, expSeconds: number) {
  const header = base64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const exp = nowUnix() + expSeconds;
  const body = base64Url(JSON.stringify({ ...payload, exp }));
  const data = `${header}.${body}`;
  const sig = crypto.createHmac("sha256", JWT_SECRET).update(data).digest("base64url");
  return `${data}.${sig}`;
}

function verifyJwt(token?: string | null): null | Record<string, any> {
  if (!token) return null;
  const [header, body, sig] = token.split(".");
  if (!header || !body || !sig) return null;
  const data = `${header}.${body}`;
  const expected = crypto.createHmac("sha256", JWT_SECRET).update(data).digest("base64url");
  if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return null;
  const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  if (!payload.exp || nowUnix() > payload.exp) return null;
  return payload;
}

function randomToken(bytes = 48) {
  return crypto.randomBytes(bytes).toString("base64url");
}

function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function hashPassword(password: string, salt?: string) {
  const actualSalt = salt || crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, actualSalt, 64).toString("hex");
  return { salt: actualSalt, hash };
}

function verifyPassword(password: string, salt: string, hash: string) {
  const candidate = crypto.scryptSync(password, salt, 64).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(candidate, "hex"), Buffer.from(hash, "hex"));
}

function parseCookies(req: Request) {
  const cookieHeader = req.headers.cookie || "";
  return Object.fromEntries(cookieHeader.split(";").map((part) => part.trim()).filter(Boolean).map((part) => {
    const idx = part.indexOf("=");
    return [part.slice(0, idx), decodeURIComponent(part.slice(idx + 1))];
  }));
}

function setCookie(res: any, key: string, value: string, maxAgeSec: number) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.append("Set-Cookie", `${key}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure}`);
}

function clearCookie(res: any, key: string) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.append("Set-Cookie", `${key}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`);
}

function encodeBase32(buf: Buffer) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  let output = "";
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i];
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      output += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += alphabet[(value << (5 - bits)) & 31];
  return output;
}

function decodeBase32(input: string) {
  const clean = input.replace(/=+$/, "").toUpperCase().replace(/\s+/g, "");
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = alphabet.indexOf(ch);
    if (idx < 0) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function createTotp(secretBase32: string, step = 30) {
  const key = decodeBase32(secretBase32);
  const counter = Math.floor(Date.now() / 1000 / step);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac("sha1", key).update(msg).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code = ((hmac.readUInt32BE(offset) & 0x7fffffff) % 1000000).toString().padStart(6, "0");
  return code;
}

function verifyTotp(secretBase32: string, code: string) {
  const normalized = code.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(normalized)) return false;
  const key = decodeBase32(secretBase32);
  const current = Math.floor(Date.now() / 1000 / 30);
  for (let drift = -1; drift <= 1; drift++) {
    const msg = Buffer.alloc(8);
    msg.writeBigUInt64BE(BigInt(current + drift));
    const hmac = crypto.createHmac("sha1", key).update(msg).digest();
    const offset = hmac[hmac.length - 1] & 0xf;
    const expected = ((hmac.readUInt32BE(offset) & 0x7fffffff) % 1000000).toString().padStart(6, "0");
    if (expected === normalized) return true;
  }
  return false;
}

function issueTokens(res: any, user: { id: string; role: string }, userAgent?: string, ip?: string) {
  const sessionId = crypto.randomUUID();
  const refreshToken = randomToken();
  const refreshHash = hashToken(refreshToken);
  const expiresAt = new Date(Date.now() + REFRESH_TTL_SECONDS * 1000).toISOString();

  sqlite.prepare(`
    INSERT INTO auth_sessions (id, user_id, refresh_token_hash, user_agent, ip_address, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(sessionId, user.id, refreshHash, userAgent || null, ip || null, expiresAt);

  const access = signJwt({ sub: user.id, role: user.role, sid: sessionId }, ACCESS_TTL_SECONDS);
  setCookie(res, ACCESS_COOKIE, access, ACCESS_TTL_SECONDS);
  setCookie(res, REFRESH_COOKIE, refreshToken, REFRESH_TTL_SECONDS);
}

function getCurrentUser(req: Request) {
  const cookies = parseCookies(req);
  const payload = verifyJwt(cookies[ACCESS_COOKIE]);
  if (!payload?.sub) return null;
  return getCurrentUserById(payload.sub, payload.sid);
}

function getCurrentUserById(userId: string, sid?: string) {
  const row = sqlite.prepare(`
    SELECT u.id, u.email, u.first_name as firstName, u.last_name as lastName, a.role, a.status,
      a.subscription_tier as subscriptionTier, a.subscription_status as subscriptionStatus, a.mfa_enabled as mfaEnabled
    FROM users u
    JOIN app_users a ON a.user_id = u.id
    WHERE u.id = ? AND a.status = 'active'
  `).get(userId) as any;
  if (!row) return null;
  return { ...row, sid };
}

export const isAuthenticated: RequestHandler = (req, res, next) => {
  const user = getCurrentUser(req);
  if (user) {
    (req as any).user = { claims: { sub: user.id }, role: user.role, profile: user };
    return next();
  }

  // Try refresh token if access token expired/missing
  const cookies = parseCookies(req);
  const refreshToken = cookies[REFRESH_COOKIE];
  if (!refreshToken) return res.status(401).json({ message: "Unauthorized" });

  const refreshHash = hashToken(refreshToken);
  const session = sqlite.prepare(`
    SELECT s.id, s.user_id, u.email, a.role, a.status FROM auth_sessions s
    JOIN users u ON u.id = s.user_id
    JOIN app_users a ON a.user_id = s.user_id
    WHERE s.refresh_token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > datetime('now')
  `).get(refreshHash) as any;

  if (!session || session.status !== "active") {
    clearCookie(res, ACCESS_COOKIE);
    clearCookie(res, REFRESH_COOKIE);
    return res.status(401).json({ message: "Unauthorized" });
  }

  // Rotate refresh token
  const newRefreshToken = randomToken();
  const newRefreshHash = hashToken(newRefreshToken);
  const newExpiresAt = new Date(Date.now() + REFRESH_TTL_SECONDS * 1000).toISOString();

  sqlite.prepare("UPDATE auth_sessions SET revoked_at = datetime('now') WHERE id = ?").run(session.id);
  const newSessionId = crypto.randomUUID();
  sqlite.prepare(`
    INSERT INTO auth_sessions (id, user_id, refresh_token_hash, user_agent, ip_address, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(newSessionId, session.user_id, newRefreshHash, (req.headers["user-agent"] as string) || null, req.ip || null, newExpiresAt);

  const access = signJwt({ sub: session.user_id, role: session.role, sid: newSessionId }, ACCESS_TTL_SECONDS);
  setCookie(res, ACCESS_COOKIE, access, ACCESS_TTL_SECONDS);
  setCookie(res, REFRESH_COOKIE, newRefreshToken, REFRESH_TTL_SECONDS);

  const refreshedUser = getCurrentUserById(session.user_id, newSessionId);
  if (!refreshedUser) return res.status(401).json({ message: "Unauthorized" });

  (req as any).user = { claims: { sub: refreshedUser.id }, role: refreshedUser.role, profile: refreshedUser };
  next();
};

export const isAdmin: RequestHandler = (req, res, next) => {
  if ((req as any).user?.role !== "admin") return res.status(403).json({ message: "Forbidden" });
  next();
};

export function setupAuthSchema() {
  // Migrate old sessions table if schema mismatch (expired→expire)
  try {
    const cols = sqlite.prepare("PRAGMA table_info(sessions)").all() as any[];
    if (cols.length > 0 && !cols.some((c: any) => c.name === "expire")) {
      sqlite.exec("DROP TABLE sessions;");
    }
  } catch {}

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE,
      first_name TEXT,
      last_name TEXT,
      profile_image_url TEXT,
      google_id TEXT UNIQUE,
      auth_provider TEXT DEFAULT 'local',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      sid TEXT PRIMARY KEY,
      sess TEXT NOT NULL,
      expire TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS IDX_session_expire ON sessions(expire);

    CREATE TABLE IF NOT EXISTS app_users (
      user_id TEXT PRIMARY KEY,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      status TEXT NOT NULL DEFAULT 'active',
      mfa_enabled INTEGER NOT NULL DEFAULT 0,
      mfa_secret TEXT,
      mfa_pending_secret TEXT,
      subscription_tier TEXT NOT NULL DEFAULT 'free',
      subscription_status TEXT NOT NULL DEFAULT 'inactive',
      subscription_expires_at TEXT,
      payment_customer_id TEXT,
      last_login_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS auth_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      refresh_token_hash TEXT NOT NULL,
      user_agent TEXT,
      ip_address TEXT,
      expires_at TEXT NOT NULL,
      revoked_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_id ON auth_sessions(user_id);

    CREATE TABLE IF NOT EXISTS login_audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT,
      user_id TEXT,
      action TEXT NOT NULL,
      success INTEGER NOT NULL,
      ip_address TEXT,
      user_agent TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Migration: add google_id and auth_provider columns if missing
  try { sqlite.exec("ALTER TABLE users ADD COLUMN google_id TEXT UNIQUE"); } catch {}
  try { sqlite.exec("ALTER TABLE users ADD COLUMN auth_provider TEXT DEFAULT 'local'"); } catch {}
  // Make password optional for OAuth users
  try { sqlite.exec("CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id)"); } catch {}

  // Promote existing users in ADMIN_EMAILS to admin role on startup
  if (ADMIN_EMAILS.length > 0) {
    const placeholders = ADMIN_EMAILS.map(() => "?").join(",");
    sqlite.prepare(`
      UPDATE app_users SET role = 'admin'
      WHERE user_id IN (
        SELECT id FROM users WHERE LOWER(email) IN (${placeholders})
      )
    `).run(...ADMIN_EMAILS);
  }
}

export function registerAuthRoutes(app: Express) {
  app.post("/api/auth/register", (req, res) => {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");
    const firstName = String(req.body?.firstName || "").trim();
    const lastName = String(req.body?.lastName || "").trim();

    // Rate limiting on register
    const rateLimitKey = `reg:${req.ip}`;
    const rateCheck = checkRateLimit(rateLimitKey);
    if (!rateCheck.allowed) {
      return res.status(429).json({ message: "تم تجاوز عدد المحاولات. حاول مرة أخرى لاحقاً" });
    }

    if (!email || !/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ message: "البريد الإلكتروني غير صالح" });
    if (password.length < 10 || !/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/\d/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
      return res.status(400).json({ message: "كلمة المرور يجب أن تكون 10 أحرف على الأقل وتتضمن حرفاً كبيراً وصغيراً ورقماً ورمزاً" });
    }

    const exists = sqlite.prepare("SELECT id FROM users WHERE email = ?").get(email);
    if (exists) {
      recordFailedAttempt(rateLimitKey);
      return res.status(409).json({ message: "البريد الإلكتروني مسجل مسبقاً" });
    }

    const userId = crypto.randomUUID();
    const { hash, salt } = hashPassword(password);
    const role = ADMIN_EMAILS.includes(email) ? "admin" : "user";

    sqlite.prepare("INSERT INTO users (id, email, first_name, last_name, created_at, updated_at) VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))")
      .run(userId, email, firstName || null, lastName || null);

    sqlite.prepare("INSERT INTO app_users (user_id, password_hash, password_salt, role, subscription_tier, subscription_status) VALUES (?, ?, ?, ?, 'free', 'inactive')")
      .run(userId, hash, salt, role);

    issueTokens(res, { id: userId, role }, req.headers["user-agent"] as string, req.ip);
    res.json({ success: true, user: { id: userId, email, firstName, lastName, role, subscriptionTier: "free", subscriptionStatus: "inactive" } });
  });

  app.post("/api/auth/login", (req, res) => {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");
    const totpCode = String(req.body?.totpCode || "").trim();

    // Rate limiting
    const rateLimitKey = `${req.ip}:${email}`;
    const rateCheck = checkRateLimit(rateLimitKey);
    if (!rateCheck.allowed) {
      return res.status(429).json({
        message: `تم تجاوز عدد المحاولات المسموح. حاول مرة أخرى بعد ${Math.ceil((rateCheck.retryAfterSec || 900) / 60)} دقيقة`,
        retryAfterSec: rateCheck.retryAfterSec,
      });
    }

    const row = sqlite.prepare(`
      SELECT u.id, u.email, u.first_name as firstName, u.last_name as lastName,
             a.password_hash as passwordHash, a.password_salt as passwordSalt, a.role, a.status,
             a.mfa_enabled as mfaEnabled, a.mfa_secret as mfaSecret,
             a.subscription_tier as subscriptionTier, a.subscription_status as subscriptionStatus
      FROM users u JOIN app_users a ON a.user_id = u.id WHERE u.email = ?
    `).get(email) as any;

    if (!row || !verifyPassword(password, row.passwordSalt, row.passwordHash)) {
      recordFailedAttempt(rateLimitKey);
      sqlite.prepare("INSERT INTO login_audit_logs (email, action, success, ip_address, user_agent) VALUES (?, 'login', 0, ?, ?)")
        .run(email || null, req.ip || null, (req.headers["user-agent"] as string) || null);
      return res.status(401).json({ message: "البريد الإلكتروني أو كلمة المرور غير صحيحة" });
    }

    // Check account status
    if (row.status !== "active") {
      return res.status(403).json({ message: "الحساب موقوف. تواصل مع الدعم الفني." });
    }

    // MFA check — return mfaRequired so frontend can show TOTP input
    if (row.mfaEnabled) {
      if (!totpCode) {
        return res.status(200).json({ mfaRequired: true, message: "أدخل رمز المصادقة الثنائية" });
      }
      if (!verifyTotp(row.mfaSecret, totpCode)) {
        recordFailedAttempt(rateLimitKey);
        return res.status(401).json({ message: "رمز المصادقة الثنائية غير صحيح", mfaRequired: true });
      }
    }

    clearAttempts(rateLimitKey);
    sqlite.prepare("UPDATE app_users SET last_login_at = datetime('now'), updated_at = datetime('now') WHERE user_id = ?").run(row.id);
    sqlite.prepare("INSERT INTO login_audit_logs (email, user_id, action, success, ip_address, user_agent) VALUES (?, ?, 'login', 1, ?, ?)")
      .run(email, row.id, req.ip || null, (req.headers["user-agent"] as string) || null);

    issueTokens(res, { id: row.id, role: row.role }, req.headers["user-agent"] as string, req.ip);
    res.json({ success: true, user: { id: row.id, email: row.email, firstName: row.firstName, lastName: row.lastName, role: row.role, subscriptionTier: row.subscriptionTier, subscriptionStatus: row.subscriptionStatus, mfaEnabled: !!row.mfaEnabled } });
  });

  app.post("/api/auth/logout", isAuthenticated, (req, res) => {
    const sid = (req as any).user?.profile?.sid;
    if (sid) sqlite.prepare("UPDATE auth_sessions SET revoked_at = datetime('now') WHERE id = ?").run(sid);
    clearCookie(res, ACCESS_COOKIE);
    clearCookie(res, REFRESH_COOKIE);
    res.json({ success: true });
  });

  app.get("/api/auth/user", isAuthenticated, (req, res) => {
    const profile = (req as any).user?.profile;
    res.json(profile);
  });

  app.get("/api/auth/admin-status", isAuthenticated, (req, res) => {
    res.json({ isAdmin: (req as any).user?.role === "admin" });
  });

  app.post("/api/auth/mfa/setup", isAuthenticated, (req, res) => {
    const userId = (req as any).user.claims.sub;
    const secret = encodeBase32(crypto.randomBytes(20));
    sqlite.prepare("UPDATE app_users SET mfa_pending_secret = ?, updated_at = datetime('now') WHERE user_id = ?").run(secret, userId);
    const email = (req as any).user?.profile?.email || "account";
    const otpauth = `otpauth://totp/ArabicLegalPlatform:${encodeURIComponent(email)}?secret=${secret}&issuer=ArabicLegalPlatform&algorithm=SHA1&digits=6&period=30`;
    res.json({ secret, otpauth });
  });

  app.post("/api/auth/mfa/verify", isAuthenticated, (req, res) => {
    const userId = (req as any).user.claims.sub;
    const code = String(req.body?.code || "");
    const row = sqlite.prepare("SELECT mfa_pending_secret as pending FROM app_users WHERE user_id = ?").get(userId) as any;
    if (!row?.pending) return res.status(400).json({ message: "No MFA setup in progress" });
    if (!verifyTotp(row.pending, code)) return res.status(400).json({ message: "Invalid MFA code" });
    sqlite.prepare("UPDATE app_users SET mfa_secret = mfa_pending_secret, mfa_pending_secret = NULL, mfa_enabled = 1, updated_at = datetime('now') WHERE user_id = ?").run(userId);
    res.json({ success: true });
  });

  app.get("/api/auth/subscription/me", isAuthenticated, (req, res) => {
    const userId = (req as any).user.claims.sub;
    const data = sqlite.prepare(`
      SELECT subscription_tier as tier, subscription_status as status, subscription_expires_at as expiresAt, payment_customer_id as customerId
      FROM app_users WHERE user_id = ?
    `).get(userId);
    res.json({ subscription: data });
  });

  // ============================================
  // Google OAuth 2.0
  // ============================================
  const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
  const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";

  function getGoogleRedirectUri(req: Request) {
    // Use SITE_URL env var if set (recommended for production behind reverse proxy)
    if (process.env.SITE_URL) {
      return `${process.env.SITE_URL.replace(/\/$/, "")}/api/auth/google/callback`;
    }
    const proto = req.headers["x-forwarded-proto"] || req.protocol || "http";
    const host = req.headers["x-forwarded-host"] || req.headers.host || "localhost:3005";
    return `${proto}://${host}/api/auth/google/callback`;
  }

  // Step 1: Redirect user to Google consent screen
  app.get("/api/auth/google", (req, res) => {
    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
      return res.redirect("/auth?error=not_configured");
    }

    const state = randomToken(32);
    // Store state in a short-lived cookie for CSRF protection
    setCookie(res, "google_oauth_state", state, 600); // 10 minutes

    const redirectUri = getGoogleRedirectUri(req);
    const params = new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "openid email profile",
      state,
      access_type: "offline",
      prompt: "select_account",
    });

    res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
  });

  // Step 2: Handle Google callback
  app.get("/api/auth/google/callback", async (req, res) => {
    try {
      const { code, state } = req.query;

      if (!code || !state) {
        return res.redirect("/auth?error=missing_params");
      }

      // Verify CSRF state
      const cookies = parseCookies(req);
      const savedState = cookies["google_oauth_state"];
      if (!savedState || savedState !== state) {
        return res.redirect("/auth?error=invalid_state");
      }
      clearCookie(res, "google_oauth_state");

      const redirectUri = getGoogleRedirectUri(req);

      // Exchange code for tokens
      const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code: code as string,
          client_id: GOOGLE_CLIENT_ID,
          client_secret: GOOGLE_CLIENT_SECRET,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
        }),
      });

      const tokenData = await tokenRes.json() as any;
      if (!tokenRes.ok || !tokenData.access_token) {
        console.error("Google token error:", tokenData);
        return res.redirect("/auth?error=token_exchange");
      }

      // Get user profile from Google
      const profileRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });

      const profile = await profileRes.json() as any;
      if (!profileRes.ok || !profile.email) {
        console.error("Google profile error:", profile);
        return res.redirect("/auth?error=profile_fetch");
      }

      const googleId = String(profile.id);
      const email = String(profile.email).toLowerCase();
      const firstName = profile.given_name || profile.name?.split(" ")[0] || "";
      const lastName = profile.family_name || "";
      const profileImage = profile.picture || "";

      // Check if user exists by google_id
      let existingUser = sqlite.prepare("SELECT u.id, a.role FROM users u JOIN app_users a ON a.user_id = u.id WHERE u.google_id = ?").get(googleId) as any;

      if (!existingUser) {
        // Check if user exists by email (might have registered with email/password before)
        existingUser = sqlite.prepare("SELECT u.id, a.role FROM users u JOIN app_users a ON a.user_id = u.id WHERE u.email = ?").get(email) as any;

        if (existingUser) {
          // Link Google to existing account
          sqlite.prepare("UPDATE users SET google_id = ?, profile_image_url = COALESCE(profile_image_url, ?), updated_at = datetime('now') WHERE id = ?")
            .run(googleId, profileImage || null, existingUser.id);
        } else {
          // Create new user (Google OAuth - no password needed)
          const userId = crypto.randomUUID();
          const role = ADMIN_EMAILS.includes(email) ? "admin" : "user";

          sqlite.prepare("INSERT INTO users (id, email, first_name, last_name, profile_image_url, google_id, auth_provider, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'google', datetime('now'), datetime('now'))")
            .run(userId, email, firstName || null, lastName || null, profileImage || null, googleId);

          // Create app_users with placeholder password (not usable for login)
          const { hash, salt } = hashPassword(randomToken(32));
          sqlite.prepare("INSERT INTO app_users (user_id, password_hash, password_salt, role, subscription_tier, subscription_status) VALUES (?, ?, ?, ?, 'free', 'inactive')")
            .run(userId, hash, salt, role);

          existingUser = { id: userId, role };
        }
      } else {
        // Update profile image on each login
        sqlite.prepare("UPDATE users SET profile_image_url = COALESCE(?, profile_image_url), updated_at = datetime('now') WHERE id = ?")
          .run(profileImage || null, existingUser.id);
      }

      // Update last login
      sqlite.prepare("UPDATE app_users SET last_login_at = datetime('now'), updated_at = datetime('now') WHERE user_id = ?").run(existingUser.id);

      // Audit log
      sqlite.prepare("INSERT INTO login_audit_logs (email, user_id, action, success, ip_address, user_agent) VALUES (?, ?, 'google_login', 1, ?, ?)")
        .run(email, existingUser.id, req.ip || null, (req.headers["user-agent"] as string) || null);

      // Issue JWT tokens (same as regular login)
      issueTokens(res, { id: existingUser.id, role: existingUser.role }, req.headers["user-agent"] as string, req.ip);

      // Redirect to library page
      res.redirect("/library");

    } catch (error: any) {
      console.error("Google OAuth error:", error);
      res.redirect("/auth?error=server_error");
    }
  });

  // API to check if Google OAuth is configured
  app.get("/api/auth/google/status", (_req, res) => {
    res.json({ enabled: !!(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET) });
  });
}
