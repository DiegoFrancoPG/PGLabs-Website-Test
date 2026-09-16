import { describe, it, expect } from "vitest";
import {
  sanitizeFilename,
  extensionOf,
  validateUpload,
  storagePathFor,
  playbackPathFromStorageKey,
  StorageError,
} from "@/lib/storage";

/*
 * AC-015's path-traversal half, and spec/03's supported upload set. No database
 * and no storage service: these are the pure rules.
 */

const VERSION = "11111111-1111-4111-8111-111111111111";
const CLASS = "22222222-2222-4222-8222-222222222222";
const ASSET = "33333333-3333-4333-8333-333333333333";

const ref = (originalName: string) => ({
  id: ASSET,
  classId: CLASS,
  versionId: VERSION,
  originalName,
});

describe("filename sanitization", () => {
  it.each([
    // Only the basename survives, so the directories are gone entirely.
    ["../../etc/passwd", "passwd"],
    // No real separators here, so the whole string is the basename; every
    // character outside the allowlist becomes an underscore and ".." collapses.
    ["..%2F..%2Fetc%2Fpasswd", "_2F._2Fetc_2Fpasswd"],
    ["/absolute/path.mp4", "path.mp4"],
    ["C:\\Windows\\system32\\evil.mp4", "evil.mp4"],
    ["....//....//x.mp4", "x.mp4"],
    ["..", "file"],
    ["...", "file"],
    ["", "file"],
  ])("defuses %j", (input, expected) => {
    expect(sanitizeFilename(input)).toBe(expected);
  });

  it("never leaves a separator behind, whatever it is given", () => {
    for (const hostile of [
      "a/b/c.mp4",
      "a\\b\\c.mp4",
      "../../../../../../root/.ssh/id_rsa",
      "lesson.mp4/../../escape.mp4",
    ]) {
      const result = sanitizeFilename(hostile);
      expect(result).not.toContain("/");
      expect(result).not.toContain("\\");
      expect(result.startsWith(".")).toBe(false);
    }
  });

  it("strips control characters, newlines and quotes", () => {
    const hostile = 'lesson\u0000\u000a\u000d"quoted".mp4';
    const result = sanitizeFilename(hostile);
    expect(result).toMatch(/^[A-Za-z0-9._-]+$/);
    expect(result).toContain("lesson");
    expect(result).toContain(".mp4");
  });

  it("keeps an ordinary name intact", () => {
    expect(sanitizeFilename("Module-1_Intro.mp4")).toBe("Module-1_Intro.mp4");
  });

  it("bounds the length so a key cannot be padded out", () => {
    expect(sanitizeFilename(`${"a".repeat(500)}.mp4`).length).toBeLessThanOrEqual(120);
  });

  it("reads the extension from the sanitized name, not the raw one", () => {
    // The raw name suggests .mp4 through a traversal segment; the real one is .txt
    expect(extensionOf("../../video.mp4/notes.txt")).toBe("txt");
    expect(extensionOf("LESSON.MP4")).toBe("mp4");
  });
});

describe("storage paths", () => {
  it("follows the layout spec/02 fixes", () => {
    expect(storagePathFor(ref("intro.mp4"))).toBe(
      `versions/${VERSION}/classes/${CLASS}/${ASSET}/intro.mp4`
    );
  });

  it("cannot be escaped by a hostile filename", () => {
    const path = storagePathFor(ref("../../../../secrets.mp4"));
    // versions / id / classes / id / asset id / filename — six segments,
    // exactly the layout spec/02 fixes. Nothing was added or climbed out.
    expect(path.split("/")).toHaveLength(6);
    expect(path.startsWith(`versions/${VERSION}/classes/${CLASS}/${ASSET}/`)).toBe(true);
    expect(path).not.toContain("..");
  });

  it("puts a normalized caption beside its original", () => {
    const original = `versions/${VERSION}/classes/${CLASS}/${ASSET}/subs.srt`;
    expect(playbackPathFromStorageKey(original)).toBe(
      `versions/${VERSION}/classes/${CLASS}/${ASSET}/normalized.vtt`
    );
  });
});

describe("upload validation", () => {
  const base = { role: "primary", originalName: "intro.mp4", mimeType: "video/mp4", bytes: 1000 };

  it("accepts each supported combination from spec/03", () => {
    const supported = [
      { role: "primary", originalName: "a.mp4", mimeType: "video/mp4", bytes: 1000 },
      { role: "primary", originalName: "a.mp3", mimeType: "audio/mpeg", bytes: 1000 },
      { role: "primary", originalName: "a.m4a", mimeType: "audio/mp4", bytes: 1000 },
      { role: "handout", originalName: "a.pdf", mimeType: "application/pdf", bytes: 1000 },
      { role: "transcript", originalName: "a.txt", mimeType: "text/plain", bytes: 1000 },
      { role: "caption", originalName: "a.vtt", mimeType: "text/vtt", bytes: 1000 },
      { role: "caption", originalName: "a.srt", mimeType: "application/x-subrip", bytes: 1000 },
    ];
    for (const input of supported) expect(() => validateUpload(input)).not.toThrow();
  });

  it("rejects a type outside the supported set", () => {
    for (const mimeType of ["image/png", "application/zip", "text/html", "video/quicktime"]) {
      expect(() => validateUpload({ ...base, mimeType, originalName: "a.bin" })).toThrow(
        StorageError
      );
    }
  });

  it("rejects an extension that disagrees with the declared type", () => {
    // spec/03: "MIME and extension must agree with supported set."
    expect(() => validateUpload({ ...base, originalName: "intro.exe" })).toThrow(
      /extension does not match/
    );
    expect(() =>
      validateUpload({ role: "handout", originalName: "a.mp4", mimeType: "application/pdf", bytes: 10 })
    ).toThrow(/extension does not match/);
  });

  it("rejects a file playing a role it cannot serve", () => {
    // A PDF is a handout, never the primary media of a class.
    expect(() =>
      validateUpload({ role: "primary", originalName: "a.pdf", mimeType: "application/pdf", bytes: 10 })
    ).toThrow(/cannot be a/);
    expect(() =>
      validateUpload({ role: "caption", originalName: "a.mp4", mimeType: "video/mp4", bytes: 10 })
    ).toThrow(/cannot be a/);
  });

  it("enforces the size limit for each kind of file", () => {
    // spec/03: 1 GiB for primary media, 25 MiB for PDF, 2 MiB for text.
    expect(() => validateUpload({ ...base, bytes: 1_073_741_824 })).not.toThrow();
    expect(() => validateUpload({ ...base, bytes: 1_073_741_825 })).toThrow(/larger than the limit/);

    const pdf = { role: "handout", originalName: "a.pdf", mimeType: "application/pdf" };
    expect(() => validateUpload({ ...pdf, bytes: 26_214_400 })).not.toThrow();
    expect(() => validateUpload({ ...pdf, bytes: 26_214_401 })).toThrow(/larger than the limit/);

    const srt = { role: "caption", originalName: "a.srt", mimeType: "application/x-subrip" };
    expect(() => validateUpload({ ...srt, bytes: 2_097_152 })).not.toThrow();
    expect(() => validateUpload({ ...srt, bytes: 2_097_153 })).toThrow(/larger than the limit/);
  });

  it("rejects an empty file", () => {
    expect(() => validateUpload({ ...base, bytes: 0 })).toThrow();
  });
});
