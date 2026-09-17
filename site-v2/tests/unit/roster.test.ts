import { describe, it, expect } from "vitest";
import { parseCsv, previewRoster, PROBLEM_TEXT, RosterError } from "@/lib/roster";

/*
 * AC-055's first clause: "Preview identifies issues."
 *
 * The apply half — idempotence, and that a manager cannot reach another
 * organization — is in tests/integration/bulk-import.test.ts, because it is a
 * property of the commands rather than of the file.
 */

describe("reading a CSV a person actually exported", () => {
  it("reads a plain file with a header in either column order", () => {
    const withEmailFirst = previewRoster("email,name\na@example.invalid,Ann\n");
    const withNameFirst = previewRoster("name,email\nAnn,a@example.invalid\n");
    expect(withEmailFirst.valid[0]).toMatchObject({ email: "a@example.invalid", displayName: "Ann" });
    expect(withNameFirst.valid[0]).toMatchObject({ email: "a@example.invalid", displayName: "Ann" });
  });

  it("takes the first two columns when there is no header", () => {
    const preview = previewRoster("a@example.invalid,Ann\nb@example.invalid,Ben\n");
    expect(preview.totals.rows).toBe(2);
    expect(preview.valid).toHaveLength(2);
  });

  it("keeps a comma inside a quoted name", () => {
    const preview = previewRoster('email,name\na@example.invalid,"Doe, Jane"\n');
    expect(preview.valid[0].displayName).toBe("Doe, Jane");
  });

  it("keeps a doubled quote inside a quoted field", () => {
    const preview = previewRoster('email,name\na@example.invalid,"Jane ""Jan"" Doe"\n');
    expect(preview.valid[0].displayName).toBe('Jane "Jan" Doe');
  });

  it("reads CRLF, LF and a missing final newline alike", () => {
    for (const text of [
      "email,name\r\na@example.invalid,Ann\r\n",
      "email,name\na@example.invalid,Ann\n",
      "email,name\na@example.invalid,Ann",
    ]) {
      expect(previewRoster(text).valid).toHaveLength(1);
    }
  });

  it("ignores a byte order mark, which is invisible to whoever exported the file", () => {
    const preview = previewRoster("﻿email,name\na@example.invalid,Ann\n");
    expect(preview.valid).toHaveLength(1);
    expect(preview.valid[0].email).toBe("a@example.invalid");
  });

  it("skips blank lines rather than counting them as people", () => {
    const preview = previewRoster("email,name\n\na@example.invalid,Ann\n\n\n");
    expect(preview.totals.rows).toBe(1);
  });

  it("refuses an empty file rather than reporting nothing to do", () => {
    expect(() => previewRoster("")).toThrow(RosterError);
    expect(() => previewRoster("\n\n")).toThrow(RosterError);
  });

  it("parses a record that spans lines inside quotes", () => {
    expect(parseCsv('a,"two\nlines"\n')).toEqual([["a", "two\nlines"]]);
  });
});

describe("AC-055 the preview names every problem", () => {
  const messy = [
    "email,name",
    "good@example.invalid,Good Person", // fine
    ",No Address", // missing email
    "not-an-email,Bad Address", // invalid email
    "noname@example.invalid,", // missing name
    "GOOD@example.invalid,Duplicate Person", // duplicate, differently cased
    `long@example.invalid,${"x".repeat(121)}`, // name too long
  ].join("\n");

  it("reports each row's own problems and reconciles the counts", () => {
    const preview = previewRoster(messy);

    expect(preview.totals.rows).toBe(6);
    expect(preview.totals.valid).toBe(1);
    expect(preview.totals.invalid).toBe(5);
    // AC-055: "output reconciles counts."
    expect(preview.totals.valid + preview.totals.invalid).toBe(preview.totals.rows);
    expect(preview.valid.length + preview.invalid.length).toBe(preview.rows.length);
  });

  it("names the line each problem is on, as the person sees it", () => {
    const preview = previewRoster(messy);
    const at = (line: number) => preview.rows.find((row) => row.line === line);

    expect(at(1)?.problems).toEqual([]);
    expect(at(2)?.problems).toContain("missing_email");
    expect(at(3)?.problems).toContain("invalid_email");
    expect(at(4)?.problems).toContain("missing_name");
    expect(at(5)?.problems).toContain("duplicate_in_file");
    expect(at(6)?.problems).toContain("name_too_long");
  });

  it("treats a differently cased address as the same person", () => {
    const preview = previewRoster(
      "email,name\nAnn@Example.Invalid,Ann\nann@example.invalid,Ann Again\n"
    );
    // The first is imported; the second is named as the duplicate it is.
    expect(preview.valid).toHaveLength(1);
    expect(preview.valid[0].email).toBe("ann@example.invalid");
    expect(preview.invalid[0].problems).toContain("duplicate_in_file");
  });

  it("reports several problems on one row rather than only the first", () => {
    const preview = previewRoster("email,name\nnot-an-email,\n");
    expect(preview.invalid[0].problems).toEqual(
      expect.arrayContaining(["invalid_email", "missing_name"])
    );
  });

  it("normalises the address it will actually use", () => {
    const preview = previewRoster("email,name\n  Ann@Example.Invalid  ,Ann\n");
    expect(preview.valid[0].email).toBe("ann@example.invalid");
  });

  it("has a sentence for every problem it can report", () => {
    const preview = previewRoster(
      ["email,name", ",x", "bad,x", "a@example.invalid,", "a@example.invalid,x"].join("\n")
    );
    for (const row of preview.invalid) {
      for (const problem of row.problems) {
        expect(PROBLEM_TEXT[problem]).toBeTruthy();
        expect(PROBLEM_TEXT[problem].length).toBeGreaterThan(5);
      }
    }
  });
});

describe("AC-055 the preview is the plan", () => {
  it("returns the same rows however many times it is asked", () => {
    const text = "email,name\na@example.invalid,Ann\nbad,Ben\n";
    expect(previewRoster(text)).toEqual(previewRoster(text));
  });

  it("carries every row, valid or not, so nothing disappears silently", () => {
    const preview = previewRoster("email,name\na@example.invalid,Ann\nbad,Ben\n");
    expect(preview.rows.map((row) => row.line)).toEqual([1, 2]);
    // The invalid row is still in `rows`: a person seeing "1 of 2" can find
    // the other one.
    expect(preview.rows).toHaveLength(preview.valid.length + preview.invalid.length);
  });
});
