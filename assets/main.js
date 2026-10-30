/* Final Exam Hub — shared behaviour: theme, nav, TOC, scrollspy */
(function () {
  "use strict";

  var d = document;

  // ---- theme ----
  var root = d.documentElement;
  try {
    var saved = localStorage.getItem("feh-theme");
    if (saved === "dark" || (!saved && window.matchMedia("(prefers-color-scheme: dark)").matches)) {
      root.setAttribute("data-theme", "dark");
    }
  } catch (e) {}
  d.addEventListener("click", function (ev) {
    var btn = ev.target.closest("[data-action='toggle-theme']");
    if (!btn) return;
    var dark = root.getAttribute("data-theme") === "dark";
    if (dark) root.removeAttribute("data-theme"); else root.setAttribute("data-theme", "dark");
    try { localStorage.setItem("feh-theme", dark ? "light" : "dark"); } catch (e) {}
  });

  // ---- mobile nav ----
  var menuBtn = d.getElementById("menuBtn");
  var mainNav = d.querySelector("nav.main");
  if (menuBtn && mainNav) {
    menuBtn.addEventListener("click", function () { mainNav.classList.toggle("open"); });
  }

  // ---- TOC collapse on mobile ----
  var toc = d.querySelector("aside.toc");
  if (toc) {
    var head = toc.querySelector(".toc-head");
    if (head) head.addEventListener("click", function () { toc.classList.toggle("open"); });
    toc.addEventListener("click", function (ev) {
      if (ev.target.closest("a") && window.innerWidth <= 920) toc.classList.remove("open");
    });
  }

  // ---- reading progress + back to top ----
  var prog = d.getElementById("progress");
  var toTop = d.getElementById("toTop");
  function onScroll() {
    var h = d.documentElement;
    var max = h.scrollHeight - h.clientHeight;
    if (prog) prog.style.width = (max > 0 ? (h.scrollTop / max) * 100 : 0) + "%";
    if (toTop) toTop.classList.toggle("show", h.scrollTop > 600);
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();
  if (toTop) toTop.addEventListener("click", function () { window.scrollTo({ top: 0, behavior: "smooth" }); });

  // ---- TOC scrollspy ----
  var tocLinks = Array.prototype.slice.call(d.querySelectorAll("aside.toc .toc-body a"));
  if (tocLinks.length && "IntersectionObserver" in window) {
    var map = {};
    tocLinks.forEach(function (a) {
      var id = a.getAttribute("href").slice(1);
      var sec = d.getElementById(id);
      if (sec) map[id] = a;
    });
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) {
          tocLinks.forEach(function (a) { a.classList.remove("current"); });
          var a = map[en.target.id];
          if (a) a.classList.add("current");
        }
      });
    }, { rootMargin: "-15% 0px -70% 0px" });
    Object.keys(map).forEach(function (id) { io.observe(d.getElementById(id)); });
  }
})();
