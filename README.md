# Fast Markdown — a faster drop-in for marked

[![make.fun](https://make.fun/badge/markdown-render-speed-02.svg)](https://make.fun/bounty/markdown-render-speed-02)
[![rank](https://make.fun/badge/markdown-render-speed-02/arisasmara/ai-markdown-fast/rank.svg)](https://make.fun/bounty/markdown-render-speed-02)
[![reward](https://make.fun/badge/markdown-render-speed-02/arisasmara/ai-markdown-fast/reward.svg)](https://make.fun/bounty/markdown-render-speed-02)

`parse(markdown)` returns exactly the HTML that marked 18.1.3 renders with
its default options — but faster.

## How it works

The entry keeps marked's own block lexer (so block segmentation is identical
by construction) and replaces its inline loop with a fast dispatch loop
(`lib/inline.js`):

- A single scan jumps from one inline construct to the next instead of trying
  a dozen regexes at every position, so long runs of plain text become one
  text token in one step.
- Each construct is still tokenized by marked's own tokenizer methods
  (`escape`, `tag`, `link`, `reflink`, `emStrong`, `codespan`, `br`, `del`,
  `autolink`, `url`), and rendered by marked's own parser and renderer — so
  the output is marked's output, not a reimplementation of it.
- Anything the fast loop cannot dispatch falls back to marked's inline
  tokenization for that run; any failure in the fast path falls back to
  `marked.parse` for the whole document. No caching across calls, no worker
  threads, no input recognition: every case is computed from that case alone.

The vendored copy of marked 18.1.3 lives in `vendor/marked/` under its MIT
licence (see `vendor/marked/LICENSE` and `vendor/marked/NOTICE`).

## Layout

- `parse.js` — the entry point: block-lex with marked, fast-inline each run,
  render with marked's parser.
- `lib/inline.js` — the fast inline tokenizer.
- `main.ts` — the harness driver: reads `/input/cases.json`, writes
  `/output/html.json`.
- `vendor/marked/` — marked 18.1.3, vendored byte for byte.
