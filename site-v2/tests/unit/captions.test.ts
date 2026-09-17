import { describe, it, expect } from "vitest";
import { convertToVtt, parseCues, CaptionError } from "@/lib/captions";

/*
 * AC-017 — caption conversion, at the unit level. The file-handling half is in
 * tests/integration/assets.test.ts.
 */
const SRT = [
  "1",
  "00:00:01,000 --> 00:00:04,500",
  "Define the task and the audience.",
  "",
  "2",
  "00:00:04,000 --> 00:00:08,250",
  "Then say what good output looks like.",
  "",
].join("\n");

describe("SRT to WebVTT", () => {
  it("preserves every timestamp exactly", () => {
    const { vtt } = convertToVtt(SRT);
    expect(vtt).toContain("00:00:01.000 --> 00:00:04.500");
    expect(vtt).toContain("00:00:04.000 --> 00:00:08.250");
  });

  it("preserves the text", () => {
    const { vtt } = convertToVtt(SRT);
    expect(vtt).toContain("Define the task and the audience.");
    expect(vtt).toContain("Then say what good output looks like.");
  });

  it("starts with the WEBVTT header", () => {
    expect(convertToVtt(SRT).vtt.startsWith("WEBVTT")).toBe(true);
  });

  it("keeps overlapping cues, in their original order", () => {
    /*
     * The second cue starts before the first ends: two speakers at once. An
     * implementation that sorted or de-overlapped would corrupt the file, so
     * this asserts the order as written rather than a normalised one.
     */
    const { vtt, cueCount } = convertToVtt(SRT);
    expect(cueCount).toBe(2);
    expect(vtt.indexOf("00:00:01.000")).toBeLessThan(vtt.indexOf("00:00:04.000 -->"));
  });

  it("derives plain searchable text from the cues", () => {
    expect(convertToVtt(SRT).sourceText).toBe(
      "Define the task and the audience. Then say what good output looks like."
    );
  });

  it("rejects a cue that ends when it starts, or earlier", () => {
    for (const bad of ["00:00:05,000 --> 00:00:05,000", "00:00:09,000 --> 00:00:02,000"]) {
      const input = ["1", bad, "Text", ""].join("\n");
      expect(() => convertToVtt(input)).toThrow(CaptionError);
      try {
        convertToVtt(input);
      } catch (err) {
        expect((err as CaptionError).code).toBe("CAPTION_RANGE_INVALID");
      }
    }
  });

  it("rejects negative and non-numeric timestamps", () => {
    const bad = [
      "-00:00:01,000 --> 00:00:04,000",
      "aa:bb:cc,ddd --> 00:00:04,000",
      "00:00:01 --> 00:00:04,000",
    ];
    for (const line of bad) {
      expect(() => convertToVtt(["1", line, "Text", ""].join("\n"))).toThrow(/invalid timestamp/);
    }
  });

  it("carries no markup through, so nothing can execute", () => {
    const hostile = [
      "1",
      "00:00:01,000 --> 00:00:04,000",
      "<script>alert(1)</script><b>Bold</b> &lt;img onerror=1&gt;",
      "",
    ].join("\n");
    const { vtt, sourceText } = convertToVtt(hostile);
    /*
     * spec/03: "Do not execute HTML inside captions/Markdown."
     *
     * The property that matters is that nothing in the output can be parsed as
     * markup, so this asserts on angle brackets and entities rather than on the
     * names of particular tags — a blocklist of tag names is exactly the kind
     * of check that passes while the next payload walks through it.
     */
    // The timing lines are excluded: "-->" is VTT's cue arrow, not markup.
    const cueText = vtt
      .split("\n")
      .filter((line) => !line.includes("-->") && line !== "WEBVTT")
      .join("\n");
    expect(cueText).not.toMatch(/[<>]/);
    expect(sourceText).not.toMatch(/[<>]/);
    // Entities are not decoded back into brackets either.
    expect(sourceText).not.toMatch(/&[#\w]+;/);
    // Script contents are dropped, not left behind as subtitle text.
    expect(sourceText).not.toContain("alert(1)");
    // Legitimate wording survives.
    expect(sourceText).toContain("Bold");
  });

  it("rejects a cue that runs past the media, allowing two seconds of slack", () => {
    const late = ["1", "00:00:01,000 --> 00:10:05,000", "Text", ""].join("\n");
    // 10:05 is five seconds past a ten-minute video: beyond the tolerance.
    expect(() => convertToVtt(late, { durationMs: 600_000 })).toThrow(/past the media length/);

    const withinSlack = ["1", "00:00:01,000 --> 00:10:01,000", "Text", ""].join("\n");
    expect(() => convertToVtt(withinSlack, { durationMs: 600_000 })).not.toThrow();
  });

  it("accepts a VTT file as input and normalises it", () => {
    const vttInput = ["WEBVTT", "", "00:00:01.000 --> 00:00:03.000", "Already VTT", ""].join("\n");
    expect(convertToVtt(vttInput).vtt).toContain("00:00:01.000 --> 00:00:03.000");
  });

  it("handles CRLF line endings and a byte order mark", () => {
    const messy = "﻿1\r\n00:00:01,000 --> 00:00:03,000\r\nWindows file\r\n";
    expect(convertToVtt(messy).sourceText).toBe("Windows file");
  });

  it("accepts a timestamp with no hours field, as SRT sometimes writes", () => {
    expect(parseCues(["1", "00:01,000 --> 00:03,000", "Short form", ""].join("\n"))[0].startMs).toBe(
      1000
    );
  });

  it("rejects a file with no cues at all", () => {
    expect(() => convertToVtt("not a caption file")).toThrow(/no cues/);
  });

  it("drops VTT positioning settings rather than choking on them", () => {
    const positioned = [
      "WEBVTT",
      "",
      "00:00:01.000 --> 00:00:03.000 line:90% align:center",
      "Positioned",
      "",
    ].join("\n");
    const { vtt } = convertToVtt(positioned);
    expect(vtt).toContain("00:00:01.000 --> 00:00:03.000");
    expect(vtt).not.toContain("line:90%");
  });
});
