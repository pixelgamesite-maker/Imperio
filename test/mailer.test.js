"use strict";
process.env.SECRET = "test-secret-test-secret-test-secret-123";
process.env.SEND_PROVIDER = "resend";
process.env.RESEND_API_KEY = "re_test";
process.env.DATA_DIR = require("node:os").tmpdir() + "/imperio-test-" + process.pid;
const test = require("node:test");
const assert = require("node:assert");
const { send, buildMessage, classifyError } = require("../src/mailer");

const settings = { signature: "The team", unsubscribeText: "Don't want these? Unsubscribe", footerAddress: "Lagos" };
const msg = buildMessage({ subject: "{name}, hi", body: "Hello {name}", fromName: "Orvellaz", fromEmail: "news@orvellaz.xyz" }, { email: "ada@example.com", name: "Ada" }, settings);

test("Resend request carries the personalised message and unsubscribe headers", async () => {
  let seen;
  global.fetch = async (url, opts) => { seen = { url, opts }; return { ok: true, status: 200, json: async () => ({ id: "x" }) }; };
  await send(msg);
  const body = JSON.parse(seen.opts.body);
  assert.strictEqual(seen.url, "https://api.resend.com/emails");
  assert.strictEqual(seen.opts.headers.Authorization, "Bearer re_test");
  assert.strictEqual(body.from, "Orvellaz <news@orvellaz.xyz>");
  assert.deepStrictEqual(body.to, ["Ada <ada@example.com>"]);
  assert.strictEqual(body.subject, "Ada, hi");
  assert.match(body.headers["List-Unsubscribe"], /^<.+\/unsubscribe\?e=.+&t=.+>$/);
  assert.strictEqual(body.headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
});

test("API errors are classified", async () => {
  global.fetch = async () => ({ ok: false, status: 429, json: async () => ({ message: "Too many requests" }) });
  await assert.rejects(send(msg), (err) => classifyError(err).throttled);
  global.fetch = async () => ({ ok: false, status: 401, json: async () => ({ message: "API key is invalid" }) });
  await assert.rejects(send(msg), (err) => classifyError(err).auth);
  global.fetch = async () => { throw new Error("getaddrinfo ENOTFOUND"); };
  await assert.rejects(send(msg), (err) => classifyError(err).connection);
});
