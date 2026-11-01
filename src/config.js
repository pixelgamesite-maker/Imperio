"use strict";
const path = require("node:path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env"), quiet: true });

function env(name, fallback) {
  const v = process.env[name];
  return v === undefined || v === "" ? fallback : v;
}

const config = {
  appName: env("APP_NAME", "Imperio Mailer"),
  brandName: env("BRAND_NAME", "Imperio"),
  baseUrl: env("BASE_URL", "http://localhost:3100").replace(/\/+$/, ""),
  port: parseInt(env("PORT", "3100"), 10),
  timezone: env("TIMEZONE", "Africa/Lagos"),
  secret: env("SECRET", ""),
  dataDir: path.resolve(__dirname, "..", env("DATA_DIR", "./data")),
  adminEmail: env("ADMIN_EMAIL", "").toLowerCase(),
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
  if (!config.smtp.host || !config.smtp.user) problems.push("SMTP_HOST and SMTP_USER are required");
  if (problems.length) {
    console.error("Fix .env before starting:\n - " + problems.join("\n - "));
    process.exit(1);
  }
}

module.exports = { config, assertReady };
