import { route } from "@/lib/api/route";
import { RATE_LIMITS } from "@/lib/security/rate-limit";
import { contactSchema } from "@/lib/validation/schemas";
import { sendEmail } from "@/lib/email/mailer";
import { getSetting } from "@/lib/services/settings";

const escape = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** Public contact form → routed to the configured support inbox. */
export const POST = route({ auth: "none", body: contactSchema, rateLimit: RATE_LIMITS.emailSend }, async ({ body, ip }) => {
  const contact = await getSetting("support.contact");
  await sendEmail({
    to: contact.email,
    subject: `[Contact] ${body.topic} — ${body.name}`,
    text: `From: ${body.name} <${body.email}> (IP ${ip})\nTopic: ${body.topic}\n\n${body.message}`,
    html: `<p><b>From:</b> ${escape(body.name)} &lt;${escape(body.email)}&gt;</p><p><b>Topic:</b> ${escape(body.topic)}</p><p>${escape(body.message).replace(/\n/g, "<br>")}</p>`,
  });
  return { received: true };
});
