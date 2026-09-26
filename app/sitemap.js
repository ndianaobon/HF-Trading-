import { ARTICLES } from "@/lib/content/learn";

const BASE = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");

export default function sitemap() {
  const now = new Date();
  const pages = [
    ["", 1, "daily"],
    ["/markets", 0.9, "hourly"],
    ["/trade/BTC-USDT", 0.8, "hourly"],
    ["/investment-plans", 0.8, "weekly"],
    ["/copy-trading", 0.7, "daily"],
    ["/automated-trading", 0.7, "monthly"],
    ["/forex", 0.7, "hourly"],
    ["/shares", 0.7, "hourly"],
    ["/indices", 0.7, "hourly"],
    ["/learn", 0.7, "weekly"],
    ["/about", 0.6, "monthly"],
    ["/fees", 0.6, "monthly"],
    ["/faq", 0.6, "monthly"],
    ["/help", 0.6, "monthly"],
    ["/contact", 0.5, "monthly"],
    ["/register", 0.5, "yearly"],
    ["/login", 0.3, "yearly"],
    ["/terms", 0.3, "yearly"],
    ["/privacy", 0.3, "yearly"],
    ["/cookies", 0.2, "yearly"],
    ["/risk-disclosure", 0.3, "yearly"],
  ];
  return [
    ...pages.map(([path, priority, changeFrequency]) => ({ url: `${BASE}${path}`, lastModified: now, priority, changeFrequency })),
    ...ARTICLES.map((a) => ({ url: `${BASE}/learn/${a.slug}`, lastModified: now, priority: 0.5, changeFrequency: "monthly" })),
  ];
}
