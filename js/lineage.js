/* Chapter 6: lineage and governance. Column-level lineage, impact analysis, PII tags and masking. */
(function () {
  'use strict';
  const { $, h, svg, table, tag } = DE;

  const BOXW = 170, ROW = 18, HEAD = 24;
  const TABLES = {
    'crm.customers': { x: 10, y: 10, cols: ['customer_id', 'name', 'email', 'country'] },
    'shop.orders': { x: 10, y: 140, cols: ['order_id', 'customer_id', 'amount', 'card_number'] },
    stg_customers: { x: 200, y: 10, cols: ['customer_id', 'full_name', 'email', 'country'] },
    stg_orders: { x: 200, y: 140, cols: ['order_id', 'customer_id', 'amount'] },
    dim_customer: { x: 390, y: 10, cols: ['customer_id', 'full_name', 'email', 'email_domain', 'country'] },
    fct_orders: { x: 390, y: 160, cols: ['order_id', 'customer_id', 'amount', 'country'] },
    revenue_by_country: { x: 580, y: 10, cols: ['country', 'revenue'] },
    churn_features: { x: 580, y: 110, cols: ['customer_id', 'email_domain', 'order_count'] },
  };
  const E = (a, b) => [a, b];
  const EDGES = [
    E('crm.customers.customer_id', 'stg_customers.customer_id'), E('crm.customers.name', 'stg_customers.full_name'),
    E('crm.customers.email', 'stg_customers.email'), E('crm.customers.country', 'stg_customers.country'),
    E('shop.orders.order_id', 'stg_orders.order_id'), E('shop.orders.customer_id', 'stg_orders.customer_id'),
    E('shop.orders.amount', 'stg_orders.amount'),
    E('stg_customers.customer_id', 'dim_customer.customer_id'), E('stg_customers.full_name', 'dim_customer.full_name'),
    E('stg_customers.email', 'dim_customer.email'), E('stg_customers.email', 'dim_customer.email_domain'),
    E('stg_customers.country', 'dim_customer.country'),
    E('stg_orders.order_id', 'fct_orders.order_id'), E('stg_orders.customer_id', 'fct_orders.customer_id'),
    E('stg_orders.amount', 'fct_orders.amount'), E('stg_customers.country', 'fct_orders.country'),
    E('fct_orders.country', 'revenue_by_country.country'), E('fct_orders.amount', 'revenue_by_country.revenue'),
    E('dim_customer.customer_id', 'churn_features.customer_id'), E('dim_customer.email_domain', 'churn_features.email_domain'),
    E('fct_orders.order_id', 'churn_features.order_count'),
  ];
  const SOURCE_PII = new Set(['crm.customers.name', 'crm.customers.email', 'shop.orders.card_number']);

  const SENSITIVE = new Set(['full_name', 'email', 'email_domain']);

  const down = (c) => EDGES.filter(([a]) => a === c).flatMap(([, b]) => [b, ...down(b)]);
  const up = (c) => EDGES.filter(([, b]) => b === c).flatMap(([a]) => [a, ...up(a)]);

  let sel = 'crm.customers.email', propagate = true, role = 'analyst';

  function piiTags() {
    const tags = new Map();
    for (const c of SOURCE_PII) {
      tags.set(c, 'pii');
      if (propagate) for (const d of down(c)) if (!tags.has(d)) tags.set(d, 'pii');
    }
    return tags;
  }

  const pos = (col) => {
    const i = col.lastIndexOf('.');
    const t = TABLES[col.slice(0, i)];
    const r = t.cols.indexOf(col.slice(i + 1));
    return { t, y: t.y + HEAD + r * ROW + ROW / 2 };
  };

  function drawGraph(tags) {
    const ups = new Set(up(sel)), downs = new Set(down(sel));
    const edges = EDGES.map(([a, b]) => {
      const pa = pos(a), pb = pos(b);
      const x1 = pa.t.x + BOXW, x2 = pb.t.x, mx = (x1 + x2) / 2;
      const cls = (downs.has(b) && (a === sel || downs.has(a))) ? 'lin down' : (ups.has(a) && (b === sel || ups.has(b))) ? 'lin up' : 'lin';
      return svg('path', { class: cls, d: `M${x1},${pa.y} C${mx},${pa.y} ${mx},${pb.y} ${x2},${pb.y}` });
    });
    const boxes = Object.entries(TABLES).map(([name, t]) => svg('g', { class: 'ltable' },
      svg('rect', { x: t.x, y: t.y, width: BOXW, height: HEAD + t.cols.length * ROW + 4, rx: 6 }),
      svg('text', { x: t.x + 8, y: t.y + 16, class: 'tn' }, name),
      t.cols.map((c, i) => {
        const id = `${name}.${c}`;
        const cls = ['lcol', id === sel ? 'sel' : downs.has(id) ? 'down' : ups.has(id) ? 'up' : '', tags.has(id) ? 'pii' : ''].join(' ');
        const y = t.y + HEAD + i * ROW;
        const g = svg('g', { class: cls, tabindex: 0, role: 'button', 'aria-label': `${id}${tags.has(id) ? ', PII' : ''}` },
          svg('rect', { x: t.x + 2, y, width: BOXW - 4, height: ROW - 1, rx: 3 }),
          svg('text', { x: t.x + 10, y: y + 13 }, c),
          tags.has(id) ? svg('text', { x: t.x + BOXW - 10, y: y + 13, 'text-anchor': 'end', class: 'piit' }, 'PII') : null);
        const pick = () => { sel = id; render(); };
        g.addEventListener('click', pick);
        g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
        return g;
      })));
    $('s6-graph').replaceChildren(svg('svg', { viewBox: '0 0 760 268', role: 'group', 'aria-label': 'Column-level lineage graph' }, edges, boxes));
  }

  const PEOPLE = [
    { customer_id: 17, full_name: 'Ana Ruiz', email: 'ana.ruiz@example.com', email_domain: 'example.com', country: 'US' },
    { customer_id: 42, full_name: 'Ben Okafor', email: 'ben@mail.test', email_domain: 'mail.test', country: 'CA' },
    { customer_id: 88, full_name: 'Cy Lindqvist', email: 'cy.l@example.org', email_domain: 'example.org', country: 'GB' },
  ];
  const fakeHash = (s) => { let x = 0; for (const ch of s) x = (x * 31 + ch.charCodeAt(0)) >>> 0; return x.toString(16).padStart(8, '0'); };

  function render() {
    const tags = piiTags();
    drawGraph(tags);
    const ups = [...new Set(up(sel))], downs = [...new Set(down(sel))];
    const tablesHit = [...new Set(downs.map((c) => c.slice(0, c.lastIndexOf('.'))))];
    $('s6-sel').textContent = sel;
    DE.stat('s6-up', String(ups.length));
    DE.stat('s6-down', String(downs.length), downs.length > 4 ? 'warn-text' : null);
    DE.stat('s6-tables', String(tablesHit.length));
    $('s6-impact').replaceChildren(...(downs.length
      ? tablesHit.map((t) => h('li', h('b', t), ': ', downs.filter((c) => c.startsWith(t + '.')).map((c) => c.slice(t.length + 1)).join(', ')))
      : [h('li.lbl', 'Nothing downstream. Safe to change.')]));

    // Masking policy: any column tagged PII is masked for analysts and hashed for engineers.
    const policy = (col, v) => {
      if (!tags.has(`dim_customer.${col}`)) return String(v);
      if (role === 'support') return String(v);
      if (role === 'engineer') return `sha:${fakeHash(String(v))}`;
      return '••••••';
    };
    const cols = TABLES.dim_customer.cols;
    table('s6-preview', cols.map((c) => ({
      key: c, label: tags.has(`dim_customer.${c}`) ? h('span', c, ' ', tag('PII', 'warn')) : c,
      fmt: (v) => policy(c, v),
      // Personal data that slipped past the policy because it wasn't tagged.
      cls: () => (!tags.has(`dim_customer.${c}`) && SENSITIVE.has(c) && role !== 'support' ? 'bad-cell' : ''),
    })), PEOPLE);
    const leak = !propagate && role !== 'support';
    const msg = $('s6-msg');
    msg.className = `msg ${leak ? 'bad' : 'good'}`;
    msg.textContent = leak
      ? 'Tags stayed on the source tables, so the masking policy never sees that dim_customer.email is an email address. Names and emails are wide open.'
      : role === 'support' ? 'Support is allowed to see contact details, and the access is logged.'
        : 'The PII tag flowed down the lineage graph, so every copy of the column is masked automatically, including email_domain, which was derived from it.';
  }

  function init() {
    DE.seg('s6-role', (v) => { role = v; render(); });
    $('s6-prop').addEventListener('change', (e) => { propagate = e.target.checked; render(); });
    render();
  }
  init();
})();
