/**
 * site-interactions.js
 * Progressive-enhancement layer for the Adam Munn engineering portfolio.
 *
 *   - Lateral page transitions (slide + fade) between internal pages
 *   - Shared-element FLIP animation on the profile headshot when moving
 *     between the hero pages (home / about) and any subject page
 *   - IntersectionObserver-driven scroll reveal
 *   - Slim scroll-progress indicator across the top of the viewport
 *   - Dismissible notice if the OS has "reduce motion" enabled, so the
 *     visitor knows how to turn animations on
 *
 *   Vanilla ES5-safe JavaScript, no dependencies, loaded with `defer`.
 */
(function () {
  'use strict';

  var CONFIG = {
    leaveDurationMs: 320,
    flipDurationMs: 520,
    revealSelector: [
      'main > section',
      '.card',
      '.evidence-item',
      '.industrial-media-item',
      '.award-item',
      '.badge-item',
      '.project-summary-card'
    ].join(', '),
    revealRootMargin: '0px 0px -40px 0px',
    revealThreshold: 0.08,
    flipStorageKey: 'headshotFlip'
  };

  var html = document.documentElement;
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  html.classList.add('js');
  if (reduceMotion) html.classList.add('reduce-motion');

  // Runs on script parse (before DOMContentLoaded) so hiding lands before paint
  // in most browsers. A matching inline <head> hint on each page removes any
  // residual flash — see step 3.
  prepareIncomingFlip();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  function init() {
    initReducedMotionNotice();
    initPageLeave();
    initIncomingFlip();
    initScrollReveal();
    initScrollProgress();
    window.addEventListener('pageshow', handlePageShow);
  }

  /* ---------------------------------------------------------------- */
  /*  Reduced-motion notice                                           */
  /* ---------------------------------------------------------------- */

  function initReducedMotionNotice() {
    if (!reduceMotion) return;
    // Swap to localStorage for permanent dismissal:
    if (sessionStorage.getItem('rmNoticeDismissed') === '1') return;

    var notice = document.createElement('div');
    notice.className = 'motion-notice';
    notice.setAttribute('role', 'note');
    notice.innerHTML =
      '<div class="motion-notice-inner">' +
        '<p><strong>Animations are disabled by your device.</strong> ' +
        'This site uses subtle motion between pages. To enable it: ' +
        'on <em>Windows</em>, open <em>Settings &rsaquo; Accessibility &rsaquo; Visual effects</em> ' +
        'and turn <em>Animation effects</em> on. On <em>macOS</em>, uncheck ' +
        '<em>System Settings &rsaquo; Accessibility &rsaquo; Display &rsaquo; Reduce motion</em>.</p>' +
        '<button type="button" class="motion-notice-close" aria-label="Dismiss notice">&times;</button>' +
      '</div>';
    document.body.appendChild(notice);

    notice.querySelector('.motion-notice-close').addEventListener('click', function () {
      notice.classList.add('is-dismissed');
      // Swap to localStorage for permanent dismissal:
      sessionStorage.setItem('rmNoticeDismissed', '1');
      window.setTimeout(function () { notice.remove(); }, 220);
    });
  }

  /* ---------------------------------------------------------------- */
  /*  Page-leave transition + shared-element FLIP handoff             */
  /* ---------------------------------------------------------------- */

  function initPageLeave() {
    document.addEventListener('click', onDocumentClick);
  }

  function onDocumentClick(event) {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

    var link = event.target.closest('a[href]');
    if (!link || !isInternalNavigation(link)) return;

    event.preventDefault();
    var destination = link.href;

    if (reduceMotion) {
      window.location.href = destination;
      return;
    }

    // Direction: forward through the nav = slide out to the left,
    // backward (returning to home/about) = slide out to the right.
    var currentIsHero = isHeroPage(window.location.pathname);
    var destinationIsHero = isHeroPage(new URL(destination, window.location.href).pathname);
    var direction = currentIsHero && !destinationIsHero ? 'forward'
                  : !currentIsHero && destinationIsHero ? 'backward'
                  : 'forward';

    html.setAttribute('data-transition-direction', direction);
    captureHeadshotForHandoff(currentIsHero, destinationIsHero);

    html.classList.add('is-leaving');
    window.setTimeout(function () {
      window.location.href = destination;
    }, CONFIG.leaveDurationMs);
  }

  function isHeroPage(pathname) {
    return /(^|\/)(index|about)\.html?$/i.test(pathname) || /\/$/.test(pathname);
  }

  function isInternalNavigation(link) {
    var href = link.getAttribute('href');
    if (!href) return false;
    if (href.charAt(0) === '#') return false;
    if (href.indexOf('mailto:') === 0 || href.indexOf('tel:') === 0) return false;
    if (link.target && link.target !== '_self') return false;
    if (link.hasAttribute('download')) return false;

    try {
      var target = new URL(link.href, window.location.href);
      if (target.origin !== window.location.origin) return false;
      if (target.pathname === window.location.pathname && target.hash) return false;
      return true;
    } catch (err) {
      return false;
    }
  }

  function handlePageShow(event) {
    if (event.persisted) {
      html.classList.remove('is-leaving');
      html.classList.remove('flip-pending');
    }
  }

  /* -- FLIP: capture source rect on the outgoing page ---------------- */

  function captureHeadshotForHandoff(currentIsHero, destinationIsHero) {
    var source = currentIsHero
      ? document.querySelector('.profile-headshot')
      : document.querySelector('.header-headshot');
    if (!source) return;

    // Only capture when the headshot's size/position will actually change.
    if (currentIsHero === destinationIsHero) return;

    var rect = source.getBoundingClientRect();
    var payload = {
      x: rect.left,
      y: rect.top,
      w: rect.width,
      h: rect.height,
      radius: window.getComputedStyle(source).borderRadius,
      src: source.getAttribute('src'),
      ts: Date.now()
    };
    try { sessionStorage.setItem(CONFIG.flipStorageKey, JSON.stringify(payload)); }
    catch (err) { /* storage disabled; degrade silently */ }
  }

  /* -- FLIP: mark the incoming page before paint --------------------- */

  function prepareIncomingFlip() {
    try {
      if (sessionStorage.getItem(CONFIG.flipStorageKey)) {
        html.classList.add('flip-pending');
      }
    } catch (err) { /* ignore */ }
  }

  /* -- FLIP: run the animation on the incoming page ------------------ */

  function initIncomingFlip() {
    var raw;
    try { raw = sessionStorage.getItem(CONFIG.flipStorageKey); }
    catch (err) { raw = null; }

    if (!raw) { html.classList.remove('flip-pending'); return; }

    var payload;
    try { payload = JSON.parse(raw); } catch (err) { payload = null; }
    sessionStorage.removeItem(CONFIG.flipStorageKey);

    var stale = !payload || (Date.now() - payload.ts) > 4000;
    if (stale || reduceMotion) { html.classList.remove('flip-pending'); return; }

    var target = isHeroPage(window.location.pathname)
      ? document.querySelector('.profile-headshot')
      : document.querySelector('.header-headshot');

    if (!target) { html.classList.remove('flip-pending'); return; }

    var lastRect = target.getBoundingClientRect();
    var clone = target.cloneNode(true);
    clone.className = 'headshot-flip-clone';
    clone.style.position = 'fixed';
    clone.style.left = payload.x + 'px';
    clone.style.top = payload.y + 'px';
    clone.style.width = payload.w + 'px';
    clone.style.height = payload.h + 'px';
    clone.style.margin = '0';
    clone.style.zIndex = '10000';
    clone.style.borderRadius = payload.radius || '50%';
    clone.style.transition =
      'transform ' + CONFIG.flipDurationMs + 'ms cubic-bezier(0.2, 0.8, 0.2, 1), ' +
      'border-radius ' + CONFIG.flipDurationMs + 'ms ease';
    clone.style.willChange = 'transform';
    document.body.appendChild(clone);

    target.classList.add('is-flip-target');

    var scaleX = lastRect.width / payload.w;
    var scaleY = lastRect.height / payload.h;
    var translateX = lastRect.left - payload.x;
    var translateY = lastRect.top - payload.y;

    // Two RAFs so the initial styles apply before the transform is set.
    window.requestAnimationFrame(function () {
      window.requestAnimationFrame(function () {
        clone.style.transform =
          'translate(' + translateX + 'px, ' + translateY + 'px) ' +
          'scale(' + scaleX + ', ' + scaleY + ')';
        clone.style.borderRadius = window.getComputedStyle(target).borderRadius;
      });
    });

    var finish = function () {
      clone.removeEventListener('transitionend', finish);
      target.classList.remove('is-flip-target');
      html.classList.remove('flip-pending');
      if (clone.parentNode) clone.parentNode.removeChild(clone);
    };
    clone.addEventListener('transitionend', finish);
    // Safety net if transitionend never fires (e.g. tab hidden during animation).
    window.setTimeout(finish, CONFIG.flipDurationMs + 250);
  }

  /* ---------------------------------------------------------------- */
  /*  Scroll reveal                                                   */
  /* ---------------------------------------------------------------- */

  function initScrollReveal() {
    if (reduceMotion) return;

    var items = document.querySelectorAll(CONFIG.revealSelector);
    if (!items.length) return;

    if (!('IntersectionObserver' in window)) {
      forEach(items, function (el) { el.classList.add('is-visible'); });
      return;
    }

    forEach(items, function (el) { el.classList.add('reveal-on-scroll'); });

    var observer = new IntersectionObserver(function (entries, obs) {
      for (var i = 0; i < entries.length; i++) {
        if (entries[i].isIntersecting) {
          entries[i].target.classList.add('is-visible');
          obs.unobserve(entries[i].target);
        }
      }
    }, {
      threshold: CONFIG.revealThreshold,
      rootMargin: CONFIG.revealRootMargin
    });

    forEach(items, function (el) { observer.observe(el); });
  }

  /* ---------------------------------------------------------------- */
  /*  Scroll-progress indicator                                       */
  /* ---------------------------------------------------------------- */

  function initScrollProgress() {
    if (reduceMotion) return;

    var bar = document.createElement('div');
    bar.className = 'scroll-progress';
    bar.setAttribute('aria-hidden', 'true');
    document.body.appendChild(bar);

    var ticking = false;
    function update() {
      var scrollable = document.documentElement.scrollHeight - window.innerHeight;
      var ratio = scrollable > 0 ? window.scrollY / scrollable : 0;
      bar.style.transform = 'scaleX(' + ratio.toFixed(4) + ')';
      ticking = false;
    }
    function requestUpdate() {
      if (!ticking) {
        window.requestAnimationFrame(update);
        ticking = true;
      }
    }
    update();
    window.addEventListener('scroll', requestUpdate, { passive: true });
    window.addEventListener('resize', requestUpdate);
  }

  function forEach(list, fn) {
    for (var i = 0; i < list.length; i++) fn(list[i], i);
  }
})();