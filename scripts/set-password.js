"use strict";
// Sets (or resets) the admin password. Run on the server: npm run set-password
const readline = require("node:readline");
const { config } = require("../src/config");
const auth = require("../src/auth");

function ask(question, hidden) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) rl._writeToOutput = (s) => { if (s.includes(question)) rl.output.write(s); };
    rl.question(question, (answer) => { rl.close(); if (hidden) process.stdout.write("\n"); resolve(answer); });
  });
}

(async () => {
  const email = (await ask(`Admin email [${config.adminEmail}]: `)).trim() || config.adminEmail;
  if (!email) { console.error("An email is required."); process.exit(1); }
  const pass = await ask("New password (at least 10 characters): ", true);
  const again = await ask("Type it again: ", true);
  if (pass !== again) { console.error("The passwords don't match. Nothing changed."); process.exit(1); }
  try {
    auth.setPassword(email, pass);
    console.log(`Password set for ${email}. Every device has been signed out.`);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
})();
