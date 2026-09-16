import { normalizeEmail } from "@/lib/email-address";

/*
 * Reading a roster out of a CSV, and saying what is wrong with it before
 * anybody commits to it.
 *
 * spec/04 (deferred convenience screens): "CSV roster import with
 * preview/validation and explicit apply".
 * AC-055: "Preview identifies issues; explicit apply idempotent; manager
 * cannot assign foreign org/role; output reconciles counts."
 *
 * Two properties shape this file:
 *
 *   - Preview and apply see the SAME rows. The preview is not an estimate; it
 *     is the plan, and apply carries out exactly the rows it showed. A preview
 *     that silently differed from what happened would be worse than none.
 *
 *   - A row is either valid or it is not, and an invalid one is named. There
 *     is no "mostly imported" outcome where somebody has to guess which of
 *     four hundred people arrived.
 */

export type RowProblem =
  | "missing_email"
  | "invalid_email"
  | "missing_name"
  | "name_too_long"
  | "duplicate_in_file"
  | "not_a_learner";

export interface RosterRow {
  /** 1-based line in the file as a person sees it, header excluded. */
  line: number;
  email: string;
  displayName: string;
  problems: RowProblem[];
}

export interface RosterPreview {
  rows: RosterRow[];
  valid: RosterRow[];
  invalid: RosterRow[];
  /** Counts that must reconcile: valid + invalid = rows. */
  totals: { rows: number; valid: number; invalid: number };
}

export class RosterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RosterError";
  }
}

/*
 * RFC 4180 parsing, the same shape lib/csv.ts writes: quoted fields may
 * contain commas, quotes are doubled inside them, and a record may span lines
 * when it is quoted. Written out rather than split(",") because a roster is
 * exactly the kind of file that contains "Doe, Jane".
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let index = 0;

  // A leading BOM is invisible to a person and would otherwise become part of
  // the first header's name.
  const body = text.replace(/^﻿/, "");

  while (index < body.length) {
    const char = body[index];

    if (quoted) {
      if (char === '"') {
        if (body[index + 1] === '"') {
          field += '"';
          index += 2;
          continue;
        }
        quoted = false;
        index += 1;
        continue;
      }
      field += char;
      index += 1;
      continue;
    }

    if (char === '"') {
      quoted = true;
      index += 1;
      continue;
    }
    if (char === ",") {
      row.push(field);
      field = "";
      index += 1;
      continue;
    }
    if (char === "\r" || char === "\n") {
      // CRLF counts once.
      if (char === "\r" && body[index + 1] === "\n") index += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      index += 1;
      continue;
    }
    field += char;
    index += 1;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((entry) => entry.some((value) => value.trim().length > 0));
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Reads a roster and reports every problem at once.
 *
 * The header may name the columns in either order; without a recognisable
 * header the first two columns are taken as email and name, because that is
 * what a spreadsheet exported without headers looks like.
 */
export function previewRoster(text: string): RosterPreview {
  const records = parseCsv(text);
  if (records.length === 0) throw new RosterError("That file has no rows.");

  const header = records[0].map((value) => value.trim().toLowerCase());
  const hasHeader = header.some((value) => value === "email" || value === "e-mail");

  let emailAt = 0;
  let nameAt = 1;
  if (hasHeader) {
    emailAt = header.findIndex((value) => value === "email" || value === "e-mail");
    const named = header.findIndex(
      (value) => value === "name" || value === "display_name" || value === "display name"
    );
    nameAt = named === -1 ? (emailAt === 0 ? 1 : 0) : named;
  }

  const body = hasHeader ? records.slice(1) : records;
  const seen = new Map<string, number>();
  const rows: RosterRow[] = [];

  body.forEach((record, index) => {
    const rawEmail = (record[emailAt] ?? "").trim();
    const rawName = (record[nameAt] ?? "").trim();
    const problems: RowProblem[] = [];

    if (rawEmail.length === 0) problems.push("missing_email");
    else if (!EMAIL.test(rawEmail)) problems.push("invalid_email");

    if (rawName.length === 0) problems.push("missing_name");
    else if (rawName.length > 120) problems.push("name_too_long");

    const key = rawEmail.length > 0 ? normalizeEmail(rawEmail) : "";
    if (key.length > 0) {
      const first = seen.get(key);
      if (first !== undefined) {
        /*
         * A duplicate is a problem with the SECOND occurrence, not the first.
         * The person is imported once, which is what somebody who pasted a
         * list twice actually wants, and the line is named so they can see why
         * the count is lower than the file's length.
         */
        problems.push("duplicate_in_file");
      } else {
        seen.set(key, index + 1);
      }
    }

    rows.push({
      line: index + 1,
      email: key.length > 0 ? key : rawEmail,
      displayName: rawName,
      problems,
    });
  });

  const valid = rows.filter((row) => row.problems.length === 0);
  const invalid = rows.filter((row) => row.problems.length > 0);

  return {
    rows,
    valid,
    invalid,
    // AC-055: "output reconciles counts". These three always agree.
    totals: { rows: rows.length, valid: valid.length, invalid: invalid.length },
  };
}

/** What a person is told about each problem, in their own words. */
export const PROBLEM_TEXT: Record<RowProblem, string> = {
  missing_email: "No email address.",
  invalid_email: "That does not look like an email address.",
  missing_name: "No name.",
  name_too_long: "That name is longer than 120 characters.",
  duplicate_in_file: "The same address appears earlier in this file.",
  not_a_learner: "Only learners can be imported this way.",
};
