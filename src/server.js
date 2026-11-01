"use strict";
const path = require("node:path");
const express = require("express");
const { config, assertReady } = require("./config");
const { db, getSettings, saveSettings, transaction } = require("./db");
const auth = require("./auth");
const worker = require("./worker");
const { send, verify, providerInfo, buildMessage, classifyError } = require("./mailer");
const { parseRecipients, isEmail, verifyUnsubscribe, escapeHtml, zonedParts } = require("./util");

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", config.trustProxy);

app.get("/healthz", (req, res) => res.type("text").send("ok"));

// ---------- Security headers ----------
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Content-Security-Policy",
    "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; " +
    "script-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
  if (!config.insecureCookies) res.setHeader("Strict-Transport-Security", "max-age=31536000");
  next();
});

// ---------- Public: unsubscribe ----------
const unsubQ = {
  add: db.prepare("INSERT INTO suppressions (email, reason, detail, created_at) VALUES (?, 'unsubscribed', ?, ?) ON CONFLICT(email) DO UPDATE SET reason = 'unsubscribed', detail = excluded.detail, created_at = excluded.created_at"),
  undo: db.prepare("DELETE FROM suppressions WHERE email = ? AND reason = 'unsubscribed'")
};

function unsubPage({ title, body }) {
  const brand = escapeHtml(config.brandName);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex"><title>${escapeHtml(title)} | ${brand}</title><link rel="stylesheet" href="/styles.css"></head>
<body><div class="solo" style="min-height:100%"><div class="solo-card">
<div class="brand"><div class="brand-mark" aria-hidden="true">${brand.charAt(0)}</div><div class="brand-name">${brand}</div></div>
<div class="panel">${body}</div>
${getSettings().footerAddress ? `<p class="solo-foot">${escapeHtml(getSettings().footerAddress)}</p>` : ""}
</div></div></body></html>`;
}

app.get("/unsubscribe", (req, res) => {
  const email = verifyUnsubscribe(req.query.e, req.query.t);
  res.setHeader("Cache-Control", "no-store");
  if (!email) return res.status(400).send(unsubPage({ title: "Link not valid", body: `<h1>This link isn't valid</h1><p>It may have been cut off when it was copied. Open the unsubscribe link straight from the email, or reply to the email and ask to be removed.</p>` }));
  const qs = `e=${encodeURIComponent(req.query.e)}&t=${encodeURIComponent(req.query.t)}`;
  res.send(unsubPage({ title: "Unsubscribe", body:
    `<h1>Stop emails from ${escapeHtml(config.brandName)}?</h1><p>We'll stop sending emails to <b>${escapeHtml(email)}</b>.</p>
     <form method="post" action="/unsubscribe?${qs}"><button class="btn btn-primary" type="submit">Unsubscribe</button></form>` }));
});

// Handles both the button on the page and one-click unsubscribe from Gmail or Yahoo (RFC 8058).
app.post("/unsubscribe", express.urlencoded({ extended: false, limit: "4kb" }), (req, res) => {
  const email = verifyUnsubscribe(req.query.e, req.query.t);
  res.setHeader("Cache-Control", "no-store");
  if (!email) return res.status(400).send(unsubPage({ title: "Link not valid", body: `<h1>This link isn't valid</h1><p>Reply to the email and ask to be removed instead.</p>` }));
  unsubQ.add.run(email, req.body && req.body["List-Unsubscribe"] === "One-Click" ? "one-click" : "page", Date.now());
  const qs = `e=${encodeURIComponent(req.query.e)}&t=${encodeURIComponent(req.query.t)}`;
  res.send(unsubPage({ title: "Unsubscribed", body:
    `<div class="unsub-mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></div>
     <h1>You're unsubscribed</h1><p><b>${escapeHtml(email)}</b> won't get any more emails from ${escapeHtml(config.brandName)}.</p>
     <form method="post" action="/unsubscribe/undo?${qs}"><button class="btn" type="submit">I clicked by mistake, keep me on the list</button></form>` }));
});

app.post("/unsubscribe/undo", (req, res) => {
  const email = verifyUnsubscribe(req.query.e, req.query.t);
  if (!email) return res.status(400).send(unsubPage({ title: "Link not valid", body: "<h1>This link isn't valid</h1>" }));
  unsubQ.undo.run(email);
  res.send(unsubPage({ title: "Still subscribed", body: `<h1>You're still on the list</h1><p>${escapeHtml(email)} will keep getting emails from ${escapeHtml(config.brandName)}.</p>` }));
});

// ---------- Static app ----------
app.use(express.static(path.join(__dirname, "..", "public"), { index: "index.html", maxAge: "1h" }));

// ---------- API ----------
const api = express.Router();
api.use(express.json({ limit: "5mb" }));
api.use(auth.requireSameOrigin);
api.use((req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });

api.post("/login", auth.login);
api.post("/logout", auth.logout);
api.use(auth.requireAuth);

const Q = {
  suppressedAll: db.prepare("SELECT email FROM suppressions"),
  insertBatch: db.prepare("INSERT INTO batches (subject, body, from_name, from_email, status, total, skipped, retry_of, created_at) VALUES (?, ?, ?, ?, 'sending', ?, ?, ?, ?)"),
  insertRecipient: db.prepare("INSERT INTO recipients (batch_id, position, email, name) VALUES (?, ?, ?, ?)"),
  batch: db.prepare("SELECT * FROM batches WHERE id = ?"),
  batches: db.prepare(`SELECT b.*,
      SUM(r.status = 'sent') AS sent, SUM(r.status = 'failed') AS failed, SUM(r.status = 'pending') AS pending,
      SUM(r.status = 'skipped') AS skipped_late, SUM(r.status = 'cancelled') AS cancelled
    FROM batches b LEFT JOIN recipients r ON r.batch_id = b.id GROUP BY b.id ORDER BY b.id DESC LIMIT ?`),
  counts: db.prepare(`SELECT SUM(status = 'sent') AS sent, SUM(status = 'failed') AS failed, SUM(status = 'pending') AS pending,
      SUM(status = 'skipped') AS skipped_late, SUM(status = 'cancelled') AS cancelled FROM recipients WHERE batch_id = ?`),
  recipients: db.prepare("SELECT email, name, status, error, attempted_at FROM recipients WHERE batch_id = ? AND (? = 'all' OR status = ?) ORDER BY position LIMIT ? OFFSET ?"),
  failed: db.prepare("SELECT email, name, error FROM recipients WHERE batch_id = ? AND status = 'failed' ORDER BY position"),
  setStatus: db.prepare("UPDATE batches SET status = ?, finished_at = ? WHERE id = ?"),
  cancelPending: db.prepare("UPDATE recipients SET status = 'cancelled' WHERE batch_id = ? AND status = 'pending'"),
  recent: db.prepare("SELECT email, status, error, attempted_at FROM recipients WHERE batch_id = ? AND attempted_at IS NOT NULL ORDER BY attempted_at DESC, id DESC LIMIT 40"),
  activeBatches: db.prepare("SELECT id FROM batches WHERE status IN ('sending', 'paused') ORDER BY id"),
  suppressions: db.prepare("SELECT email, reason, detail, created_at FROM suppressions ORDER BY created_at DESC LIMIT ? OFFSET ?"),
  suppressionCounts: db.prepare("SELECT reason, COUNT(*) AS n FROM suppressions GROUP BY reason"),
  delSuppression: db.prepare("DELETE FROM suppressions WHERE email = ?"),
  isSuppressed: db.prepare("SELECT 1 FROM suppressions WHERE email = ?")
};

function suppressedSet() { return new Set(Q.suppressedAll.all().map((r) => r.email)); }

function batchView(b, counts) {
  const c = counts || Q.counts.get(b.id);
  return {
    id: b.id, subject: b.subject, fromName: b.from_name, fromEmail: b.from_email, status: b.status,
    total: b.total, skippedAtStart: b.skipped, retryOf: b.retry_of, createdAt: b.created_at, finishedAt: b.finished_at,
    sent: c.sent || 0, failed: c.failed || 0, pending: c.pending || 0, skipped: (c.skipped_late || 0), cancelled: c.cancelled || 0
  };
}

api.get("/me", (req, res) => {
  res.json({ email: auth.adminEmail(), appName: config.appName, brandName: config.brandName, timezone: config.timezone });
});

// ----- Settings -----
api.get("/settings", (req, res) => {
  const s = getSettings();
  const counts = Object.fromEntries(Q.suppressionCounts.all().map((r) => [r.reason, r.n]));
  res.json({
    settings: s,
    smtp: providerInfo(),
    suppressions: { unsubscribed: counts.unsubscribed || 0, bounced: counts.bounced || 0 }
  });
});

const int = (v, min, max) => { const n = parseInt(v, 10); return Number.isFinite(n) && n >= min && n <= max ? n : null; };

api.put("/settings", (req, res) => {
  const b = req.body || {};
  const errors = [];
  const out = {};
  const numbers = { dailyLimit: [1, 100000], delaySeconds: [1, 3600], batchSize: [1, 10000], batchPauseMinutes: [0, 1440], startHour: [0, 23] };
  for (const [k, [min, max]] of Object.entries(numbers)) {
    if (b[k] === undefined) continue;
    const n = int(b[k], min, max);
    if (n === null) errors.push(`${k} must be a whole number from ${min} to ${max}.`); else out[k] = n;
  }
  for (const k of ["fromName", "signature", "unsubscribeText", "footerAddress"]) {
    if (b[k] !== undefined) out[k] = String(b[k]).slice(0, 2000);
  }
  if (b.fromEmail !== undefined) {
    if (!isEmail(String(b.fromEmail).trim())) errors.push("The from address isn't a valid email.");
    else out.fromEmail = String(b.fromEmail).trim();
  }
  if (out.unsubscribeText !== undefined && !out.unsubscribeText.trim()) errors.push("The unsubscribe line can't be empty.");
  if (errors.length) return res.status(400).json({ error: errors.join(" ") });
  saveSettings(out);
  res.json({ settings: getSettings() });
});

api.post("/smtp/test", async (req, res) => {
  try {
    await verify();
    res.json({ ok: true });
  } catch (err) {
    const e = classifyError(err);
    const what = config.provider === "smtp" ? "The mail server rejected the username or password." : "The email service rejected the API key.";
    res.status(502).json({ error: e.auth ? what : "Couldn't reach the email service: " + e.message });
  }
});

// ----- Compose -----
api.post("/recipients/check", (req, res) => {
  const p = parseRecipients((req.body || {}).text, suppressedSet());
  res.json({
    ready: p.ready.length,
    duplicate: p.duplicate, invalid: p.invalid, suppressed: p.suppressed,
    sample: p.ready.slice(0, 50)
  });
});

function validateMessage(b) {
  const errors = [];
  const subject = String(b.subject || "").trim();
  const body = String(b.body || "");
  const fromName = String(b.fromName || "").trim().slice(0, 100);
  const fromEmail = String(b.fromEmail || "").trim();
  if (!subject) errors.push("Add a subject.");
  if (subject.length > 250) errors.push("Keep the subject under 250 characters.");
  if (!body.trim()) errors.push("Write a message.");
  if (body.length > 100000) errors.push("The message is too long.");
  if (!isEmail(fromEmail)) errors.push("The from address isn't a valid email.");
  return { errors, subject, body, fromName: fromName || config.brandName, fromEmail };
}

api.post("/test-send", async (req, res) => {
  const m = validateMessage(req.body || {});
  if (m.errors.length) return res.status(400).json({ error: m.errors.join(" ") });
  const s = getSettings();
  if (worker.usedToday() >= s.dailyLimit) return res.status(429).json({ error: "Today's daily limit is used up, so the test wasn't sent." });
  const to = auth.adminEmail();
  try {
    await send(buildMessage(m, { email: to, name: String((req.body || {}).testName || "").trim() }, s));
    worker.countSend();
    res.json({ ok: true, to });
  } catch (err) {
    const e = classifyError(err);
    res.status(502).json({ error: e.auth ? (config.provider === "smtp" ? "The mail server rejected the login. Check SMTP_USER and SMTP_PASS." : "The email service rejected the API key.") : "The test didn't send: " + e.message });
  }
});

api.post("/batches", (req, res) => {
  const b = req.body || {};
  const m = validateMessage(b);
  if (m.errors.length) return res.status(400).json({ error: m.errors.join(" ") });
  const p = parseRecipients(b.recipients, suppressedSet());
  if (!p.ready.length) return res.status(400).json({ error: "There's nobody to send to. Check the recipients list." });
  if (p.ready.length > 20000) return res.status(400).json({ error: "Split lists over 20,000 people into several batches." });
  const skipped = p.duplicate.length + p.invalid.length + p.suppressed.length;
  const id = transaction(() => {
    const info = Q.insertBatch.run(m.subject, m.body, m.fromName, m.fromEmail, p.ready.length, skipped, null, Date.now());
    const batchId = Number(info.lastInsertRowid);
    p.ready.forEach((r, i) => Q.insertRecipient.run(batchId, i, r.email, r.name));
    return batchId;
  });
  res.status(201).json({ batch: batchView(Q.batch.get(id)) });
});

// ----- Batches -----
api.get("/batches", (req, res) => {
  const rows = Q.batches.all(int(req.query.limit, 1, 500) || 100);
  res.json({ batches: rows.map((r) => batchView(r, r)) });
});

api.get("/batches/:id", (req, res) => {
  const b = Q.batch.get(int(req.params.id, 1, 1e12));
  if (!b) return res.status(404).json({ error: "Batch not found." });
  const filter = ["sent", "failed", "pending", "skipped", "cancelled"].includes(req.query.status) ? req.query.status : "all";
  const limit = int(req.query.limit, 1, 1000) || 500;
  const offset = int(req.query.offset, 0, 1e9) || 0;
  res.json({ batch: batchView(b), recipients: Q.recipients.all(b.id, filter, filter, limit, offset) });
});

api.get("/batches/:id/failed.csv", (req, res) => {
  const b = Q.batch.get(int(req.params.id, 1, 1e12));
  if (!b) return res.status(404).json({ error: "Batch not found." });
  // Quote every cell and defuse values a spreadsheet would run as a formula.
  const cell = (v) => '"' + String(v == null ? "" : v).replace(/^([=+\-@\t\r])/, "'$1").replace(/"/g, '""') + '"';
  const csv = "email,name,error\n" + Q.failed.all(b.id).map((r) => [r.email, r.name, r.error].map(cell).join(",")).join("\n") + "\n";
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="batch-${b.id}-failed.csv"`);
  res.send(csv);
});

function changeStatus(req, res, from, to) {
  const b = Q.batch.get(int(req.params.id, 1, 1e12));
  if (!b) return res.status(404).json({ error: "Batch not found." });
  if (!from.includes(b.status)) return res.status(409).json({ error: `This batch is ${b.status} and can't be changed that way.` });
  transaction(() => {
    Q.setStatus.run(to, to === "cancelled" ? Date.now() : null, b.id);
    if (to === "cancelled") Q.cancelPending.run(b.id);
  });
  if (to === "sending") worker.wake();
  res.json({ batch: batchView(Q.batch.get(b.id)) });
}
api.post("/batches/:id/pause", (req, res) => changeStatus(req, res, ["sending"], "paused"));
api.post("/batches/:id/resume", (req, res) => changeStatus(req, res, ["paused"], "sending"));
api.post("/batches/:id/cancel", (req, res) => changeStatus(req, res, ["sending", "paused"], "cancelled"));

api.post("/batches/:id/retry", (req, res) => {
  const b = Q.batch.get(int(req.params.id, 1, 1e12));
  if (!b) return res.status(404).json({ error: "Batch not found." });
  const failed = Q.failed.all(b.id).filter((r) => !Q.isSuppressed.get(r.email.toLowerCase()));
  if (!failed.length) return res.status(400).json({ error: "Nothing to retry. Failed addresses that bounced are on the do-not-email list." });
  const id = transaction(() => {
    const info = Q.insertBatch.run(b.subject, b.body, b.from_name, b.from_email, failed.length, 0, b.id, Date.now());
    const newId = Number(info.lastInsertRowid);
    failed.forEach((r, i) => Q.insertRecipient.run(newId, i, r.email, r.name));
    return newId;
  });
  res.status(201).json({ batch: batchView(Q.batch.get(id)) });
});

// ----- Queue (what's sending now) -----
api.get("/queue", (req, res) => {
  const active = Q.activeBatches.all().map((r) => batchView(Q.batch.get(r.id)));
  const current = active.find((b) => b.status === "sending") || active[0] || null;
  const latest = current ? null : Q.batches.all(1).map((r) => batchView(r, r))[0] || null;
  res.json({
    worker: worker.status(),
    now: Date.now(),
    hour: zonedParts().hour,
    current,
    queued: active.filter((b) => !current || b.id !== current.id),
    latest,
    log: current ? Q.recent.all(current.id) : (latest ? Q.recent.all(latest.id) : [])
  });
});

// ----- Do-not-email list -----
api.get("/suppressions", (req, res) => {
  res.json({ suppressions: Q.suppressions.all(int(req.query.limit, 1, 1000) || 200, int(req.query.offset, 0, 1e9) || 0) });
});
api.delete("/suppressions/:email", (req, res) => {
  Q.delSuppression.run(String(req.params.email).toLowerCase());
  res.json({ ok: true });
});

app.use("/api", api);
app.use("/api", (req, res) => res.status(404).json({ error: "Not found." }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  if (req.path.startsWith("/api")) return res.status(err.status || 500).json({ error: err.status === 413 ? "That list is too large to upload at once." : "Something went wrong on the server." });
  res.status(500).send("Something went wrong.");
});

if (require.main === module) {
  assertReady();
  try {
    if (auth.syncAdminFromEnv()) console.log("Admin password set from ADMIN_PASSWORD.");
  } catch (err) { console.error("ADMIN_PASSWORD not used: " + err.message); }
  if (!auth.hasAdmin()) console.warn("No admin password yet. Set ADMIN_PASSWORD or run: npm run set-password");
  app.listen(config.port, config.host, () => {
    console.log(`${config.appName} listening on http://${config.host}:${config.port} (public: ${config.baseUrl})`);
    worker.start();
  });
}

module.exports = app;
