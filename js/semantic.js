/* Chapter 7: semantic layers and cost. One metric definition for every tool; paying to precompute vs paying per query. */
(function () {
  'use strict';
  const { $, h } = DE;

  // ---------- part A: metric consistency ----------
  const ORDERS = [
    { id: 1, gross: 120, tax: 10, refunded: false, test: false },
    { id: 2, gross: 64, tax: 5, refunded: false, test: false },
    { id: 3, gross: 250, tax: 20, refunded: true, test: false },
    { id: 4, gross: 33, tax: 3, refunded: false, test: false },
    { id: 5, gross: 999, tax: 80, refunded: false, test: true },
    { id: 6, gross: 88, tax: 7, refunded: false, test: false },
    { id: 7, gross: 45, tax: 4, refunded: true, test: false },
    { id: 8, gross: 150, tax: 12, refunded: false, test: false },
  ];
  const TOOLS = [
    { name: 'Finance dashboard', def: { tax: true, refunds: true, test: true } },
    { name: 'Sales dashboard', def: { tax: false, refunds: false, test: true } },
    { name: 'Data science notebook', def: { tax: true, refunds: true, test: false } },
  ];
  const shared = { tax: true, refunds: true, test: true };
  let layer = false;

  const revenue = (d) => ORDERS.filter((o) => !(d.refunds && o.refunded) && !(d.test && o.test))
    .reduce((s, o) => s + o.gross - (d.tax ? o.tax : 0), 0);
  const describe = (d) => [d.tax ? 'net of tax' : 'including tax', d.refunds ? 'minus refunds' : 'refunds counted', d.test ? 'no test orders' : 'test orders included'].join(', ');

  function renderMetrics() {
    const vals = TOOLS.map((t) => revenue(layer ? shared : t.def));
    const agree = vals.every((v) => v === vals[0]);
    $('s7-tools').replaceChildren(...TOOLS.map((t, i) => h('div.stat.tool',
      h('span.stat-label', t.name),
      h('span.stat-value', { class: agree ? 'good-text' : 'bad-text' }, DE.money(vals[i])),
      h('span.stat-note', layer ? 'revenue from the semantic layer' : describe(t.def)))));
    const msg = $('s7-msg');
    msg.className = `msg ${agree ? 'good' : 'bad'}`;
    msg.textContent = agree
      ? 'Every tool asks the semantic layer for "revenue" and gets the same number. Change the definition once and all of them follow.'
      : `Three tools, three "revenue" numbers, ${DE.money(Math.max(...vals) - Math.min(...vals))} apart. Each team wrote its own SQL, and the Monday meeting is about whose is right.`;
    $('s7-def').hidden = !layer;
    $('s7-yaml').textContent = `metrics:
  - name: revenue
    description: ${describe(shared)}
    model: fct_orders
    expr: SUM(gross_amount${shared.tax ? ' - tax_amount' : ''})
    filters:${shared.refunds ? '\n      - is_refunded = false' : ''}${shared.test ? '\n      - is_test_order = false' : ''}${!shared.refunds && !shared.test ? ' []' : ''}`;
  }

  // ---------- part B: precompute or scan ----------
  const PRICE_TB = 5;          // dollars per TB scanned (illustrative on-demand pricing)
  const AGG_SHARE = 0.001;     // the aggregate is 0.1% the size of the table
  const GROWTH = 0.02;         // 2% new data per day
  let sizeLog = 3, qpd = 200, refreshes = 24, incremental = true;

  const fmtGB = (g) => (g < 1 ? `${Math.round(g * 1024)} MB` : g < 1024 ? `${Math.round(g)} GB` : `${(g / 1024).toFixed(1)} TB`);
  const dollars = (v) => (v < 10 ? `$${v.toFixed(2)}` : `$${DE.int(v)}`);

  function renderCost() {
    const size = Math.pow(10, sizeLog);    // GB
    const onDemand = (qpd * size / 1024) * PRICE_TB;
    const refreshScan = incremental ? size * GROWTH : size * refreshes;
    const mv = ((refreshScan + qpd * size * AGG_SHARE) / 1024) * PRICE_TB;
    $('s7-size-out').textContent = fmtGB(size);
    DE.stat('s7-od', dollars(onDemand), onDemand > mv ? 'bad-text' : 'good-text');
    DE.stat('s7-mv', dollars(mv), mv > onDemand ? 'bad-text' : 'good-text');
    DE.stat('s7-ratio', onDemand > mv ? `${(onDemand / Math.max(mv, 0.001)).toFixed(0)}× cheaper` : `${(mv / Math.max(onDemand, 0.001)).toFixed(1)}× dearer`, onDemand > mv ? 'good-text' : 'bad-text');
    const max = Math.max(onDemand, mv);
    $('s7-bars').replaceChildren(
      h('div.bar', h('span.bl', 'Scan every time'), h('span.track', h('span.fill', { class: onDemand > mv ? 'hot' : null, style: `width:${(onDemand / max) * 100}%` })), h('span.bv', dollars(onDemand))),
      h('div.bar', h('span.bl', 'Materialized'), h('span.track', h('span.fill', { class: mv > onDemand ? 'hot' : null, style: `width:${(mv / max) * 100}%` })), h('span.bv', dollars(mv))));
  }

  function init() {
    ['tax', 'refunds', 'test'].forEach((k) => $(`s7-d-${k}`).addEventListener('change', (e) => { shared[k] = e.target.checked; renderMetrics(); }));
    $('s7-layer').addEventListener('change', (e) => { layer = e.target.checked; renderMetrics(); });
    $('s7-size').addEventListener('input', (e) => { sizeLog = +e.target.value; renderCost(); });
    DE.range('s7-qpd', (v) => DE.int(v), (v) => { qpd = v; renderCost(); });
    DE.seg('s7-refresh', (v) => { refreshes = +v; renderCost(); });
    DE.seg('s7-mode', (v) => { incremental = v === 'inc'; renderCost(); });
    sizeLog = +$('s7-size').value;
    qpd = +$('s7-qpd').value;
    renderMetrics();
    renderCost();
  }
  init();
})();
