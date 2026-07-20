(function() {
  'use strict';

  const K1 = 1.4;
  const B = 0.75;
  const STOPWORDS = new Set(['a','an','and','are','as','at','be','by','for','from','has','have','he','in','is','it','its','of','on','or','she','that','the','this','to','was','were','will','with','you','your','we','our','i','my','me','but','not','can','all','any','if','so','do','does','did','been','being','had','here','there','which','who','what','when','where','how','than','then','them','they','their','also','more','most','some','such','into','over','under','out','up','down']);

  function stem(word) {
    let w = word.toLowerCase();
    if (w.length < 4) return w;
    if (w.endsWith('ingly')) return w.slice(0, -5);
    if (w.endsWith('edly')) return w.slice(0, -4);
    if (w.endsWith('ing') && w.length > 5) return w.slice(0, -3);
    if (w.endsWith('ed') && w.length > 4) return w.slice(0, -2);
    if (w.endsWith('ly') && w.length > 4) return w.slice(0, -2);
    if (w.endsWith('ies') && w.length > 4) return w.slice(0, -3) + 'y';
    if (w.endsWith('es') && w.length > 4) return w.slice(0, -2);
    if (w.endsWith('s') && !w.endsWith('ss') && w.length > 3) return w.slice(0, -1);
    return w;
  }

  function tokenise(text) {
    return text.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter(t => t && t.length > 1 && !STOPWORDS.has(t)).map(stem);
  }

  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  let index = null;
  let indexLoadState = 'idle';
  let selectedIndex = 0;
  let currentResults = [];

  function bm25Score(queryTerms, doc, idx) {
    let score = 0;
    const N = idx.docCount;
    for (const term of queryTerms) {
      const df = idx.df[term] || 0;
      if (df === 0) continue;
      const tf = doc.tf[term] || 0;
      if (tf === 0) continue;
      const idf = Math.log((N - df + 0.5) / (df + 0.5) + 1);
      const numerator = tf * (K1 + 1);
      const denominator = tf + K1 * (1 - B + B * (doc.length / idx.avgdl));
      score += idf * (numerator / denominator);
    }
    return score;
  }

  function buildSnippet(doc, queryTerms) {
    const excerpt = doc.excerpt || '';
    const lowered = excerpt.toLowerCase();
    let bestPos = 0;
    for (const term of queryTerms) {
      const pos = lowered.indexOf(term.slice(0, Math.max(3, term.length - 2)));
      if (pos >= 0) { bestPos = Math.max(0, pos - 40); break; }
    }
    let snippet = excerpt.slice(bestPos, bestPos + 180);
    if (bestPos > 0) snippet = '... ' + snippet;
    if (bestPos + 180 < excerpt.length) snippet = snippet + ' ...';
    let escaped = escapeHtml(snippet);
    for (const term of queryTerms) {
      const stem3 = term.slice(0, Math.max(3, term.length - 2));
      const re = new RegExp('(' + stem3.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[a-z]*)', 'gi');
      escaped = escaped.replace(re, '<mark>$1</mark>');
    }
    return escaped;
  }

  function search(query) {
    if (!index || !query.trim()) return [];
    const queryTerms = tokenise(query);
    if (queryTerms.length === 0) return [];
    const scored = index.docs.map(doc => ({ doc, score: bm25Score(queryTerms, doc, index) })).filter(r => r.score > 0).sort((a, b) => b.score - a.score).slice(0, 10);
    return scored.map(r => ({ url: r.doc.url, title: r.doc.title, description: r.doc.description, snippet: buildSnippet(r.doc, queryTerms), score: r.score }));
  }

  function ensureModal() {
    let modal = document.getElementById('search-modal');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'search-modal';
    modal.className = 'search-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', 'Site search');
    modal.hidden = true;
    modal.innerHTML = '<div class="search-modal-backdrop"></div><div class="search-modal-panel" role="combobox" aria-haspopup="listbox" aria-expanded="true"><input type="search" class="search-input" placeholder="Search the site..." aria-label="Search query" aria-controls="search-results" autocomplete="off" spellcheck="false"><div class="search-status" id="search-status" aria-live="polite"></div><ul class="search-results" id="search-results" role="listbox"></ul></div>';
    document.body.appendChild(modal);
    modal.querySelector('.search-modal-backdrop').addEventListener('click', closeModal);
    const input = modal.querySelector('.search-input');
    input.addEventListener('input', onInput);
    input.addEventListener('keydown', onKeyDown);
    return modal;
  }

  function loadIndex() {
    if (indexLoadState === 'loaded' || indexLoadState === 'loading') return;
    indexLoadState = 'loading';
    fetch('search-index.json').then(r => {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(data => {
      index = data;
      indexLoadState = 'loaded';
      const status = document.getElementById('search-status');
      if (status && status.textContent === 'Loading search index...') status.textContent = '';
    }).catch(err => {
      indexLoadState = 'error';
      console.error('Search index load failed:', err);
      const status = document.getElementById('search-status');
      if (status) status.textContent = 'Search index unavailable';
    });
  }

  function openModal() {
    const modal = ensureModal();
    modal.hidden = false;
    document.body.style.overflow = 'hidden';
    const input = modal.querySelector('.search-input');
    input.focus();
    input.select();
    loadIndex();
    if (indexLoadState === 'loading') {
      document.getElementById('search-status').textContent = 'Loading search index...';
    }
  }

  function closeModal() {
    const modal = document.getElementById('search-modal');
    if (!modal) return;
    modal.hidden = true;
    document.body.style.overflow = '';
  }

  function renderResults() {
    const ul = document.getElementById('search-results');
    const status = document.getElementById('search-status');
    if (!ul) return;
    if (currentResults.length === 0) {
      ul.innerHTML = '';
      if (status) status.textContent = index ? 'No results' : status.textContent;
      return;
    }
    if (status) status.textContent = currentResults.length + ' result' + (currentResults.length === 1 ? '' : 's');
    ul.innerHTML = currentResults.map((r, i) => '<li role="option" class="search-result' + (i === selectedIndex ? ' selected' : '') + '" data-url="' + escapeHtml(r.url) + '" data-index="' + i + '"><a href="' + escapeHtml(r.url) + '" class="search-result-link"><div class="search-result-title">' + escapeHtml(r.title) + '</div><div class="search-result-snippet">' + r.snippet + '</div></a></li>').join('');
    ul.querySelectorAll('.search-result').forEach(li => {
      li.addEventListener('mouseenter', () => {
        selectedIndex = parseInt(li.dataset.index, 10);
        updateSelection();
      });
    });
  }

  function updateSelection() {
    const items = document.querySelectorAll('#search-results .search-result');
    items.forEach((it, i) => it.classList.toggle('selected', i === selectedIndex));
    const sel = items[selectedIndex];
    if (sel) sel.scrollIntoView({ block: 'nearest' });
  }

  function onInput(e) {
    if (indexLoadState !== 'loaded') {
      if (indexLoadState === 'error') return;
      const status = document.getElementById('search-status');
      if (status) status.textContent = 'Loading search index...';
      const q = e.target.value;
      const retry = setInterval(() => {
        if (indexLoadState === 'loaded') { clearInterval(retry); currentResults = search(q); selectedIndex = 0; renderResults(); }
        else if (indexLoadState === 'error') { clearInterval(retry); }
      }, 100);
      return;
    }
    currentResults = search(e.target.value);
    selectedIndex = 0;
    renderResults();
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') { closeModal(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); if (currentResults.length) { selectedIndex = (selectedIndex + 1) % currentResults.length; updateSelection(); } return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); if (currentResults.length) { selectedIndex = (selectedIndex - 1 + currentResults.length) % currentResults.length; updateSelection(); } return; }
    if (e.key === 'Enter') { e.preventDefault(); const sel = currentResults[selectedIndex]; if (sel) window.location.href = sel.url; return; }
  }

  document.addEventListener('keydown', function(e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); openModal(); return; }
    if (e.key === '/' && !['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)) { e.preventDefault(); openModal(); return; }
  });

  document.addEventListener('click', function(e) {
    const btn = e.target.closest('.search-open');
    if (btn) { e.preventDefault(); openModal(); }
  });
})();