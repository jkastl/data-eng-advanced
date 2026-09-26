/* Chapter 1: stream processing. Event time vs processing time, tumbling windows, watermarks, late data. */
(function () {
  'use strict';
  const { $, h, svg, table, tag } = DE;

  const WIN = 10;            // tumbling window size, seconds of event time
  const E_MAX = 70, P_MAX = 95;

  // 34 clicks from phones. Most arrive within a few seconds; some were offline for a while.
  const EVENTS = (function () {
    const r = DE.rng(2024), out = [];
    for (let i = 0; i < 34; i++) {
      const e = +(r() * 66).toFixed(1);
      const slow = r() < 0.2;
      const d = slow ? 6 + r() * 22 : r() * r() * 4;
      out.push({ id: i + 1, e, a: +(e + d).toFixed(1) });
    }
    return out.sort((x, y) => x.a - y.a);
  })();

  let basis = 'event', delay = 3, lateness = 0, now = 40, playing = false, timer = 0;

  const winOf = (t) => Math.floor(t / WIN) * WIN;

  // Replay arrivals up to `now` and decide each event's fate.
  function simulate() {
    const wins = {};
    const win = (s) => (wins[s] = wins[s] || { start: s, count: 0, firedAt: null, emitted: null, updates: 0, dropped: 0 });
    const fates = {};
    let maxE = -Infinity;
    const wmPath = [];
    const fire = (wm, p) => {
      for (const w of Object.values(wins)) if (w.firedAt == null && wm >= w.start + WIN) { w.firedAt = p; w.emitted = w.count; }
    };
    const arrived = EVENTS.filter((ev) => ev.a <= now);
    if (basis === 'event') {
      for (const ev of arrived) {
        const wm = maxE - delay;
        const w = win(winOf(ev.e));
        if (wm >= w.start + WIN + lateness) { fates[ev.id] = 'dropped'; w.dropped++; }
        else if (w.firedAt != null) { fates[ev.id] = 'late'; w.count++; w.updates++; w.emitted = w.count; }
        else { fates[ev.id] = 'ontime'; w.count++; }
        maxE = Math.max(maxE, ev.e);
        wmPath.push([ev.a, maxE - delay]);
        fire(maxE - delay, ev.a);
      }
    } else {
      for (const ev of arrived) {
        const w = win(winOf(ev.a));
        w.count++;
        fates[ev.id] = 'ontime';
      }
      for (const w of Object.values(wins)) if (now >= w.start + WIN) { w.firedAt = w.start + WIN; w.emitted = w.count; }
    }
    // True counts by event time, over everything that will ever arrive.
    const truth = {};
    for (const ev of EVENTS) truth[winOf(ev.e)] = (truth[winOf(ev.e)] || 0) + 1;
    return { wins, fates, wmPath, wm: maxE - delay, truth };
  }

  function draw(sim) {
    const W = 720, H = 400, L = 44, R = 12, T = 22, B = 34;
    const x = (e) => L + (e / E_MAX) * (W - L - R);
    const y = (p) => T + (p / P_MAX) * (H - T - B);
    const kids = [];
    for (let s = 0; s < E_MAX; s += WIN) {
      const w = sim.wins[s];
      const cls = basis !== 'event' ? 'band' : !w || w.firedAt == null ? 'band' : 'band fired';
      kids.push(svg('rect', { class: cls + ((s / WIN) % 2 ? ' alt' : ''), x: x(s), y: T, width: x(s + WIN) - x(s), height: H - T - B }));
      kids.push(svg('text', { class: 'axl', x: (x(s) + x(s + WIN)) / 2, y: T - 7, 'text-anchor': 'middle' }, `${s}–${s + WIN}s`));
    }
    for (let p = 0; p <= P_MAX; p += 20) {
      kids.push(svg('text', { class: 'axl', x: L - 6, y: y(p) + 4, 'text-anchor': 'end' }, `${p}s`));
    }
    kids.push(svg('text', { class: 'axl', x: (L + W - R) / 2, y: H - 8, 'text-anchor': 'middle' }, 'event time: when the click happened →'));
    kids.push(svg('text', { class: 'axl', x: 12, y: (T + H - B) / 2, transform: `rotate(-90 12 ${(T + H - B) / 2})`, 'text-anchor': 'middle' }, 'processing time ↓'));
    if (basis === 'event' && sim.wmPath.length) {
      // Step function: the watermark holds until the next arrival, then jumps right.
      const [p0, w0] = sim.wmPath[0];
      let d = `M${x(Math.max(0, w0))},${y(p0)}`;
      for (const [p, wm] of sim.wmPath.slice(1)) d += `V${y(p)}H${x(Math.max(0, wm))}`;
      d += `V${y(now)}`;
      kids.push(svg('path', { class: 'wm', d }));
    }
    kids.push(svg('line', { class: 'now', x1: L, x2: W - R, y1: y(now), y2: y(now) }));
    kids.push(svg('text', { class: 'axl now-l', x: W - R - 4, y: y(now) - 5, 'text-anchor': 'end' }, `now = ${now}s`));
    for (const ev of EVENTS) {
      const arrived = ev.a <= now;
      const f = sim.fates[ev.id];
      kids.push(svg('circle', {
        class: `ev ${arrived ? f : 'future'}`, cx: x(ev.e), cy: y(ev.a), r: 4.5,
      }, svg('title', null, `click #${ev.id}: happened at ${ev.e}s, arrived at ${ev.a}s${arrived ? ` (${f})` : ' (not yet arrived)'}`)));
    }
    $('s1-plot').replaceChildren(svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Events by event time and arrival time with the watermark' }, kids));
  }

  function render() {
    const sim = simulate();
    draw(sim);
    const rows = [];
    for (let s = 0; s < E_MAX; s += WIN) {
      const w = sim.wins[s] || { start: s, count: 0, firedAt: null, updates: 0, dropped: 0 };
      rows.push({
        win: `${s}–${s + WIN}s`, emitted: w.firedAt == null ? null : w.emitted,
        truth: sim.truth[s] || 0, firedAt: w.firedAt, updates: w.updates, dropped: w.dropped,
      });
    }
    table('s1-results', [
      { key: 'win', label: 'window' },
      { key: 'firedAt', label: 'emitted at', num: true, fmt: (v) => (v == null ? '—' : `${v.toFixed(1)}s`) },
      { key: 'emitted', label: 'count', num: true, fmt: (v) => (v == null ? '—' : v) },
      { key: 'truth', label: 'true count', num: true },
      { key: '_s', label: '', fmt: (_, r) => (r.firedAt == null ? tag('open') : h('span',
        r.emitted === r.truth ? tag('correct', 'good') : tag(`off by ${r.truth - r.emitted}`, 'bad'),
        r.updates ? tag(`${r.updates} update${r.updates > 1 ? 's' : ''}`, 'warn') : null)) },
    ], rows, { rowClass: (r) => (r.firedAt == null ? 'dim' : r.emitted === r.truth ? null : 'bad') });

    const fates = Object.values(sim.fates);
    const fired = rows.filter((r) => r.firedAt != null);
    const wait = fired.map((r) => r.firedAt - (parseFloat(r.win) + WIN));
    DE.stat('s1-wm', basis === 'event' && Number.isFinite(sim.wm) ? `${Math.max(0, sim.wm).toFixed(1)}s` : 'n/a');
    DE.stat('s1-late', String(fates.filter((f) => f === 'late').length), fates.includes('late') ? 'warn-text' : null);
    DE.stat('s1-dropped', String(fates.filter((f) => f === 'dropped').length), fates.includes('dropped') ? 'bad-text' : 'good-text');
    DE.stat('s1-wait', wait.length ? `${(wait.reduce((a, b) => a + b, 0) / wait.length).toFixed(1)}s` : '–');
    const wrong = fired.filter((r) => r.emitted !== r.truth).length;
    DE.stat('s1-wrong', `${wrong} / ${fired.length}`, wrong ? 'bad-text' : 'good-text');
    $('s1-delay-wrap').hidden = basis !== 'event';
    $('s1-now-out').textContent = `${now}s`;
    $('s1-now').value = now;
  }

  function stopPlay() { clearInterval(timer); timer = 0; playing = false; $('s1-play').textContent = 'Play'; }

  function init() {
    DE.seg('s1-basis', (v) => { basis = v; render(); });
    DE.range('s1-delay', (v) => `${v}s`, (v) => { delay = v; render(); });
    DE.range('s1-lateness', (v) => `${v}s`, (v) => { lateness = v; render(); });
    $('s1-now').addEventListener('input', (e) => { now = +e.target.value; render(); });
    $('s1-play').addEventListener('click', () => {
      if (playing) return stopPlay();
      if (now >= P_MAX) now = 0;
      playing = true;
      $('s1-play').textContent = 'Pause';
      timer = setInterval(() => { now = Math.min(P_MAX, now + 1); render(); if (now >= P_MAX) stopPlay(); }, 120);
    });
    DE.onView('streaming', { leave: stopPlay });
    render();
  }
  init();
})();
