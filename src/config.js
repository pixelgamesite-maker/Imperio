"use strict";
const path = require("node:path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env"), quiet: true });

function env(name, fallback) {
  const v = process.env[name];
  return v === undefined || v === "" ? fallback : v;
}

const onRailway = !!process.env.RAILWAY_ENVIRONMENT;
const railwayUrl = process.env.RAILWAY_PUBLIC_DOMAIN ? "https://" + process.env.RAILWAY_PUBLIC_DOMAIN : "";

const config = {
  onRailway,
  appName: env("APP_NAME", "Imperio Mailer"),
  brandName: env("BRAND_NAME", "Imperio"),
  baseUrl: env("BASE_URL", railwayUrl || "http://localhost:3100").replace(/\/+$/, ""),
  port: parseInt(env("PORT", "3100"), 10),
  // On a VPS the app sits behind nginx on the same machine; on Railway it must accept outside connections.
  host: env("HOST", onRailway ? "0.0.0.0" : "127.0.0.1"),
  trustProxy: onRailway ? 1 : "loopback",
  adminPassword: env("ADMIN_PASSWORD", ""),
  timezone: env("TIMEZONE", "Africa/Lagos"),
  secret: env("SECRET", ""),
  dataDir: path.resolve(__dirname, "..", env("DATA_DIR", process.env.RAILWAY_VOLUME_MOUNT_PATH || "./data")),
  adminEmail: env("ADMIN_EMAIL", "").toLowerCase(),
  // How email leaves the app: "smtp" (a mailbox such as GoDaddy), "resend" or "brevo" (HTTPS APIs, which work on
  // hosts that block SMTP, such as Railway's Hobby plan). Left empty, it picks the API whose key is set, else SMTP.
  provider: (env("SEND_PROVIDER", process.env.RESEND_API_KEY ? "resend" : process.env.BREVO_API_KEY ? "brevo" : "smtp")).toLowerCase(),
  resendKey: env("RESEND_API_KEY", ""),
  brevoKey: env("BREVO_API_KEY", ""),
  smtp: {
    host: env("SMTP_HOST", ""),
    port: parseInt(env("SMTP_PORT", "465"), 10),
    secure: env("SMTP_SECURE", "true") === "true",
    user: env("SMTP_USER", ""),
    pass: env("SMTP_PASS", "")
  },
  // Lets local testing run without HTTPS. Never set this on the live server.
  insecureCookies: env("INSECURE_COOKIES", "false") === "true"
};

function assertReady() {
  const problems = [];
  if (!config.secret || config.secret === "change-me" || config.secret.length < 32) problems.push("SECRET must be a random string of at least 32 characters");
  if (!config.adminEmail) problems.push("ADMIN_EMAIL is missing");
  if (!["smtp", "resend", "brevo"].includes(config.provider)) problems.push("SEND_PROVIDER must be smtp, resend or brevo");
  if (config.provider === "smtp" && (!config.smtp.host || !config.smtp.user)) problems.push("SMTP_HOST and SMTP_USER are required");
  if (config.provider === "resend" && !config.resendKey) problems.push("RESEND_API_KEY is missing");
  if (config.provider === "brevo" && !config.brevoKey) problems.push("BREVO_API_KEY is missing");
  if (problems.length) {
    console.error("Fix .env before starting:\n - " + problems.join("\n - "));
    process.exit(1);
  }
}

module.exports = { config, assertReady };
