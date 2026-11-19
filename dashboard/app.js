
(function () {
  'use strict';
  var DATA = window.RADAR;
  if (!DATA) {
    var placeholder = document.getElementById('board');
    if (placeholder) {
      placeholder.innerHTML = '<div style="padding:2rem;color:#f87171;font-family:sans-serif">Radar data not loaded. Expected window.RADAR from data.js.</div>';
    }
    return;
  }
  var app = document.getElementById('board');
  var state = {
    q: '',
    category: 'all',
    chain: 'all',
    minTvl: 0,
    watchlistOnly: false,
    tab: 'pre-token', // 'pre-token' | 'live'
    sort: 'rank',     // 'rank' | 'name' | 'tvl' | 'growth' | 'multiple' | 'implied' | 'age'
    dir: 1,           // 1 = asc, -1 = desc
    selected: null,   // slug string or null
  };
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n).toLocaleString('en-US');
  }
  function fmtUsdExact(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return '$' + Math.round(n).toLocaleString('en-US');
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n >= 0 ? '+' : '') + n.toFixed(1) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'untracked';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      var keys = Object.keys(attrs);
      for (var k = 0; k < keys.length; k++) {
        var key = keys[k];
        var val = attrs[key];
        if (key === 'class') node.className = val;
        else if (key === 'text') node.textContent = val;
        else if (key === 'html') node.innerHTML = val;
        else if (key.slice(0, 2) === 'on') node.addEventListener(key.slice(2), val);
        else if (val !== null && val !== undefined) node.setAttribute(key, val);
      }
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) {
        for (var c = 0; c < child.length; c++) {
          if (child[c]) node.appendChild(child[c]);
        }
      } else if (typeof child === 'string') {
        node.appendChild(document.createTextNode(child));
      } else {
        node.appendChild(child);
      }
    }
    return node;
  }
  function parseHash() {
    var raw = window.location.hash.replace(/^#/, '');
    state.selected = null;
    state.category = 'all';
    state.chain = 'all';
    state.minTvl = 0;
    state.watchlistOnly = false;
    state.tab = 'pre-token';
    state.q = '';
    if (!raw || raw === 'board') return;
    var pairs = raw.split('&');
    for (var i = 0; i < pairs.length; i++) {
      var pair = pairs[i].split('=');
      var key = decodeURIComponent(pair[0]);
      var val = pair[1] ? decodeURIComponent(pair[1]) : '';
      if (key === 'detail' || key === 'p') {
        state.selected = val || null;
      } else if (key === 'filter' || key === 'category') {
        state.category = val || 'all';
      } else if (key === 'chain') {
        state.chain = val || 'all';
      } else if (key === 'q') {
        state.q = val || '';
      } else if (key === 'watchlist') {
        state.watchlistOnly = val === '1' || val === 'true';
      } else if (key === 'tab') {
        state.tab = val === 'live' ? 'live' : 'pre-token';
      }
    }
  }
  function updateHash() {
    var parts = [];
    if (state.selected) parts.push('detail=' + encodeURIComponent(state.selected));
    if (state.category !== 'all') parts.push('filter=' + encodeURIComponent(state.category));
    if (state.chain !== 'all') parts.push('chain=' + encodeURIComponent(state.chain));
    if (state.q) parts.push('q=' + encodeURIComponent(state.q));
    if (state.watchlistOnly) parts.push('watchlist=1');
    if (state.tab !== 'pre-token') parts.push('tab=' + encodeURIComponent(state.tab));
    var next = parts.join('&');
    if (next) {
      window.history.replaceState(null, '', '#' + next);
    } else {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }
  }
  function filterRows() {
    var q = state.q.trim().toLowerCase();
    var minTvl = state.minTvl;
    return DATA.rows.filter(function (r) {
      if (state.watchlistOnly && !r.is_watchlist) return false;
      if (state.category !== 'all' && (r.category || 'Uncategorized') !== state.category) return false;
      if (state.chain !== 'all' && (!r.chains || r.chains.indexOf(state.chain) === -1)) return false;
      if (r.tvl_usd < minTvl) return false;
      if (!q) return true;
      var hay = [
        r.name,
        r.slug,
        r.category || '',
        (r.chains || []).join(' ')
      ].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortRows(list) {
    var key = state.sort;
    var dir = state.dir;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'rank') {
        av = a.rank; bv = b.rank;
      } else if (key === 'name') {
        av = a.name.toLowerCase(); bv = b.name.toLowerCase();
      } else if (key === 'tvl') {
        av = a.tvl_usd; bv = b.tvl_usd;
      } else if (key === 'growth') {
        av = a.change_7d === null ? -Infinity : a.change_7d;
        bv = b.change_7d === null ? -Infinity : b.change_7d;
      } else if (key === 'multiple') {
        av = a.peer_multiple; bv = b.peer_multiple;
      } else if (key === 'conviction') {
        av = a.conviction_score || 0; bv = b.conviction_score || 0;
      } else if (key === 'age') {
        av = a.age_days === null ? -1 : a.age_days;
        bv = b.age_days === null ? -1 : b.age_days;
      } else {
        av = a.implied_value_usd; bv = b.implied_value_usd;
      }
      if (av < bv) return -dir;
      if (av > bv) return dir;
      if (a.tvl_usd !== b.tvl_usd) return b.tvl_usd - a.tvl_usd;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }
  function renderHeader() {
    return el('header', { class: 'radar-header' },
      el('div', { class: 'brand-container' },
        el('div', { class: 'radar-pulse-icon', 'aria-hidden': 'true' },
          el('div', { class: 'radar-pulse-ring' }),
          el('div', { class: 'radar-pulse-dot' })
        ),
        el('div', { class: 'brand-titles' },
          el('h1', { class: 'brand-title', text: 'TOKEN RADAR' }),
          el('span', { class: 'brand-subtitle', text: 'Pre-Token Valuation & Opportunity Screen' })
        )
      ),
      el('div', { class: 'header-meta' },
        el('div', { class: 'meta-pill' },
          el('span', { class: 'meta-label', text: 'Snapshot As-Of' }),
          el('b', { class: 'meta-val', text: DATA.as_of })
        ),
        el('div', { class: 'meta-pill' },
          el('span', { class: 'meta-label', text: 'Pre-Token Universe' }),
          el('b', { class: 'meta-val', text: DATA.board_size + ' Protocols' })
        ),
        el('div', { class: 'meta-pill' },
          el('span', { class: 'meta-label', text: 'Watchlist Floor' }),
          el('b', { class: 'meta-val', text: fmtUsd(DATA.floor_usd) })
        )
      )
    );
  }
  function renderLede() {
    return el('section', { class: 'radar-summary' },
      el('div', { class: 'summary-text' },
        el('h2', { class: 'summary-heading', text: DATA.watchlist_size + ' Watchlist Protocols, Ranked by Implied Value' }),
        el('p', { class: 'summary-desc', text: 'All ' + DATA.board_size + ' protocols recording no token are ranked by dynamic implied market valuation. Implied value derives from snapshot figures (category peer medians with empirical Bayesian shrinkage, 7-day TVL momentum, protocol longevity, and multi-chain breadth).' })
      ),
      el('div', { class: 'stats-grid' },
        [
          ['Watchlist Coverage', DATA.watchlist_size + ' / ' + DATA.watchlist_size, '100% floor coverage', 'accent'],
          ['Pre-Token Scored', String(DATA.board_size), 'Records no token', ''],
          ['Global Peer Multiple', DATA.global_median_multiple.toFixed(3) + 'x', 'Median tokenized mcap/TVL', 'accent'],
          ['Live Token Peers', String(DATA.live_size), 'Trading peers set aside', '']
        ].map(function (s) {
          return el('div', { class: 'stat-card' },
            el('span', { class: 'stat-label', text: s[0] }),
            el('b', { class: 'stat-value ' + s[3], text: s[1] }),
            el('span', { class: 'stat-note', text: s[2] })
          );
        })
      )
    );
  }
  function renderControls() {
    var catSet = {};
    for (var i = 0; i < DATA.rows.length; i++) {
      catSet[DATA.rows[i].category || 'Uncategorized'] = true;
    }
    var categories = Object.keys(catSet).sort();
    var chainSet = {};
    for (var j = 0; j < DATA.rows.length; j++) {
      var chains = DATA.rows[j].chains || [];
      for (var c = 0; c < chains.length; c++) {
        chainSet[chains[c]] = true;
      }
    }
    var chainList = Object.keys(chainSet).sort();
    var searchInput = el('input', {
      type: 'search',
      id: 'search-input',
      class: 'search-box',
      placeholder: 'Search by protocol name, slug, category, or chain...',
      value: state.q,
      'aria-label': 'Search protocol board'
    });
    searchInput.addEventListener('input', function () {
      state.q = searchInput.value;
      updateHash();
      renderApp();
    });
    var catSelect = el('select', { id: 'category-select', class: 'select-box', 'aria-label': 'Filter by Category' },
      el('option', { value: 'all', text: 'All Categories (' + categories.length + ')' }),
      categories.map(function (c) {
        return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null });
      })
    );
    catSelect.addEventListener('change', function () {
      state.category = catSelect.value;
      updateHash();
      renderApp();
    });
    var chainSelect = el('select', { id: 'chain-select', class: 'select-box', 'aria-label': 'Filter by Chain' },
      el('option', { value: 'all', text: 'All Chains (' + chainList.length + ')' }),
      chainList.map(function (ch) {
        return el('option', { value: ch, text: ch, selected: ch === state.chain ? 'selected' : null });
      })
    );
    chainSelect.addEventListener('change', function () {
      state.chain = chainSelect.value;
      updateHash();
      renderApp();
    });
    var minTvlSelect = el('select', { id: 'tvl-select', class: 'select-box', 'aria-label': 'Minimum TVL' },
      [['0', 'Any TVL ($5M+)'], ['10000000', 'Min $10M TVL'], ['50000000', 'Min $50M TVL (Watchlist Floor)'], ['100000000', 'Min $100M TVL'], ['500000000', 'Min $500M TVL'], ['1000000000', 'Min $1B TVL']].map(function (o) {
        return el('option', { value: o[0], text: o[1], selected: Number(o[0]) === state.minTvl ? 'selected' : null });
      })
    );
    minTvlSelect.addEventListener('change', function () {
      state.minTvl = Number(minTvlSelect.value) || 0;
      updateHash();
      renderApp();
    });
    var watchlistBtn = el('button', {
      type: 'button',
      class: 'btn-toggle' + (state.watchlistOnly ? ' active' : ''),
      'aria-pressed': state.watchlistOnly ? 'true' : 'false',
      onclick: function () {
        state.watchlistOnly = !state.watchlistOnly;
        updateHash();
        renderApp();
      }
    }, el('span', { class: 'toggle-indicator' }), 'Watchlist Only (≥$50M)');
    var tabPre = el('button', {
      type: 'button',
      class: 'tab-btn' + (state.tab === 'pre-token' ? ' active' : ''),
      'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false',
      text: 'Pre-Token Radar (' + DATA.board_size + ')',
      onclick: function () {
        state.tab = 'pre-token';
        updateHash();
        renderApp();
      }
    });
    var tabLive = el('button', {
      type: 'button',
      class: 'tab-btn' + (state.tab === 'live' ? ' active' : ''),
      'aria-pressed': state.tab === 'live' ? 'true' : 'false',
      text: 'Live Token Peers (' + DATA.live_size + ')',
      onclick: function () {
        state.tab = 'live';
        updateHash();
        renderApp();
      }
    });
    var activeCount = filterRows().length;
    return el('div', { class: 'radar-controls' },
      el('div', { class: 'controls-row tabs-row' },
        el('div', { class: 'tab-group' }, tabPre, tabLive),
        el('div', { class: 'results-badge' },
          state.tab === 'pre-token'
            ? 'Showing ' + activeCount + ' of ' + DATA.board_size + ' protocols'
            : DATA.live_size + ' live token benchmark protocols'
        )
      ),
      state.tab === 'pre-token'
        ? el('div', { class: 'controls-row filters-row' },
            el('div', { class: 'filter-field search-field' },
              el('label', { for: 'search-input', text: 'Search' }),
              searchInput
            ),
            el('div', { class: 'filter-field' },
              el('label', { for: 'category-select', text: 'Category' }),
              catSelect
            ),
            el('div', { class: 'filter-field' },
              el('label', { for: 'chain-select', text: 'Chain' }),
              chainSelect
            ),
            el('div', { class: 'filter-field' },
              el('label', { for: 'tvl-select', text: 'TVL Filter' }),
              minTvlSelect
            ),
            el('div', { class: 'filter-field toggle-field' },
              watchlistBtn
            )
          )
        : null
    );
  }
  function sortHeader(key, label, isNumeric) {
    var isActive = state.sort === key;
    var arrow = isActive ? (state.dir === 1 ? ' ↑' : ' ↓') : '';
    return el('th', {
      scope: 'col',
      class: 'sortable-col' + (isNumeric ? ' num-col' : '') + (isActive ? ' active-sort' : ''),
      onclick: function () {
        if (state.sort === key) {
          state.dir = -state.dir;
        } else {
          state.sort = key;
          state.dir = (key === 'rank' || key === 'name') ? 1 : -1;
        }
        renderApp();
      }
    },
      el('button', { type: 'button', class: 'sort-btn' },
        label,
        el('span', { class: 'sort-arrow', 'aria-hidden': 'true', text: arrow })
      )
    );
  }
  function renderTopMoversStrip() {
    var top50 = DATA.rows.filter(function (r) {
      return r.rank <= 50 && r.change_7d !== null;
    });
    top50.sort(function (a, b) { return b.change_7d - a.change_7d; });
    var top5 = top50.slice(0, 5);
    var cards = top5.map(function (r) {
      var deltaClass = r.change_7d >= 0 ? 'pos-change' : 'neg-change';
      return el('button', {
        type: 'button',
        class: 'top-mover-card',
        onclick: function () { openDetail(r.slug); },
        title: 'View ' + r.name + ' detail'
      },
        el('span', { class: 'mover-rank', text: '#' + r.rank }),
        el('span', { class: 'mover-name', text: r.name }),
        el('span', { class: 'mover-delta ' + deltaClass, text: fmtPct(r.change_7d) })
      );
    });
    return el('div', { class: 'top-movers-strip' },
      el('span', { class: 'top-movers-label', text: 'Top 7d Movers (Top 50):' }),
      el('div', { class: 'top-movers-items' }, cards)
    );
  }
  function renderBoardTable() {
    var filtered = filterRows();
    var list = sortRows(filtered);
    if (list.length === 0) {
      return el('div', { class: 'empty-panel' },
        el('h3', { text: 'No matching protocols found' }),
        el('p', { text: 'No pre-token protocol matches the current search and filter combination.' }),
        el('button', {
          type: 'button',
          class: 'btn-reset',
          text: 'Reset All Filters',
          onclick: function () {
            state.q = '';
            state.category = 'all';
            state.chain = 'all';
            state.minTvl = 0;
            state.watchlistOnly = false;
            updateHash();
            renderApp();
          }
        })
      );
    }
    var tbody = el('tbody');
    var maxImplied = list[0] ? list[0].implied_value_usd : 1;
    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      var isTop10 = r.rank <= 10;
      var growthClass = r.change_7d === null ? '' : (r.change_7d >= 0 ? 'pos-change' : 'neg-change');
      var growthText = fmtPct(r.change_7d);
      var rankBadgeClass = isTop10 ? 'rank-badge top-10' : 'rank-badge';
      var chainsSnippet = r.chains && r.chains.length > 0
        ? (r.chains.length <= 2 ? r.chains.join(', ') : r.chains.slice(0, 2).join(', ') + ' +' + (r.chains.length - 2))
        : 'Primary';
      var rowEl = el('tr', {
        class: 'table-row' + (state.selected === r.slug ? ' selected-row' : ''),
        tabindex: '0',
        'data-slug': r.slug,
        onclick: (function (slug) {
          return function () { openDetail(slug); };
        })(r.slug),
        onkeydown: (function (slug) {
          return function (e) {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              openDetail(slug);
            }
          };
        })(r.slug)
      },
        el('td', { class: 'num-col rank-cell' },
          el('span', { class: rankBadgeClass, text: '#' + r.rank })
        ),
        el('td', { class: 'protocol-cell' },
          el('div', { class: 'protocol-info' },
            el('div', { class: 'protocol-main' },
              el('span', { class: 'protocol-name', text: r.name }),
              r.is_watchlist ? el('span', { class: 'watchlist-badge', text: 'Watchlist' }) : null,
              r.is_long_shot ? el('span', { class: 'longshot-badge', text: 'LONG SHOT', title: r.long_shot_reason || 'Long shot protocol' }) : null,
              r.is_outlier ? el('span', { class: 'outlier-badge', text: 'OUTLIER', title: r.outlier_reason || 'Category concentration outlier' }) : null
            ),
            el('span', { class: 'protocol-slug', text: r.slug })
          )
        ),
        el('td', { class: 'category-cell' },
          el('span', { class: 'category-tag', text: r.category || 'Uncategorized' })
        ),
        el('td', { class: 'chains-cell' },
          el('span', { class: 'chains-snippet', text: chainsSnippet, title: (r.chains || []).join(', ') })
        ),
        el('td', { class: 'num-col tvl-cell' },
          el('span', { class: 'val-mono', text: fmtUsd(r.tvl_usd) })
        ),
        el('td', { class: 'num-col growth-cell ' + growthClass },
          el('span', { class: 'val-mono', text: growthText })
        ),
        el('td', { class: 'num-col multiple-cell' },
          el('div', { class: 'multiple-stack' },
            el('span', { class: 'val-mono accent-subtle', text: r.peer_multiple.toFixed(2) + 'x' }),
            el('span', { class: 'dispersion-tag', text: 'IQR ' + (r.peer_dispersion !== undefined ? r.peer_dispersion.toFixed(2) : '0.00'), title: 'Peer cohort dispersion (IQR)' })
          )
        ),
        el('td', { class: 'num-col conviction-cell' },
          el('div', { class: 'conviction-container' },
            el('span', { class: 'conviction-badge ' + (r.conviction_score >= 70 ? 'conv-high' : (r.conviction_score >= 45 ? 'conv-med' : 'conv-low')), text: String(r.conviction_score || 50) }),
            el('span', { class: 'conviction-sub', text: '/100' })
          )
        ),
        el('td', { class: 'num-col implied-cell' },
          el('div', { class: 'implied-container' },
            el('span', { class: 'val-mono accent-bright implied-num', text: fmtUsd(r.implied_value_usd) }),
            el('div', { class: 'implied-bar-bg', 'aria-hidden': 'true' },
              el('div', {
                class: 'implied-bar-fill',
                style: 'width:' + Math.max(4, Math.round((r.implied_value_usd / maxImplied) * 100)) + '%'
              })
            )
          )
        )
      );
      tbody.appendChild(rowEl);
    }
    return el('div', { class: 'table-container' },
      el('table', { class: 'radar-table' },
        el('thead', null,
          el('tr', null,
            sortHeader('rank', 'Rank', true),
            sortHeader('name', 'Protocol', false),
            el('th', { scope: 'col', class: 'plain-col' }, 'Category'),
            el('th', { scope: 'col', class: 'plain-col' }, 'Chains'),
            sortHeader('tvl', 'TVL (USD)', true),
            sortHeader('growth', '7d Change', true),
            sortHeader('multiple', 'Multiple & IQR', true),
            sortHeader('conviction', 'Conviction', true),
            sortHeader('implied', 'Implied Value', true)
          )
        ),
        tbody
      )
    );
  }
  function renderLiveTable() {
    var tbody = el('tbody');
    var list = DATA.live || [];
    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      var growthClass = r.change_7d === null ? '' : (r.change_7d >= 0 ? 'pos-change' : 'neg-change');
      tbody.appendChild(el('tr', { class: 'table-row' },
        el('td', { class: 'protocol-cell' },
          el('div', { class: 'protocol-info' },
            el('span', { class: 'protocol-name', text: r.name }),
            el('span', { class: 'protocol-slug', text: r.slug })
          )
        ),
        el('td', { class: 'category-cell' },
          el('span', { class: 'category-tag', text: r.category || 'Uncategorized' })
        ),
        el('td', { class: 'num-col tvl-cell' },
          el('span', { class: 'val-mono', text: fmtUsd(r.tvl_usd) })
        ),
        el('td', { class: 'num-col growth-cell ' + growthClass },
          el('span', { class: 'val-mono', text: fmtPct(r.change_7d) })
        ),
        el('td', { class: 'num-col mcap-cell' },
          el('span', { class: 'val-mono accent-bright', text: fmtUsd(r.mcap_usd) })
        ),
        el('td', { class: 'num-col ratio-cell' },
          el('span', { class: 'val-mono', text: r.mcap_tvl_ratio !== null ? r.mcap_tvl_ratio.toFixed(3) + 'x' : 'n/a' })
        ),
        el('td', { class: 'status-cell' },
          el('span', { class: 'status-tag', text: 'Active Market' })
        )
      ));
    }
    return el('div', { class: 'table-container' },
      el('div', { class: 'live-intro-banner' },
        el('p', { text: 'Benchmark Set: Protocols with trading tokens carry observable market caps. These provide the runtime empirical valuation multiples used by the peer multiple model.' })
      ),
      el('table', { class: 'radar-table' },
        el('thead', null,
          el('tr', null,
            el('th', { scope: 'col', class: 'plain-col' }, 'Protocol'),
            el('th', { scope: 'col', class: 'plain-col' }, 'Category'),
            el('th', { scope: 'col', class: 'num-col' }, 'TVL'),
            el('th', { scope: 'col', class: 'num-col' }, '7d Change'),
            el('th', { scope: 'col', class: 'num-col' }, 'Market Cap'),
            el('th', { scope: 'col', class: 'num-col' }, 'Mcap / TVL'),
            el('th', { scope: 'col', class: 'plain-col' }, 'Market Status')
          )
        ),
        tbody
      )
    );
  }
  function renderMethodologyPanel() {
    return el('section', { class: 'methodology-section' },
      el('details', { class: 'methodology-panel', id: 'methodology-panel' },
        el('summary', { class: 'methodology-summary' },
          el('div', { class: 'methodology-summary-text' },
            el('span', { class: 'methodology-badge', text: 'Model v3 Specification' }),
            el('h2', { class: 'methodology-heading', text: 'Methodology & Model Limits' }),
            el('span', { class: 'methodology-toggle-hint', text: 'Click to expand valuation method, Bayesian shrinkage, plausibility rules & sanity layer limits ▸' })
          )
        ),
        el('div', { class: 'methodology-grid' },
          [
            ['01. Similarity-Weighted Multiples', 'Replaces crude medians with distance-weighted peer multiples: category peers are weighted by log TVL proximity (w_tvl = 1 / (1 + 0.5·ΔlogTVL)) and chain overlap Jaccard (w_chain = 1 + J). Peer ratios capped at 3.0x to eliminate outlier distortion.'],
            ['02. Bayesian Shrinkage & Caps', 'Empirical Bayes shrinkage pulls small cohorts toward category median (and global ' + DATA.global_median_multiple.toFixed(3) + 'x) via prior weighting 4. Multiples capped at 3.0x ceiling. Peer agreement measured via Interquartile Range (IQR = Q3 - Q1).'],
            ['03. Plausibility & Conviction Score', '0.10x structural factor applies to bridge protocols, CEXs, and wrapped/staked derivatives with existing token lineage. Explicit 0-100 conviction score synthesizes upside, agreement (1/(1+IQR)), 7d growth, and seasoning.'],
            ['04. Sanity Layer & Known Limits', 'Flags category concentration outliers (>45% share of multi-protocol categories). Model derives from snapshot-frozen TVL (not live order-book depth) and cannot observe off-chain private equity or tokenomic lockups.']
          ].map(function (m) {
            return el('div', { class: 'methodology-card' },
              el('h3', { class: 'methodology-card-title', text: m[0] }),
              el('p', { class: 'methodology-card-body', text: m[1] })
            );
          })
        )
      )
    );
  }
  function renderModelExplainer() {
    var catMults = DATA.category_multiples || {};
    var catEntries = Object.keys(catMults).map(function (k) {
      return { cat: k, data: catMults[k] };
    }).sort(function (a, b) {
      return b.data.multiple - a.data.multiple;
    });
    return el('section', { class: 'model-explainer-section' },
      el('div', { class: 'explainer-header' },
        el('h2', { class: 'explainer-title', text: 'How Implied Value is Derived' }),
        el('p', { class: 'explainer-subtitle', text: 'A deterministic, peer-referenced mathematical model that derives pre-token valuations purely from snapshot metrics.' })
      ),
      el('div', { class: 'explainer-grid' },
        [
          ['01', 'Similarity Multiple M(P)', 'Peers in same category weighted by log TVL distance and chain overlap Jaccard, shrunk via Bayes prior 4, capped at 3.0x ceiling.'],
          ['02', 'Base Valuation', 'Base value B = TVL × M(P). Locked capital scaled by empirical category multiples.'],
          ['03', 'Momentum Factor', '7d growth factor f_mom = clamp(1 + change_7d / 100, 0.5, 2.0). Bounded weekly delta.'],
          ['04', 'Seasoning Factor', 'Longevity factor f_age = 1 + 0.25 × min(age_days, 1460) / 1460. Up to +25% survival premium for 4-year track record.'],
          ['05', 'Chain Breadth', 'Multi-chain factor f_chain = 1 + 0.05 × min(len(chains) - 1, 6). Up to +30% at 7+ chains.'],
          ['06', 'Launch Plausibility', 'Structural factor: 0.10x for wrapped, bridged, or exchange lineage; 1.00x for primary pre-token protocols.'],
          ['07', 'Implied Valuation', 'implied = round(B × f_mom × f_age × f_chain × f_plaus) in whole USD (min $1). Deterministic runtime formula.']
        ].map(function (c) {
          return el('div', { class: 'explainer-card' },
            el('div', { class: 'step-num', text: c[0] }),
            el('h3', { text: c[1] }),
            el('p', { text: c[2] })
          );
        })
      ),
      el('div', { class: 'category-multiples-card' },
        el('h3', { class: 'cat-title', text: 'Live Category Valuation Benchmarks (Empirical Multiples & Dispersion)' }),
        el('p', { class: 'cat-intro', text: 'Derived directly from 30 live-token peers in this snapshot. Shrunk toward global median (' + DATA.global_median_multiple.toFixed(3) + 'x) via Bayesian weighting; capped at 3.0x ceiling.' }),
        el('div', { class: 'cat-table-wrap' },
          el('table', { class: 'cat-median-table' },
            el('thead', null,
              el('tr', null,
                el('th', { scope: 'col', class: 'plain-col' }, 'Category'),
                el('th', { scope: 'col', class: 'num-col' }, 'Peers (n)'),
                el('th', { scope: 'col', class: 'num-col' }, 'Category Median'),
                el('th', { scope: 'col', class: 'num-col' }, 'IQR Dispersion'),
                el('th', { scope: 'col', class: 'num-col' }, 'Effective Multiple M(P)')
              )
            ),
            el('tbody', null,
              catEntries.map(function (item) {
                return el('tr', { class: 'cat-tr' },
                  el('td', { class: 'cat-name-cell' }, item.cat),
                  el('td', { class: 'num-col' }, 'n=' + item.data.n),
                  el('td', { class: 'num-col val-mono' }, item.data.median.toFixed(3) + 'x'),
                  el('td', { class: 'num-col val-mono' }, (item.data.dispersion !== undefined ? item.data.dispersion.toFixed(3) : '0.000') + 'x'),
                  el('td', { class: 'num-col val-mono accent-bright' }, item.data.multiple.toFixed(3) + 'x' + (item.data.multiple >= 3 ? ' (cap)' : ''))
                );
              })
            )
          )
        )
      )
    );
  }
  var dialog = el('dialog', { class: 'detail-dialog', id: 'detail-modal', 'aria-labelledby': 'detail-modal-title' });
  dialog.addEventListener('close', function () {
    state.selected = null;
    updateHash();
  });
  function openDetail(slug) {
    var row = null;
    for (var i = 0; i < DATA.rows.length; i++) {
      if (DATA.rows[i].slug === slug) {
        row = DATA.rows[i];
        break;
      }
    }
    if (!row) return;
    state.selected = slug;
    updateHash();
    dialog.innerHTML = '';
    var headerEl = el('div', { class: 'modal-head' },
      el('div', { class: 'modal-title-block' },
        el('div', { class: 'modal-badges' },
          el('span', { class: 'rank-pill', text: 'Rank #' + row.rank + ' of ' + DATA.board_size }),
          row.is_watchlist ? el('span', { class: 'watchlist-pill', text: 'Watchlist Protocol' }) : null,
          row.is_long_shot ? el('span', { class: 'longshot-pill', text: 'LONG SHOT: ' + (row.long_shot_reason || 'Discounted') }) : null,
          row.is_outlier ? el('span', { class: 'outlier-pill', text: 'OUTLIER: ' + (row.outlier_reason || 'Concentration') }) : null,
          el('span', { class: 'token-status-pill', text: 'Records No Token' })
        ),
        el('h2', { id: 'detail-modal-title', class: 'modal-title', text: row.name }),
        el('div', { class: 'modal-sub', text: (row.category || 'Uncategorized') + ' • ' + (row.chains ? row.chains.join(', ') : 'Primary Chain') + ' • Listed: ' + (row.listed_at || 'Unknown') })
      ),
      el('button', {
        type: 'button',
        class: 'btn-close-modal',
        'aria-label': 'Close detail dialog',
        text: '✕',
        onclick: function () { dialog.close(); }
      })
    );
    var figuresGrid = el('div', { class: 'modal-figures-grid' },
      [
        ['Implied Valuation', fmtUsdExact(row.implied_value_usd), fmtUsd(row.implied_value_usd) + ' model total', 'accent-bright'],
        ['Total Value Locked', fmtUsdExact(row.tvl_usd), fmtUsd(row.tvl_usd) + ' on-chain', ''],
        ['7-Day TVL Change', fmtPct(row.change_7d), 'Trailing week delta', (row.change_7d !== null && row.change_7d >= 0 ? 'pos-change' : 'neg-change')],
        ['Conviction Score', (row.conviction_score || 50) + ' / 100', (row.conviction_score >= 70 ? 'High' : (row.conviction_score >= 45 ? 'Moderate' : 'Low')) + ' model conviction', (row.conviction_score >= 70 ? 'pos-change' : (row.conviction_score >= 45 ? 'accent-subtle' : 'neg-change'))],
        ['Peer Cohort Dispersion', 'IQR ' + (row.peer_dispersion !== undefined ? row.peer_dispersion.toFixed(2) : '0.00'), (row.category || 'Category') + ' multiple spread', ''],
        ['Age with No Token', fmtAge(row.age_days), (row.age_days || 0) + ' days tracked', '']
      ].map(function (fig) {
        return el('div', { class: 'fig-item' },
          el('span', { class: 'fig-lbl', text: fig[0] }),
          el('b', { class: 'fig-val ' + fig[3], text: fig[1] }),
          el('span', { class: 'fig-sub', text: fig[2] })
        );
      })
    );
    var factorItems = [
      ['Peer Multiple M(P)', 'vs 3.0x cap', row.peer_multiple.toFixed(3) + 'x', Math.min(100, Math.max(4, Math.round(row.peer_multiple / 3 * 100))), row.peer_multiple >= 3 ? 'bar-gold' : 'bar-signal'],
      ['Peer Dispersion (IQR)', (row.category || 'Category') + ' spread', (row.peer_dispersion !== undefined ? row.peer_dispersion.toFixed(2) : '0.00') + 'x', Math.min(100, Math.max(4, Math.round(100 / (1 + (row.peer_dispersion || 0))))), 'bar-signal'],
      ['Momentum Factor', fmtPct(row.change_7d), row.momentum_factor.toFixed(2) + 'x', Math.min(100, Math.max(4, Math.round((row.momentum_factor - 0.5) / 1.5 * 100))), row.momentum_factor >= 1 ? 'bar-pos' : 'bar-neg'],
      ['Seasoning Factor', fmtAge(row.age_days), row.seasoning_factor.toFixed(2) + 'x', Math.min(100, Math.max(4, Math.round(row.seasoning_factor / 1.25 * 100))), 'bar-signal'],
      ['Chain Breadth', (row.chains ? row.chains.length : 1) + ' chain(s)', row.breadth_factor.toFixed(2) + 'x', Math.min(100, Math.max(4, Math.round(row.breadth_factor / 1.3 * 100))), 'bar-signal'],
      ['Launch Plausibility', row.launch_plausibility_factor < 1 ? 'discounted long shot' : 'full plausibility', row.launch_plausibility_factor.toFixed(2) + 'x', Math.min(100, Math.max(4, Math.round(row.launch_plausibility_factor * 100))), row.launch_plausibility_factor < 1 ? 'bar-neg' : 'bar-signal']
    ];
    var factorBarsEl = el('div', { class: 'factor-bars-wrap' },
      factorItems.map(function (f) {
        return el('div', { class: 'factor-bar-row' },
          el('div', { class: 'factor-bar-meta' },
            el('span', { class: 'factor-bar-title', text: f[0] }),
            el('span', { class: 'factor-bar-sub', text: f[1] }),
            el('span', { class: 'factor-bar-num val-mono', text: f[2] })
          ),
          el('div', { class: 'factor-track' },
            el('div', { class: 'factor-fill ' + f[4], style: 'width:' + f[3] + '%' })
          )
        );
      })
    );
    var modelCard = el('div', { class: 'modal-section' },
      el('h3', { class: 'section-title', text: 'Why this rank: Factor Breakdown' }),
      factorBarsEl,
      el('div', { class: 'breakdown-box' },
        [
          ['Peer Multiple M(P)', row.peer_multiple.toFixed(3) + 'x', (row.category || 'Category') + ' median (' + row.category_median.toFixed(3) + 'x, n=' + row.category_peers_count + ') with distance weighting & Bayes shrinkage' + (row.peer_multiple >= 3 ? ' [Capped at 3.0x max ceiling]' : ''), 'accent-bright'],
          ['Cohort Dispersion (IQR)', (row.peer_dispersion !== undefined ? row.peer_dispersion.toFixed(3) : '0.000') + 'x', 'Interquartile range of category peers (Q3 - Q1)', ''],
          ['Conviction Score', (row.conviction_score || 50) + ' / 100', 'Synthesizes peer multiple, agreement (1/(1+IQR)), 7d growth, and seasoning', (row.conviction_score >= 70 ? 'accent-bright' : '')],
          ['Base Value (TVL × M)', fmtUsd(row.tvl_usd * row.peer_multiple), fmtUsd(row.tvl_usd) + ' TVL × ' + row.peer_multiple.toFixed(3) + 'x', ''],
          ['Momentum Factor (f_mom)', row.momentum_factor.toFixed(2) + 'x', 'Clamped factor from 7d change ' + fmtPct(row.change_7d), ''],
          ['Seasoning Factor (f_age)', row.seasoning_factor.toFixed(2) + 'x', 'Longevity multiplier from ' + (row.age_days || 0) + ' days seasoning', ''],
          ['Chain Breadth Factor (f_chain)', row.breadth_factor.toFixed(2) + 'x', (row.chains ? row.chains.length : 1) + ' active deployment chain(s)', ''],
          ['Launch Plausibility (f_plaus)', row.launch_plausibility_factor.toFixed(2) + 'x', row.launch_plausibility_factor < 1 ? '0.10x long-shot factor (' + (row.long_shot_reason || 'discounted lineage') + ')' : '1.00x full plausibility (primary pre-token protocol)', row.launch_plausibility_factor < 1 ? 'neg-change' : 'accent-bright']
        ].map(function (b) {
          return el('div', { class: 'breakdown-row' },
            el('span', { class: 'br-name', text: b[0] }),
            el('span', { class: 'br-val val-mono ' + b[3], text: b[1] }),
            el('span', { class: 'br-desc', text: b[2] })
          );
        }),
        row.is_long_shot ? el('div', { class: 'longshot-reason-callout' },
          el('b', { text: 'LONG SHOT Rationale: ' }),
          row.long_shot_reason
        ) : null,
        row.is_outlier ? el('div', { class: 'outlier-reason-callout' },
          el('b', { text: 'Sanity Layer Alert: ' }),
          row.outlier_reason
        ) : null,
        el('div', { class: 'model-note-callout' },
          el('span', { class: 'note-tag', text: 'Model Summary:' }),
          el('span', { class: 'note-text', text: row.model_note })
        )
      )
    );
    var farmSteps = row.farm_steps || [];
    var stepsList = el('div', { class: 'farm-steps-container' });
    for (var s = 0; s < farmSteps.length; s++) {
      var stepStr = farmSteps[s];
      var costIdx = stepStr.indexOf('Cost: ');
      var timeIdx = stepStr.indexOf('Time: ');
      var actionPart = stepStr;
      var costPart = '';
      var timePart = '';
      if (costIdx >= 0 && timeIdx > costIdx) {
        actionPart = stepStr.slice(0, costIdx).trim();
        costPart = stepStr.slice(costIdx + 6, timeIdx).trim().replace(/\.$/, '');
        timePart = stepStr.slice(timeIdx + 6).trim().replace(/\.$/, '');
      } else if (costIdx >= 0) {
        actionPart = stepStr.slice(0, costIdx).trim();
        costPart = stepStr.slice(costIdx + 6).trim().replace(/\.$/, '');
      }
      var stepCard = el('div', { class: 'step-card' },
        el('div', { class: 'step-badge-col' },
          el('span', { class: 'step-circle', text: String(s + 1) })
        ),
        el('div', { class: 'step-content-col' },
          el('p', { class: 'step-action-text', text: actionPart }),
          el('div', { class: 'step-meta-pills' },
            costPart ? el('span', { class: 'pill-cost' }, el('b', { text: 'Cost: ' }), costPart) : null,
            timePart ? el('span', { class: 'pill-time' }, el('b', { text: 'Time: ' }), timePart) : null
          )
        )
      );
      stepsList.appendChild(stepCard);
    }
    var farmCard = el('div', { class: 'modal-section' },
      el('h3', { class: 'section-title', text: 'Concrete Farm Playbook' }),
      el('p', { class: 'section-desc', text: 'Tactical multi-step operational guide tailored to ' + row.name + '\'s specific smart contracts, capital tier, and chain infrastructure.' }),
      stepsList
    );
    dialog.appendChild(headerEl);
    dialog.appendChild(figuresGrid);
    dialog.appendChild(modelCard);
    dialog.appendChild(farmCard);
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }
  function renderApp() {
    app.innerHTML = '';
    var container = el('div', { class: 'radar-shell' },
      renderHeader(),
      renderLede(),
      renderControls(),
      state.tab === 'pre-token' ? renderTopMoversStrip() : null,
      state.tab === 'pre-token' ? renderMethodologyPanel() : null,
      state.tab === 'pre-token' ? renderBoardTable() : renderLiveTable(),
      state.tab === 'pre-token' ? renderModelExplainer() : null
    );
    app.appendChild(container);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) {
      document.body.appendChild(dialog);
    }
    if (state.selected) {
      openDetail(state.selected);
    } else if (dialog.open) {
      dialog.close();
    }
  }
  parseHash();
  renderApp();
  window.addEventListener('hashchange', function () {
    parseHash();
    renderApp();
  });
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) {
      dialog.close();
    }
  });
})();
