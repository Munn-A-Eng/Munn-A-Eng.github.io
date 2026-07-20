// Portfolio interaction layer
// Adds page transitions, scroll reveal effects and a scroll progress bar.

document.addEventListener("DOMContentLoaded", function () {
  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  document.documentElement.classList.add("js-enabled");

  // Visible diagnostic marker. Remove this line later if wanted.
  document.body.classList.add("interactions-loaded");

  if (prefersReducedMotion) {
    return;
  }

  // Scroll progress bar
  const progressBar = document.createElement("div");
  progressBar.className = "scroll-progress";
  document.body.appendChild(progressBar);

  function updateProgress() {
    const scrollableHeight = document.documentElement.scrollHeight - window.innerHeight;
    const progress = scrollableHeight > 0 ? window.scrollY / scrollableHeight : 0;
    progressBar.style.transform = "scaleX(" + progress + ")";
  }

  updateProgress();
  window.addEventListener("scroll", updateProgress, { passive: true });
  window.addEventListener("resize", updateProgress);

  // Scroll reveal
  const revealItems = document.querySelectorAll(
    "main > section, .card, .evidence-item, .industrial-media-item, .award-item, .badge-item, .project-summary-card"
  );

  revealItems.forEach(function (item) {
    item.classList.add("reveal-on-scroll");
  });

  const revealObserver = new IntersectionObserver(
    function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          revealObserver.unobserve(entry.target);
        }
      });
    },
    {
      threshold: 0.08,
      rootMargin: "0px 0px -30px 0px"
    }
  );

  revealItems.forEach(function (item) {
    revealObserver.observe(item);
  });

  // Page exit transition
  document.addEventListener("click", function (event) {
    const link = event.target.closest("a");

    if (!link) {
      return;
    }

    const href = link.getAttribute("href");

    if (
      !href ||
      href.startsWith("#") ||
      href.startsWith("mailto:") ||
      href.startsWith("tel:") ||
      link.target === "_blank" ||
      link.hasAttribute("download")
    ) {
      return;
    }

    const targetUrl = new URL(link.href, window.location.href);
    const currentUrl = new URL(window.location.href);

    if (targetUrl.origin !== currentUrl.origin) {
      return;
    }

    if (
      targetUrl.pathname === currentUrl.pathname &&
      targetUrl.hash
    ) {
      return;
    }

    event.preventDefault();

    document.body.classList.add("page-leaving");

    window.setTimeout(function () {
      window.location.href = link.href;
    }, 220);
  });

  window.addEventListener("pageshow", function () {
    document.body.classList.remove("page-leaving");
  });
});