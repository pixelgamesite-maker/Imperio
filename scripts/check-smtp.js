"use strict";
// Checks the SMTP details in .env without sending anything: npm run check-smtp
const { config } = require("../src/config");
const { verify, providerInfo, classifyError } = require("../src/mailer");

const info = providerInfo();
console.log(info.provider === "smtp" ? `Connecting to ${config.smtp.host}:${config.smtp.port} as ${config.smtp.user} ...` : `Checking the ${info.label} API key ...`);
verify().then(
  () => { console.log("OK: the login works."); process.exit(0); },
  (err) => {
    const e = classifyError(err);
    console.error(e.auth ? "Rejected: check the password or API key." : "Failed: " + e.message);
    process.exit(1);
  }
);
