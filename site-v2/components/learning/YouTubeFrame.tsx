"use client";

import { useEffect, useRef, useState } from "react";
import { youtubeEmbedUrl } from "@/lib/youtube";

/*
 * A YouTube player that behaves, to ClassPlayer, like a media element (D-05).
 *
 * ClassPlayer measures progress from three things a <video> gives it: the
 * current time, the playback rate, and play/pause/timeupdate/ended events.
 * YouTube's IFrame Player API exposes the first two as calls and the events as
 * state changes, so this component translates: it hands ClassPlayer a handle
 * with the same properties, reports state changes as the same events, and
 * polls the time while playing in place of timeupdate. Everything that decides
 * what counts as watched stays in ClassPlayer and on the server.
 */

export interface MediaHandle {
  currentTime: number;
  playbackRate: number;
  /** In seconds; 0 until the player knows it. */
  readonly duration: number;
  pause(): void;
}

interface Handlers {
  onReady: (handle: MediaHandle) => void;
  onPlay: () => void;
  onPause: () => void;
  onTimeUpdate: () => void;
  onEnded: () => void;
  onRateChange: (rate: number) => void;
  onError: (message: string) => void;
}

interface Props extends Handlers {
  videoId: string;
  title: string;
  /** Where to resume. Passed as the embed's start, so resuming does not autoplay. */
  startSeconds: number;
}

/* The subset of the IFrame Player API used here. */
interface YouTubePlayer {
  getCurrentTime(): number;
  getDuration(): number;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getPlaybackRate(): number;
  setPlaybackRate(rate: number): void;
  pauseVideo(): void;
}

interface YouTubeNamespace {
  Player: new (
    element: HTMLIFrameElement,
    options: {
      events: {
        onReady?: () => void;
        onStateChange?: (event: { data: number }) => void;
        onPlaybackRateChange?: (event: { data: number }) => void;
        onError?: (event: { data: number }) => void;
      };
    }
  ) => YouTubePlayer;
}

declare global {
  interface Window {
    YT?: YouTubeNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

const API_SRC = "https://www.youtube.com/iframe_api";
const POLL_MS = 250;

const STATE = { ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3 } as const;

let apiPromise: Promise<YouTubeNamespace> | null = null;

/** Loads YouTube's player API once per page, however many players ask for it. */
function loadYouTubeApi(): Promise<YouTubeNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      if (window.YT?.Player) resolve(window.YT);
    };
    const script = document.createElement("script");
    script.src = API_SRC;
    script.async = true;
    script.onerror = () => {
      apiPromise = null;
      reject(new Error("The YouTube player could not be loaded."));
    };
    document.head.appendChild(script);
  });
  return apiPromise;
}

/* YouTube's error codes, said in a way a learner can act on. */
function describeError(code: number): string {
  if (code === 101 || code === 150) return "The owner of this video does not allow it to be played here.";
  if (code === 100) return "This video is private or no longer available.";
  if (code === 153) return "YouTube refused to load the player on this page.";
  return "The video could not be played.";
}

export function YouTubeFrame({ videoId, title, startSeconds, ...handlers }: Props) {
  const frame = useRef<HTMLIFrameElement | null>(null);
  // The latest handlers, read at call time, so a new render never rebuilds the player.
  const latest = useRef<Handlers>(handlers);
  useEffect(() => {
    latest.current = handlers;
  });

  // Fixed at mount: changing the src would reload the player mid-lesson.
  const [src] = useState(() =>
    youtubeEmbedUrl(videoId, { origin: window.location.origin, startSeconds })
  );

  useEffect(() => {
    let cancelled = false;
    let poll: ReturnType<typeof setInterval> | null = null;
    // True from the first PLAYING until a pause or the end. Buffering is not a
    // pause: the interval being watched stays open through it.
    let playing = false;

    const stopPolling = () => {
      if (poll !== null) clearInterval(poll);
      poll = null;
    };

    loadYouTubeApi()
      .then((YT) => {
        if (cancelled || !frame.current) return;
        const player = new YT.Player(frame.current, {
          events: {
            onReady: () => {
              if (cancelled) return;
              latest.current.onReady({
                get currentTime() {
                  return player.getCurrentTime();
                },
                set currentTime(seconds: number) {
                  player.seekTo(seconds, true);
                },
                get playbackRate() {
                  return player.getPlaybackRate();
                },
                set playbackRate(rate: number) {
                  player.setPlaybackRate(rate);
                },
                get duration() {
                  return player.getDuration();
                },
                pause: () => player.pauseVideo(),
              });
            },
            onStateChange: ({ data }) => {
              if (cancelled) return;
              if (data === STATE.PLAYING) {
                if (!playing) {
                  playing = true;
                  latest.current.onPlay();
                }
                if (poll === null) poll = setInterval(() => latest.current.onTimeUpdate(), POLL_MS);
              } else if (data === STATE.BUFFERING) {
                stopPolling();
              } else {
                stopPolling();
                if (playing) {
                  playing = false;
                  // One last reading, so the end of the interval is where it stopped.
                  latest.current.onTimeUpdate();
                  latest.current.onPause();
                }
                if (data === STATE.ENDED) latest.current.onEnded();
              }
            },
            onPlaybackRateChange: ({ data }) => {
              if (!cancelled) latest.current.onRateChange(data);
            },
            onError: ({ data }) => {
              if (!cancelled) latest.current.onError(describeError(data));
            },
          },
        });
      })
      .catch((err: Error) => {
        if (!cancelled) latest.current.onError(err.message);
      });

    return () => {
      cancelled = true;
      stopPolling();
    };
  }, []);

  return (
    <div className="aspect-video w-full overflow-hidden rounded-ui bg-black">
      <iframe
        ref={frame}
        src={src}
        title={title}
        className="h-full w-full"
        allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
        allowFullScreen
        /*
         * The platform's pages send no Referer to other origins (next.config's
         * Referrer-Policy: same-origin), and YouTube refuses to play an embed
         * that arrives without one. This iframe alone sends the origin — never
         * the path, which carries enrollment and class ids.
         */
        referrerPolicy="strict-origin-when-cross-origin"
      />
    </div>
  );
}
