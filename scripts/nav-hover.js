(function () {
  const CLOSE_DELAY_MS = 180;

  function init() {
    const dropdowns = document.querySelectorAll('.nav-dropdown');
    dropdowns.forEach(dd => {
      let closeTimer = 0;
      const openIt   = () => { clearTimeout(closeTimer); dd.setAttribute('open', ''); };
      const closeIt  = () => { closeTimer = setTimeout(() => dd.removeAttribute('open'), CLOSE_DELAY_MS); };
      dd.addEventListener('mouseenter', openIt);
      dd.addEventListener('mouseleave', closeIt);
      dd.addEventListener('focusin',   openIt);
      dd.addEventListener('focusout',  closeIt);
    });

    document.addEventListener('click', (e) => {
      dropdowns.forEach(dd => {
        if (dd.hasAttribute('open') && !dd.contains(e.target)) dd.removeAttribute('open');
      });
    });

    dropdowns.forEach(dd => {
      const summary = dd.querySelector('summary');
      const firstLink = dd.querySelector('.nav-dropdown-list a');
      if (!summary || !firstLink) return;
      const overviewHref = firstLink.getAttribute('href');
      summary.addEventListener('click', (e) => {
        if (e.ctrlKey || e.metaKey || e.shiftKey || e.button === 1) return;
        e.preventDefault();
        window.location.href = overviewHref;
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();