/* Chapter 4: open table formats. Immutable files, snapshots, copy-on-write vs merge-on-read, time travel. */
(function () {
  'use strict';
  const { $, h, table, tag } = DE;

  const CUSTS = ['Ana', 'Ben', 'Cy'];
  let files, snaps, nextRow, nextFile, selected, rewritten, mode, log;

  function reset() {
    files = {};
    snaps = [];
    nextRow = 1;
    nextFile = 1;
    rewritten = 0;
    log = [];
    commit('append', [newData(6)]);
    commit('append', [newData(6)]);
    selected = null;
  }

  function newData(n, rows) {
    rows = rows || Array.from({ length: n }, () => { const id = nextRow++; return { id, cust: CUSTS[id % 3] }; });
    const name = `data-${String(nextFile++).padStart(3, '0')}.parquet`;
    files[name] = { name, kind: 'data', rows };
    return name;
  }
  function newDeletes(ids) {
    const name = `delete-${String(nextFile++).padStart(3, '0')}.parquet`;
    files[name] = { name, kind: 'delete', ids };
    return name;
  }
  const current = () => snaps[snaps.length - 1];

  // A commit is just a new list of file references plus a pointer swap.
  function commit(op, add, remove = [], note = '') {
    const base = current() ? current().files.filter((f) => !remove.includes(f)) : [];
    snaps.push({ id: snaps.length ? current().id + 1 : 1, op, files: base.concat(add), note });
  }

  function read(snap) {
    const data = snap.files.map((f) => files[f]).filter((f) => f.kind === 'data');
    const dels = new Set(snap.files.map((f) => files[f]).filter((f) => f.kind === 'delete').flatMap((f) => f.ids));
    const rows = data.flatMap((f) => f.rows).filter((r) => !dels.has(r.id));
    return { rows, dataFiles: data.length, delFiles: snap.files.length - data.length };
  }

  function deleteCustomer(c) {
    const snap = current();
    const hit = snap.files.map((f) => files[f]).filter((f) => f.kind === 'data' && f.rows.some((r) => r.cust === c));
    const already = new Set(snap.files.map((f) => files[f]).filter((f) => f.kind === 'delete').flatMap((f) => f.ids));
    const ids = hit.flatMap((f) => f.rows).filter((r) => r.cust === c && !already.has(r.id)).map((r) => r.id);
    if (!ids.length) { log.unshift({ t: `No live rows for ${c}.`, k: 'dim' }); return; }
    if (mode === 'cow') {
      const add = [], remove = [];
      let n = 0;
      for (const f of hit) {
        const keep = f.rows.filter((r) => r.cust !== c && !already.has(r.id));
        remove.push(f.name);
        n += keep.length;
        if (keep.length) add.push(newData(0, keep));
      }
      rewritten += n;
      commit(`delete ${c} (copy-on-write)`, add, remove);
      log.unshift({ t: `Copy-on-write: rewrote ${hit.length} file${hit.length > 1 ? 's' : ''} (${n} surviving rows copied) to remove ${ids.length} rows.`, k: 'warn' });
    } else {
      commit(`delete ${c} (merge-on-read)`, [newDeletes(ids)]);
      log.unshift({ t: `Merge-on-read: wrote one small delete file listing ${ids.length} row ids. Readers now filter them out.`, k: 'good' });
    }
  }

  function compact() {
    const snap = current();
    const { rows } = read(snap);
    const remove = snap.files.slice();
    const add = [newData(0, rows)];
    rewritten += rows.length;
    commit('compact', add, remove);
    log.unshift({ t: `Compaction: ${remove.length} files → 1, deletes applied. Old files stay on storage for time travel.`, k: 'good' });
  }

  function expire() {
    const keep = new Set(current().files);
    const before = Object.keys(files).length;
    snaps = [current()];
    for (const k of Object.keys(files)) if (!keep.has(k)) delete files[k];
    selected = null;
    log.unshift({ t: `Expired old snapshots and deleted ${before - Object.keys(files).length} unreferenced files. Time travel before snapshot ${current().id} is gone.`, k: 'warn' });
  }

  function concurrent() {
    const base = current().id;
    commit('append (writer A)', [newData(3)]);
    log.unshift({ t: `Writer A and writer B both started from snapshot ${base}. A committed snapshot ${current().id} first.`, k: 'dim' });
    log.unshift({ t: `Writer B's commit failed: the table is no longer at snapshot ${base}. B checks A's changes, finds no conflict (both only added files), and retries on top.`, k: 'warn' });
    commit('append (writer B, retried)', [newData(3)]);
    log.unshift({ t: `Writer B committed snapshot ${current().id}. Nothing lost, nothing half-written.`, k: 'good' });
  }

  function render() {
    const snap = snaps.find((s) => s.id === selected) || current();
    const live = new Set(snap.files);
    const res = read(snap);

    table('s4-snaps', [
      { key: 'id', label: 'snapshot', fmt: (id, s) => {
        const btn = h('button.btn.mini', { class: s === snap ? 'primary' : 'ghost', 'aria-pressed': String(s === snap), title: s === snap ? 'Being read' : 'Time travel to this snapshot',
          onclick: () => { selected = s.id === current().id ? null : s.id; render(); } }, `#${id}`);
        return btn;
      } },
      { key: 'op', label: 'operation' },
      { key: 'files', label: 'files', num: true, fmt: (v) => v.length },
      { key: '_r', label: 'rows', num: true, fmt: (_, s) => read(s).rows.length },
    ], snaps.slice().reverse(), { rowClass: (s) => (s === snap ? 'new' : null) });

    $('s4-files').replaceChildren(...Object.values(files).map((f) => h('div.fchip', { class: `${f.kind}${live.has(f.name) ? ' live' : ''}` },
      h('span.fn', f.name), h('span.fr', f.kind === 'data' ? `${f.rows.length} rows` : `${f.ids.length} deletes`))));

    $('s4-log').replaceChildren(...(log.length ? log.slice(0, 5).map((l) => h('li', { class: l.k ? `t-${l.k}` : null }, l.t)) : [h('li.lbl', 'Try an operation.')]));

    DE.stat('s4-snap', `${snap.id}${snap === current() ? ' (current)' : ''}`, snap === current() ? null : 'warn-text');
    DE.stat('s4-rows', String(res.rows.length));
    DE.stat('s4-read', `${res.dataFiles} + ${res.delFiles}`, res.delFiles ? 'warn-text' : null);
    DE.stat('s4-stored', String(Object.keys(files).length));
    DE.stat('s4-rewritten', String(rewritten));
    const byCust = CUSTS.map((c) => `${c}: ${res.rows.filter((r) => r.cust === c).length}`).join(' · ');
    $('s4-query').textContent = `SELECT cust, COUNT(*) FROM orders ${snap === current() ? '' : `VERSION AS OF ${snap.id} `}GROUP BY cust;\n-- ${byCust}`;
    const writes = [...document.querySelectorAll('#s4-ops button')];
    writes.forEach((b) => (b.disabled = snap !== current()));
  }

  function init() {
    DE.seg('s4-mode', (v) => { mode = v; });
    mode = DE.$('s4-mode').querySelector('[aria-pressed="true"]').dataset.v;
    const act = (fn) => () => { fn(); selected = null; render(); };
    $('s4-append').addEventListener('click', act(() => { commit('append', [newData(4)]); log.unshift({ t: 'Appended one new file. Nothing existing was touched.', k: 'good' }); }));
    CUSTS.forEach((c) => $('s4-del').appendChild(h('option', { value: c }, c)));
    $('s4-delete').addEventListener('click', act(() => deleteCustomer($('s4-del').value)));
    $('s4-compact').addEventListener('click', act(compact));
    $('s4-concurrent').addEventListener('click', act(concurrent));
    $('s4-expire').addEventListener('click', act(expire));
    $('s4-reset').addEventListener('click', act(reset));
    reset();
    render();
  }
  init();
})();
