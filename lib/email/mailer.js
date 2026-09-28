import "server-only";
import { prisma } from "@/lib/db/prisma";
import { appUrl, env } from "@/lib/config";

/**
 * Email is recorded in EmailOutbox first, then delivered by the configured
 * provider. "console" (development) logs to the server output only.
 */
export async function sendEmail(msg) {
  const provider = env().EMAIL_PROVIDER;
  const record = await prisma.emailOutbox.create({ data: { ...msg, provider } });
  try {
    if (provider === "smtp") {
      const nodemailer = await import("nodemailer");
      const host = env().SMTP_HOST;
      const transport = nodemailer.createTransport({
        // Connect over IPv4 when available: nodemailer otherwise may pick IPv6, which
        // fails on hosts without IPv6 connectivity. TLS still verifies the real hostname.
        host: await ipv4(host),
        tls: { servername: host },
        port: env().SMTP_PORT,
        secure: env().SMTP_PORT === 465,
        auth: env().SMTP_USER ? { user: env().SMTP_USER, pass: env().SMTP_PASS } : undefined,
      });
      await transport.sendMail({ from: env().EMAIL_FROM, ...msg });
    } else {
      console.info(`[email:console] to=${msg.to} subject="${msg.subject}"\n${msg.text}\n`);
    }
    await prisma.emailOutbox.update({ where: { id: record.id }, data: { status: "SENT", sentAt: new Date() } });
  } catch (err) {
    console.error("[email] delivery failed", err);
    await prisma.emailOutbox.update({ where: { id: record.id }, data: { status: "FAILED", error: String(err).slice(0, 500) } });
  }
}

/** Sends without blocking the caller; failures are recorded in EmailOutbox. */
export function sendLater(promise) {
  void Promise.resolve(promise).catch((err) => console.error("[email] send failed", err));
}

async function ipv4(host) {
  try {
    const { resolve4 } = await import("node:dns/promises");
    return (await resolve4(host))[0] ?? host;
  } catch {
    return host;
  }
}

/* ───────────── Template (exchange-style: dark header, white card, yellow actions) ───────────── */

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

function layout({ title, preheader = "", body }) {
  const site = appUrl();
  const year = new Date().getFullYear();
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:#F5F5F5;font-family:${FONT};-webkit-font-smoothing:antialiased">
<span style="display:none!important;visibility:hidden;opacity:0;height:0;width:0;overflow:hidden">${esc(preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F5F5F5"><tr><td align="center" style="padding:24px 12px">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#FFFFFF;border-radius:8px;overflow:hidden">
    <tr><td style="background:#0B0E11;padding:22px 32px">
      <a href="${site}" style="text-decoration:none"><img src="${site}/email-logo" width="164" height="48" alt="HarborFinance Trading" style="display:block;border:0;height:48px;width:164px"></a>
    </td></tr>
    <tr><td style="padding:36px 32px 8px">
      <h1 style="margin:0 0 20px;font-size:24px;line-height:32px;font-weight:700;color:#1E2329">${esc(title)}</h1>
      <div style="font-size:15px;line-height:24px;color:#474D57">${body}</div>
    </td></tr>
    <tr><td style="padding:8px 32px 32px">
      <div style="margin-top:24px;padding:16px;background:#FAFAFA;border-radius:6px;font-size:13px;line-height:20px;color:#707A8A">
        <strong style="color:#1E2329">Stay safe:</strong> HarborFinance will never ask for your password, 2FA codes or verification codes by phone, email or chat. Always check you're on <a href="${site}" style="color:#C99400;text-decoration:none">${esc(site.replace(/^https?:\/\//, ""))}</a> before signing in.
      </div>
    </td></tr>
    <tr><td style="background:#FAFAFA;border-top:1px solid #EAECEF;padding:24px 32px;font-size:12px;line-height:18px;color:#929AA5">
      <p style="margin:0 0 8px"><strong style="color:#474D57">Risk warning:</strong> Digital asset trading carries a high level of risk and may not be suitable for everyone. Prices can move sharply and you can lose some or all of your funds. Past performance does not predict future results.</p>
      <p style="margin:0 0 8px">This is an automated message, please do not reply. Need help? Visit the <a href="${site}/dashboard/support" style="color:#C99400;text-decoration:none">Support Center</a>.</p>
      <p style="margin:0">© ${year} HarborFinance Trading · <a href="${site}/privacy" style="color:#929AA5">Privacy</a> · <a href="${site}/terms" style="color:#929AA5">Terms</a></p>
    </td></tr>
  </table>
</td></tr></table></body></html>`;
}

const p = (html) => `<p style="margin:0 0 16px">${html}</p>`;
const button = (href, label) =>
  `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 20px"><tr><td style="background:#F4BE2C;border-radius:6px"><a href="${href}" style="display:inline-block;padding:13px 28px;font-size:15px;font-weight:700;color:#0B0E11;text-decoration:none">${esc(label)}</a></td></tr></table>`;
const codeBox = (code) =>
  `<div style="margin:8px 0 20px;padding:18px 0;background:#FAFAFA;border:1px solid #EAECEF;border-radius:6px;text-align:center;font-family:'SFMono-Regular',Menlo,Consolas,monospace;font-size:34px;line-height:40px;font-weight:700;letter-spacing:10px;color:#1E2329">${esc(code)}</div>`;
const details = (rows) =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 20px;border:1px solid #EAECEF;border-radius:6px;border-collapse:separate;font-size:14px">${rows
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(
      ([k, v], i) =>
        `<tr><td style="padding:11px 16px;color:#707A8A;${i ? "border-top:1px solid #EAECEF;" : ""}">${esc(k)}</td><td style="padding:11px 16px;color:#1E2329;font-weight:600;text-align:right;word-break:break-all;${i ? "border-top:1px solid #EAECEF;" : ""}">${esc(v)}</td></tr>`,
    )
    .join("")}</table>`;
const when = (d = new Date()) => `${d.toISOString().slice(0, 19).replace("T", " ")} (UTC)`;
const text = (lines) => lines.filter((l) => l !== null && l !== undefined).join("\n");

export const emails = {
  /** 6-digit sign-up verification code. */
  verifyCode(to, firstName, code) {
    return sendEmail({
      to,
      subject: `[HarborFinance] Your verification code: ${code}`,
      text: text([`Hi ${firstName},`, "", `Your HarborFinance verification code is: ${code}`, "", "Enter it on the verification page to activate your account. The code expires in 15 minutes.", "If you didn't create an account, ignore this email."]),
      html: layout({
        title: "Verify your email address",
        preheader: `Your verification code is ${code}`,
        body:
          p(`Hi ${esc(firstName)},`) +
          p("Welcome to HarborFinance Trading. Enter this code on the verification page to activate your account:") +
          codeBox(code) +
          p("The code is valid for <strong>15 minutes</strong> and can be used once. If you didn't create a HarborFinance account, you can ignore this email.") +
          button(`${appUrl()}/verify-email`, "Go to verification"),
      }),
    });
  },

  /** Legacy link-based verification (older accounts). */
  verifyEmail(to, firstName, token) {
    const link = `${appUrl()}/verify-email?token=${encodeURIComponent(token)}`;
    return sendEmail({
      to,
      subject: "Verify your HarborFinance email",
      text: text([`Hi ${firstName},`, "", "Confirm your email address:", link]),
      html: layout({ title: "Verify your email address", body: p(`Hi ${esc(firstName)},`) + p("Confirm your email address to finish setting up your account.") + button(link, "Verify email") }),
    });
  },

  welcome(to, firstName) {
    const site = appUrl();
    return sendEmail({
      to,
      subject: "Welcome to HarborFinance Trading",
      text: text([
        `Hi ${firstName},`,
        "",
        "Welcome to HarborFinance Trading — your account is verified and ready.",
        "",
        "Get started:",
        `1. Secure your account with two-factor authentication: ${site}/dashboard/settings?tab=security`,
        `2. Deposit funds: ${site}/dashboard/deposit`,
        `3. Explore live markets: ${site}/markets`,
      ]),
      html: layout({
        title: "Welcome to HarborFinance Trading",
        preheader: "Your account is verified. Here's how to get started.",
        body:
          p(`Hi ${esc(firstName)},`) +
          p("Your account is verified and ready. You now have access to live markets, portfolio tools, copy trading and more.") +
          `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 20px">${[
            ["1", "Secure your account", "Turn on two-factor authentication for sign-ins and withdrawals.", `${site}/dashboard/settings?tab=security`],
            ["2", "Fund your account", "Deposit crypto to your HarborFinance wallet.", `${site}/dashboard/deposit`],
            ["3", "Start trading", "Follow live prices and place your first order.", `${site}/markets`],
          ]
            .map(
              ([n, t, d, href]) =>
                `<tr><td width="36" valign="top" style="padding:8px 0"><div style="width:26px;height:26px;border-radius:13px;background:#F4BE2C;color:#0B0E11;font-weight:700;font-size:13px;line-height:26px;text-align:center">${n}</div></td><td style="padding:8px 0"><a href="${href}" style="color:#1E2329;font-weight:700;text-decoration:none">${t}</a><br><span style="font-size:14px;color:#707A8A">${d}</span></td></tr>`,
            )
            .join("")}</table>` +
          button(`${site}/dashboard`, "Go to your dashboard"),
      }),
    });
  },

  depositConfirmed(to, d) {
    return sendEmail({
      to,
      subject: `[HarborFinance] Deposit confirmed: ${d.amount} ${d.asset}`,
      text: text([`Your deposit of ${d.amount} ${d.asset} has been credited to your account.`, `Network: ${d.network}`, d.txHash ? `Transaction: ${d.txHash}` : null, `Time: ${when()}`]),
      html: layout({
        title: "Deposit successful",
        preheader: `${d.amount} ${d.asset} has been credited to your account`,
        body:
          p(`Your deposit of <strong style="color:#1E2329">${esc(d.amount)} ${esc(d.asset)}</strong> is now available in your HarborFinance account.`) +
          details([
            ["Amount", `${d.amount} ${d.asset}`],
            ["Network", d.network],
            ["Transaction ID", d.txHash],
            ["Status", "Successful"],
            ["Time", when()],
          ]) +
          button(`${appUrl()}/dashboard/wallets`, "View wallet"),
      }),
    });
  },

  withdrawalRequested(to, w) {
    return sendEmail({
      to,
      subject: `[HarborFinance] Withdrawal request received: ${w.amount} ${w.asset}`,
      text: text([`We received your request to withdraw ${w.amount} ${w.asset} (fee ${w.fee} ${w.asset}) to ${w.address} on ${w.network}.`, "If you didn't make this request, cancel it in your dashboard and contact support immediately."]),
      html: layout({
        title: "Withdrawal request received",
        preheader: `Your ${w.amount} ${w.asset} withdrawal is being reviewed`,
        body:
          p("We received your withdrawal request. It will be processed after review; you'll get another email when it's sent.") +
          details([
            ["Amount", `${w.amount} ${w.asset}`],
            ["Network fee", `${w.fee} ${w.asset}`],
            ["Network", w.network],
            ["Address", w.address],
            ["Status", "Under review"],
            ["Time", when()],
          ]) +
          p(`<strong style="color:#CF304A">Didn't request this?</strong> Cancel it from your dashboard and contact support right away.`) +
          button(`${appUrl()}/dashboard/transactions?type=WITHDRAWAL`, "View withdrawal"),
      }),
    });
  },

  withdrawalCompleted(to, w) {
    return sendEmail({
      to,
      subject: `[HarborFinance] Withdrawal successful: ${w.amount} ${w.asset}`,
      text: text([`Your withdrawal of ${w.amount} ${w.asset} has been sent to ${w.address} on ${w.network}.`, w.txHash ? `Transaction: ${w.txHash}` : null]),
      html: layout({
        title: "Withdrawal successful",
        preheader: `${w.amount} ${w.asset} has been sent`,
        body:
          p(`Your withdrawal of <strong style="color:#1E2329">${esc(w.amount)} ${esc(w.asset)}</strong> has been sent.`) +
          details([
            ["Amount", `${w.amount} ${w.asset}`],
            ["Network", w.network],
            ["Address", w.address],
            ["Transaction ID", w.txHash],
            ["Status", "Successful"],
            ["Time", when()],
          ]) +
          p("Blockchain confirmations can take a few minutes depending on the network.") +
          button(`${appUrl()}/dashboard/transactions?type=WITHDRAWAL`, "View details"),
      }),
    });
  },

  withdrawalRejected(to, w) {
    return sendEmail({
      to,
      subject: `[HarborFinance] Withdrawal ${w.failed ? "failed" : "not approved"}: ${w.amount} ${w.asset}`,
      text: text([`Your withdrawal of ${w.amount} ${w.asset} was ${w.failed ? "not completed" : "not approved"}. The funds have been returned to your wallet.`, w.reason ? `Reason: ${w.reason}` : null]),
      html: layout({
        title: w.failed ? "Withdrawal failed" : "Withdrawal not approved",
        preheader: "The funds have been returned to your wallet",
        body:
          p(`Your withdrawal of <strong style="color:#1E2329">${esc(w.amount)} ${esc(w.asset)}</strong> could not be completed. The full amount, including the fee, has been returned to your wallet.`) +
          details([
            ["Amount", `${w.amount} ${w.asset}`],
            ["Address", w.address],
            ["Reason", w.reason],
            ["Time", when()],
          ]) +
          button(`${appUrl()}/dashboard/support`, "Contact support"),
      }),
    });
  },

  referralReward(to, r) {
    return sendEmail({
      to,
      subject: `[HarborFinance] You earned ${r.amount} ${r.asset} from a referral`,
      text: text([`Your referral made a qualifying deposit. ${r.amount} ${r.asset} has been credited to your wallet.`]),
      html: layout({
        title: "Referral reward credited",
        preheader: `${r.amount} ${r.asset} has been added to your wallet`,
        body:
          p(`Good news: someone you invited made a qualifying deposit, and <strong style="color:#1E2329">${esc(r.amount)} ${esc(r.asset)}</strong> has been credited to your wallet.`) +
          p("Keep sharing your referral link to earn more.") +
          button(`${appUrl()}/dashboard/referrals`, "View referrals"),
      }),
    });
  },

  passwordReset(to, token) {
    const link = `${appUrl()}/reset-password?token=${encodeURIComponent(token)}`;
    return sendEmail({
      to,
      subject: "[HarborFinance] Reset your password",
      text: text(["A password reset was requested for your account:", link, "", "This link expires in 30 minutes. If you didn't request this, you can ignore this email."]),
      html: layout({
        title: "Reset your password",
        preheader: "Use this link to choose a new password",
        body: p("We received a request to reset the password for your HarborFinance account.") + button(link, "Reset password") + p("This link expires in 30 minutes. If you didn't request a reset, you can safely ignore this email; your password won't change."),
      }),
    });
  },

  securityAlert(to, headline, detail) {
    return sendEmail({
      to,
      subject: `[HarborFinance] Security alert: ${headline}`,
      text: `${headline}\n\n${detail}`,
      html: layout({ title: headline, preheader: detail, body: p(esc(detail)) + p("If this wasn't you, change your password immediately and contact support.") + button(`${appUrl()}/dashboard/settings?tab=security`, "Review account security") }),
    });
  },
};
