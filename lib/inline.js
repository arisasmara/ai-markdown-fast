// Fast inline tokenizer for the markdown-render-speed entry.
//
// marked's block lexer does the block segmentation (so blocks are identical
// by construction) and this module replaces only its inline loop. The loop
// below scans for the next position where an inline construct can start
// instead of trying a dozen regexes at every position, so long runs of plain
// text become a single text token in one step. Every construct itself is
// still tokenized by marked 18.1.3's own tokenizer methods, and rendered by
// marked's own parser and renderer, so the tokens (and therefore the HTML)
// are marked's tokens.
//
// The masking helpers and the label/entity helpers are ports of marked
// 18.1.3's own code (MIT, Copyright (c) 2018-2026 MarkedJS), kept because
// emphasis and strikethrough need a source with links, code spans, HTML and
// escapes masked out before they scan for closers.

const numericCharacterReference = /&#(?:(\d{1,7})|[Xx]([A-Fa-f0-9]{1,6}));/;
const numericCharacterReferenceOrAmpersand = /&#(?:(\d{1,7})|[Xx]([A-Fa-f0-9]{1,6}));|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/g;
const multipleSpaceGlobal = /\s+/g;

/**
 * Normalizes a link label so definitions and references can be matched.
 * (Port of marked's normalizeLabel.)
 */
function normalizeLabel(label) {
  return label.trim().replace(multipleSpaceGlobal, ' ').toLowerCase().toUpperCase().toLowerCase();
}

/**
 * Numeric character references are recognized outside code and are
 * equivalent to the character they name. Values that are zero, out of range,
 * or a surrogate become the replacement character.
 * (Port of marked's decodeNumericCharacterReferences.)
 */
function decodeNumericCharacterReferences(text) {
  if (!numericCharacterReference.test(text)) {
    return text;
  }
  return text.replace(numericCharacterReferenceOrAmpersand, (ref, dec, hex) => {
    if (dec === undefined && hex === undefined) {
      return '&amp;';
    }
    const code = dec === undefined ? Number.parseInt(hex, 16) : Number.parseInt(dec, 10);
    if (code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) {
      return '�';
    }
    return code === 38 ? '&amp;' : String.fromCodePoint(code);
  });
}

/**
 * Does this link text hold a link already? An image does not count: an image
 * may hold a link, a link may not.
 * (Port of marked's Lexer#linkInText.)
 */
function linkInText(text, tokenizer, links) {
  if (!text.includes('[')) {
    return false;
  }

  const linkRule = tokenizer.rules.inline.link;
  for (const match of text.matchAll(tokenizer.rules.inline.blockSkip)) {
    if (linkRule.test(match[0]) && text.charAt(match.index - 1) !== '!') {
      return true;
    }
  }

  for (const match of text.matchAll(tokenizer.rules.inline.reflinkSearch)) {
    const match0 = match[0];
    const refStart = match0.lastIndexOf('[');
    if (match0.charAt(0) === '!' || !Object.hasOwn(links, normalizeLabel(match0.slice(refStart + 1, -1)))) {
      continue;
    }
    if (refStart > 1 && linkInText(match0.slice(1, refStart - 1), tokenizer, links)) {
      continue;
    }
    return true;
  }

  return false;
}

/**
 * Mask links, code, html and escapes so emStrong and del do not see their
 * delimiters inside them. Every mask keeps the length it replaces, so the
 * masked source lines up with the real source by index.
 * (Port of marked's Lexer#maskSrc.)
 */
function maskSrc(src, tokenizer, links) {
  let maskedSrc = src;

  if (links && src.includes('[')) {
    const reflinkSearch = tokenizer.rules.inline.reflinkSearch;
    const maskReflink = (match0) => {
      const refStart = match0.lastIndexOf('[');
      if (!Object.hasOwn(links, normalizeLabel(match0.slice(refStart + 1, -1)))) {
        return match0;
      }
      if (refStart > 1 && match0.charAt(0) !== '!') {
        const text = match0.slice(1, refStart - 1);
        if (linkInText(text, tokenizer, links)) {
          return '[' + text.replace(reflinkSearch, maskReflink)
            + '][' + 'a'.repeat(match0.length - refStart - 2) + ']';
        }
      }
      return '[' + 'a'.repeat(match0.length - 2) + ']';
    };
    maskedSrc = maskedSrc.replace(reflinkSearch, maskReflink);
  }

  maskedSrc = maskedSrc.replace(tokenizer.rules.inline.anyPunctuationOutsideCode, (match0, code, punct) => {
    if (punct) {
      return '+'.repeat(match0.length);
    }
    if (code) {
      return code + match0.slice(code.length, -code.length).replace(/`/g, '+') + code;
    }
    return match0;
  });

  maskedSrc = maskedSrc.replace(tokenizer.rules.inline.blockSkip, (match0, _link, context) => {
    const offset = context ? context.length : 0;
    return match0.slice(0, offset) + '[' + 'a'.repeat(match0.length - offset - 2) + ']';
  });

  return maskedSrc;
}

// The next position where an inline construct can start, mirroring the
// stops of marked's GFM text rule. Stopping early is safe: the loop retries
// the rules there and resumes the text run when none matches.
//   - \ ` < ! [ * _ ~ : any of these can open a construct
//   - two or more spaces before a newline: a hard break
//   - www. (only where marked stops for it), http://, https://, ftp://,
//     mailto:, xmpp:, or an email-looking run: a GFM extended autolink
const STOP_RE = /[\\`<\[!*_~]| {2,}\n|(?<![^\s*_~(])www\.|[hH][tT][tT][pP][sS]?:\/\/|[fF][tT][pP]:\/\/|mailto:|xmpp:|[A-Za-z0-9.!#$%&'*+\/=?_`{|}~-]+@/g;

/**
 * Tokenize one inline run the way marked's Lexer#inlineTokens does, but with
 * a dispatch loop: jump to the next construct instead of trying every rule
 * at every position, and emit long plain-text runs as a single text token.
 * `lexer` is a marked Lexer instance whose blockTokens already ran (so its
 * links map is populated); the hard constructs are tokenized by that
 * lexer's own tokenizer methods, so their tokens are marked's tokens.
 * Throws on any unexpected condition; the caller falls back to marked for
 * the whole document in that case.
 */
export function fastInlineTokens(src, lexer) {
  const tokenizer = lexer.tokenizer;
  const links = lexer.tokens.links;
  const tokens = [];

  const prevLinkParenPossible = lexer.state.linkParenPossible;
  lexer.state.linkParenPossible = prevLinkParenPossible && src.includes(')');
  try {
    // The masked source for emStrong/del, computed lazily and only when a
    // delimiter is actually seen. It masks the whole run, as marked does.
    let maskedSrc = null;
    const getMasked = () => {
      if (maskedSrc === null) maskedSrc = maskSrc(src, tokenizer, links);
      return maskedSrc;
    };

    const full = src;
    const len = full.length;
    let i = 0;
    // Start of the pending plain-text run, or -1 when there is none.
    let textFrom = -1;
    // The character before the current position, as marked tracks it: the
    // last character of the preceding text token (unless that token ends in
    // '_'), or '' after any other token and at the start of the run.
    let prevChar = '';

    const flushText = (end) => {
      if (textFrom === -1) return;
      const raw = full.slice(textFrom, end);
      const escaped = lexer.state.inRawBlock;
      // The numeric-reference decode is a no-op when there is no '&'.
      const text = (escaped || raw.indexOf('&') === -1) ? raw : decodeNumericCharacterReferences(raw);
      const last = tokens.at(-1);
      if (last?.type === 'text') {
        last.raw += raw;
        last.text += text;
      } else {
        tokens.push({ type: 'text', raw, text, escaped });
      }
      if (raw.slice(-1) !== '_') prevChar = raw.slice(-1);
      textFrom = -1;
    };

    while (i < len) {
      STOP_RE.lastIndex = i;
      const m = STOP_RE.exec(full);
      if (m === null) {
        // No construct starts in the rest of the run: it is all text.
        if (textFrom === -1) textFrom = i;
        i = len;
        break;
      }
      const stop = m.index;
      if (stop > i) {
        // Plain text up to the next possible construct; jump there.
        if (textFrom === -1) textFrom = i;
        i = stop;
      }

      // Flush the pending text first, so prevChar is the character right
      // before this position when emStrong/del read it.
      flushText(i);

      // Try the rules marked tries at this position, in its order, gated
      // by the character.
      const ch = full[i];
      const rest = full.slice(i);
      let tok;
      if (ch === '\\') {
        tok = tokenizer.escape(rest) || tokenizer.br(rest);
      } else if (ch === '<') {
        tok = tokenizer.tag(rest) || tokenizer.autolink(rest);
      } else if (ch === '[' || ch === '!') {
        tok = tokenizer.link(rest) || tokenizer.reflink(rest, links);
      } else if (ch === '*' || ch === '_') {
        tok = tokenizer.emStrong(rest, getMasked(), prevChar);
      } else if (ch === '`') {
        tok = tokenizer.codespan(rest);
      } else if (ch === ' ') {
        tok = tokenizer.br(rest);
      } else if (ch === '~') {
        tok = tokenizer.del(rest, getMasked(), prevChar);
      } else {
        // A www/http/ftp/mailto/xmpp/email start: only the url rule can
        // match, and only when we are not already inside a link (marked's
        // Lexer#inlineTokens gates it on !inLink, so an unclosed <a> in an
        // earlier run suppresses later autolinks in the same document).
        if (!lexer.state.inLink) tok = tokenizer.url(rest);
      }

      if (tok) {
        if (tok.type === 'text') {
          // A reference that resolves to nothing yields a single text
          // character; marked merges it and does not keep it as prevChar.
          const last = tokens.at(-1);
          if (last?.type === 'text') {
            last.raw += tok.raw;
            last.text += tok.text;
          } else {
            tokens.push(tok);
          }
          prevChar = '';
        } else {
          tokens.push(tok);
          prevChar = '';
        }
        i += tok.raw.length;
      } else {
        // No rule matched: this character is ordinary text after all.
        if (textFrom === -1) textFrom = i;
        if (ch === '`' || ch === '~') {
          // marked's text rule consumes a whole run of backticks or tildes
          // as its first character, so a failed codespan/del never retries
          // inside the run (e.g. ```foo`` stays literal, cm-347).
          let j = i + 1;
          while (j < len && full[j] === ch) j++;
          i = j;
        } else {
          i += 1;
        }
      }
    }

    flushText(len);
    return tokens;
  } finally {
    lexer.state.linkParenPossible = prevLinkParenPossible;
  }
}
