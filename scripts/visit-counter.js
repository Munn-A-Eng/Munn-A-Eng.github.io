(function () {
  const el = document.querySelector('[data-visit-count]');
  if (!el) return;

  const NAMESPACE = 'adammunn-portfolio';
  const KEY = 'visits';

  // Skip incrementing on localhost — read-only for testing
  const isLocal = ['localhost', '127.0.0.1', ''].includes(location.hostname);

  // Session-guard: only increment once per browser tab session
  const SESSION_FLAG = 'visit-counter-hit';
  const alreadyHitThisSession = sessionStorage.getItem(SESSION_FLAG) === '1';

  const endpoint = (isLocal || alreadyHitThisSession)
    ? 'https://abacus.jasoncameron.dev/get/' + NAMESPACE + '/' + KEY
    : 'https://abacus.jasoncameron.dev/hit/' + NAMESPACE + '/' + KEY;

  fetch(endpoint)
    .then(r => r.ok ? r.json() : Promise.reject('non-ok'))
    .then(data => {
      const n = data.value;
      if (typeof n !== 'number') throw new Error('bad payload');
      el.textContent = n.toLocaleString('en-GB');
      if (!isLocal && !alreadyHitThisSession) {
        sessionStorage.setItem(SESSION_FLAG, '1');
      }
    })
    .catch(err => {
      console.warn('Visit counter fetch failed:', err);
      el.textContent = '—';
      el.title = 'Counter unavailable';
    });
})();