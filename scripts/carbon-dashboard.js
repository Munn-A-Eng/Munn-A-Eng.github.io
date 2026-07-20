(function () {
  const root = document.querySelector('.carbon-dashboard');
  if (!root) return;

  const API_BASE = 'https://api.carbonintensity.org.uk';
  const REFRESH_MS = 5 * 60 * 1000;

  const els = {
    status:      root.querySelector('[data-carbon-status]'),
    refresh:     root.querySelector('[data-carbon-refresh]'),
    value:       root.querySelector('[data-carbon-value]'),
    index:       root.querySelector('[data-carbon-index]'),
    time:        root.querySelector('[data-carbon-time]'),
    spark:       root.querySelector('[data-carbon-sparkline]'),
    sparkFill:   root.querySelector('[data-carbon-sparkline-fill]'),
    donut:       root.querySelector('[data-carbon-mix-donut]'),
    donutSegs:   root.querySelector('[data-carbon-mix-segments]'),
    lowCarbon:   root.querySelector('[data-carbon-lowcarbon]'),
    mixLegend:   root.querySelector('[data-carbon-mix-legend]')
  };

  const FUEL_COLOURS = {
    gas:      '#c46b3a',
    coal:     '#3a3a3a',
    biomass:  '#8a6f3a',
    nuclear:  '#5a7fa8',
    hydro:    '#3a8ac4',
    imports:  '#7a7a7a',
    other:    '#a0a0a0',
    wind:     '#3aa896',
    solar:    '#e0b040'
  };
  const FUEL_ORDER = ['gas','coal','biomass','nuclear','hydro','imports','wind','solar','other'];
  const LOW_CARBON = new Set(['wind','solar','nuclear','hydro']);

  let isRefreshing = false;
  let currentSeries = null;
  let tooltipInitialised = false;

  function setStatus(text, cls) {
    if (!els.status) return;
    els.status.textContent = text;
    els.status.classList.remove('is-live', 'is-error');
    if (cls) els.status.classList.add(cls);
  }

  function fmtTime(iso) {
    try {
      return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    } catch (e) { return ''; }
  }

  function indexToKey(idx) {
    return idx ? idx.toLowerCase().replace(/\s+/g, '-') : '';
  }

  function drawSparkline(data) {
    if (!els.spark || !data || !data.length) return;
    const values = data.map(d => d.intensity.actual ?? d.intensity.forecast).filter(v => v != null);
    if (!values.length) return;

    const yMax = 300, yMin = 0, range = yMax - yMin;
    const W = 400, H = 300, padX = 2;

    const points = values.map((v, i) => {
      const x = (i / (values.length - 1)) * (W - padX * 2) + padX;
      const y = H - ((Math.min(v, yMax) - yMin) / range) * H;
      return [x, y];
    });

    const d = points.map((p, i) => (i === 0 ? 'M' : 'L') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
    els.spark.setAttribute('d', d);

    if (els.sparkFill) {
      const fillD = d + ' L' + points[points.length - 1][0].toFixed(1) + ',' + H
                      + ' L' + points[0][0].toFixed(1) + ',' + H + ' Z';
      els.sparkFill.setAttribute('d', fillD);
    }

    currentSeries = data;
    initSparklineTooltip();
  }

  function initSparklineTooltip() {
    if (tooltipInitialised) return;
    const svg = els.spark && els.spark.ownerSVGElement;
    if (!svg) return;

    let wrap = svg.parentElement;
    if (!wrap.classList.contains('carbon-spark-hoverwrap')) {
      const newWrap = document.createElement('div');
      newWrap.className = 'carbon-spark-hoverwrap';
      newWrap.style.cssText = 'position:relative;line-height:0;width:100%';
      svg.parentNode.insertBefore(newWrap, svg);
      newWrap.appendChild(svg);
      wrap = newWrap;
    }

    const line = document.createElement('div');
    line.style.cssText = 'position:absolute;top:0;bottom:0;width:1px;background:repeating-linear-gradient(to bottom,var(--text) 0 3px,transparent 3px 6px);opacity:0;pointer-events:none;transition:opacity 0.1s';
    wrap.appendChild(line);

    const dot = document.createElement('div');
    dot.style.cssText = 'position:absolute;width:9px;height:9px;border-radius:50%;background:var(--accent);border:2px solid var(--panel);transform:translate(-50%,-50%);opacity:0;pointer-events:none;transition:opacity 0.1s';
    wrap.appendChild(dot);

    const tip = document.createElement('div');
    tip.style.cssText = 'position:absolute;background:var(--text);color:var(--panel);padding:0.35rem 0.6rem;border-radius:4px;font-size:0.78rem;line-height:1.35;pointer-events:none;opacity:0;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,0.2);transition:opacity 0.1s;font-variant-numeric:tabular-nums;z-index:5';
    wrap.appendChild(tip);

    svg.style.cursor = 'crosshair';

    svg.addEventListener('mousemove', function (ev) {
      if (!currentSeries || !currentSeries.length) return;
      const rect = svg.getBoundingClientRect();
      const relX = (ev.clientX - rect.left) / rect.width;
      if (relX < 0 || relX > 1) return;

      const n = currentSeries.length;
      const idx = Math.max(0, Math.min(n - 1, Math.round(relX * (n - 1))));
      const point = currentSeries[idx];
      const value = point.intensity.actual ?? point.intensity.forecast;
      if (value == null) return;

      const H_render = rect.height;
      const dataX_pct = (idx / (n - 1)) * 100;
      const dataY_px = H_render - (Math.min(value, 300) / 300) * H_render;

      line.style.left = dataX_pct + '%';
      line.style.opacity = '0.5';

      dot.style.left = dataX_pct + '%';
      dot.style.top  = dataY_px + 'px';
      dot.style.opacity = '1';

      const timeStr = new Date(point.to).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
      tip.innerHTML = '<strong>' + value + '</strong> gCO₂/kWh<br><span style="opacity:0.7">' + timeStr + '</span>';

      let hAlign = 'translate(-50%, ';
      if (dataX_pct < 10) hAlign = 'translate(0, ';
      else if (dataX_pct > 90) hAlign = 'translate(-100%, ';

      let vAlign, tipTop;
      if (dataY_px < 40) { vAlign = '0)'; tipTop = dataY_px + 14; }
      else               { vAlign = '-100%)'; tipTop = dataY_px - 10; }

      tip.style.left = dataX_pct + '%';
      tip.style.top = tipTop + 'px';
      tip.style.transform = hAlign + vAlign;
      tip.style.opacity = '1';
    });

    svg.addEventListener('mouseleave', function () {
      line.style.opacity = '0';
      dot.style.opacity = '0';
      tip.style.opacity = '0';
    });

    tooltipInitialised = true;
  }

  function polar(cx, cy, r, angleRad) {
    return [cx + r * Math.cos(angleRad), cy + r * Math.sin(angleRad)];
  }

  function donutSegmentPath(cx, cy, rOuter, rInner, startAngle, endAngle) {
    const large = (endAngle - startAngle) > Math.PI ? 1 : 0;
    const [x1, y1] = polar(cx, cy, rOuter, startAngle);
    const [x2, y2] = polar(cx, cy, rOuter, endAngle);
    const [x3, y3] = polar(cx, cy, rInner, endAngle);
    const [x4, y4] = polar(cx, cy, rInner, startAngle);
    return [
      'M', x1.toFixed(2), y1.toFixed(2),
      'A', rOuter, rOuter, 0, large, 1, x2.toFixed(2), y2.toFixed(2),
      'L', x3.toFixed(2), y3.toFixed(2),
      'A', rInner, rInner, 0, large, 0, x4.toFixed(2), y4.toFixed(2),
      'Z'
    ].join(' ');
  }

  function drawDonut(mix) {
    if (!els.donutSegs || !els.mixLegend || !mix) return;
    els.donutSegs.innerHTML = '';
    els.mixLegend.innerHTML = '';

    const cx = 80, cy = 80, rOuter = 70, rInner = 46;
    let cursor = -Math.PI / 2;
    let lowCarbonTotal = 0;

    const byFuel = {};
    mix.forEach(m => { byFuel[m.fuel] = m.perc; });

    FUEL_ORDER.forEach(fuel => {
      const pct = byFuel[fuel];
      if (pct == null || pct <= 0) return;

      const sweep = (pct / 100) * (Math.PI * 2);
      const start = cursor;
      const end = cursor + sweep;
      cursor = end;

      if (LOW_CARBON.has(fuel)) lowCarbonTotal += pct;

      const colour = FUEL_COLOURS[fuel] || FUEL_COLOURS.other;

      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', donutSegmentPath(cx, cy, rOuter, rInner, start, end));
      path.setAttribute('fill', colour);
      path.setAttribute('data-fuel', fuel);
      path.setAttribute('tabindex', '0');
      path.setAttribute('role', 'img');
      path.setAttribute('aria-label', fuel + ': ' + pct.toFixed(1) + '%');

      path.addEventListener('mouseenter', function () {
        els.donut.classList.add('is-hovering');
        path.classList.add('is-hover');
        highlightLegend(fuel, true);
      });
      path.addEventListener('mouseleave', function () {
        els.donut.classList.remove('is-hovering');
        path.classList.remove('is-hover');
        highlightLegend(fuel, false);
      });

      els.donutSegs.appendChild(path);

      const fuelUpper = fuel.charAt(0).toUpperCase() + fuel.slice(1);
      const li = document.createElement('li');
      li.dataset.fuel = fuel;
      li.style.cssText = 'display:inline-flex;align-items:center;white-space:nowrap';
      li.innerHTML =
        '<span class="carbon-swatch" style="background:' + colour +
        ';display:inline-block;width:12px;height:12px;min-width:12px;border-radius:2px;flex-shrink:0;vertical-align:middle;margin-right:0.55rem"></span>'
        + '<span class="carbon-fuel" style="margin-right:0.45rem;font-weight:500">' + fuelUpper + '</span>'
        + '<span class="carbon-pct" style="color:var(--muted);font-variant-numeric:tabular-nums">' + pct.toFixed(1) + '%</span>';
      els.mixLegend.appendChild(li);
    });

    if (els.lowCarbon) els.lowCarbon.textContent = lowCarbonTotal.toFixed(0) + '%';
  }

  function highlightLegend(fuel, on) {
    if (!els.mixLegend) return;
    els.mixLegend.querySelectorAll('li').forEach(li => {
      li.style.opacity = (!on || li.dataset.fuel === fuel) ? '' : '0.45';
    });
  }

  async function refresh() {
    if (isRefreshing) return;
    isRefreshing = true;
    if (els.refresh) {
      els.refresh.disabled = true;
      els.refresh.classList.add('is-refreshing');
    }

    try {
      setStatus('Loading…');

      const now = new Date();
      const from = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const fromIso = from.toISOString().split('.')[0] + 'Z';
      const toIso = now.toISOString().split('.')[0] + 'Z';

      const [intensityRes, generationRes] = await Promise.all([
        fetch(API_BASE + '/intensity/' + fromIso + '/' + toIso),
        fetch(API_BASE + '/generation')
      ]);
      if (!intensityRes.ok || !generationRes.ok) throw new Error('API returned non-OK status');

      const intensity  = await intensityRes.json();
      const generation = await generationRes.json();

      const series = intensity.data || [];
      const latest = series[series.length - 1];
      if (!latest) throw new Error('No intensity data');

      const value = latest.intensity.actual ?? latest.intensity.forecast;
      const index = latest.intensity.index;

      els.value.textContent = value != null ? value : '—';
      els.index.textContent = index || '—';
      els.index.setAttribute('data-level', indexToKey(index));
      els.time.textContent  = 'Updated ' + fmtTime(latest.to);

      drawSparkline(series);
      drawDonut((generation.data && generation.data.generationmix) || []);

      setStatus('Live', 'is-live');
    } catch (err) {
      console.warn('Carbon dashboard fetch failed:', err);
      setStatus('Data unavailable', 'is-error');
      els.value.textContent = '—';
      els.index.textContent = '—';
      els.time.textContent  = 'Retry in 5 minutes';
    } finally {
      isRefreshing = false;
      if (els.refresh) {
        els.refresh.disabled = false;
        els.refresh.classList.remove('is-refreshing');
      }
    }
  }

  if (els.refresh) {
    els.refresh.addEventListener('click', refresh);
  }

  refresh();
  setInterval(refresh, REFRESH_MS);
})();