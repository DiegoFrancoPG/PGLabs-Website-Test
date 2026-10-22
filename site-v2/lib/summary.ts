/*
 * The short summary on a lesson's information card.
 *
 * A lesson's description (`body_md`) is the summary when the author wrote one;
 * otherwise the opening of its source text (the transcript every published
 * video carries) stands in. Either way it is reduced to plain prose — no
 * Markdown marks, caption cue numbers or timestamps — and cut at a sentence
 * boundary near `maxChars`, which the card then clamps to three lines.
 */

const TIMESTAMP = /^\s*\[?(\d{1,2}:)?\d{1,2}:\d{2}([.,]\d{1,3})?\]?(\s*-->\s*(\d{1,2}:)?\d{1,2}:\d{2}([.,]\d{1,3})?)?/;

function plain(text: string): string {
  return text
    .split(/\r?\n/)
    .filter((line) => !/^\s*WEBVTT\b/.test(line) && !/^\s*\d+\s*$/.test(line))
    .map((line) => line.replace(TIMESTAMP, ""))
    .join(" ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s*#{1,6}\s+/gm, "")
    .replace(/[*_`>#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function lessonSummary(bodyMd: string, sourceText: string, maxChars = 280): string {
  const text = plain(bodyMd) || plain(sourceText);
  if (text.length <= maxChars) return text;

  const head = text.slice(0, maxChars);
  const end = Math.max(head.lastIndexOf(". "), head.lastIndexOf("? "), head.lastIndexOf("! "));
  // A sentence that ends early enough reads better than a cut mid-thought.
  if (end >= maxChars * 0.5) return head.slice(0, end + 1);
  return `${head.slice(0, head.lastIndexOf(" ")).replace(/[,;:]$/, "")}…`;
}
