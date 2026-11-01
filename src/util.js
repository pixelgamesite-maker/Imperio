"use strict";
const crypto = require("node:crypto");
const { config } = require("./config");

// ---------- Time (all day boundaries use the configured time zone) ----------
function zonedParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: config.timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t).value;
  return { day: `${get("year")}-${get("month")}-${get("day")}`, hour: parseInt(get("hour"), 10), minute: parseInt(get("minute"), 10) };
}
const dayKey = (date) => zonedParts(date).day;

// ---------- Recipients ----------
const EMAIL_RE = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*\.[A-Za-z]{2,}$/;

function isEmail(s) { return typeof s === "string" && s.length <= 254 && EMAIL_RE.test(s); }

/**
 * Parse pasted recipients. Accepts "email", "email, name", "email; name", "email<TAB>name" and "Name <email>".
 * suppressed: Set of lower-case addresses to skip.
 */
function parseRecipients(text, suppressed = new Set()) {
  const out = { ready: [], duplicate: [], invalid: [], suppressed: [] };
  const seen = new Set();
  String(text || "").split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    let email, name;
    const angle = line.match(/^(.*?)<([^>]+)>\s*$/);
    if (angle) { name = angle[1].replace(/[",;]/g, " ").trim(); email = angle[2].trim(); }
    else {
      const parts = line.split(/[,;\t]/);
      email = parts[0].trim();
      name = parts.slice(1).join(" ").trim();
    }
    name = name.replace(/\s+/g, " ").slice(0, 80);
    const key = email.toLowerCase();
    const entry = { email, name, line: i + 1 };
    if (!isEmail(email)) out.invalid.push(entry);
    else if (seen.has(key)) out.duplicate.push(entry);
    else if (suppressed.has(key)) { seen.add(key); out.suppressed.push(entry); }
    else { seen.add(key); out.ready.push(entry); }
  });
  return out;
}

function personalize(text, name) {
  return String(text).replace(/\{name\}/gi, name && name.trim() ? name.trim() : "there");
}

// ---------- Unsubscribe tokens ----------
function b64url(buf) { return Buffer.from(buf).toString("base64url"); }

function unsubscribeToken(email) {
  return crypto.createHmac("sha256", config.secret).update("unsub:" + email.toLowerCase()).digest("base64url").slice(0, 32);
}
function unsubscribeUrl(email) {
  return `${config.baseUrl}/unsubscribe?e=${b64url(email.toLowerCase())}&t=${unsubscribeToken(email)}`;
}
function verifyUnsubscribe(e, t) {
  let email;
  try { email = Buffer.from(String(e || ""), "base64url").toString("utf8"); } catch { return null; }
  if (!isEmail(email) || typeof t !== "string") return null;
  const expected = Buffer.from(unsubscribeToken(email));
  const given = Buffer.from(t);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
  return email.toLowerCase();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

module.exports = { zonedParts, dayKey, isEmail, parseRecipients, personalize, unsubscribeUrl, verifyUnsubscribe, escapeHtml };
