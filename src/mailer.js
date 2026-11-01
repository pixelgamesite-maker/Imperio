"use strict";
const nodemailer = require("nodemailer");
const { config } = require("./config");
const { personalize, unsubscribeUrl, escapeHtml } = require("./util");

let transporter = null;
function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      auth: config.smtp.pass ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
      connectionTimeout: 20000,
      greetingTimeout: 15000,
      socketTimeout: 30000
    });
  }
  return transporter;
}

// ---------- HTTPS API senders (Resend, Brevo) ----------
class SendError extends Error {
  constructor(message, httpStatus) { super(message); this.httpStatus = httpStatus; }
}

function addr(a) { return typeof a === "string" ? { email: a, name: "" } : { email: a.address, name: a.name || "" }; }

async function postJson(url, headers, body) {
  let res;
  try {
    res = await fetch(url, { method: "POST", headers: Object.assign({ "Content-Type": "application/json", Accept: "application/json" }, headers), body: JSON.stringify(body), signal: AbortSignal.timeout(30000) });
  } catch (err) {
    const e = new SendError("Couldn't reach the email service: " + err.message, 0);
    e.code = "ECONNECTION";
    throw e;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new SendError((data && (data.message || data.error || data.name)) || "HTTP " + res.status, res.status);
  return data;
}

const api = {
  resend: {
    send(m) {
      const from = addr(m.from), to = addr(m.to);
      return postJson("https://api.resend.com/emails", { Authorization: "Bearer " + config.resendKey }, {
        from: from.name ? `${from.name.replace(/["<>]/g, "")} <${from.email}>` : from.email,
        to: [to.name ? `${to.name.replace(/["<>]/g, "")} <${to.email}>` : to.email],
        subject: m.subject, text: m.text, html: m.html, headers: m.headers,
        attachments: m.attachments ? m.attachments.map((a) => ({ filename: a.filename, content: a.content.toString("base64") })) : undefined
      });
    },
    async verify() {
      const res = await fetch("https://api.resend.com/domains", { headers: { Authorization: "Bearer " + config.resendKey }, signal: AbortSignal.timeout(15000) });
      if (res.ok) return true;
      const data = await res.json().catch(() => ({}));
      if (data && data.name === "restricted_api_key") return true; // a sending-only key: valid
      throw new SendError(data.message || "HTTP " + res.status, res.status);
    }
  },
  brevo: {
    send(m) {
      const from = addr(m.from), to = addr(m.to);
      return postJson("https://api.brevo.com/v3/smtp/email", { "api-key": config.brevoKey }, {
        sender: { email: from.email, name: from.name || undefined },
        to: [{ email: to.email, name: to.name || undefined }],
        subject: m.subject, textContent: m.text, htmlContent: m.html, headers: m.headers,
        attachment: m.attachments ? m.attachments.map((a) => ({ name: a.filename, content: a.content.toString("base64") })) : undefined
      });
    },
    async verify() {
      const res = await fetch("https://api.brevo.com/v3/account", { headers: { "api-key": config.brevoKey, Accept: "application/json" }, signal: AbortSignal.timeout(15000) });
      if (res.ok) return true;
      const data = await res.json().catch(() => ({}));
      throw new SendError(data.message || "HTTP " + res.status, res.status);
    }
  }
};

/** Sends one built message with whichever provider is configured. */
function send(message) {
  if (config.provider === "smtp") return getTransporter().sendMail(message);
  return api[config.provider].send(message);
}

/** Checks the login or API key without sending anything. */
function verify() {
  if (config.provider === "smtp") return getTransporter().verify();
  return api[config.provider].verify();
}

function providerInfo() {
  if (config.provider === "smtp") return { provider: "smtp", label: "SMTP mailbox", host: config.smtp.host, port: config.smtp.port, secure: config.smtp.secure, user: config.smtp.user, passwordSet: !!config.smtp.pass };
  return { provider: config.provider, label: config.provider === "resend" ? "Resend" : "Brevo", keySet: !!(config.provider === "resend" ? config.resendKey : config.brevoKey) };
}

function textToHtml(text) {
  return escapeHtml(text)
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>')
    .replace(/\r?\n/g, "<br>");
}

/** Builds one personalised message. */
/** files: optional [{ filename, contentType, content: Buffer }] from attachments.load(). */
function buildMessage({ subject, body, fromName, fromEmail }, recipient, settings, files) {
  const name = recipient.name || "";
  const unsubUrl = unsubscribeUrl(recipient.email);
  const subj = personalize(subject, name).replace(/[\r\n]+/g, " ");
  const main = personalize(body, name);
  const signature = settings.signature ? "\n\n" + settings.signature : "";

  const unsubText = (settings.unsubscribeText || "Unsubscribe").trim();
  const lastSpace = unsubText.lastIndexOf(" ");
  const unsubLead = lastSpace > 0 ? unsubText.slice(0, lastSpace + 1) : "";
  const unsubWord = lastSpace > 0 ? unsubText.slice(lastSpace + 1) : unsubText;
  const address = settings.footerAddress ? settings.footerAddress.trim() : "";

  const text = main + signature + "\n\n--\n" + unsubLead + unsubWord + ": " + unsubUrl + (address ? "\n" + address : "");

  const html =
    '<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#1b2430;max-width:600px">' +
    "<div>" + textToHtml(main + signature) + "</div>" +
    '<hr style="border:0;border-top:1px solid #dde2e8;margin:28px 0 12px">' +
    '<div style="font-size:12px;color:#66727f">' + escapeHtml(unsubLead) + '<a href="' + escapeHtml(unsubUrl) + '" style="color:#66727f">' + escapeHtml(unsubWord) + "</a>" +
    (address ? "<br>" + escapeHtml(address) : "") + "</div></div>";

  return {
    from: { name: fromName, address: fromEmail },
    to: recipient.name ? { name: recipient.name, address: recipient.email } : recipient.email,
    subject: subj,
    text,
    html,
    attachments: files && files.length ? files : undefined,
    headers: {
      // One-click unsubscribe (RFC 8058); Gmail and Yahoo expect this on bulk mail.
      "List-Unsubscribe": "<" + unsubUrl + ">",
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click"
    }
  };
}

/** Classifies an SMTP error. Permanent (5xx) recipient errors should suppress the address. */
function classifyError(err) {
  if (err && err.httpStatus !== undefined) {
    const st = err.httpStatus;
    const message = String(err.message || "Unknown error").slice(0, 300);
    return {
      code: st, message,
      auth: st === 401 || st === 403,
      connection: st === 0 || st >= 500,
      throttled: st === 429,
      // The service refused this address outright (e.g. not a real address); don't email it again.
      permanentRecipient: (st === 400 || st === 422) && /recipient|invalid.*(email|address)/i.test(message) && !/attach|extension|file/i.test(message),
      // The service refused the email itself (e.g. an attachment type): every recipient would fail the same way.
      badContent: (st === 400 || st === 422) && /attach|extension|file/i.test(message)
    };
  }
  const code = err && (err.responseCode || 0);
  const message = String((err && (err.response || err.message)) || "Unknown error").slice(0, 300);
  const permanentRecipient = code >= 550 && code <= 553;
  const connection = !code && /ECONN|ETIMEDOUT|ESOCKET|EAUTH|ENOTFOUND|EDNS|Greeting|timeout/i.test(String(err && (err.code || err.message)));
  const auth = (err && err.code === "EAUTH") || code === 535;
  // 421/450/451/452 and quota messages mean "slow down / try later".
  const throttled = (code >= 421 && code <= 452) || /rate|limit|too many|quota/i.test(message);
  return { code, message, permanentRecipient, connection, auth, throttled };
}

module.exports = { getTransporter, send, verify, providerInfo, buildMessage, classifyError };
