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
      const transport = nodemailer.createTransport({
        host: env().SMTP_HOST,
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

function layout(title, bodyHtml) {
  return `<!doctype html><html><body style="margin:0;background:#070B14;font-family:Inter,Segoe UI,Arial,sans-serif;color:#E6EAF2">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px"><tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="background:#0E1626;border:1px solid #1E2A40;border-radius:16px;padding:32px">
<tr><td style="font-size:18px;font-weight:700;color:#fff;padding-bottom:24px"><span style="color:#F4BE2C">&#9679;</span> HarborFinance</td></tr>
<tr><td style="font-size:20px;font-weight:600;color:#fff;padding-bottom:12px">${title}</td></tr>
<tr><td style="font-size:14px;line-height:22px;color:#AEB7C8">${bodyHtml}</td></tr>
<tr><td style="font-size:12px;color:#6B7890;padding-top:28px;border-top:1px solid #1E2A40">You received this email because of activity on your HarborFinance account. If this wasn't you, please secure your account and contact support.</td></tr>
</table></td></tr></table></body></html>`;
}

const button = (href, label) =>
  `<p style="padding:16px 0"><a href="${href}" style="background:#F4BE2C;color:#0B1220;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:600">${label}</a></p><p style="font-size:12px;color:#6B7890">Or paste this link into your browser:<br>${href}</p>`;

export const emails = {
  verifyEmail(to, firstName, token) {
    const link = `${appUrl()}/verify-email?token=${encodeURIComponent(token)}`;
    return sendEmail({
      to,
      subject: "Verify your HarborFinance email",
      text: `Hi ${firstName},\n\nConfirm your email address to finish setting up your account:\n${link}\n\nThis link expires in 24 hours.`,
      html: layout(
        "Confirm your email address",
        `Hi ${firstName},<br><br>Confirm your email address to finish setting up your HarborFinance account. This link expires in 24 hours.${button(link, "Verify email")}`,
      ),
    });
  },
  passwordReset(to, token) {
    const link = `${appUrl()}/reset-password?token=${encodeURIComponent(token)}`;
    return sendEmail({
      to,
      subject: "Reset your HarborFinance password",
      text: `A password reset was requested for your account.\n${link}\n\nThis link expires in 30 minutes. If you didn't request this, you can ignore this email.`,
      html: layout(
        "Reset your password",
        `A password reset was requested for your account. This link expires in 30 minutes.${button(link, "Choose a new password")}If you didn't request this, you can safely ignore this email.`,
      ),
    });
  },
  securityAlert(to, headline, detail) {
    return sendEmail({
      to,
      subject: `Security alert: ${headline}`,
      text: `${headline}\n\n${detail}`,
      html: layout(headline, detail),
    });
  },
};
