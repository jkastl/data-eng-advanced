/* Chapter 2: delivery guarantees. A consumer reads a log, writes to a sink, commits offsets, and crashes. */
(function () {
  'use strict';
  const { $, h, table, tag } = DE;

  const MSGS = [30, 12, 45, 8, 60, 25, 17, 40].map((amount, i) => ({ offset: i, id: `pay-${101 + i}`, amount }));
  const TRUE_TOTAL = MSGS.reduce((s, m) => s + m.amount, 0);

  const STRATS = {
    atmost: {
      label: 'At most once', steps: ['commit', 'write'],
      code: `for msg in consumer:
    consumer.commit(msg.offset + 1)   <span class="kw"># first</span>
    sink.insert(msg)                  <span class="kw"># then</span>`,
    },
    atleast: {
      label: 'At least once', steps: ['write', 'commit'],
      code: `for msg in consumer:
    sink.insert(msg)                  <span class="kw"># first</span>
    consumer.commit(msg.offset + 1)   <span class="kw"># then</span>`,
    },
    idem: {
      label: 'At least once + idempotent sink', steps: ['write', 'commit'], dedupe: true,
      code: `for msg in consumer:
    sink.upsert(key=msg.id, row=msg)  <span class="kw"># replay-safe</span>
    consumer.commit(msg.offset + 1)`,
    },
    txn: {
      label: 'Transactional (exactly once)', steps: ['txn'],
      code: `for msg in consumer:
    with sink.transaction() as tx:
        tx.insert(msg)
        tx.save_offset(msg.offset + 1)  <span class="kw"># same commit</span>`,
    },
  };

  let strat = 'atleast', crashAt = 4;

  function run() {
    const s = STRATS[strat];
    const sink = [], trace = [];
    let committed = 0, crashed = false;
    const write = (m, attempt) => {
      if (s.dedupe && sink.some((r) => r.id === m.id)) { trace.push({ t: `${m.id}: already in sink, upsert is a no-op`, k: 'good' }); return; }
      sink.push({ id: m.id, amount: m.amount, attempt });
    };
    const pass = (attempt) => {
      for (let o = committed; o < MSGS.length; o++) {
        const m = MSGS[o];
        if (s.steps[0] === 'txn') {
          if (!crashed && crashAt === o) {
            crashed = true;
            trace.push({ t: `offset ${o} (${m.id}): crash inside the transaction → rolled back, nothing written`, k: 'bad' });
            return false;
          }
          write(m, attempt);
          committed = o + 1;
          trace.push({ t: `offset ${o} (${m.id}): row + offset ${o + 1} in one commit`, k: attempt === 2 ? 'new' : null });
          continue;
        }
        const name = { write: 'write row', commit: `commit offset ${o + 1}` };
        const doStep = (st) => (st === 'write' ? write(m, attempt) : (committed = o + 1));
        const [first, second] = s.steps;
        doStep(first);
        if (!crashed && crashAt === o) {
          crashed = true;
          trace.push({ t: `offset ${o} (${m.id}): ${name[first]}, then 💥 crash before ${name[second]}`, k: 'bad' });
          return false;
        }
        doStep(second);
        trace.push({ t: `offset ${o} (${m.id}): ${name[first]} → ${name[second]}`, k: attempt === 2 ? 'new' : null });
      }
      return true;
    };
    if (!pass(1)) {
      trace.push({ t: `restart: resume from committed offset ${committed}`, k: 'warn' });
      pass(2);
    }
    return { sink, trace };
  }

  function render() {
    const { sink, trace } = run();
    const counts = {};
    sink.forEach((r) => (counts[r.id] = (counts[r.id] || 0) + 1));
    const missing = MSGS.filter((m) => !counts[m.id]);
    const dupes = sink.length - Object.keys(counts).length;
    const total = sink.reduce((a, r) => a + r.amount, 0);

    $('s2-log').replaceChildren(...MSGS.map((m) => h('div.logcell', { class: crashAt === m.offset ? 'crash' : null },
      h('span.lo', `#${m.offset}`), h('span', m.id), h('b', DE.money(m.amount)))));

    table('s2-sink', [
      { key: 'id', label: 'payment' }, { key: 'amount', num: true, fmt: DE.money },
      { key: 'attempt', label: 'written by', fmt: (v) => (v === 1 ? 'first run' : 'after restart') },
      { key: '_s', label: '', fmt: (_, r) => (counts[r.id] > 1 ? tag('duplicate', 'bad') : '') },
    ], sink, { rowClass: (r) => (counts[r.id] > 1 ? 'bad' : r.attempt === 2 ? 'new' : null) });

    $('s2-missing').textContent = missing.length ? `Never written: ${missing.map((m) => m.id).join(', ')}` : '';
    $('s2-missing').hidden = !missing.length;
    $('s2-trace').replaceChildren(...trace.map((l) => h('li', { class: l.k ? `t-${l.k}` : null }, l.t)));
    $('s2-code').innerHTML = STRATS[strat].code;

    DE.stat('s2-rows', `${sink.length}`);
    DE.stat('s2-dupes', String(dupes), dupes ? 'bad-text' : 'good-text');
    DE.stat('s2-lost', String(missing.length), missing.length ? 'bad-text' : 'good-text');
    DE.stat('s2-total', DE.money(total), total === TRUE_TOTAL ? 'good-text' : 'bad-text');
    $('s2-true').textContent = `should be ${DE.money(TRUE_TOTAL)}`;
  }

  function init() {
    DE.seg('s2-strat', (v) => { strat = v; render(); });
    DE.range('s2-crash', (v) => (v < 0 ? 'no crash' : `offset ${v}`), (v) => { crashAt = v; render(); });
    crashAt = +$('s2-crash').value;
    render();
  }
  init();
})();
