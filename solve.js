// solve.js v3 — csv-reader 1.0.0 drop-in, two-path parser.
//
// Semantics follow vendor/csv-reader/index.js exactly. The fast path scans
// unquoted fields with three indexOf calls + slice (measured ~20% faster
// than one regex exec on the practice set, M5); the quoted path jumps quote
// to quote with indexOf. No character-at-a-time loop is left on any hot
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

  // Reads unquoted characters onto `value` up to the next comma or line break: a CR not followed by LF is dropped
  // (stray_cr). Returns the field and how it ended; `added` counts the characters kept.
  // Three indexOf calls (measured ~20% faster than one regex exec on the practice set, M5).
  function readUnquoted(value) {
    let added = 0;
    for (;;) {
      let i = text.indexOf(',', pos);
      const nl = text.indexOf('\n', pos);
      if (nl !== -1 && (i === -1 || nl < i)) i = nl;
      const cr = text.indexOf('\r', pos);
      if (cr !== -1 && (i === -1 || cr < i)) i = cr;
      if (i === -1) {
        if (pos < n) {
          value += text.slice(pos);
          added += n - pos;
          pos = n;
        }
        return { value, ended: END, added };
      }
      if (i > pos) {
        value += text.slice(pos, i);
        added += i - pos;
      }
      const c = text.charCodeAt(i);
      if (c === 44) {
        pos = i + 1;
        return { value, ended: COMMA, added };
      }
      if (c === 10) {
        pos = i + 1;
        line += 1;
        return { value, ended: LINE_BREAK, added };
      }
      // '\r': CRLF ends the line, a lone CR is dropped (stray_cr) and the field goes on.
      if (text.charCodeAt(i + 1) === 10) {
        pos = i + 2;
        line += 1;
        return { value, ended: LINE_BREAK, added };
      }
      error('stray_cr');
      pos = i + 1;
    }
  }

  // The raw slice [a, b) of a quoted field, with CRLF / lone CR read as LF: counts the lines it spans
  // (one per LF and one per CR not followed by LF) and converts them. Fast path when it holds no CR/LF.
  function flushSegment(a, b) {
    const lf = text.indexOf('\n', a);
    if (lf === -1 || lf >= b) {
      const cr = text.indexOf('\r', a);
      if (cr === -1 || cr >= b) return text.slice(a, b);
      const seg = text.slice(a, b);
      line += (seg.match(/\r(?!\n)/g) || []).length;
      return seg.replace(/\r\n?/g, '\n');
    }
    const cr = text.indexOf('\r', a);
    if (cr === -1 || cr >= b) {
      let count = 0;
      let i = lf;
      while (i !== -1 && i < b) {
        count += 1;
        i = text.indexOf('\n', i + 1);
      }
      line += count;
      return text.slice(a, b);
    }
    const seg = text.slice(a, b);
    line += (seg.match(/\n/g) || []).length + (seg.match(/\r(?!\n)/g) || []).length;
    return seg.replace(/\r\n?/g, '\n');
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
      if (pos >= n) return { value, ended: END };
      const c = text.charCodeAt(pos);
      if (c === 44) {
        pos += 1;
        return { value, ended: COMMA };
      }
      if (c === 10) {
        pos += 1;
        line += 1;
        return { value, ended: LINE_BREAK };
      }
      if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
        return { value, ended: LINE_BREAK };
      }
      // What follows the closing quote is appended as it stands, up to the next comma or line break.
      const junk = readUnquoted(value);
      if (junk.added > 0) error('quote_junk');
      return junk;
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
    let field;
    let quoted;
    do {
      quoted = text.charCodeAt(pos) === 34;
      field = quoted ? readQuoted() : readUnquoted('');
      fields.push(field.value);
    } while (field.ended === COMMA);

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
