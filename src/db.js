"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { config } = require("./config");

fs.mkdirSync(config.dataDir, { recursive: true });
const db = new DatabaseSync(path.join(config.dataDir, "imperio.sqlite"));

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS admin (
    id            INTEGER PRIMARY KEY CHECK (id = 1),
    email         TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    updated_at    TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS batches (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    subject    TEXT NOT NULL,
    body       TEXT NOT NULL,
    from_name  TEXT NOT NULL,
    from_email TEXT NOT NULL,
    status     TEXT NOT NULL,          -- sending | paused | cancelled | done
    total      INTEGER NOT NULL,
    skipped    INTEGER NOT NULL DEFAULT 0,
    retry_of   INTEGER,
    created_at INTEGER NOT NULL,
    finished_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS recipients (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id     INTEGER NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
    position     INTEGER NOT NULL,
    email        TEXT NOT NULL,
    name         TEXT NOT NULL DEFAULT '',
    status       TEXT NOT NULL DEFAULT 'pending', -- pending | sent | failed | skipped | cancelled
    error        TEXT,
    attempted_at INTEGER,
    attempt_day  TEXT
  );
  CREATE INDEX IF NOT EXISTS recipients_batch ON recipients(batch_id, status, position);
  CREATE INDEX IF NOT EXISTS recipients_day ON recipients(attempt_day);

  CREATE TABLE IF NOT EXISTS suppressions (
    email      TEXT PRIMARY KEY,
    reason     TEXT NOT NULL,          -- unsubscribed | bounced
    detail     TEXT,
    created_at INTEGER NOT NULL
  );

  -- Every message handed to the mail server today, including tests, counts toward the daily limit.
  CREATE TABLE IF NOT EXISTS daily_counts (
    day   TEXT PRIMARY KEY,
    count INTEGER NOT NULL
  );
`);

const DEFAULT_SETTINGS = {
  from_name: config.brandName,
  from_email: config.smtp.user || "",
  daily_limit: "450",
  delay_seconds: "10",
  batch_size: "50",
  batch_pause_minutes: "5",
  start_hour: "8",
  signature: "The " + config.brandName + " team",
  unsubscribe_text: "Don't want these emails? Unsubscribe",
  footer_address: ""
};

const insertDefault = db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)");
for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) insertDefault.run(k, v);

function getSettings() {
  const out = {};
  for (const row of db.prepare("SELECT key, value FROM settings").all()) out[row.key] = row.value;
  return {
    fromName: out.from_name,
    fromEmail: out.from_email,
    dailyLimit: parseInt(out.daily_limit, 10),
    delaySeconds: parseInt(out.delay_seconds, 10),
    batchSize: parseInt(out.batch_size, 10),
    batchPauseMinutes: parseInt(out.batch_pause_minutes, 10),
    startHour: parseInt(out.start_hour, 10),
    signature: out.signature,
    unsubscribeText: out.unsubscribe_text,
    footerAddress: out.footer_address
  };
}

const SETTING_KEYS = {
  fromName: "from_name", fromEmail: "from_email", dailyLimit: "daily_limit", delaySeconds: "delay_seconds",
  batchSize: "batch_size", batchPauseMinutes: "batch_pause_minutes", startHour: "start_hour",
  signature: "signature", unsubscribeText: "unsubscribe_text", footerAddress: "footer_address"
};

function saveSettings(values) {
  const upsert = db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
  transaction(() => {
    for (const [k, v] of Object.entries(values)) {
      if (SETTING_KEYS[k] !== undefined) upsert.run(SETTING_KEYS[k], String(v));
    }
  });
}

function transaction(fn) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

module.exports = { db, getSettings, saveSettings, transaction };
