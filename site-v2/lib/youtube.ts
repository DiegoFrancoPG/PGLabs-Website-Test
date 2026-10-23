/*
 * YouTube-hosted video for a video class (D-05 in HANDOFF.md, migration M29).
 *
 * The database stores the eleven-character video id and nothing else, so the
 * only thing ever rendered into a learner's page is a URL this module composes
 * on a host it names. Whatever an author pastes is reduced to that id here.
 */

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

/** The host the player is served from: YouTube's no-cookie domain. */
export const YOUTUBE_EMBED_ORIGIN = "https://www.youtube-nocookie.com";

export function isYouTubeVideoId(value: string): boolean {
  return VIDEO_ID.test(value);
}

/**
 * The video id in a pasted link, or null when there is none.
 *
 * Accepts a bare id and the link shapes YouTube itself hands out: watch?v=,
 * youtu.be/, /embed/, /shorts/ and /live/, on youtube.com, m.youtube.com,
 * music.youtube.com and youtube-nocookie.com. Anything else — another host, a
 * playlist without a video, a channel — is refused rather than guessed at.
 */
export function parseYouTubeVideoId(input: string): string | null {
  const text = input.trim();
  if (isYouTubeVideoId(text)) return text;

  let url: URL;
  try {
    url = new URL(/^[a-z]+:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;

  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const segments = url.pathname.split("/").filter(Boolean);
  let candidate: string | null = null;

  if (host === "youtu.be") {
    candidate = segments[0] ?? null;
  } else if (
    host === "youtube.com" ||
    host === "m.youtube.com" ||
    host === "music.youtube.com" ||
    host === "youtube-nocookie.com"
  ) {
    if (segments[0] === "watch") candidate = url.searchParams.get("v");
    else if (["embed", "shorts", "live", "v"].includes(segments[0] ?? "")) candidate = segments[1] ?? null;
  }

  return candidate !== null && isYouTubeVideoId(candidate) ? candidate : null;
}

/** The link an author can open to check which video a class points at. */
export function youtubeWatchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
}

/**
 * The embed URL for the player.
 *
 * enablejsapi and origin are what let the page read the player's state, which
 * is how progress is measured. rel=0 keeps suggestions to the same channel,
 * cc_load_policy=1 shows captions by default as the uploaded-file player does,
 * and start resumes where the learner left off without starting playback.
 *
 * controls=0 hides YouTube's own control bar, whose logo and "Watch on
 * YouTube" link take the learner out of the lesson; YouTubeFrame draws the
 * controls instead. fs=0 and iv_load_policy=3 drop the fullscreen button and
 * annotations that would otherwise still show over the picture. YouTube may
 * still show its title or logo in some states: no parameter removes those.
 */
export function youtubeEmbedUrl(videoId: string, options: { origin: string; startSeconds: number }): string {
  if (!isYouTubeVideoId(videoId)) throw new Error("Not a YouTube video id");
  const params = new URLSearchParams({
    enablejsapi: "1",
    origin: options.origin,
    rel: "0",
    cc_load_policy: "1",
    controls: "0",
    fs: "0",
    iv_load_policy: "3",
    playsinline: "1",
    start: String(Math.max(0, Math.floor(options.startSeconds))),
  });
  return `${YOUTUBE_EMBED_ORIGIN}/embed/${videoId}?${params.toString()}`;
}

/** A media time as the player shows it: 0:05, 10:15, 1:02:03. */
export function formatMediaTime(seconds: number): string {
  const total = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}
