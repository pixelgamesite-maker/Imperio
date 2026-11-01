"use strict";
const { db, getSettings, transaction } = require("./db");
const { send, buildMessage, classifyError } = require("./mailer");
const { zonedParts } = require("./util");
const attachments = require("./attachments");

// File contents for the batch being sent, loaded once rather than for every recipient.
let fileCache = { batchId: null, files: [] };
function filesFor(batchId) {
  if (fileCache.batchId !== batchId) fileCache = { batchId, files: attachments.load(attachments.forBatch(batchId)) };
  return fileCache.files;
}

const state = {
  phase: "idle",          // idle | sending | between | break | waiting-limit | waiting-morning | backoff
  nextAt: 0,
  sinceBreak: 0,
  lastError: null,        // { message, at, kind }
  busy: false,
  timer: null
};

const q = {
  activeBatch: db.prepare("SELECT * FROM batches WHERE status = 'sending' ORDER BY id LIMIT 1"),
  nextRecipient: db.prepare("SELECT * FROM recipients WHERE batch_id = ? AND status = 'pending' ORDER BY position LIMIT 1"),
  isSuppressed: db.prepare("SELECT reason FROM suppressions WHERE email = ?"),
  markRecipient: db.prepare("UPDATE recipients SET status = ?, error = ?, attempted_at = ?, attempt_day = ? WHERE id = ?"),
  pauseBatch: db.prepare("UPDATE batches SET status = 'paused' WHERE id = ? AND status = 'sending'"),
  finishBatch: db.prepare("UPDATE batches SET status = 'done', finished_at = ? WHERE id = ? AND status = 'sending'"),
  bumpDay: db.prepare("INSERT INTO daily_counts (day, count) VALUES (?, 1) ON CONFLICT(day) DO UPDATE SET count = count + 1"),
  dayCount: db.prepare("SELECT count FROM daily_counts WHERE day = ?"),
  suppress: db.prepare("INSERT OR IGNORE INTO suppressions (email, reason, detail, created_at) VALUES (?, ?, ?, ?)")
};

function usedToday() {
  const row = q.dayCount.get(zonedParts().day);
  return row ? row.count : 0;
}

/** Records one message handed to the mail server (tests included). */
function countSend() { q.bumpDay.run(zonedParts().day); }

async function step() {
  if (state.busy) return;
  const now = Date.now();
  if (now < state.nextAt) return;

  const batch = q.activeBatch.get();
  if (!batch) { state.phase = "idle"; state.sinceBreak = 0; return; }

  const settings = getSettings();
  const zp = zonedParts();
  if (zp.hour < settings.startHour) { state.phase = "waiting-morning"; return; }
  if (usedToday() >= settings.dailyLimit) { state.phase = "waiting-limit"; return; }

  const r = q.nextRecipient.get(batch.id);
  if (!r) { q.finishBatch.run(now, batch.id); state.phase = "idle"; return; }

  // An address may have unsubscribed or bounced after the batch was queued.
  if (q.isSuppressed.get(r.email.toLowerCase())) {
    q.markRecipient.run("skipped", "On the do-not-email list", now, null, r.id);
    return step();
  }

  state.busy = true;
  state.phase = "sending";
  try {
    await send(buildMessage({
      subject: batch.subject, body: batch.body, fromName: batch.from_name, fromEmail: batch.from_email
    }, r, settings, filesFor(batch.id)));
    transaction(() => { q.markRecipient.run("sent", null, Date.now(), zp.day, r.id); countSend(); });
    state.lastError = null;
  } catch (err) {
    const e = classifyError(err);
    if (e.auth || e.connection) {
      // The mail server is unreachable or rejected the login: keep the recipient waiting and try again later.
      state.lastError = { kind: e.auth ? "auth" : "connection", message: e.message, at: Date.now() };
      state.phase = "backoff";
      state.nextAt = Date.now() + 5 * 60 * 1000;
      return;
    }
    if (e.badContent) {
      // Pause instead of failing every recipient with the same error; the admin can fix the email and resend.
      q.pauseBatch.run(batch.id);
      state.lastError = { kind: "content", message: e.message, at: Date.now(), batchId: batch.id };
      state.phase = "idle";
      return;
    }
    if (e.throttled && !e.permanentRecipient) {
      state.lastError = { kind: "throttled", message: e.message, at: Date.now() };
      state.phase = "backoff";
      state.nextAt = Date.now() + 15 * 60 * 1000;
      return;
    }
    transaction(() => {
      q.markRecipient.run("failed", e.message, Date.now(), zp.day, r.id);
      countSend();
      if (e.permanentRecipient) q.suppress.run(r.email.toLowerCase(), "bounced", e.message, Date.now());
    });
  } finally {
    state.busy = false;
  }

  state.sinceBreak++;
  state.nextAt = Date.now() + settings.delaySeconds * 1000;
  state.phase = "between";
  if (state.sinceBreak >= settings.batchSize) {
    state.sinceBreak = 0;
    state.nextAt += settings.batchPauseMinutes * 60 * 1000;
    state.phase = "break";
  }
}

function start() {
  if (state.timer) return;
  const tick = async () => {
    try { await step(); } catch (err) { console.error("Worker error:", err); }
    state.timer = setTimeout(tick, 1000);
  };
  state.timer = setTimeout(tick, 1000);
}

/** Skip any wait (used after resume or when the admin changes settings). */
function wake() {
  if (state.phase === "backoff" || (state.lastError && state.lastError.kind === "content")) state.lastError = null;
  state.nextAt = 0;
}

function status() {
  const settings = getSettings();
  return {
    phase: state.phase,
    nextAt: state.nextAt || null,
    lastError: state.lastError,
    usedToday: usedToday(),
    dailyLimit: settings.dailyLimit,
    startHour: settings.startHour
  };
}

module.exports = { start, wake, status, countSend, usedToday, _step: step, _state: state };
