import { describe, it, expect } from "vitest";
import { isYouTubeVideoId, parseYouTubeVideoId, youtubeEmbedUrl } from "@/lib/youtube";

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

  it("refuses anything that is not an id, so nothing else reaches the src", () => {
    expect(() => youtubeEmbedUrl("../../x", { origin: "https://a.example", startSeconds: 0 })).toThrow();
    expect(isYouTubeVideoId(`${ID}?autoplay=1`)).toBe(false);
  });
});
