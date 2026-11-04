(function () {
  var root = document.documentElement;
  var stored = null;
  var manager = null;
  try {
    stored = localStorage.getItem("neocord-theme");
    manager = localStorage.getItem("neocord-pm");
  } catch (error) {}
  var dark = matchMedia("(prefers-color-scheme: dark)");
  root.dataset.theme = stored === "light" || stored === "dark" ? stored : dark.matches ? "dark" : "light";
  root.dataset.pm = manager === "npm" || manager === "pnpm" || manager === "yarn" ? manager : "bun";
  dark.addEventListener("change", function (event) {
    var choice = null;
    try {
      choice = localStorage.getItem("neocord-theme");
    } catch (error) {}
    if (choice === null) {
      root.dataset.theme = event.matches ? "dark" : "light";
      window.dispatchEvent(new Event("neocord-theme"));
    }
  });
})();
