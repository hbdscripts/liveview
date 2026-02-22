(function () {
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function fmtGbp(n) {
    var x = n != null ? Number(n) : NaN;
    if (!Number.isFinite(x)) return '\u2014';
    return '\u00A3' + x.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  var state = { range: '30d' };
  var rangeLabels = { today: 'Today', yesterday: 'Yesterday', '7d': 'Last 7 days', '14d': 'Last 14 days', '30d': 'Last 30 days' };

  function getShopParam() {
    try {
      var p = new URLSearchParams(window.location.search);
      return (p.get('shop') || '').trim();
    } catch (_) { return ''; }
  }

  function renderTable(bodyId, rows) {
    var tbody = document.getElementById(bodyId);
    if (!tbody) return;
    if (!Array.isArray(rows) || !rows.length) {
      tbody.innerHTML = '<tr><td colspan="4" class="text-muted text-center">No data</td></tr>';
      return;
    }
    var html = '';
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var title = (r && r.title != null) ? String(r.title) : (r && r.product_id != null ? r.product_id : '—');
      var revenue = (r && r.revenue_gbp != null) ? Number(r.revenue_gbp) : 0;
      var cost = (r && r.cost_gbp != null) ? Number(r.cost_gbp) : 0;
      var profit = (r && r.gross_profit_gbp != null) ? Number(r.gross_profit_gbp) : (revenue - cost);
      html += '<tr>' +
        '<td>' + esc(title) + '</td>' +
        '<td class="text-end">' + esc(fmtGbp(revenue)) + '</td>' +
        '<td class="text-end">' + esc(fmtGbp(cost)) + '</td>' +
        '<td class="text-end">' + esc(fmtGbp(profit)) + '</td>' +
        '</tr>';
    }
    tbody.innerHTML = html;
  }

  function setLoading(loading) {
    var el = document.getElementById('performance-loading');
    var err = document.getElementById('performance-error');
    var content = document.getElementById('performance-content');
    if (el) el.classList.toggle('is-hidden', !loading);
    if (err) err.classList.add('is-hidden');
    if (content) content.classList.toggle('is-hidden', loading);
  }

  function setError(msg) {
    var el = document.getElementById('performance-error');
    if (el) {
      el.textContent = msg || 'Failed to load data.';
      el.classList.remove('is-hidden');
    }
    setLoading(false);
  }

  function fetchData() {
    setLoading(true);
    var range = state.range || '30d';
    var shop = getShopParam();
    var url = '/api/performance/gross-profit?range=' + encodeURIComponent(range);
    if (shop) url += '&shop=' + encodeURIComponent(shop);

    fetch(url, { credentials: 'same-origin', cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        setLoading(false);
        if (!data || !data.ok) {
          setError(data && data.error ? data.error : 'Request failed');
          return;
        }
        document.getElementById('performance-error').classList.add('is-hidden');
        document.getElementById('performance-content').classList.remove('is-hidden');
        renderTable('performance-high-body', data.high || []);
        renderTable('performance-low-body', data.low || []);
      })
      .catch(function () {
        setError('Request failed');
      });
  }

  function bind() {
    var rangeBtn = document.getElementById('performance-range-btn');
    var rangeLabel = document.getElementById('performance-range-label');
    var menu = document.getElementById('performance-range-menu');
    if (menu) {
      menu.addEventListener('click', function (e) {
        var item = e.target && e.target.closest ? e.target.closest('[data-range]') : null;
        if (!item || !item.dataset.range) return;
        state.range = item.dataset.range;
        if (rangeLabel) rangeLabel.textContent = rangeLabels[state.range] || state.range;
        menu.querySelectorAll('.dropdown-item').forEach(function (el) {
          el.classList.toggle('active', el.dataset.range === state.range);
        });
        fetchData();
      });
    }
    if (rangeLabel) rangeLabel.textContent = rangeLabels[state.range] || state.range;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      bind();
      fetchData();
    });
  } else {
    bind();
    fetchData();
  }
})();
