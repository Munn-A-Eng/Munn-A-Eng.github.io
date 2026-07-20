(function () {
  const STORAGE_KEY = 'portfolio-a11y-prefs';
  const DEFAULTS = {
    theme:    'light',   // 'light' | 'dark'
    contrast: 'normal',  // 'normal' | 'high'
    textSize: 'normal',  // 'normal' | 'large' | 'xlarge'
    motion:   'auto'     // 'auto' | 'reduced'
  };

  let prefs = { ...DEFAULTS };
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (saved && typeof saved === 'object') prefs = { ...DEFAULTS, ...saved };
  } catch (e) {}

  function applyAll() {
    const html = document.documentElement;
    html.setAttribute('data-theme',     prefs.theme);
    html.setAttribute('data-contrast',  prefs.contrast);
    html.setAttribute('data-text-size', prefs.textSize);
    html.setAttribute('data-motion',    prefs.motion);
  }

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs)); } catch (e) {}
  }

  function setPref(key, value) {
    prefs[key] = value;
    applyAll();
    save();
    syncButtons();
  }

  function reset() {
    prefs = { ...DEFAULTS };
    applyAll();
    save();
    syncButtons();
  }

  const widget = document.createElement('div');
  widget.className = 'a11y-widget';
  widget.setAttribute('data-open', 'false');
  widget.innerHTML = `
    <button class="a11y-toggle" type="button"
            aria-label="Open display and accessibility settings"
            aria-expanded="false">
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"
           fill="none" stroke="currentColor" stroke-width="2"
           stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"/>
        <circle cx="12" cy="8" r="1.4" fill="currentColor" stroke="none"/>
        <path d="M8 12h8M12 12v5M9.5 17.5L12 14M14.5 17.5L12 14"/>
      </svg>
      <span class="a11y-toggle-label">Accessibility</span>
    </button>
    <div class="a11y-panel" role="dialog" aria-label="Display and accessibility settings">
      <div class="a11y-panel-header">
        <h3>Display settings</h3>
        <button class="a11y-close" type="button" aria-label="Close settings">×</button>
      </div>

      <div class="a11y-row">
        <span class="a11y-label">Theme</span>
        <div class="a11y-group" role="group" aria-label="Theme">
          <button type="button" data-set="theme" data-value="light">Light</button>
          <button type="button" data-set="theme" data-value="dark">Dark</button>
        </div>
      </div>

      <div class="a11y-row">
        <span class="a11y-label">Contrast</span>
        <div class="a11y-group" role="group" aria-label="Contrast">
          <button type="button" data-set="contrast" data-value="normal">Normal</button>
          <button type="button" data-set="contrast" data-value="high">High</button>
        </div>
      </div>

      <div class="a11y-row">
        <span class="a11y-label">Text size</span>
        <div class="a11y-group" role="group" aria-label="Text size">
          <button type="button" data-set="textSize" data-value="normal">A</button>
          <button type="button" data-set="textSize" data-value="large">A+</button>
          <button type="button" data-set="textSize" data-value="xlarge">A++</button>
        </div>
      </div>

      <div class="a11y-row">
        <span class="a11y-label">Motion</span>
        <div class="a11y-group" role="group" aria-label="Motion">
          <button type="button" data-set="motion" data-value="auto">Auto</button>
          <button type="button" data-set="motion" data-value="reduced">Reduced</button>
        </div>
      </div>

      <button class="a11y-reset" type="button">Reset to defaults</button>
    </div>
  `;
  document.body.appendChild(widget);

  const toggle       = widget.querySelector('.a11y-toggle');
  const panel        = widget.querySelector('.a11y-panel');
  const closeBtn     = widget.querySelector('.a11y-close');
  const resetBtn     = widget.querySelector('.a11y-reset');
  const optionButtons = widget.querySelectorAll('button[data-set]');

  function openPanel() {
    widget.setAttribute('data-open', 'true');
    toggle.setAttribute('aria-expanded', 'true');
  }
  function closePanel() {
    widget.setAttribute('data-open', 'false');
    toggle.setAttribute('aria-expanded', 'false');
  }
  toggle.addEventListener('click', function () {
    if (widget.getAttribute('data-open') === 'true') closePanel();
    else openPanel();
  });
  closeBtn.addEventListener('click', closePanel);

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && widget.getAttribute('data-open') === 'true') {
      closePanel();
      toggle.focus();
    }
  });

  document.addEventListener('click', function (e) {
    if (widget.getAttribute('data-open') !== 'true') return;
    if (!widget.contains(e.target)) closePanel();
  });

  optionButtons.forEach(function (btn) {
    btn.addEventListener('click', function () {
      setPref(btn.dataset.set, btn.dataset.value);
    });
  });

  resetBtn.addEventListener('click', reset);

  function syncButtons() {
    optionButtons.forEach(function (btn) {
      const active = prefs[btn.dataset.set] === btn.dataset.value;
      btn.classList.toggle('is-selected', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  applyAll();
  syncButtons();
})();