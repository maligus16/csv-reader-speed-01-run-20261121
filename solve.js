// A fast drop-in for csv-reader 1.0.0 (make.fun's own CSV reader).
//
// Same answer as csv-reader 1.0.0 for every input {text, header}:
// {columns, rows, errors}. Written from scratch from the policy in the
// competition rules: BOM dropped, records end at LF/CRLF, empty lines are
// no records, lone CRs outside quotes are dropped (stray_cr), quoted fields
// run to the next non-doubled quote ("" -> one quote, CR/CRLF inside -> LF),
// junk after a closing quote is appended as-is (quote_junk), a quote that
// never closes is literal and the rest is re-read unquoted
// (unterminated_quote), quotes inside unquoted fields are literal, rows are
// padded/cut to the first record's width (short_row/long_row).
//
// Speed comes from never reading one character at a time on the common
// path: a record whose first physical line holds no quote is answered with
// one slice + one split; quoted fields are found with indexOf jumps and
// converted with slice/replace, not per-character concatenation.

/** csv-reader 1.0.0's answer for one case's input. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  const n = text.length;
  let pos = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  let line = 1;

  // Finish one record: header, width, short/long padding, push.
  // Returns nothing; `fields` is the record's fields.
  function finishRecord(fields, recordLine, recordRow) {
    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      return;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }

  // Read one unquoted field starting at `pos` (pos is past any opening
  // quote logic). `first` is the value it starts with ('' normally, '"'
  // for an unterminated quote re-read). Returns {value, ended} where ended
  // is 0 = comma, 1 = line break, 2 = end of text. Lone CRs are dropped
  // with a stray_cr error each; a CR right before the line break is the
  // CRLF, not a stray. `line` is advanced past a line break.
  function readUnquoted(first) {
    const comma = text.indexOf(',', pos);
    const nl = text.indexOf('\n', pos);
    let end;
    let ended;
    if (comma !== -1 && (nl === -1 || comma < nl)) {
      end = comma;
      ended = 0;
    } else if (nl !== -1) {
      end = nl;
      ended = 1;
    } else {
      end = n;
      ended = 2;
    }
    let segEnd = end;
    if (ended === 1 && segEnd > pos && text.charCodeAt(segEnd - 1) === 13) segEnd -= 1;
    let value = first;
    const cr = text.indexOf('\r', pos);
    if (cr === -1 || cr >= segEnd) {
      if (segEnd > pos) value += text.slice(pos, segEnd);
    } else {
      let s = pos;
      for (;;) {
        const i = text.indexOf('\r', s);
        if (i === -1 || i >= segEnd) {
          value += text.slice(s, segEnd);
          break;
        }
        value += text.slice(s, i);
        errors.push({ code: 'stray_cr', line: recordLineNow, row: recordRowNow });
        s = i + 1;
      }
    }
    if (ended === 1) line += 1;
    pos = ended === 2 ? n : end + 1;
    return { value, ended };
  }

  // The record being read, for error() calls inside readUnquoted.
  let recordLineNow = 1;
  let recordRowNow = null;

  while (true) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    const recordLine = line;
    const recordRow = header && columns === null ? null : rows.length;
    recordLineNow = recordLine;
    recordRowNow = recordRow;

    const nl = text.indexOf('\n', pos);
    const lineEnd = nl === -1 ? n : nl;
    const qi = text.indexOf('"', pos);

    if (qi === -1 || qi >= lineEnd) {
      // Fast path: no quote in this record's first physical line, so the
      // whole record is unquoted and ends at this line break (or the end).
      let segEnd = lineEnd;
      if (nl !== -1 && segEnd > pos && text.charCodeAt(segEnd - 1) === 13) segEnd -= 1;
      let fields = null;
      const cr = text.indexOf('\r', pos);
      if (cr === -1 || cr >= segEnd) {
        if (segEnd > pos) fields = text.slice(pos, segEnd).split(',');
      } else {
        let out = '';
        let s = pos;
        for (;;) {
          const i = text.indexOf('\r', s);
          if (i === -1 || i >= segEnd) {
            out += text.slice(s, segEnd);
            break;
          }
          out += text.slice(s, i);
          errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
          s = i + 1;
        }
        if (out !== '') fields = out.split(',');
      }
      if (nl !== -1) line += 1;
      pos = nl === -1 ? n : nl + 1;
      if (fields === null) continue;
      finishRecord(fields, recordLine, recordRow);
      continue;
    }

    // General path: at least one quote in this record's first line.
    const fields = [];
    let quoted = false;
    let ended = 0;
    for (;;) {
      quoted = text.charCodeAt(pos) === 34;
      let value;
      if (!quoted) {
        const f = readUnquoted('');
        value = f.value;
        ended = f.ended;
      } else {
        const open = pos;
        let q = pos + 1;
        let close = -1;
        for (;;) {
          q = text.indexOf('"', q);
          if (q === -1) break;
          if (text.charCodeAt(q + 1) === 34) {
            q += 2;
            continue;
          }
          close = q;
          break;
        }
        if (close === -1) {
          // The quote never closes: it is a literal character, and the
          // text after it is read again as unquoted.
          errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
          pos = open + 1;
          const f = readUnquoted('"');
          value = f.value;
          ended = f.ended;
        } else {
          let span = text.slice(open + 1, close);
          if (span.indexOf('"') !== -1) span = span.replaceAll('""', '"');
          if (span.indexOf('\r') !== -1 || span.indexOf('\n') !== -1) {
            const converted = span.replace(/\r\n?/g, '\n');
            let cnt = 0;
            let idx = -1;
            for (;;) {
              idx = converted.indexOf('\n', idx + 1);
              if (idx === -1) break;
              cnt += 1;
            }
            line += cnt;
            span = converted;
          }
          value = span;
          pos = close + 1;
          if (pos >= n) {
            ended = 2;
          } else {
            const c = text.charCodeAt(pos);
            if (c === 44) {
              pos += 1;
              ended = 0;
            } else if (c === 10) {
              pos += 1;
              line += 1;
              ended = 1;
            } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
              pos += 2;
              line += 1;
              ended = 1;
            } else {
              // Junk after the closing quote, appended as it stands.
              const f = readUnquoted(value);
              if (f.value.length > value.length) {
                errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
              }
              value = f.value;
              ended = f.ended;
            }
          }
        }
      }
      fields.push(value);
      if (ended !== 0) break;
    }

    // A line that held only stray CRs is left with no characters: no
    // record (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;
    finishRecord(fields, recordLine, recordRow);
  }

  return { columns: header ? (columns ?? []) : null, rows, errors };
}
