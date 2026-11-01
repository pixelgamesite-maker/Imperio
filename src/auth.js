"use strict";
const crypto = require("node:crypto");
const bcrypt = require("bcryptjs");
const { db } = require("./db");
const { config } = require("./config");

const COOKIE = "imperio_session";
const SESSION_DAYS = 14;
const MAX_FAILS = 5;
const LOCK_MINUTES = 15;

const fails = new Map(); // ip -> { count, until }

const q = {
  admin: db.prepare("SELECT * FROM admin WHERE id = 1"),
  setAdmin: db.prepare(`INSERT INTO admin (id, email, password_hash, updated_at) VALUES (1, ?, ?, ?)
                        ON CONFLICT(id) DO UPDATE SET email = excluded.email, password_hash = excluded.password_hash, updated_at = excluded.updated_at`),
  addSession: db.prepare("INSERT INTO sessions (token_hash, created_at, expires_at) VALUES (?, ?, ?)"),
  getSession: db.prepare("SELECT * FROM sessions WHERE token_hash = ? AND expires_at > ?"),
  delSession: db.prepare("DELETE FROM sessions WHERE token_hash = ?"),
  delAll: db.prepare("DELETE FROM sessions"),
  purge: db.prepare("DELETE FROM sessions WHERE expires_at <= ?")
};

const hash = (token) => crypto.createHash("sha256").update(token).digest("hex");

function setPassword(email, password) {
  if (!password || password.length < 10) throw new Error("Use a password of at least 10 characters.");
  q.setAdmin.run(email.toLowerCase(), bcrypt.hashSync(password, 12), new Date().toISOString());
  q.delAll.run(); // sign out every device
}

function hasAdmin() { return !!q.admin.get(); }

/** Lets hosts without a terminal (Railway) set the password with the ADMIN_PASSWORD variable. */
function syncAdminFromEnv() {
  if (!config.adminPassword || !config.adminEmail) return false;
  const admin = q.admin.get();
  if (admin && admin.email === config.adminEmail && bcrypt.compareSync(config.adminPassword, admin.password_hash)) return false;
  setPassword(config.adminEmail, config.adminPassword);
  return true;
}

function parseCookies(header) {
  const out = {};
  String(header || "").split(";").forEach((part) => {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

function cookieHeader(value, maxAgeSeconds) {
  return [
    `${COOKIE}=${value}`, "Path=/", "HttpOnly", "SameSite=Strict", `Max-Age=${maxAgeSeconds}`,
    config.insecureCookies ? "" : "Secure"
  ].filter(Boolean).join("; ");
}

function clientIp(req) { return req.ip || req.socket.remoteAddress || "unknown"; }

async function login(req, res) {
  const ip = clientIp(req);
  const f = fails.get(ip);
  if (f && f.until > Date.now()) {
    const mins = Math.ceil((f.until - Date.now()) / 60000);
    return res.status(429).json({ error: `Too many wrong passwords. Try again in ${mins} minute${mins > 1 ? "s" : ""}.` });
  }
  const { email, password } = req.body || {};
  const admin = q.admin.get();
  const ok = admin && typeof email === "string" && typeof password === "string" &&
    email.trim().toLowerCase() === admin.email && (await bcrypt.compare(password, admin.password_hash));
  if (!ok) {
    const lockExpired = f && f.until && f.until <= Date.now();
    const n = (f && !lockExpired ? f.count : 0) + 1;
    fails.set(ip, { count: n, until: n >= MAX_FAILS ? Date.now() + LOCK_MINUTES * 60000 : 0 });
    return res.status(401).json({ error: admin ? "That email and password don't match." : "No password is set yet. Run npm run set-password on the server." });
  }
  fails.delete(ip);
  const token = crypto.randomBytes(32).toString("base64url");
  const now = Date.now();
  q.purge.run(now);
  q.addSession.run(hash(token), now, now + SESSION_DAYS * 86400000);
  res.setHeader("Set-Cookie", cookieHeader(token, SESSION_DAYS * 86400));
  res.json({ ok: true, email: admin.email });
}

function logout(req, res) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (token) q.delSession.run(hash(token));
  res.setHeader("Set-Cookie", cookieHeader("", 0));
  res.json({ ok: true });
}

function requireAuth(req, res, next) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (!token || !q.getSession.get(hash(token), Date.now())) return res.status(401).json({ error: "Sign in to continue." });
  next();
}

/** Blocks cross-site form posts: state-changing API calls must be same-origin JSON. */
function requireSameOrigin(req, res, next) {
  if (req.method === "GET" || req.method === "HEAD") return next();
  const origin = req.headers.origin;
  const expected = new URL(config.baseUrl).origin;
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const sameHost = origin && host && new URL(origin).host === host;
  if (origin && origin !== expected && !sameHost) return res.status(403).json({ error: "Request blocked: wrong origin." });
  if (!req.is("application/json")) return res.status(415).json({ error: "Expected JSON." });
  next();
}

module.exports = { login, logout, requireAuth, requireSameOrigin, setPassword, hasAdmin, syncAdminFromEnv, adminEmail: () => (q.admin.get() || {}).email };
