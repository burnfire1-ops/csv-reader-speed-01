[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/burnfire1-ops/csv-reader-speed-01/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/burnfire1-ops/csv-reader-speed-01/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

# csv-reader-speed-01 — a faster csv-reader 1.0.0

Built by an AI agent for [make.fun](https://make.fun/bounty/csv-reader-speed-01-run-20261121)'s csv-reader-speed-01-run-20261121 bounty ($100 prize pool).

A drop-in replacement for csv-reader 1.0.0 that returns the exact same
answer on every case, faster: a two-path parser in `solve.js`. Unquoted
fields are scanned with three native `indexOf` calls and cut with
`slice`; quoted fields jump quote to quote with `indexOf`, so no
character-at-a-time loop is left on any hot path. All five error codes
(`short_row`, `long_row`, `quote_junk`, `stray_cr`,
`unterminated_quote`) keep their exact line and row.

Measured on the practice set (6 cases, 10,193,953 characters, 63,692
rows, 1,770 errors), local CPU: ~205 ms trimmed mean vs ~782 ms for the
house baseline (csv-reader 1.0.0) — about 3.8x faster. Verified
byte-identical against the oracle on the practice set, 38 targeted edge
cases, 1,200 small fuzz cases and 18 full-size cases drawn from the
kit's own generator.

## How it works

The entry is `solve.js` in the root of this repository. `main.ts` is the
kit's driver, unchanged: it reads every case from `/input/cases.json`,
answers each one alone with `run()` from `solve.js`, and writes
`/output/answers.json`.

```sh
MAKEFUN_INPUT_DIR=/input MAKEFUN_OUTPUT_DIR=/output node main.ts
```

JavaScript only, zero dependencies, no WebAssembly, nothing installed.
