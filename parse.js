// parse.js — a faster drop-in for marked 18.1.3.
//
// The document is block-lexed by marked's own Lexer, so block segmentation
// is identical to marked's by construction. Each inline run is then
// tokenized by the fast dispatch loop in lib/inline.js (which still uses
// marked's own tokenizer methods for every construct) and rendered by
// marked's own Parser. The rendered HTML replaces the run's token array
// with a single verbatim html token, and marked's Parser renders the blocks.
//
// Anything the fast path cannot do falls back: a run that fails inside the
// fast loop falls back to marked's inline tokenization for that run (inside
// lib/inline.js the hard constructs are already marked's), and any failure
// of the fast path at all falls back to marked.parse for the whole document.
// No caching across calls, no worker threads, no input recognition: every
// case is computed from that case alone.

import { Lexer, Parser, marked } from './vendor/marked/marked.esm.js';
import { fastInlineTokens } from './lib/inline.js';

const parser = new Parser();

function fastParse(markdown) {
  const src = markdown.replace(/\r\n?/g, '\n');
  const lexer = new Lexer();
  const tokens = lexer.blockTokens(src, lexer.tokens);

  for (const entry of lexer.inlineQueue) {
    // As in Lexer#lex, a raw <pre>/<code>/<kbd>/<script> left open ends
    // with the block holding it; each run starts with the flag cleared.
    lexer.state.inRawBlock = false;
    const inlineTokens = fastInlineTokens(entry.src, lexer);
    const html = parser.parseInline(inlineTokens);
    // entry.tokens may already hold a checkbox token: a loose task list
    // unshifts it into the paragraph's token array before inline lexing.
    // Keep it and append the rendered HTML after it.
    entry.tokens.push({ type: 'html', raw: html, text: html, block: false });
  }

  return parser.parse(tokens);
}

/** The HTML marked 18.1.3 renders for `markdown`, with marked's defaults. */
export function parse(markdown) {
  try {
    return fastParse(markdown);
  } catch {
    return marked.parse(markdown);
  }
}
