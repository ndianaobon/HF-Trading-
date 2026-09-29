// Hides the full-screen brand loader (partials/loader.html) once the page has loaded.
// Loaded as a blocking classic script from <head> (inline scripts are blocked by the CSP).
// The first page of a session plays the full intro; later pages fade out as soon as they are ready.
(function () {
  var root = document.documentElement;
  var seen = false;
  try {
    seen = sessionStorage.getItem("hf.loader") === "1";
    sessionStorage.setItem("hf.loader", "1");
  } catch (e) {}
  if (seen) root.classList.add("hf-loader-quick");

  var start = Date.now();
  var minVisible = seen ? 0 : 1500;
  var done = false;

  function hide() {
    if (done) return;
    done = true;
    setTimeout(function () {
      var el = document.getElementById("hf-loader");
      if (!el) return;
      el.classList.add("is-done");
      el.setAttribute("aria-hidden", "true");
      setTimeout(function () {
        if (el.parentNode) el.parentNode.removeChild(el);
      }, 700);
    }, Math.max(0, minVisible - (Date.now() - start)));
  }

  if (document.readyState === "complete") hide();
  else window.addEventListener("load", hide);
  // Do not wait on slow third-party assets for too long.
  setTimeout(hide, 6000);
})();
