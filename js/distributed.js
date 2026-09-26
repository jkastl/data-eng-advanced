/* Chapter 5: distributed execution. Hash shuffles, skew, salting, and broadcast vs shuffle joins. */
(function () {
  'use strict';
  const { $, h } = DE;

  // ---------- part A: shuffle and skew ----------
  const ROWS = 12000, KEYS = 400;
  let workers = 8, skew = 0.3, salt = false;

  // Deterministic string hash, so the same key always lands on the same worker.
  function hash(s) {
    let x = 2166136261;
    for (let i = 0; i < s.length; i++) x = Math.imul(x ^ s.charCodeAt(i), 16777619);
    return x >>> 0;
  }

  function shuffle() {
    const load = new Array(workers).fill(0);
    const hot = Math.round(ROWS * skew);
    const rest = ROWS - hot;
    // The long tail: remaining rows spread evenly over the other keys.
    for (let k = 1; k < KEYS; k++) load[hash(`cust-${k}`) % workers] += rest / (KEYS - 1);
    // The hot key: one customer (say, a marketplace's house account) with a huge share of rows.
    if (salt) {
      // Salting appends a random suffix 0..N-1, splitting the hot key over N partial groups.
      for (let s = 0; s < workers; s++) load[hash(`cust-0#${s}`) % workers] += hot / workers;
    } else load[hash('cust-0') % workers] += hot;
    return load.map(Math.round);
  }

  function renderShuffle() {
    const load = shuffle();
    const max = Math.max(...load), mean = ROWS / workers;
    const hotW = salt ? -1 : hash('cust-0') % workers;
    $('s5-bars').replaceChildren(...load.map((n, i) => h('div.bar',
      h('span.bl', `worker ${i + 1}`),
      h('span.track', h('span.fill', { class: i === hotW && skew > 0.05 ? 'hot' : null, style: `width:${(n / max) * 100}%` })),
      h('span.bv', DE.int(n)))));
    const extra = salt ? 1 + 0.08 * workers : 1;   // the second aggregation step isn't free
    const time = (max / mean) * extra;
    DE.stat('s5-max', DE.int(max));
    DE.stat('s5-mean', DE.int(mean));
    DE.stat('s5-time', `${time.toFixed(1)}×`, time > 2 ? 'bad-text' : time < 1.3 ? 'good-text' : 'warn-text');
    DE.stat('s5-eff', DE.pct(mean / max), mean / max < 0.5 ? 'bad-text' : null);
    $('s5-sql').innerHTML = salt
      ? `<span class="kw">-- stage 1: partial sums on a salted key</span>
SELECT customer_id, salt, SUM(amount) AS part
FROM (SELECT *, FLOOR(RAND() * ${workers}) AS salt FROM orders)
GROUP BY customer_id, salt;
<span class="kw">-- stage 2: combine the ${workers} partials per customer</span>
SELECT customer_id, SUM(part) FROM stage1 GROUP BY customer_id;`
      : `SELECT customer_id, SUM(amount)
FROM orders
GROUP BY customer_id;  <span class="kw">-- rows shuffled by hash(customer_id)</span>`;
  }

  // ---------- part B: join strategy ----------
  const FACT_GB = 500, MEM_GB = 8;
  let dimLog = 0, nodes = 20;   // dim size = 10^dimLog GB

  const fmtGB = (g) => (g < 1 ? `${Math.round(g * 1024)} MB` : g < 1024 ? `${g < 10 ? g.toFixed(1) : Math.round(g)} GB` : `${(g / 1024).toFixed(1)} TB`);

  function renderJoin() {
    const dim = Math.pow(10, dimLog);
    const shuffleNet = FACT_GB + dim;           // both sides re-partitioned by key
    const bcastNet = dim * nodes;               // the small side copied to every node
    const fits = dim <= MEM_GB * 0.5;           // it has to fit in memory with room to spare
    const best = fits && bcastNet < shuffleNet ? 'broadcast' : 'shuffle';
    $('s5-dim-out').textContent = fmtGB(dim);
    DE.stat('s5-shuf', fmtGB(shuffleNet), best === 'shuffle' ? 'good-text' : null);
    DE.stat('s5-bc', fits ? fmtGB(bcastNet) : 'out of memory', !fits ? 'bad-text' : best === 'broadcast' ? 'good-text' : null);
    DE.stat('s5-pick', best === 'broadcast' ? 'Broadcast' : 'Shuffle (sort-merge)');
    const msg = $('s5-join-msg');
    if (!fits) { msg.className = 'msg bad'; msg.textContent = `A ${fmtGB(dim)} table can't be copied into every ${MEM_GB} GB executor. Only a shuffle join works; hope the join key isn't skewed.`; }
    else if (best === 'broadcast') { msg.className = 'msg good'; msg.textContent = `Copying ${fmtGB(dim)} to ${nodes} nodes moves far less than re-shuffling the ${FACT_GB} GB fact table. The big side never leaves its node.`; }
    else { msg.className = 'msg warn'; msg.textContent = `It would fit in memory, but copying it to ${nodes} nodes now moves more data than a shuffle.`; }
    const max = Math.max(shuffleNet, fits ? bcastNet : 0);
    $('s5-join-bars').replaceChildren(
      h('div.bar', h('span.bl', 'Shuffle'), h('span.track', h('span.fill', { style: `width:${(shuffleNet / max) * 100}%` })), h('span.bv', fmtGB(shuffleNet))),
      h('div.bar', h('span.bl', 'Broadcast'), h('span.track', fits ? h('span.fill', { style: `width:${(bcastNet / max) * 100}%` }) : h('span.fill.hot', { style: 'width:100%' })), h('span.bv', fits ? fmtGB(bcastNet) : 'OOM')));
  }

  function init() {
    DE.range('s5-workers', null, (v) => { workers = v; renderShuffle(); });
    DE.range('s5-skew', (v) => `${v}%`, (v) => { skew = v / 100; renderShuffle(); });
    $('s5-salt').addEventListener('change', (e) => { salt = e.target.checked; renderShuffle(); });
    workers = +$('s5-workers').value;
    skew = +$('s5-skew').value / 100;
    $('s5-dim').addEventListener('input', (e) => { dimLog = +e.target.value; renderJoin(); });
    DE.range('s5-nodes', null, (v) => { nodes = v; renderJoin(); });
    dimLog = +$('s5-dim').value;
    nodes = +$('s5-nodes').value;
    renderShuffle();
    renderJoin();
  }
  init();
})();
