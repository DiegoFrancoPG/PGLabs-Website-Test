import { describe, it, expect } from "vitest";
import { toCsv, escapeField, neutralizeFormula, type CsvColumn } from "@/lib/csv";

/*
 * AC-038's first clause, at the unit level: "Dangerous field prefixed with
 * quote and RFC4180 escaped". The scoping half is in
 * tests/integration/reports.test.ts, where a real manager asks for somebody
 * else's organization.
 */

interface Row {
  name: string;
  note: string | null;
  count: number;
}

const columns: readonly CsvColumn<Row>[] = [
  { header: "name", value: (r) => r.name, userEntered: true },
  { header: "note", value: (r) => r.note, userEntered: true },
  { header: "count", value: (r) => r.count },
];

const rowsOf = (csv: string) => csv.replace(/^﻿/, "").trimEnd().split("\r\n");

describe("AC-038 spreadsheet formula injection", () => {
  it("prefixes a value whose first visible character starts a formula", () => {
    for (const dangerous of ["=1+1", "+1", "-1", "@SUM(A1)", "\t=cmd"]) {
      expect(neutralizeFormula(dangerous)).toBe(`'${dangerous}`);
    }
  });

  it("looks past leading whitespace, which is exactly the scenario's case", () => {
    /*
     * AC-038: "Learner name begins whitespace then =". A check on the raw
     * first character would see a space, pass it through, and the spreadsheet
     * — which ignores the space — would run the formula.
     */
    const name = "   =HYPERLINK(\"http://attacker.example\",\"Click\")";
    expect(neutralizeFormula(name).startsWith("'")).toBe(true);
  });

  it("leaves ordinary text and machine values alone", () => {
    for (const safe of ["Amber", "O'Brien", "2026-09-15T12:00:00Z", "66.7", ""]) {
      expect(neutralizeFormula(safe)).toBe(safe);
    }
  });

  it("does not defend machine-generated columns, so their values survive intact", () => {
    // A negative number in a numeric column stays a number, not '-1.
    const csv = toCsv(columns, [{ name: "Amber", note: null, count: -1 }]);
    expect(rowsOf(csv)[1]).toBe("Amber,,-1");
  });

  it("prefixes and then escapes, in that order", () => {
    // The prefix goes inside the quotes; escaping the already-prefixed value.
    const csv = toCsv(columns, [{ name: '=cmd|"/c calc"!A1', note: null, count: 1 }]);
    expect(rowsOf(csv)[1]).toBe(`"'=cmd|""/c calc""!A1",,1`);
  });
});

describe("AC-038 RFC 4180 quoting", () => {
  it("quotes a field with a comma, a quote or a newline, and doubles quotes", () => {
    expect(escapeField("plain")).toBe("plain");
    expect(escapeField("a,b")).toBe('"a,b"');
    expect(escapeField('say "hi"')).toBe('"say ""hi"""');
    expect(escapeField("two\nlines")).toBe('"two\nlines"');
    expect(escapeField("carriage\rreturn")).toBe('"carriage\rreturn"');
  });

  it("round-trips a name containing a comma without splitting the row", () => {
    const csv = toCsv(columns, [{ name: "Doe, Jane", note: "ok", count: 2 }]);
    expect(rowsOf(csv)).toEqual(["name,note,count", '"Doe, Jane",ok,2']);
  });
});

describe("AC-038 the file's shape", () => {
  it("starts with a BOM, so a spreadsheet reads it as UTF-8", () => {
    const csv = toCsv(columns, [{ name: "Ólafur", note: null, count: 1 }]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain("Ólafur");
  });

  it("separates rows with CRLF and ends with one", () => {
    const csv = toCsv(columns, [
      { name: "A", note: null, count: 1 },
      { name: "B", note: null, count: 2 },
    ]);
    expect(csv.endsWith("\r\n")).toBe(true);
    expect(csv.replace(/^﻿/, "")).toBe("name,note,count\r\nA,,1\r\nB,,2\r\n");
  });

  it("writes a header even when there are no rows", () => {
    expect(rowsOf(toCsv(columns, []))).toEqual(["name,note,count"]);
  });

  it("writes an empty cell for null, not the word null", () => {
    const csv = toCsv(columns, [{ name: "A", note: null, count: 0 }]);
    expect(rowsOf(csv)[1]).toBe("A,,0");
  });
});
