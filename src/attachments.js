"use strict";
// Files attached to emails. Stored on disk next to the database (the Railway volume), described in SQLite.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { db } = require("./db");
const { config } = require("./config");

const DIR = path.join(config.dataDir, "attachments");
fs.mkdirSync(DIR, { recursive: true });

const MAX_TOTAL_BYTES = 5 * 1024 * 1024; // per email, all files together
const MAX_FILES = 3;
const TYPES = {
  pdf: "application/pdf",
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  csv: "text/csv", txt: "text/plain"
};

db.exec(`
  CREATE TABLE IF NOT EXISTS attachments (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    type       TEXT NOT NULL,
    size       INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS batch_attachments (
    batch_id      INTEGER NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
    attachment_id TEXT NOT NULL REFERENCES attachments(id),
    position      INTEGER NOT NULL,
    PRIMARY KEY (batch_id, attachment_id)
  );
`);

const q = {
  insert: db.prepare("INSERT INTO attachments (id, name, type, size, created_at) VALUES (?, ?, ?, ?, ?)"),
  get: db.prepare("SELECT * FROM attachments WHERE id = ?"),
  link: db.prepare("INSERT OR IGNORE INTO batch_attachments (batch_id, attachment_id, position) VALUES (?, ?, ?)"),
  forBatch: db.prepare("SELECT a.* FROM batch_attachments ba JOIN attachments a ON a.id = ba.attachment_id WHERE ba.batch_id = ? ORDER BY ba.position"),
  orphans: db.prepare("SELECT id FROM attachments WHERE created_at < ? AND id NOT IN (SELECT attachment_id FROM batch_attachments)"),
  remove: db.prepare("DELETE FROM attachments WHERE id = ?")
};

function cleanName(name) {
  const base = path.basename(String(name || "file")).replace(/[\u0000-\u001f"\\/<>:|?*]+/g, "").trim();
  return (base || "file").slice(0, 120);
}

/** Saves an uploaded file. Returns its description or throws an Error with a user-facing message. */
function save(name, buffer) {
  const filename = cleanName(name);
  const ext = (filename.split(".").pop() || "").toLowerCase();
  if (!TYPES[ext] || !filename.includes(".")) throw new Error("That file type can't be attached. Use PDF, an image, Word, Excel, PowerPoint, CSV or text.");
  if (!buffer.length) throw new Error("That file is empty.");
  if (buffer.length > MAX_TOTAL_BYTES) throw new Error("Files can be up to 5 MB.");
  const id = crypto.randomBytes(16).toString("hex");
  fs.writeFileSync(path.join(DIR, id), buffer, { mode: 0o600 });
  q.insert.run(id, filename, TYPES[ext], buffer.length, Date.now());
  return describe(q.get.get(id));
}

function describe(row) { return { id: row.id, name: row.name, type: row.type, size: row.size }; }

/** Validates a list of attachment ids for one email. */
function resolve(ids) {
  if (ids === undefined || ids === null) return [];
  if (!Array.isArray(ids)) throw new Error("Attachments must be a list.");
  const unique = [...new Set(ids.map(String))];
  if (unique.length > MAX_FILES) throw new Error(`Attach up to ${MAX_FILES} files.`);
  const rows = unique.map((id) => {
    const row = /^[0-9a-f]{32}$/.test(id) ? q.get.get(id) : null;
    if (!row || !fs.existsSync(path.join(DIR, row.id))) throw new Error("An attachment is missing. Remove it and attach it again.");
    return row;
  });
  const total = rows.reduce((n, r) => n + r.size, 0);
  if (total > MAX_TOTAL_BYTES) throw new Error("Attachments can add up to 5 MB per email.");
  return rows.map(describe);
}

function linkToBatch(batchId, list) { list.forEach((a, i) => q.link.run(batchId, a.id, i)); }
function forBatch(batchId) { return q.forBatch.all(batchId).map(describe); }

/** Loads file contents for sending. */
function load(list) {
  return list.map((a) => ({ filename: a.name, contentType: a.type, content: fs.readFileSync(path.join(DIR, a.id)) }));
}

/** Removes uploads that were never used in a batch (abandoned drafts) after a day. */
function cleanup() {
  for (const { id } of q.orphans.all(Date.now() - 24 * 3600 * 1000)) {
    try { fs.unlinkSync(path.join(DIR, id)); } catch { /* already gone */ }
    q.remove.run(id);
  }
}

module.exports = { save, resolve, linkToBatch, forBatch, load, cleanup, MAX_TOTAL_BYTES, MAX_FILES, TYPES };
