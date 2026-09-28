// Apply the saved (or system) colour theme before first paint to avoid a flash.
// Loaded as a blocking classic script from <head> (inline scripts are blocked by the CSP).
(function () {
  var t = "dark";
  try {
    var saved = localStorage.getItem("hf.theme");
    t = saved === "light" || saved === "dark" ? saved : matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  } catch (e) {}
  document.documentElement.setAttribute("data-theme", t);
  var m = document.createElement("meta");
  m.name = "theme-color";
  m.content = t === "light" ? "#f5f6f8" : "#000000";
  document.head.appendChild(m);
})();
