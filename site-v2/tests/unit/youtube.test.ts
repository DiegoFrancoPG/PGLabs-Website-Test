import { describe, it, expect } from "vitest";
import { formatMediaTime, isYouTubeVideoId, parseYouTubeVideoId, youtubeEmbedUrl } from "@/lib/youtube";

/*
 * D-05: what an author may paste for a YouTube class, and the one URL the
 * learner's page is ever given. No network: these are the pure rules.
 */

const ID = "dQw4w9WgXcQ";

describe("parseYouTubeVideoId", () => {
  it.each([
    [ID],
    [`  ${ID}  `],
    [`https://www.youtube.com/watch?v=${ID}`],
    [`https://www.youtube.com/watch?feature=share&v=${ID}&t=42s`],
    [`youtube.com/watch?v=${ID}`],
    [`https://m.youtube.com/watch?v=${ID}`],
    [`https://music.youtube.com/watch?v=${ID}`],
    [`https://youtu.be/${ID}`],
    [`https://youtu.be/${ID}?si=abc&t=10`],
    [`https://www.youtube.com/embed/${ID}`],
    [`https://www.youtube-nocookie.com/embed/${ID}?rel=0`],
    [`https://www.youtube.com/shorts/${ID}`],
    [`https://www.youtube.com/live/${ID}`],
    [`http://www.youtube.com/watch?v=${ID}`],
  ])("finds the id in %s", (input) => {
    expect(parseYouTubeVideoId(input)).toBe(ID);
  });

  it.each([
    [""],
    ["not a link"],
    ["dQw4w9WgXc"], // ten characters
    ["dQw4w9WgXcQQ"], // twelve
    [`https://vimeo.com/${ID}`],
    [`https://youtube.com.evil.example/watch?v=${ID}`],
    [`https://evil.example/?u=https://youtu.be/${ID}`],
    ["https://www.youtube.com/playlist?list=PL1234567890"],
    ["https://www.youtube.com/@channel"],
    [`https://www.youtube.com/watch?v=${ID.slice(0, 10)}%22`],
    [`javascript:alert(1)//youtu.be/${ID}`],
    [`ftp://youtu.be/${ID}`],
  ])("refuses %s", (input) => {
    expect(parseYouTubeVideoId(input)).toBeNull();
  });
});

describe("youtubeEmbedUrl", () => {
  it("serves the player from the no-cookie host with the API enabled", () => {
    const url = new URL(youtubeEmbedUrl(ID, { origin: "https://learn.example.org", startSeconds: 61.9 }));
    expect(url.origin).toBe("https://www.youtube-nocookie.com");
    expect(url.pathname).toBe(`/embed/${ID}`);
    expect(url.searchParams.get("enablejsapi")).toBe("1");
    expect(url.searchParams.get("origin")).toBe("https://learn.example.org");
    // Resume is whole seconds, rounded down so no unwatched second is skipped.
    expect(url.searchParams.get("start")).toBe("61");
    expect(url.searchParams.get("cc_load_policy")).toBe("1");
  });

  it("hides YouTube's own controls, whose links leave the lesson", () => {
    const url = new URL(youtubeEmbedUrl(ID, { origin: "https://learn.example.org", startSeconds: 0 }));
    expect(url.searchParams.get("controls")).toBe("0");
    expect(url.searchParams.get("fs")).toBe("0");
    expect(url.searchParams.get("iv_load_policy")).toBe("3");
    expect(url.searchParams.get("rel")).toBe("0");
  });

  it("refuses anything that is not an id, so nothing else reaches the src", () => {
    expect(() => youtubeEmbedUrl("../../x", { origin: "https://a.example", startSeconds: 0 })).toThrow();
    expect(isYouTubeVideoId(`${ID}?autoplay=1`)).toBe(false);
  });
});

describe("formatMediaTime", () => {
  it.each([
    [0, "0:00"],
    [5.9, "0:05"],
    [615, "10:15"],
    [3723, "1:02:03"],
    [-4, "0:00"],
    [Number.NaN, "0:00"],
  ])("shows %s seconds as %s", (seconds, label) => {
    expect(formatMediaTime(seconds)).toBe(label);
  });
});

describe("reading classes from a database without M29", () => {
  it("treats a missing youtube_video_id as null instead of failing the read", async () => {
    const { classSchema } = await import("@/features/content/content");
    const { classDetailSchema } = await import("@/features/learning/learning");
    const row = {
      id: "11111111-1111-4111-8111-111111111111",
      module_id: "22222222-2222-4222-8222-222222222222",
      version_id: "33333333-3333-4333-8333-333333333333",
      title: "Video", kind: "video", required: true, position: 0,
      body_md: "", source_text: "", duration_ms: 600000, primary_asset_id: null,
    };
    expect(classSchema.parse(row).youtube_video_id).toBeNull();
    expect(classSchema.parse({ ...row, youtube_video_id: ID }).youtube_video_id).toBe(ID);
    expect(classDetailSchema.shape.class.parse(row).youtube_video_id).toBeNull();
  });
});
