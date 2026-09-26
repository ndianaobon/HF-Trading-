import { NextResponse } from "next/server";
import { route } from "@/lib/api/route";
import { getSetting } from "@/lib/services/settings";
import { isDemoMode } from "@/lib/config";

/**
 * Public site configuration for the static pages: platform mode, maintenance
 * banner, support contact, and company details ONLY when marked verified.
 */
export const GET = route({ auth: "none" }, async () => {
  const [company, contact, maintenance] = await Promise.all([getSetting("company.profile"), getSetting("support.contact"), getSetting("platform.maintenance")]);
  const data = {
    mode: isDemoMode() ? "demo" : "live",
    maintenance: maintenance.enabled ? { message: maintenance.message || "Scheduled maintenance in progress. Some features are temporarily unavailable." } : null,
    support: { email: contact.email, hours: contact.hours || null, liveChatEnabled: contact.liveChatEnabled },
    company: company.verified && company.legalName ? { legalName: company.legalName, registrationNumber: company.registrationNumber, registeredAddress: company.registeredAddress, licenses: company.licenses } : null,
  };
  return NextResponse.json({ data }, { headers: { "Cache-Control": "public, max-age=30" } });
});
