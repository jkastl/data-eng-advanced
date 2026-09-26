# data-eng-advanced

Advanced data engineering, one interactive demo at a time. Each chapter is a small working model of
something that gets hard once data is big, fast or widely shared, and every one has something to
drag, click or break.

**[jkastl.github.io/data-eng-advanced](https://jkastl.github.io/data-eng-advanced/)**

This picks up where [data-eng-concepts](https://github.com/jkastl/data-eng-concepts)
([live](https://jkastl.github.io/data-eng-concepts/)) leaves off. That site covers the fundamentals.

| # | Topic | What you do |
|---|---|---|
| 1 | Event time, windows and watermarks | Window clicks by processing or event time; tune the watermark delay and allowed lateness against late-arriving events |
| 2 | At-least-once, exactly-once | Crash a log consumer between writing and committing its offset under four strategies; count lost and duplicated payments |
| 3 | Log-based CDC | Compare polling on `updated_at` with reading the write-ahead log; see lost intermediate states and deletes |
| 4 | Open table formats | Append, delete (copy-on-write vs merge-on-read), compact, time travel, expire snapshots, resolve concurrent writers |
| 5 | Shuffles, skew and joins | Skew a group-by onto one worker and fix it with salting; pick broadcast vs shuffle join by table size |
| 6 | Lineage and PII | Trace column-level lineage up and down; see masking fail when PII tags don't propagate |
| 7 | Semantic layers and cost | Reconcile three "revenue" numbers with one metric definition; weigh materialized views against scanning |

All data is generated in the page from fixed seeds, so every visit sees the same thing. Nothing is
fetched or sent anywhere.

## Running it

No build step and no dependencies. Open `index.html` in a browser, or serve the folder:

```sh
python3 -m http.server
```

GitHub Pages serves the repo root from `main`. Commit and push changes directly to `main`; there are
no feature branches or pull requests.

## Layout

```
index.html           all chapter text and page structure; hash routes like #/cdc
style.css            dark theme, responsive down to phone width
js/core.js           seeded RNG, element and table builders, controls, router
                     (shared with data-eng-concepts; keep the two in step)
js/streaming.js      1: event time, windows, watermarks
js/delivery.js       2: delivery guarantees
js/cdc.js            3: log-based change data capture
js/tables.js         4: open table formats
js/distributed.js    5: shuffles, skew, join strategies
js/lineage.js        6: column lineage, PII tags, masking
js/semantic.js       7: semantic layer and materialization cost
```

## Versioning

The version and date in the footer of `index.html` are **updated by hand**. Nothing bumps them
automatically. Change both in the same commit as the change they describe, following
[semver](https://semver.org/):

- **Patch** (`1.2.0` → `1.2.1`): fixing a typo, a bug or tweaking the wording.
- **Minor** (`1.2.0` → `1.3.0`): adding, removing, or changing a chapter or demo, or a small
  visual change.
- **Major** (`1.2.0` → `2.0.0`): a redesign or restructure of the app.

The date is the day of the change, in `YYYY-MM-DD` format.
