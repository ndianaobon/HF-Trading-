// Light / dark theme. The initial theme is applied by the inline script in
// partials/head.html (before first paint); this module handles the toggle,
// remembers the choice and follows the system setting until the user picks one.

const KEY = "hf.theme";
const root = document.documentElement;

export const currentTheme = () => (root.getAttribute("data-theme") === "light" ? "light" : "dark");

function savedTheme() {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : null;
  } catch {
    return null;
  }
}

function syncControls() {
  const next = currentTheme() === "light" ? "dark" : "light";
  document.querySelectorAll("[data-theme-toggle]").forEach((b) => {
    b.setAttribute("aria-label", `Switch to ${next} mode`);
    b.setAttribute("aria-pressed", String(currentTheme() === "light"));
  });
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = currentTheme() === "light" ? "#f5f6f8" : "#000000";
}

/** Applies a theme; `persist` stores it as the user's explicit choice. */
export function setTheme(theme, { persist = true } = {}) {
  if (theme !== "light" && theme !== "dark") return;
  root.classList.add("theme-switching");
  root.setAttribute("data-theme", theme);
  if (persist) {
    try {
      localStorage.setItem(KEY, theme);
    } catch {
      /* storage unavailable: the choice lasts for this page only */
    }
  }
  syncControls();
  window.dispatchEvent(new CustomEvent("hf:themechange", { detail: { theme } }));
  setTimeout(() => root.classList.remove("theme-switching"), 250);
}

document.addEventListener("click", (e) => {
  if (e.target.closest?.("[data-theme-toggle]")) setTheme(currentTheme() === "light" ? "dark" : "light");
});

// Follow the operating-system setting until the user makes an explicit choice.
matchMedia("(prefers-color-scheme: light)").addEventListener?.("change", (e) => {
  if (!savedTheme()) setTheme(e.matches ? "light" : "dark", { persist: false });
});

// Keep tabs in sync when the choice changes in another tab.
window.addEventListener("storage", (e) => {
  if (e.key === KEY && (e.newValue === "light" || e.newValue === "dark")) setTheme(e.newValue, { persist: false });
});

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", syncControls);
else syncControls();
