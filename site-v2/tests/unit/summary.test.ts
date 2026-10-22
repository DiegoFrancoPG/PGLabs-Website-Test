import { describe, it, expect } from "vitest";
import { lessonSummary } from "@/lib/summary";

describe("lessonSummary", () => {
  it("uses the lesson's description when there is one, as plain prose", () => {
    expect(lessonSummary("## Why it matters\n\nAI **changes** how [teams](https://x.org) work.", "ignored")).toBe(
      "Why it matters AI changes how teams work."
    );
  });

  it("falls back to the transcript without cue numbers or timestamps", () => {
    const vtt = "WEBVTT\n\n1\n00:00:01.000 --> 00:00:04.000\nWelcome to the course.\n\n2\n00:00:04.500 --> 00:00:07.000\nToday we start.";
    expect(lessonSummary("", vtt)).toBe("Welcome to the course. Today we start.");
    expect(lessonSummary("  ", "[00:12] Hello there.")).toBe("Hello there.");
  });

  it("cuts long text at a sentence boundary", () => {
    const text = `${"A first sentence that runs on. ".repeat(8)}The end.`;
    const summary = lessonSummary(text, "", 120);
    expect(summary.length).toBeLessThanOrEqual(120);
    expect(summary.endsWith(".")).toBe(true);
  });

  it("cuts at a word with an ellipsis when no sentence ends in time", () => {
    const summary = lessonSummary("word ".repeat(100), "", 50);
    expect(summary.endsWith("word…")).toBe(true);
    expect(summary.length).toBeLessThanOrEqual(51);
  });

  it("is empty when there is nothing to summarize", () => {
    expect(lessonSummary("", "")).toBe("");
  });
});
