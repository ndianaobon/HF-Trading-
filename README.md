# HarborFinance Trading

**Trade Smarter. Manage Your Digital Assets.**

A full digital-asset trading and investment platform: public website, trading terminal, customer dashboard, admin console and a transactional trading engine.

- **Frontend:** plain HTML, CSS (Tailwind CSS + hand-written component classes) and vanilla JavaScript ES modules. No framework.
- **Backend:** Node.js with Next.js 15 route handlers (API + HTML serving), Prisma, PostgreSQL / Supabase. Everything is JavaScript.
- **Charts:** TradingView Lightweight Charts (candles, volume, indicators, portfolio/admin series) + SVG (allocation donut).
- **Icons:** Lucide (inlined as SVG at build time).
- **Market data:** Binance public market data (REST + WebSocket). Prices are never fabricated; when the feed is delayed or unavailable the UI says so and trading pauses.
- **Market news:** the dashboard's *Top Stories* card shows headlines from publisher RSS feeds. The defaults are Cointelegraph and CoinDesk; set `NEWS_FEEDS` (comma-separated HTTPS URLs, or `disabled`). Only the headline, publisher, time and link are shown; each story opens on the publisher's site, and nothing is shown if no feed responds.

> Recharts was part of the original stack list, but it is a React-only library. The frontend has no React, so its charts use Lightweight Charts and SVG instead. React/react-dom remain installed only because Next.js requires them internally (and for the generated Open Graph images).

---

## Quick start (local development)

Requirements: Node.js 20+ (tested on 22).

```bash
npm install
cp .env.example .env          # then set AUTH_SECRET and ENCRYPTION_KEY (see below)
npm run db:local              # terminal 1 – embedded PostgreSQL on port 5433 (data in ./.pgdata)
npm run db:deploy             # apply migrations
npm run db:seed               # demo data + accounts
npm run dev                   # terminal 2 – http://localhost:3000
```

`npm run dev` builds the HTML views, CSS and icon module, watches `frontend/` and `public/assets/js`, and starts `next dev`. Pass a port with `npm run dev -- -p 3100`.

Generate secrets:

```bash
openssl rand -hex 32        # AUTH_SECRET
openssl rand -base64 32     # ENCRYPTION_KEY
```

### Production

```bash
npm run build     # builds views/CSS/icons, then `next build`
npm run db:deploy
npm start
```

Set `NODE_ENV=production`, a real `NEXT_PUBLIC_APP_URL`, strong secrets, `EMAIL_PROVIDER=smtp` and, for live money movement, `APP_MODE=live` with a configured payment provider.

### Using Supabase

Point `DATABASE_URL` at the pooled connection (port 6543, `?pgbouncer=true`) and `DIRECT_URL` at the direct connection (port 5432). See `.env.example`. Run `npm run db:deploy` and optionally `npm run db:seed`. For private file storage set `STORAGE_PROVIDER=supabase`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and a **private** bucket name. The service-role key is server-only and never sent to the browser.

---

## Test accounts (development / demo data only)

Created by `npm run db:seed`. All balances and activity are simulated and labelled **Demo** in the UI.

| Role | Email | Password |
| --- | --- | --- |
| Demo trader | `demo@harborfinance.test` | `DemoTrader!2026` |
| Super admin | `admin@harborfinance.test` | `AdminHarbor!2026` |
| Compliance / Finance / Support staff | `compliance@`, `finance@`, `support@harborfinance.test` | `StaffHarbor!2026` |
| Seeded customers | `<first>.<last>@example.test` | `UserHarbor!2026` |

Accounts created during QA through the registration form (not seeded, so `npm run db:reset` removes them):

| Email | Password |
| --- | --- |
| `qa.tester@example.test` | `QaHarbor#Test2026` |
| `qa.register@example.test` | `QaRegister!2026` |

In development, emails (verification, password reset) are written to the `EmailOutbox` table and shown in a **dev mailbox** panel on the verify-email and forgot-password pages. The panel is disabled in production.

**Never use these credentials outside local development.** Re-seed or rotate them before any shared deployment.

---

## Project layout

```
frontend/                 HTML sources
  layouts/                marketing, auth, app (dashboard), admin, trade, bare
  partials/               header, footer, ticker, navigation, logo …
  pages/                  one file per page; `<!-- @page {…} -->` sets title, layout, script
  styles/app.css          Tailwind entry + design tokens + component classes
scripts/
  build-frontend.js       frontend/ → views/*.html, public/assets/css/app.css, icon module
  dev.js                  dev orchestrator (watchers + next dev)
  dev-db.mjs              embedded PostgreSQL for local development
views/                    generated HTML (not public; served by the page router)
public/assets/js/
  core/                   dom/html templating, api client, store, ui kit, forms, charts,
                          live market feed, realtime (SSE), app/admin shells
  components/             market table, trade chart, order ticket, orders panel,
                          admin kit, wallet/support widgets …
  pages/                  one script per page (home.js, dash-*.js, admin-*.js, trade.js …)
app/                      Next.js: API route handlers (app/api/**), page router
                          (app/route.js, app/[...path]/route.js), sitemap/robots/OG images
lib/                      server: auth, trading engine, payments, market data, services,
                          validation (Zod), security, notifications, jobs, views router
prisma/                   schema, migrations, seed
```

**How pages are served:** `lib/views/serve-page.js` maps a URL to a built view, enforces access (dashboard needs a session; admin pages need an active admin whose role has that page's permission, otherwise **404**), handles dynamic routes (`/trade/:symbol`, `/copy-trading/:slug`, `/admin/users/:id` …) and returns a real 404 for unknown paths. Each page loads its own ES module, which calls the JSON API.

---

## Demo mode vs live mode

`APP_MODE=demo` (default): deposits can be simulated, orders fill via a simulator **at live market prices**, and every simulated record is flagged `isDemo` and labelled in the UI. No real funds move.

`APP_MODE=live`: deposit addresses come only from addresses registered by an administrator (the platform never generates them). Withdrawals go through admin review. Orders execute only if a real execution venue is configured; otherwise trading is disabled with a clear message.

Content rules the platform follows:
- no guaranteed returns;
- no fabricated prices, statistics, testimonials or news;
- no invented licences, registrations, addresses or metrics.

Company details appear publicly only once an administrator marks the company profile as verified in **Admin → Settings**.

---

## Copy trading

Admin-created lead traders → admin-issued signals → automatic copy trades → the normal order pipeline → P&L from actual fills.

- **Lead traders** are created and managed only in **Admin → Copy Trading** (`copytraders.manage`). Users can follow them but never create one; there is no "become a lead trader" flow. Status: *Active* (visible, copyable), *Inactive* (hidden), *Suspended* (visible, no new signals execute). A separate switch stops new copiers without affecting existing ones. Removing a trader keeps its history and stops every follower.
- **Signals** (`CopySignal`): `CREATED` (draft) → `ACTIVE` (waiting for the entry price, or immediate at market when there is none) → `EXECUTED` (followers' positions open) → `CLOSED` at take-profit, stop-loss or by the admin; or `CANCELLED` before execution.
- **Copy engine** (`lib/services/copy-trading.js`, scheduler job `copy-engine`, every 5 s, never on stale prices): when a signal executes, every *Active* follower gets a `CopyTrade` placed as a MARKET order through `placeOrder()` — same balances, fees, ledger and positions as a manual order. Size = the follower's *amount per trade* × the signal's size multiplier, capped by their *copy amount* still free. While open, the bought asset (or, for sells, the proceeds) is reserved in the wallet and released just before the closing order. Sell signals need the follower to hold the asset (spot only).
- **P&L** is never entered: gross = (exit − entry) × size; net = exit proceeds − entry cost, both including fees. Lead-trader statistics (return, win rate, followers, followers' P&L) are calculated from closed signals and copy trades (`lib/services/copy-stats.js`).
- Followers set a copy amount, an amount per trade and a stop-copy threshold; reaching the threshold (realised + open loss) stops copying and closes their positions. Stopping manually does the same.
- Orders are filled by the internal simulator until a real execution venue is connected (`lib/trading/venue.js`), and are labelled *Simulated*.

## Automated trading bot (SMC / ICT)

An additional strategy/execution module on top of the existing order, wallet, position and P&L systems. **Admin → Automated Trading** (`autobot.manage`) controls everything; users see their own trades under **Dashboard → Automated Trading**.

- **Strategy engine** (`lib/autobot/smc.js`, pure functions, no I/O): multi-timeframe analysis — bias timeframes (default 4h + 1h market structure) → setup timeframe (15m) → entry timeframe (5m). A buy requires, as explicit conditions: HTF bias, a sell-side liquidity sweep (swing low, equal lows, previous-day low or Asian low, wicked through and closed back), displacement (body ≥ N×ATR), a break of structure, an entry zone (fair value gap and/or order block), a discount entry, a retrace into the zone, lower-timeframe confirmation, and a target at resting opposing liquidity (or a fixed R) meeting the minimum risk/reward. Sells are the exact mirror. Stop = beyond the sweep extreme.
- **Signal log** (`AutoBotSignal`): every detected setup with its checklist (✔/✘ + detail) and the decision — `WATCHING`, `EXECUTED`, `REJECTED` (reason) or `EXPIRED`.
- **Gates** before execution: bot status, spot direction, enabled trading sessions (UTC, optional per-instrument hours), news windows (events entered by the admin), execution venue.
- **Risk engine** (`lib/autobot/risk.js`, per account): risk per trade (% of account value, entry→stop), max open trades, max daily loss, max drawdown (pauses the account), max exposure per instrument and in total, max consecutive losses per day, stop loss always required, minimum risk/reward **after round-trip fees**, 1× leverage (spot). Sized positions are capped by exposure limits and available USDT; failures are recorded as `REJECTED` trades with the reason.
- **Execution** (`lib/autobot/engine.js`, jobs `autobot-scan` every 30 s and `autobot-exits` every 5 s): positions open and close through `placeOrder()` via `lib/trading/managed-position.js` (shared with copy trading); P&L comes from the actual fills. Stop-loss/take-profit exits keep running while the bot is paused or stopped. Circuit breakers: no analysis or trades on stale market data; auto-pause after repeated execution errors.
- **Controls**: start, pause, resume, emergency **STOP BOT** (no new trades, positions stay open and visible), close one / all positions, enable instruments, risk, sessions, strategy parameters, news events, participation (users opt in, or administrators only).
- **Instruments**: the platform trades crypto spot pairs against USDT (BTCUSD = BTC-USDT). Gold, silver and forex pairs are listed as unavailable: there is no tradable market, execution venue or reliable real-time feed for them, and spot trading cannot sell short. Bearish setups are therefore logged and rejected.
- `POST /api/dev/auto-trading/inject` (development only, 404 in production) pushes a synthetic setup through the same gates, risk engine and execution for testing.

## Brand

The logo is the **HFT** mark on a dark tile with a yellow base band (`#F4BE2C`), beside the *HARBORFINANCE / TRADING* wordmark.

- `public/brand/` has the logo, icon and wordmark SVGs, in dark- and light-background versions. `public/favicon.svg` is the icon.
- `lib/brand/logo.js` holds the same artwork for the Apple touch icon and the social share images.
- The letters are outlined from Montserrat (SIL Open Font License, see `lib/brand/FONT-LICENSE.txt`), so the logo looks identical whether or not the font is installed. The header wordmark is live Montserrat text so it stays readable at small sizes.

## Light / dark mode

Every header has a sun/moon button that switches the theme. The choice is saved in the browser (`localStorage` key `hf.theme`) and applied before the page paints, so there's no flash. Until a visitor picks a theme, the site follows their system setting.

- Colours come from the design tokens in `frontend/styles/app.css`. `html[data-theme="light"]` overrides them, so any new component that uses the tokens (`bg-panel`, `text-muted`, `border-line`, `text-white` for strongest text, …) works in both modes automatically.
- Charts re-colour live on `hf:themechange` (`trackTheme` in `public/assets/js/core/charts.js`).

## Security model (summary)

- Passwords hashed with Argon2id; sessions are random tokens stored hashed, in an `HttpOnly`, `SameSite=Lax` cookie.
- Optional TOTP 2FA with replay protection and one-time backup codes; 2FA or password step-up for withdrawals, transfers and API keys.
- CSRF protection: state-changing API requests must carry a same-origin `Origin` header.
- Rate limiting on authentication and sensitive endpoints; Zod validation on every input.
- Role-based access control for staff (super admin, admin, compliance, finance, support) with per-permission checks on both pages and APIs.
- AES-256-GCM encryption for 2FA secrets and KYC ID numbers; KYC files and attachments stored privately and served only to authorised users.
- Strict security headers (CSP, frame-ancestors none, no-sniff, referrer policy …).
- Balance changes run in database transactions with row locks and non-negative CHECK constraints (no negative balances or double spends), plus idempotency keys on orders.
- Every sensitive staff action is written to an append-only audit log.

---

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Build frontend, watch, run Next.js dev server |
| `npm run build` / `npm start` | Production build / start |
| `npm run build:frontend` | Rebuild views, CSS and icons only |
| `npm run lint` / `npm run format` | ESLint / Prettier |
| `npm run db:local` | Embedded local PostgreSQL (port 5433) |
| `npm run db:migrate` / `db:deploy` | Create (dev) / apply migrations |
| `npm run db:seed` / `db:reset` | Seed demo data / reset database and re-seed |
| `npm run db:studio` | Prisma Studio |

---

## Verification performed

- `eslint .` passes with no errors; `next build` compiles; `prisma migrate status` shows the schema up to date.
- Every public route returns 200; unknown routes 404; `/dashboard` and `/admin` redirect to login when signed out.
- Unknown markets (`/trade/NOPE-USDT`) and unknown or unpublished trader profiles return a real 404.
- Access control: customers get 404 on admin pages and 403 on admin APIs; limited staff roles only reach permitted sections. Cross-origin and origin-less writes are rejected (403).
- Flows tested in the browser:
  - registration, email verification and login;
  - dashboard with live data, simulated deposit;
  - market order fill, limit order placement and cancellation;
  - all 17 admin sections, including an audited deposit approval and a session revocation.
- Layout checked for horizontal overflow at 375 px (phone), 768 px and 1024 px (iPad) and 1440 px (desktop) on the home page, the dashboard and the main dashboard pages.
