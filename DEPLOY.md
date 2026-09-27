# Deploying HarborFinance on Hostinger (Business plan — Web Apps)

This guide puts the site live on your Hostinger **Business web hosting** plan using its **Node.js Web Apps** feature, with your free domain and mailboxes. Replace `harborfinancetrading.com` with your domain everywhere.

**How it fits together**

```
Visitors → harborfinancetrading.com (Hostinger, HTTPS) → HarborFinance Node.js web app
                                                   │
                                   Supabase (free) ├─ PostgreSQL database
                                                   └─ Storage: KYC documents, attachments, images
Hostinger cron job ── every minute ──► keeps the app awake so background jobs keep running
```

Why the extra pieces:

- Hostinger shared hosting offers MySQL, but HarborFinance needs **PostgreSQL** → Supabase.
- Web-app files can be replaced when you redeploy, so **uploaded files** go to Supabase Storage, not the app folder.
- Order matching, copy trading and the automated bot run **inside the app**. A cron "ping" every minute keeps it awake and restarts the background jobs if Hostinger ever restarts the app.

---

## 0. Checklist

- [ ] Latest code **committed and pushed** to GitHub (`github.com/ndianaobon/HF-Trading-`).
- [ ] Your domain added to the hosting plan (hPanel → **Websites**).
- [ ] A Supabase account (supabase.com, free).

## 1. Database: Supabase

1. **supabase.com → your project** `harborfinance-trading`. If it shows **Paused**, click **Restore** (takes a few minutes). If it's gone, create a new project (region close to your users, strong database password — save it).
2. **Project Settings → Database → Connection string (URI):** copy
   - the **Transaction pooler** string (port **6543**) → this becomes `DATABASE_URL` (add `?pgbouncer=true` at the end),
   - the **Session pooler / direct** string (port **5432**) → this becomes `DIRECT_URL`.
3. **Start clean.** The old project was used during development and contains demo accounts whose passwords are public. For a live site, empty it (see step 3 below — the command wipes the database and recreates the tables).

## 2. File storage: Supabase Storage

1. Supabase → **Storage → New bucket**, name `harborfinance-private`, leave **Public bucket OFF**.
2. **Project Settings → API:** copy the **Project URL** (`SUPABASE_URL`) and the **service_role** secret key (`SUPABASE_SERVICE_ROLE_KEY`). The service-role key is powerful: it only goes into Hostinger's environment variables, never into code or the browser.

## 3. Prepare the database (from your computer, once)

In the project folder on your computer, put the Supabase strings into `.env` (`DATABASE_URL`, `DIRECT_URL`), set `APP_MODE=live`, then:

```bash
npx prisma migrate reset --force --skip-seed   # ⚠ wipes the database, then creates all tables
npm run setup:prod                             # markets catalogue + YOUR super admin account
```

`setup:prod` asks for your admin email, a password (12+ characters with upper, lower, number, symbol) and your country code (e.g. `NG`). It never creates demo data. (Skip the `reset` line only if the database is new and empty — then run `npx prisma migrate deploy` instead.)

## 4. Mailbox for outgoing email

hPanel → **Emails** → create `no-reply@harborfinancetrading.com` (included free with the plan). Then in **Emails → DNS settings / Email deliverability**, make sure **SPF, DKIM and DMARC** are all active so emails don't land in spam.

## 5. Create the web app

hPanel → **Websites → Add website → Node.js Web App** (the wording may be *Web Apps → Create / Deploy*):

1. **Source:** connect **GitHub** and choose `ndianaobon/HF-Trading-`, branch `main`. (Alternatively upload a zip of the project without `node_modules`, `.next`, `.env`.)
2. **Framework:** Next.js. **Node.js version:** 22 (or 20).
3. **Commands:**

   | Setting | Value |
   | --- | --- |
   | Install | `npm install --include=dev` |
   | Build | `npm run build` |
   | Start | `npm start` |

4. **Domain:** attach `harborfinancetrading.com` (Hostinger issues the free SSL certificate — make sure SSL is **on** / forced HTTPS).
5. **Environment variables** — add each of these (don't add `NODE_ENV`; it's set automatically) (generate the two secrets on your computer: `openssl rand -hex 32` and `openssl rand -base64 32`, or ask me to generate them):

   | Name | Value |
   | --- | --- |
   | `NEXT_PUBLIC_APP_URL` | `https://harborfinancetrading.com` |
   | `APP_MODE` | `live` |
   | `DATABASE_URL` | Supabase transaction pooler URI (port 6543) + `?pgbouncer=true` |
   | `DIRECT_URL` | Supabase session/direct URI (port 5432) |
   | `AUTH_SECRET` | 64 random hex characters |
   | `ENCRYPTION_KEY` | random base64 32-byte key |
   | `MARKET_DATA_PROVIDER` | `binance` |
   | `MARKET_DATA_BASE_URL` | `https://data-api.binance.vision` |
   | `EMAIL_PROVIDER` | `smtp` |
   | `EMAIL_FROM` | `HarborFinance <no-reply@harborfinancetrading.com>` |
   | `SMTP_HOST` | `smtp.hostinger.com` |
   | `SMTP_PORT` | `465` |
   | `SMTP_USER` | `no-reply@harborfinancetrading.com` |
   | `SMTP_PASS` | the mailbox password |
   | `STORAGE_PROVIDER` | `supabase` |
   | `SUPABASE_URL` | Supabase Project URL |
   | `SUPABASE_SERVICE_ROLE_KEY` | Supabase service_role key |
   | `SUPABASE_STORAGE_BUCKET` | `harborfinance-private` |
   | `PAYMENT_PROVIDER` | `manual` |

   Keep `AUTH_SECRET` and `ENCRYPTION_KEY` somewhere safe (a password manager). If they are ever lost or changed, users' two-factor authentication and stored ID numbers can no longer be decrypted.

6. **Deploy.** The first build takes a few minutes. If it fails, open the build log (see Troubleshooting).

## 6. Keep the app awake (cron job)

hPanel → **Advanced → Cron Jobs → Create**:

- **Command:** `wget -q -O /dev/null https://harborfinancetrading.com/api/system/status`
  (if hPanel offers a "URL" / "fetch" type, just enter the URL)
- **Schedule:** every minute (`* * * * *`)

This keeps the Node.js app running so that limit orders, copy-trading signals, the bot's stop-loss/take-profit exits and deposit expiry keep working even when nobody is on the site. It also keeps the free Supabase project active (Supabase pauses projects that are idle for a week).

## 7. First sign-in and setup

1. Open `https://harborfinancetrading.com` — the home page should load with live prices.
2. Sign in at `/login` with the admin account from step 3 and **set up two-factor authentication** when asked (the admin console requires it). Save the backup codes.
3. **Admin console:**
   - **Settings → Company profile** and **support email**.
   - **Wallets:** add the deposit addresses customers pay to.
   - **Markets:** review trading fees.
   - **Copy Trading** and **Automated Trading** start switched off — set them up when ready.
4. Register a normal test account and confirm the verification email arrives.
5. **Check the background jobs:** Admin → Automated Trading shows *Last scan* when instruments are enabled; Copy Trading signals execute within seconds of activation. If nothing happens while the site is idle, re-check the cron job (step 6).

## 8. Updating the site

Push new code to GitHub, then in hPanel → your web app → **Redeploy** (or enable automatic deploys on push if offered).

**If the update includes database changes** (new files under `prisma/migrations/`), apply them from your computer *before* redeploying:

```bash
npx prisma migrate deploy        # with the Supabase strings in your local .env
```

Never run `npm run db:seed` or `prisma migrate reset` against the live database once you have real users.

## 9. Backups

- **Supabase free plan has no automatic daily backups.** Download one regularly from your computer:

  ```bash
  pg_dump "YOUR_DIRECT_URL" > backup-$(date +%F).sql
  ```

  (or upgrade Supabase to Pro for daily backups).
- Uploaded files live in the Supabase Storage bucket.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| Build fails: `prisma` or `tailwindcss` not found | The install step skipped dev dependencies: the install command must be `npm install --include=dev`, and don't add a `NODE_ENV` variable (the build and start commands set production mode themselves). |
| Build fails on `prisma` | Check `DATABASE_URL` and `DIRECT_URL` are set in the environment variables. |
| App starts then stops: "Invalid environment configuration" | The runtime log names the missing/invalid variable. |
| Can sign in but get logged straight out | Open the site with **https://** — session cookies are secure-only in production. Make sure SSL is forced. |
| "Market data unavailable" everywhere | The app must reach `data-api.binance.vision`; contact Hostinger support if outbound requests are blocked. |
| Emails not arriving | SMTP variables, mailbox password, and SPF/DKIM/DMARC (step 4). |
| Admin → Automated Trading "Last scan" goes stale when idle | The cron job (step 6) is missing or failing. |
| Live notifications only refresh every ~15 s | The host is buffering the live connection; the site automatically falls back to polling, nothing else to do. |

## Limits of this plan

Shared web-app hosting suits launch and moderate traffic. Move to a **VPS** (see [DEPLOY-VPS.md](DEPLOY-VPS.md)) if the app is restarted often, builds hit memory limits, or traffic grows — the VPS guide keeps the same code, with the database on the server itself.

## Before accepting real money

- Orders are filled by the platform's **internal simulator** at live prices and labelled *Simulated*; no exchange is connected.
- Deposits are confirmed by an administrator and withdrawals are paid manually.
- Operating a trading or investment platform for the public usually requires a licence where you and your customers are. Take legal advice before opening to real customers.
