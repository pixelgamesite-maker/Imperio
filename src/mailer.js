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

function textToHtml(text) {
  return escapeHtml(text)
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>')
    .replace(/\r?\n/g, "<br>");
}

/** Builds one personalised message. */
function buildMessage({ subject, body, fromName, fromEmail }, recipient, settings) {
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
    headers: {
      // One-click unsubscribe (RFC 8058); Gmail and Yahoo expect this on bulk mail.
      "List-Unsubscribe": "<" + unsubUrl + ">",
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click"
    }
  };
}

/** Classifies an SMTP error. Permanent (5xx) recipient errors should suppress the address. */
function classifyError(err) {
  const code = err && (err.responseCode || 0);
  const message = String((err && (err.response || err.message)) || "Unknown error").slice(0, 300);
  const permanentRecipient = code >= 550 && code <= 553;
  const connection = !code && /ECONN|ETIMEDOUT|ESOCKET|EAUTH|ENOTFOUND|EDNS|Greeting|timeout/i.test(String(err && (err.code || err.message)));
  const auth = (err && err.code === "EAUTH") || code === 535;
  // 421/450/451/452 and quota messages mean "slow down / try later".
  const throttled = (code >= 421 && code <= 452) || /rate|limit|too many|quota/i.test(message);
  return { code, message, permanentRecipient, connection, auth, throttled };
}

module.exports = { getTransporter, buildMessage, classifyError };
