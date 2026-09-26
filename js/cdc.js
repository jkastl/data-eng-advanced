/* Chapter 3: log-based CDC. Polling a table vs reading the database's write-ahead log. */
(function () {
  'use strict';
  const { $, h, table, tag } = DE;

  const OPS = [
    { t: 1, op: 'insert', id: 1, status: 'pending' },
    { t: 2, op: 'insert', id: 2, status: 'pending' },
    { t: 3, op: 'update', id: 1, status: 'paid' },
    { t: 4, op: 'insert', id: 3, status: 'pending' },
    { t: 5, op: 'update', id: 1, status: 'shipped' },
    { t: 6, op: 'delete', id: 2 },
    { t: 7, op: 'update', id: 3, status: 'paid' },
    { t: 8, op: 'insert', id: 4, status: 'pending' },
    { t: 9, op: 'insert', id: 5, status: 'pending' },
    { t: 10, op: 'delete', id: 5 },
    { t: 11, op: 'update', id: 4, status: 'paid' },
    { t: 12, op: 'update', id: 3, status: 'refunded' },
  ];
  const LSN0 = 0x1a2f0;
  const lsn = (i) => '0/' + (LSN0 + i * 0x68).toString(16).toUpperCase();

  let now = 12, interval = 4;

  function stateAt(t) {
    const rows = new Map();
    for (const o of OPS) {
      if (o.t > t) break;
      if (o.op === 'delete') rows.delete(o.id);
      else rows.set(o.id, { id: o.id, status: o.status, updated_at: o.t });
    }
    return rows;
  }

  function render() {
    const log = OPS.map((o, i) => Object.assign({ lsn: lsn(i) }, o)).filter((o) => o.t <= now);
    const before = {};
    const logRows = log.map((o) => {
      const prev = before[o.id] ?? null;
      before[o.id] = o.op === 'delete' ? null : o.status;
      return { lsn: o.lsn, t: o.t, op: o.op, id: o.id, change: `${prev ?? '∅'} → ${o.op === 'delete' ? '∅' : o.status}` };
    });

    // Polling: every `interval` seconds, SELECT rows with updated_at > last poll.
    const polls = [];
    let last = 0;
    for (let p = interval; p <= now; p += interval) {
      const snap = [...stateAt(p).values()].filter((r) => r.updated_at > last);
      polls.push({ at: p, rows: snap });
      last = p;
    }

    // What each approach knows about each order's history.
    const ids = [...new Set(OPS.map((o) => o.id))];
    const hist = ids.map((id) => {
      const logSeen = log.filter((o) => o.id === id).map((o) => (o.op === 'delete' ? 'deleted' : o.status));
      const pollSeen = [];
      for (const p of polls) for (const r of p.rows) if (r.id === id && pollSeen[pollSeen.length - 1] !== r.status) pollSeen.push(r.status);
      return { id, log: logSeen, poll: pollSeen };
    }).filter((r) => r.log.length);

    table('s3-wal', [
      { key: 'lsn', label: 'LSN' }, { key: 't', label: 'time', fmt: (v) => `t=${v}` },
      { key: 'op', fmt: (v) => tag(v, v === 'delete' ? 'bad' : v === 'insert' ? 'good' : 'warn') },
      { key: 'id', label: 'order' }, { key: 'change', label: 'status' },
    ], logRows.slice().reverse(), { empty: 'No changes yet' });

    $('s3-polls').replaceChildren(...(polls.length ? polls.slice().reverse().map((p) => h('li',
      h('b', `t=${p.at}`), ' ', h('code', `WHERE updated_at > ${p.at - interval}`), ' → ',
      p.rows.length ? p.rows.map((r) => tag(`#${r.id} ${r.status}`)) : h('span.lbl', 'nothing')))
      : [h('li.lbl', 'No polls yet')]));

    const fmtSeq = (seq) => (seq.length ? seq.join(' → ') : '—');
    table('s3-hist', [
      { key: 'id', label: 'order' },
      { key: 'log', label: 'log-based CDC sees', fmt: fmtSeq },
      { key: 'poll', label: 'polling sees', fmt: fmtSeq },
      { key: '_s', label: '', fmt: (_, r) => (fmtSeq(r.log) === fmtSeq(r.poll) ? tag('same', 'good') : tag(r.poll.length ? 'lost changes' : 'never seen', 'bad')) },
    ], hist, { rowClass: (r) => (fmtSeq(r.log) === fmtSeq(r.poll) ? null : 'bad') });

    const pollChanges = hist.reduce((s, r) => s + r.poll.length, 0);
    DE.stat('s3-changes', String(log.length));
    DE.stat('s3-captured', `${pollChanges} / ${log.length}`, pollChanges < log.length ? 'bad-text' : 'good-text');
    DE.stat('s3-deletes', `0 / ${log.filter((o) => o.op === 'delete').length}`, log.some((o) => o.op === 'delete') ? 'bad-text' : null);
    DE.stat('s3-queries', String(polls.length));
    $('s3-now-out').textContent = `t=${now}`;
  }

  function init() {
    $('s3-now').addEventListener('input', (e) => { now = +e.target.value; render(); });
    DE.seg('s3-interval', (v) => { interval = +v; render(); });
    interval = +DE.$('s3-interval').querySelector('[aria-pressed="true"]').dataset.v;
    render();
  }
  init();
})();
