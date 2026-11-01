"use strict";
// Checks the SMTP details in .env without sending anything: npm run check-smtp
const { config } = require("../src/config");
const { getTransporter, classifyError } = require("../src/mailer");

console.log(`Connecting to ${config.smtp.host}:${config.smtp.port} as ${config.smtp.user} ...`);
getTransporter().verify().then(
  () => { console.log("OK: the mail server accepted the login."); process.exit(0); },
  (err) => {
    const e = classifyError(err);
    console.error(e.auth ? "The mail server rejected the username or password." : "Failed: " + e.message);
    process.exit(1);
  }
);
