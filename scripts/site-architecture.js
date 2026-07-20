(function () {
  const svg = document.querySelector('.site-arch-svg');
  if (!svg) return;

  const nodes = svg.querySelectorAll('.arch-node');
  const edges = svg.querySelectorAll('.arch-edges path');

  const PAGE_NODES = new Set([
    'index', 'about', 'experience', 'cad',
    'manufacturing', 'robotics', 'dissertation'
  ]);

  const PAGE_LINKED_ASSETS = new Set(['styles', 'site-js', 'search-js', 'rrt-js']);

  const PAGE_Y = {
    'index':          81,
    'about':         133,
    'experience':    185,
    'cad':           237,
    'manufacturing': 289,
    'robotics':      341,
    'dissertation':  393
  };

  const ASSET_Y = {
    'styles':    103,
    'site-js':   179,
    'search-js': 255,
    'rrt-js':    331
  };

  const DEFAULT_PAGE = 'robotics';
  let lockedNode = DEFAULT_PAGE;

  const flowOut = svg.querySelector('#arch-flow-1');
  const flowRet = svg.querySelector('#arch-flow-4');

  function redrawPageEdges(srcY) {
    edges.forEach(function (edge) {
      if (edge.dataset.from !== 'pages') return;
      const tgtY = ASSET_Y[edge.dataset.to];
      if (tgtY === undefined) return;
      edge.setAttribute(
        'd',
        'M220,' + srcY + ' C280,' + srcY + ' 300,' + tgtY + ' 360,' + tgtY
      );
    });
  }

  function redrawPulsePaths(srcY) {
    const searchY = ASSET_Y['search-js'];
    if (flowOut) {
      flowOut.setAttribute(
        'd',
        'M220,' + srcY + ' C300,' + srcY + ' 320,' + searchY + ' 360,' + searchY
      );
    }
    if (flowRet) {
      flowRet.setAttribute(
        'd',
        'M360,' + searchY + ' C300,' + searchY + ' 260,' + srcY + ' 220,' + srcY
      );
    }
  }

  function highlight(nodeId) {
    svg.classList.add('is-highlighting');
    const connectedNodes = new Set([nodeId]);
    const isPage = PAGE_NODES.has(nodeId);

    if (isPage) {
      redrawPageEdges(PAGE_Y[nodeId]);
      redrawPulsePaths(PAGE_Y[nodeId]);
    }

    edges.forEach(function (edge) {
      const from = edge.dataset.from;
      const to   = edge.dataset.to;
      let hit;

      if (from === 'pages') {
        hit = isPage;
        if (hit) connectedNodes.add(to);
      } else if (isPage && PAGE_LINKED_ASSETS.has(from)) {
        hit = true;
        connectedNodes.add(from);
        connectedNodes.add(to);
      } else {
        hit = from === nodeId || to === nodeId;
        if (hit) {
          connectedNodes.add(from);
          connectedNodes.add(to);
        }
      }

      edge.classList.toggle('is-active', hit);
      edge.classList.toggle('is-dimmed', !hit);
    });

    nodes.forEach(function (n) {
      const id = n.dataset.node;
      const active = connectedNodes.has(id);
      const locked = id === lockedNode;
      n.classList.toggle('is-active', active);
      n.classList.toggle('is-dimmed', !active);
      n.classList.toggle('is-locked', locked);
    });
  }

  function showLocked() {
    highlight(lockedNode);
  }

  nodes.forEach(function (node) {
    node.addEventListener('mouseenter', function () { highlight(node.dataset.node); });
    node.addEventListener('mouseleave', showLocked);

    node.addEventListener('click', function () {
      const id = node.dataset.node;
      // Click the currently-locked node to release it back to default
      lockedNode = (id === lockedNode) ? DEFAULT_PAGE : id;
      showLocked();
      node.blur(); // prevent stuck focus outline after click
    });

    node.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        const id = node.dataset.node;
        lockedNode = (id === lockedNode) ? DEFAULT_PAGE : id;
        showLocked();
      }
    });

    node.addEventListener('focusin',  function () { highlight(node.dataset.node); });
    node.addEventListener('focusout', showLocked);
  });

  showLocked();
})();