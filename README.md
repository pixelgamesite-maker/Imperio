# Imperio

Private bulk-email sender for Placornat (`bulk.placornat.com`). One admin signs in, writes one email, pastes a list, and the server sends each recipient their own copy through SMTP, slowly and within a daily limit.

## Status

Step 1 of 4: front-end mockup in `public/` (sample data, nothing is sent).

1. Front-end mockup for the client to approve
2. Backend: login, queue and sending (Node.js, SQLite, Nodemailer)
3. Settings, unsubscribe and history wired to the backend
4. Deployment guide for aaPanel, plus a test run

## Try the mockup

Open `public/index.html` in a browser. Screens: `#compose`, `#queue`, `#history`, `#config`, `#login`, `#unsubscribe`.

`python3 scripts/bundle-mockup.py` builds a single shareable page at `dist/mockup.html`.
