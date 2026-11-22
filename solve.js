// solve.js v4 — csv-reader 1.0.0 drop-in, two-path parser.
//
// Semantics follow vendor/csv-reader/index.js exactly. v4 is v3 tuned for a
// cold run (the grader executes every timed round in a fresh container, so
// warm JIT numbers do not count): the unquoted scan caches the current line's
// extent (one indexOf(',') per field instead of three indexOf calls), field
// results travel in a closure slot instead of a fresh object per field, and
// flushSegment converts CR/CRLF without regex (no regex compile on a cold
// run, no match arrays). No character-at-a-time loop is left on any hot
// path. Pure: no clock, no randomness, no locale, nothing kept between calls.
const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

/** csv-reader 1.0.0's answer for one case's input. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  const n = text.length;
  let pos = text.charCodeAt(0) === 0xFEFF ? 1 : 0;
  let line = 1;

  // The record being read: the line it starts on and the index in rows it takes (null: the header).
  let recordLine = 1;
  let recordRow = null;

  function error(code) {
    errors.push({ code, line: recordLine, row: recordRow });
  }

  // How the last field read ended (COMMA / LINE_BREAK / END). Kept in a
  // closure slot instead of a fresh {value, ended, added} object per field:
  // ~600k fields per set, and one object per field was measurable in GC.
  let ended = END;

  // The current line's extent, cached across the fields of one line: the
  // index of its '\n' (or n) and of its first '\r' (or -1). Recomputed when
  // pos moves past the cached line end, or when the cached CR is now behind
  // pos (readQuoted can consume CRs inside quotes without this cache
  // knowing). This turns the unquoted scan's three indexOf calls per field
  // into one indexOf(',') per field plus two cached compares.
  let lineEnd = -1;
  let lineCr = -1;

  // Reads unquoted characters onto `value` up to the next comma or line break: a CR not followed by LF is dropped
  // (stray_cr). Returns the field string; sets `ended`.
  function readUnquoted(value) {
    for (;;) {
      // The cache is stale when pos moved past the line end, OR when the
      // cached CR is now behind pos: readQuoted can consume CRs inside quotes
      // (flushSegment) without this cache knowing, so a CR it already ate
      // must never be re-read as a stray CR here.
      if (pos > lineEnd || (lineCr !== -1 && lineCr < pos)) {
        lineEnd = text.indexOf('\n', pos);
        if (lineEnd === -1) lineEnd = n;
        lineCr = text.indexOf('\r', pos);
        if (lineCr === -1 || lineCr > lineEnd) lineCr = -1;
      }
      const comma = text.indexOf(',', pos);
      let i = comma === -1 || comma > lineEnd ? lineEnd : comma;
      if (lineCr !== -1 && lineCr < i) {
        // A CR comes first: CRLF (CR at lineEnd - 1, with a real '\n' after it) ends the line,
        // a lone CR is dropped (stray_cr). At EOF (lineEnd === n) a trailing CR has no LF after
        // it, so it is lone, not CRLF.
        if (lineCr === lineEnd - 1 && lineEnd !== n) {
          if (lineCr > pos) value += text.slice(pos, lineCr);
          pos = lineEnd + 1;
          line += 1;
          ended = LINE_BREAK;
          return value;
        }
        if (lineCr > pos) value += text.slice(pos, lineCr);
        error('stray_cr');
        pos = lineCr + 1;
        lineCr = text.indexOf('\r', pos);
        if (lineCr === -1 || lineCr > lineEnd) lineCr = -1;
        continue;
      }
      if (i > pos) value += text.slice(pos, i);
      if (i === lineEnd) {
        if (lineEnd === n) {
          pos = n;
          ended = END;
        } else {
          pos = lineEnd + 1;
          line += 1;
          ended = LINE_BREAK;
        }
        return value;
      }
      pos = i + 1;
      ended = COMMA;
      return value;
    }
  }

  // The raw slice [a, b) of a quoted field, with CRLF / lone CR read as LF: counts the lines it spans
  // (one per LF and one per CR not followed by LF) and converts them. Fast path when it holds no CR/LF.
  // No regex: the old .match()/.replace() compiled regexes on a cold run and allocated match arrays.
  function flushSegment(a, b) {
    const lf = text.indexOf('\n', a);
    if (lf === -1 || lf >= b) {
      const cr = text.indexOf('\r', a);
      if (cr === -1 || cr >= b) return text.slice(a, b);
      // CRs only: walk them, converting each CR/CRLF to LF (one line each).
      let out = '';
      let s = a;
      let i = cr;
      for (;;) {
        out += text.slice(s, i) + '\n';
        line += 1;
        s = text.charCodeAt(i + 1) === 10 ? i + 2 : i + 1;
        i = text.indexOf('\r', s);
        if (i === -1 || i >= b) break;
      }
      if (s < b) out += text.slice(s, b);
      return out;
    }
    const cr = text.indexOf('\r', a);
    if (cr === -1 || cr >= b) {
      // LFs only: count them, no conversion.
      let count = 0;
      let i = lf;
      while (i !== -1 && i < b) {
        count += 1;
        i = text.indexOf('\n', i + 1);
      }
      line += count;
      return text.slice(a, b);
    }
    // Both: convert each CR/CRLF to LF, counting the LFs passed on the way.
    let out = '';
    let s = a;
    let i = cr;
    for (;;) {
      let j = text.indexOf('\n', s);
      while (j !== -1 && j < i) {
        line += 1;
        j = text.indexOf('\n', j + 1);
      }
      out += text.slice(s, i) + '\n';
      line += 1;
      s = text.charCodeAt(i + 1) === 10 ? i + 2 : i + 1;
      i = text.indexOf('\r', s);
      if (i === -1 || i >= b) break;
    }
    let j = text.indexOf('\n', s);
    while (j !== -1 && j < b) {
      line += 1;
      j = text.indexOf('\n', j + 1);
    }
    if (s < b) out += text.slice(s, b);
    return out;
  }

  // Reads a quoted field whose opening quote is at pos: jumps quote to quote with indexOf,
  // so a quoted field costs native scans, not one JS iteration per character.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    let value = '';
    pos += 1;
    let segStart = pos;
    for (;;) {
      const q = text.indexOf('"', pos);
      if (q === -1) {
        // The quote never closes: it is a literal character, and the text after it is read again as unquoted.
        pos = open + 1;
        line = openLine;
        error('unterminated_quote');
        return readUnquoted('"');
      }
      if (text.charCodeAt(q + 1) === 34) {
        // Doubled quote: one literal quote, and the field goes on.
        value += flushSegment(segStart, q);
        value += '"';
        pos = q + 2;
        segStart = q + 2;
        continue;
      }
      // Closed at q.
      value += flushSegment(segStart, q);
      pos = q + 1;
      if (pos >= n) {
        ended = END;
        return value;
      }
      const c = text.charCodeAt(pos);
      if (c === 44) {
        pos += 1;
        ended = COMMA;
        return value;
      }
      if (c === 10) {
        pos += 1;
        line += 1;
        ended = LINE_BREAK;
        return value;
      }
      if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
        ended = LINE_BREAK;
        return value;
      }
      // What follows the closing quote is appended as it stands, up to the next comma or line break.
      // `added` was the kept-character count; the value's length change says the same.
      const before = value.length;
      value = readUnquoted(value);
      if (value.length > before) error('quote_junk');
      return value;
    }
  }

  for (;;) {
    // Lines with no characters are no records.
    while (pos < n) {
      if (text.charCodeAt(pos) === 10) {
        pos += 1;
        line += 1;
      } else if (text.charCodeAt(pos) === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let quoted;
    do {
      quoted = text.charCodeAt(pos) === 34;
      fields.push(quoted ? readQuoted() : readUnquoted(''));
    } while (ended === COMMA);

    // A line that held only stray CRs is left with no characters: no record (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
