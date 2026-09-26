import { ICONS } from "./icon-data.js";
import { raw, esc } from "./dom.js";

/**
 * Lucide icon as inline SVG. Icon data is generated at build time with only the
 * icons referenced by the frontend (see scripts/build-frontend.js).
 */
export function icon(name, cls = "h-4 w-4") {
  const node = ICONS[name];
  if (!node) return raw("");
  const inner = node.map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).map(([k, v]) => `${k}="${esc(v)}"`).join(" ")}/>`).join("");
  return raw(
    `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon ${esc(cls)}" aria-hidden="true">${inner}</svg>`,
  );
}
