# Imperio

A private bulk-email sender. One admin signs in, writes one email, pastes a list, and the server sends each person their own copy through SMTP, slowly and within a daily limit.

- Each recipient gets a separate email, so nobody sees anyone else's address, and `{name}` is filled in.
- A background worker sends one at a time, waits between emails, takes breaks, and stops at the daily limit. Leftovers continue the next morning.
- Every email carries an unsubscribe link and one-click unsubscribe headers (what Gmail and Yahoo expect on bulk mail).
- Unsubscribed and bounced addresses go on a do-not-email list and are skipped in every batch.
- Up to 3 attachments per email (PDF, images, Word, Excel, PowerPoint, CSV, text), 5 MB in total, stored on the same volume as the database. Unused uploads are cleaned up after a day.
- The SMTP password lives only in `.env` on the server, never in the page or the database.

## Status

| Step | | |
|---|---|---|
| 1 | Front-end mockup | Done (`mockup/`) |
| 2 | Backend: login, queue and sending | Done |
| 3 | Settings, unsubscribe and history | Done |
| 4 | Deployment and a live test | Guide below |

## Requirements

- Node.js **22.13 or newer** (it uses Node's built-in SQLite, so nothing needs compiling)
- A mailbox with SMTP access (set up for GoDaddy Professional Email: `smtpout.secureserver.net`, port 465, SSL)
- A subdomain with HTTPS, for example `bulk.orvellaz.xyz`

## Deploy on Railway

Railway only allows outgoing SMTP (which GoDaddy mail needs) on the **Pro plan**. On the Hobby plan, send through **Resend** or **Brevo** instead: they use HTTPS, which Railway allows on every plan. First verify `orvellaz.xyz` with that service (it gives you DNS records to add in GoDaddy), then set `SEND_PROVIDER` and its API key below.

1. In Railway, choose **New Project → Deploy from GitHub repo** and pick this repo. It uses `railway.json` and Node 22 from `.nvmrc`.
2. On the service, open **Settings → Volumes**, add a volume, and mount it at `/data`. This keeps the database between deploys. The app finds the volume on its own.
3. Open **Variables** and add:

   | Variable | Value |
   |---|---|
   | `SECRET` | a long random string |
   | `ADMIN_EMAIL` | `mateo@orvellaz.xyz` |
   | `ADMIN_PASSWORD` | the password for signing in to the app (changing it later resets the password) |
   | `APP_NAME` / `BRAND_NAME` | `Orvellaz Mailer` / `Orvellaz` |
   | `BASE_URL` | `https://bulk.orvellaz.xyz` |
   | `SEND_PROVIDER` | `resend`, `brevo`, or `smtp` (Pro plan only) |
   | `RESEND_API_KEY` or `BREVO_API_KEY` | the key from that service, if you use one |
   | `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` | only for `smtp`: `smtpout.secureserver.net` / `465` / `true` |
   | `SMTP_USER` / `SMTP_PASS` | only for `smtp`: the mailbox address and its password |

4. Under **Settings → Networking**, add the custom domain `bulk.orvellaz.xyz`. Railway shows a CNAME record. Add it in GoDaddy DNS (name `bulk`). Railway issues the HTTPS certificate itself.
5. Run the live test from step 8 below.

## Deploy on aaPanel

**1. Point the subdomain at the server.** In GoDaddy DNS, add an **A** record: name `bulk`, value your server's IP.

**2. Install Node.js.** In aaPanel open **App Store**, install **Node.js version manager**, and install Node **22** (LTS).

**3. Get the code onto the server.** In aaPanel's **Terminal**:

```bash
cd /www/wwwroot
git clone https://github.com/pixelgamesite-maker/Imperio.git imperio
cd imperio
npm ci --omit=dev
```

If the repo is private, use a GitHub personal access token as the password, or upload a ZIP of the repo through aaPanel's **Files** and unzip it into `/www/wwwroot/imperio`.

**4. Fill in `.env`.**

```bash
cp .env.example .env
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # copy this into SECRET
nano .env        # set SECRET, SMTP_PASS, BRAND_NAME, BASE_URL
chmod 600 .env
```

**5. Set the admin password and check the mailbox login.**

```bash
npm run set-password
npm run check-smtp
```

`check-smtp` should print `OK: the mail server accepted the login.`

**6. Run it as a Node project.** In aaPanel open **Website → Node project → Add Node project**:

- Project path: `/www/wwwroot/imperio`
- Start command: `npm start`
- Port: `3100` (match `PORT` in `.env`)
- Domain: `bulk.orvellaz.xyz`

The app listens on `127.0.0.1` only. aaPanel's nginx forwards the domain to it.

No Node project menu? Use PM2 instead: `npm i -g pm2 && pm2 start npm --name imperio -- start && pm2 save && pm2 startup`, then add the domain as a reverse proxy to `http://127.0.0.1:3100`.

**7. Turn on HTTPS.** Open the site's settings → **SSL** → **Let's Encrypt**, issue the certificate, and turn on **Force HTTPS**. Sign-in won't work over plain HTTP, by design.

**8. Test it live.**

1. Open `https://bulk.orvellaz.xyz` and sign in.
2. **Settings → Test connection** should show *Connected*. Add the business address and save.
3. On **Compose**, write a short email and press **Send test to myself**.
4. In Gmail, open it, tap **⋮ → Show original**, and check SPF, DKIM and DMARC all say **PASS**.
5. Click the unsubscribe link in the test email, then check **Settings → Do-not-email list**. Remove yourself again afterwards.

## Day to day

- **Warm up first.** A new mailbox (and a new `.xyz` domain) should start at 50–100 emails a day for the first week or two, then rise toward 450. Lower **Daily limit** in Settings to do this.
- **Only email people who agreed to it.** Complaints and bounces are what get a domain blocked.
- **Back up** `data/imperio.sqlite` now and then (aaPanel **Cron → Backup directory** works).

## Updating

```bash
cd /www/wwwroot/imperio
git pull
npm ci --omit=dev
```

Then restart the Node project in aaPanel (or `pm2 restart imperio`).

## Local development

```bash
npm install
cp .env.example .env    # set SECRET, INSECURE_COOKIES=true, BASE_URL=http://localhost:3100
npm run set-password
npm start
npm test
```

Point `SMTP_HOST` at a local test mail server (such as Mailpit on port 1025 with `SMTP_SECURE=false`) so nothing reaches real inboxes.

## Project layout

```
src/server.js     routes, API, unsubscribe pages
src/worker.js     the sending loop (limits, delays, breaks, bounces)
src/mailer.js     builds each email and its unsubscribe headers
src/db.js         SQLite tables and settings
src/auth.js       admin sign-in and sessions
src/util.js       recipient parsing, {name}, unsubscribe tokens
public/           the app's screens
mockup/           the approved clickable mockup (sample data)
```
