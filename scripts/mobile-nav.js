(function () {
  const header = document.querySelector('.site-header');
  const navWrap = header?.querySelector('.nav-wrap');
  const navLinks = header?.querySelector('.nav-links');
  if (!header || !navWrap || !navLinks) return;

  const button = document.createElement('button');
  button.className = 'nav-hamburger';
  button.type = 'button';
  button.setAttribute('aria-label', 'Open navigation menu');
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-controls', 'primary-nav');
  button.innerHTML =
    '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" ' +
    'stroke="currentColor" stroke-width="2" stroke-linecap="round">' +
    '<path class="nav-hamburger-open"  d="M3 6h18M3 12h18M3 18h18"/>' +
    '<path class="nav-hamburger-close" d="M5 5l14 14M19 5L5 19"/>' +
    '</svg>';

  navLinks.id = navLinks.id || 'primary-nav';
  navWrap.appendChild(button);

  function setOpen(open) {
    header.classList.toggle('nav-open', open);
    button.setAttribute('aria-expanded', String(open));
    button.setAttribute('aria-label',
      open ? 'Close navigation menu' : 'Open navigation menu');
  }

  button.addEventListener('click', function () {
    setOpen(!header.classList.contains('nav-open'));
  });

  // Close when a link inside the menu is tapped
  navLinks.addEventListener('click', function (e) {
    if (e.target.tagName === 'A') setOpen(false);
  });

  // Close if the viewport returns to desktop width
  window.addEventListener('resize', function () {
    if (window.innerWidth > 780 && header.classList.contains('nav-open')) {
      setOpen(false);
    }
  });

  // Close on Escape
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && header.classList.contains('nav-open')) {
      setOpen(false);
      button.focus();
    }
  });
    // Close other dropdowns when one is opened (single-open behaviour)
  const dropdowns = header.querySelectorAll('.nav-dropdown');
  dropdowns.forEach(function (d) {
    d.addEventListener('toggle', function () {
      if (d.open) {
        dropdowns.forEach(function (other) {
          if (other !== d) other.open = false;
        });
      }
    });
  });
})();