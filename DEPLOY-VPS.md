# Deploying HarborFinance on a Hostinger VPS (alternative)

> Using the Hostinger **Business web hosting** plan (Web Apps)? Follow [DEPLOY.md](DEPLOY.md) instead. This guide is for a VPS, which gives full control and suits heavier traffic.

This guide takes the site from your computer to `https://harborfinancetrading.com` on a Hostinger VPS. It takes about an hour the first time.

**What you'll end up with:** Ubuntu server → nginx (HTTPS) → the app running under PM2 → PostgreSQL on the same server. Background jobs (order matching, copy trading, the automated bot) run inside the app, which is why a VPS is needed rather than shared hosting.

---

## 0. Before you start

- [ ] A **Hostinger VPS** (KVM 1 with 4 GB RAM is the minimum; KVM 2 is more comfortable).
- [ ] Your **domain** (in the same Hostinger account is easiest).
- [ ] The latest code **committed and pushed** to GitHub (`github.com/ndianaobon/HF-Trading-`).
- [ ] A mailbox for sending emails, e.g. `no-reply@harborfinancetrading.com` (Hostinger Email, or any SMTP service).

Commands in `grey boxes` are typed into the server's terminal unless the step says otherwise.

---

## 1. Set up the VPS

1. In **hPanel → VPS**, choose the OS template **Ubuntu 24.04** (plain OS, no control panel), set a strong root password, and note the server's **IP address**.
2. Connect from your computer (Windows Terminal / PowerShell works):

   ```bash
   ssh root@YOUR_SERVER_IP
   ```

3. Update the system and create a user for the app (don't run it as root):

   ```bash
   apt update && apt upgrade -y
   adduser harbor               # choose a strong password
   usermod -aG sudo harbor
   ```

4. Firewall — allow only SSH and web traffic:

   ```bash
   ufw allow OpenSSH
   ufw allow 'Nginx Full' 2>/dev/null || { ufw allow 80; ufw allow 443; }
   ufw enable
   ```

## 2. Point the domain at the server

In **hPanel → Domains → harborfinancetrading.com → DNS / Nameservers**:

| Type | Name | Points to | TTL |
| --- | --- | --- | --- |
| A | `@` | YOUR_SERVER_IP | 3600 |
| A | `www` | YOUR_SERVER_IP | 3600 |

Delete any existing `A` or `CNAME` records for `@` and `www` that point elsewhere (e.g. the parking page). Changes usually work within minutes but can take a few hours. Check with `ping harborfinancetrading.com` from your computer: it should show your server's IP.

## 3. Install the software

```bash
# Node.js 22
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs git nginx postgresql
npm install -g pm2

# certbot for the free HTTPS certificate
apt install -y certbot python3-certbot-nginx

node -v    # should print v22.x
```

## 4. Create the database

Choose a long random database password (letters and numbers only keeps the URL simple):

```bash
sudo -u postgres psql -c "CREATE USER harbor WITH PASSWORD 'CHANGE_ME_LONG_RANDOM';"
sudo -u postgres psql -c "CREATE DATABASE harborfinance OWNER harbor;"
```

> **Using Supabase instead?** Restore the project in the Supabase dashboard and use its connection strings in step 6 (Option B in the env file). Its data came from development, so it contains **demo accounts with publicly known passwords** — delete or suspend them before going live (the setup script in step 7 lists them). A fresh database on the VPS avoids this.

## 5. Get the code onto the server

Switch to the app user and give the server read-only access to your GitHub repository:

```bash
su - harbor
ssh-keygen -t ed25519 -C "harborfinance-server" -N "" -f ~/.ssh/id_ed25519
cat ~/.ssh/id_ed25519.pub
```

Copy the printed line. On GitHub: **repository → Settings → Deploy keys → Add deploy key**, paste it, leave *Allow write access* unticked, save. Then:

```bash
sudo mkdir -p /var/www /var/log/harborfinance
sudo chown harbor:harbor /var/www /var/log/harborfinance
cd /var/www
git clone git@github.com:ndianaobon/HF-Trading-.git harborfinance
cd harborfinance
```

## 6. Configure the environment

```bash
cp deploy/env.production.example .env
openssl rand -hex 32       # copy → AUTH_SECRET
openssl rand -base64 32    # copy → ENCRYPTION_KEY
nano .env
```

Fill in every `<...>` value:

- `NEXT_PUBLIC_APP_URL=https://harborfinancetrading.com`
- `DATABASE_URL` and `DIRECT_URL` with the database password from step 4.
- `AUTH_SECRET` and `ENCRYPTION_KEY` from the two commands above. **If you use an existing database (Supabase), copy these two from your local `.env` instead** — new keys would make its stored 2FA and KYC data unreadable.
- The SMTP settings for your mailbox (Hostinger Email: `smtp.hostinger.com`, port `465`, full address as the user).
- `APP_MODE=live` for real customers.

Save with `Ctrl+O`, `Enter`, `Ctrl+X`. Then lock the file down: `chmod 600 .env`.

## 7. Install, set up the database and build

```bash
npm ci                      # install dependencies
npx prisma migrate deploy   # create the tables
npm run setup:prod          # markets catalogue + your super admin account
npm run build               # build the site (a few minutes)
```

`npm run setup:prod` asks for your admin email, a password and your country code. It never creates demo data. **Do not run `npm run db:seed` on the server** — that's for development and refuses to run in live mode.

## 8. Start the app

```bash
pm2 start deploy/ecosystem.config.cjs
pm2 save
pm2 startup systemd -u harbor --hp /home/harbor
```

The last command prints a line starting with `sudo env PATH=...` — copy and run it, so the app starts again after a server reboot. Check it's running:

```bash
pm2 status                          # harborfinance should be "online"
curl -I http://127.0.0.1:3000       # should answer HTTP/1.1 200
```

Run it as **one instance only** (as configured). The background jobs live inside the app, and two copies would run them twice.

## 9. Put nginx and HTTPS in front

```bash
sudo cp deploy/nginx-harborfinance.conf /etc/nginx/sites-available/harborfinance
sudo nano /etc/nginx/sites-available/harborfinance     # replace harborfinancetrading.com (3 places)
sudo ln -s /etc/nginx/sites-available/harborfinance /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx

sudo certbot --nginx -d harborfinancetrading.com -d www.harborfinancetrading.com
```

Certbot asks for an email and to accept the terms; choose to **redirect HTTP to HTTPS**. It renews the certificate automatically.

Open **https://harborfinancetrading.com** — the site should load with a padlock.

## 10. First sign-in and platform setup

1. Go to `https://harborfinancetrading.com/login` and sign in with the admin account from step 7.
2. **Set up two-factor authentication** when asked (Google Authenticator, Authy, …). The admin console requires it. Store the backup codes safely.
3. In the **Admin console**:
   - **Settings → Company profile:** your legal details (shown publicly only when marked verified), support email.
   - **Wallets:** add the deposit addresses customers should pay to (in live mode addresses come only from here).
   - **Markets / fees:** review trading fees.
   - **Copy Trading / Automated Trading:** both start switched off; configure them when ready.
4. Register a normal test account yourself and check that the verification email arrives.

## 11. Email deliverability (so emails don't land in spam)

If you use Hostinger Email for your domain, hPanel → **Emails → DNS settings** shows the SPF, DKIM and DMARC records — make sure all three are active. With another provider, add the records it gives you in **Domains → DNS**.

## 12. Deploying updates

After new code is pushed to GitHub:

```bash
ssh harbor@YOUR_SERVER_IP
cd /var/www/harborfinance
bash deploy/update.sh
```

It pulls the code, installs dependencies, applies database migrations, rebuilds and restarts with no manual steps.

## 13. Backups

- **hPanel → VPS → Snapshots & backups:** enable weekly backups / take a snapshot before big changes.
- **Daily database backup** (keeps 14 days) — as the `harbor` user run `crontab -e` and add:

  ```cron
  30 2 * * * mkdir -p ~/backups && pg_dump "postgresql://harbor:CHANGE_ME_LONG_RANDOM@localhost:5432/harborfinance" | gzip > ~/backups/db-$(date +\%F).sql.gz && find ~/backups -name 'db-*.sql.gz' -mtime +14 -delete
  ```

- Uploaded files (KYC documents, support attachments, trader images) are in `/var/www/harborfinance/storage` — include that folder in your backups.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Site doesn't load at all | `ping harborfinancetrading.com` shows the server IP? `sudo systemctl status nginx` |
| "502 Bad Gateway" | App not running: `pm2 status`, then `pm2 logs harborfinance --lines 100` |
| App crashes at start with "Invalid environment configuration" | A value in `.env` is missing or wrong — the message names it |
| Can't log in / logged straight out | The site must be opened over **https**: session cookies are secure-only in production |
| Emails not arriving | `pm2 logs` for `[email] delivery failed`; check SMTP host/port/password and the DNS records in step 11 |
| Prices show "unavailable" | The server must reach `data-api.binance.vision` (outbound HTTPS); `curl -I https://data-api.binance.vision` |
| Build runs out of memory | Use a VPS with at least 4 GB RAM, or add swap: `sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile` |

Useful commands: `pm2 logs harborfinance` (live logs) · `pm2 restart harborfinance` · `sudo nginx -t` (check config) · `sudo certbot renew --dry-run` (test renewal).

---

## Before accepting real money

- Orders are filled by the platform's **internal simulator** at live prices and labelled *Simulated*; no exchange is connected. Customers' trades don't reach a real market until an execution venue is integrated.
- Deposits are confirmed by an administrator and withdrawals are paid manually.
- Operating a trading or investment platform for the public usually requires a licence where you and your customers are. Take legal advice before opening to real customers.
