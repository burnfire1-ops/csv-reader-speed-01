// solve.js v5 — csv-reader 1.0.0 drop-in, scalar char-loop parser.
//
// Semantics follow vendor/csv-reader/index.js exactly. v5 replaces v4's
// indexOf two-path parser with a tight charCodeAt loop: on the server the
// indexOf path is penalised ~2.48x vs local while the oracle's scalar loop
// is penalised only ~1.22x (v4 server 1,350,000 us, rank 1692; local cold
// 545 ms vs oracle 1,132 ms). The scalar loop is the same speed class on
// both machines, so its server factor should track the oracle's, not v4's.
// Fields are built with slice() per segment instead of per-character concat,
// and field results travel in a closure slot instead of a fresh object per
// field. No indexOf and no regex anywhere on a hot path. Pure: no clock, no
// randomness, no locale, nothing kept between calls.
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

  let recordLine = 1;
  let recordRow = null;

  function error(code) {
    errors.push({ code, line: recordLine, row: recordRow });
  }

  let ended = END;

  // Reads unquoted characters onto `value` up to the next comma or line break.
  // A CR not followed by LF is dropped (stray_cr). Returns the field; sets `ended`.
  function readUnquoted(value) {
    let seg = pos;
    for (;;) {
      if (pos >= n) {
        if (seg < pos) value += text.slice(seg, pos);
        ended = END;
        return value;
      }
      const c = text.charCodeAt(pos);
      if (c === 44) { // ','
        if (seg < pos) value += text.slice(seg, pos);
        pos += 1;
        ended = COMMA;
        return value;
      }
      if (c === 10) { // '\n'
        if (seg < pos) value += text.slice(seg, pos);
        pos += 1;
        line += 1;
        ended = LINE_BREAK;
        return value;
      }
      if (c === 13) { // '\r'
        if (text.charCodeAt(pos + 1) === 10) {
          if (seg < pos) value += text.slice(seg, pos);
          pos += 2;
          line += 1;
          ended = LINE_BREAK;
          return value;
        }
        if (seg < pos) value += text.slice(seg, pos);
        error('stray_cr');
        pos += 1;
        seg = pos;
        continue;
      }
      pos += 1;
    }
  }

  // Reads a quoted field whose opening quote is at pos.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    let value = '';
    pos += 1;
    let seg = pos;
    for (;;) {
      if (pos >= n) {
        pos = open + 1;
        line = openLine;
        error('unterminated_quote');
        return readUnquoted('"');
      }
      const c = text.charCodeAt(pos);
      if (c === 34) { // '"'
        if (text.charCodeAt(pos + 1) === 34) {
          if (seg < pos) value += text.slice(seg, pos);
          value += '"';
          pos += 2;
          seg = pos;
          continue;
        }
        if (seg < pos) value += text.slice(seg, pos);
        pos += 1;
        if (pos >= n) {
          ended = END;
          return value;
        }
        const d = text.charCodeAt(pos);
        if (d === 44) {
          pos += 1;
          ended = COMMA;
          return value;
        }
        if (d === 10) {
          pos += 1;
          line += 1;
          ended = LINE_BREAK;
          return value;
        }
        if (d === 13 && text.charCodeAt(pos + 1) === 10) {
          pos += 2;
          line += 1;
          ended = LINE_BREAK;
          return value;
        }
        const before = value.length;
        value = readUnquoted(value);
        if (value.length > before) error('quote_junk');
        return value;
      }
      if (c === 13) { // CR inside quotes -> LF
        if (seg < pos) value += text.slice(seg, pos);
        value += '\n';
        line += 1;
        pos += text.charCodeAt(pos + 1) === 10 ? 2 : 1;
        seg = pos;
        continue;
      }
      if (c === 10) line += 1;
      pos += 1;
    }
  }

  for (;;) {
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
