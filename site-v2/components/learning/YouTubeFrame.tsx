"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  Captions,
  CaptionsOff,
  Maximize,
  Minimize,
  Pause,
  Play,
  RotateCcw,
  Volume2,
  VolumeX,
} from "lucide-react";
import { Button } from "@/components/pglearn/ui/button";
import { formatMediaTime, youtubeEmbedUrl } from "@/lib/youtube";

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
 *
 * It also draws the controls. YouTube's own bar carries its logo and a "Watch
 * on YouTube" link that takes the learner out of the lesson, so the embed asks
 * for none (controls=0) and the bar below is ours: play, back ten seconds, the
 * timeline, volume, captions and fullscreen. Speed stays in ClassPlayer, which
 * offers it for both players. There is no quality control: YouTube retired the
 * API calls for it in 2019 and now chooses the quality itself.
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

interface CaptionTrack {
  languageCode: string;
  displayName?: string;
  languageName?: string;
}

/* The subset of the IFrame Player API used here. */
interface YouTubePlayer {
  getCurrentTime(): number;
  getDuration(): number;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getPlaybackRate(): number;
  setPlaybackRate(rate: number): void;
  playVideo(): void;
  pauseVideo(): void;
  mute(): void;
  unMute(): void;
  isMuted(): boolean;
  getVolume(): number;
  setVolume(volume: number): void;
  /*
   * The captions module. YouTube does not document these, though its own
   * player is built on them; every call is guarded, and the captions button
   * disappears if they stop answering. Captions still start on through the
   * embed's cc_load_policy, which is documented.
   */
  getOptions?(): string[];
  getOption?(module: "captions", option: "tracklist" | "track"): unknown;
  setOption?(module: "captions", option: "track", value: Partial<CaptionTrack>): void;
  loadModule?(module: "captions"): void;
  unloadModule?(module: "captions"): void;
}

interface YouTubeNamespace {
  Player: new (
    element: HTMLIFrameElement,
    options: {
      events: {
        onReady?: () => void;
        onStateChange?: (event: { data: number }) => void;
        onPlaybackRateChange?: (event: { data: number }) => void;
        onApiChange?: () => void;
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

/* Safari on iPad still names the element fullscreen API with a prefix. */
type FullscreenElement = HTMLElement & { webkitRequestFullscreen?: () => void };
type FullscreenDocument = Document & {
  webkitFullscreenEnabled?: boolean;
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => void;
};

const API_SRC = "https://www.youtube.com/iframe_api";
const POLL_MS = 250;
const BACK_SECONDS = 10;

const STATE = { ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3 } as const;

/*
 * The bar sits on the video's black ground, so it takes the platform's
 * dark-surface tokens whatever the page theme is: white text, a white wash on
 * hover and the on-dark focus ring.
 */
const ON_DARK = {
  "--ui-foreground": "255 255 255",
  "--ui-wash": "255 255 255 / 0.15",
  "--ui-ring": "89 196 237",
} as CSSProperties;

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

/** The caption tracks YouTube offers for this video, or null when it will not say. */
function readCaptionTracks(player: YouTubePlayer): CaptionTrack[] | null {
  try {
    if (!player.getOptions?.().includes("captions")) return null;
    const list = player.getOption?.("captions", "tracklist");
    if (!Array.isArray(list)) return null;
    return list.filter(
      (track): track is CaptionTrack => typeof track?.languageCode === "string"
    );
  } catch {
    return null;
  }
}

function currentCaptionCode(player: YouTubePlayer): string | null {
  try {
    const track = player.getOption?.("captions", "track") as Partial<CaptionTrack> | undefined;
    return typeof track?.languageCode === "string" ? track.languageCode : null;
  } catch {
    return null;
  }
}

export function YouTubeFrame({ videoId, title, startSeconds, ...handlers }: Props) {
  const frame = useRef<HTMLIFrameElement | null>(null);
  const shell = useRef<HTMLDivElement | null>(null);
  const player = useRef<YouTubePlayer | null>(null);
  // The latest handlers, read at call time, so a new render never rebuilds the player.
  const latest = useRef<Handlers>(handlers);
  useEffect(() => {
    latest.current = handlers;
  });

  // Fixed at mount: changing the src would reload the player mid-lesson.
  const [src] = useState(() =>
    youtubeEmbedUrl(videoId, { origin: window.location.origin, startSeconds })
  );

  // What the bar shows. The player is the source of truth; these mirror it.
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(startSeconds);
  const [duration, setDuration] = useState(0);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(100);
  const [tracks, setTracks] = useState<CaptionTrack[] | null>(null);
  const [captionsOn, setCaptionsOn] = useState(true);
  const [captionCode, setCaptionCode] = useState<string | null>(null);
  const [canFullscreen, setCanFullscreen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let poll: ReturnType<typeof setInterval> | null = null;
    // True from the first PLAYING until a pause or the end. Buffering is not a
    // pause: the interval being watched stays open through it.
    let playingNow = false;

    const stopPolling = () => {
      if (poll !== null) clearInterval(poll);
      poll = null;
    };
    const readTime = () => {
      const p = player.current;
      if (p) setTime(p.getCurrentTime());
    };

    loadYouTubeApi()
      .then((YT) => {
        if (cancelled || !frame.current) return;
        const created = new YT.Player(frame.current, {
          events: {
            onReady: () => {
              if (cancelled) return;
              player.current = created;
              setReady(true);
              setDuration(created.getDuration());
              setMuted(created.isMuted());
              setVolume(created.getVolume());
              readTime();
              latest.current.onReady({
                get currentTime() {
                  return created.getCurrentTime();
                },
                set currentTime(seconds: number) {
                  created.seekTo(seconds, true);
                },
                get playbackRate() {
                  return created.getPlaybackRate();
                },
                set playbackRate(rate: number) {
                  created.setPlaybackRate(rate);
                },
                get duration() {
                  return created.getDuration();
                },
                pause: () => created.pauseVideo(),
              });
            },
            onStateChange: ({ data }) => {
              if (cancelled) return;
              readTime();
              // The duration is sometimes only known once playback has begun.
              setDuration(created.getDuration());
              if (data === STATE.PLAYING) {
                setPlaying(true);
                if (!playingNow) {
                  playingNow = true;
                  latest.current.onPlay();
                }
                if (poll === null) {
                  poll = setInterval(() => {
                    readTime();
                    latest.current.onTimeUpdate();
                  }, POLL_MS);
                }
              } else if (data === STATE.BUFFERING) {
                stopPolling();
              } else {
                stopPolling();
                setPlaying(false);
                if (playingNow) {
                  playingNow = false;
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
            /*
             * Fired when a module such as captions loads. Turning captions off
             * unloads the module, so an empty answer then does not mean the
             * video has none: the button stays once it has appeared.
             */
            onApiChange: () => {
              if (cancelled) return;
              const found = readCaptionTracks(created);
              if (found && found.length > 0) {
                setTracks(found);
                setCaptionCode(currentCaptionCode(created) ?? found[0].languageCode);
              }
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

  /* Fullscreen is offered only where the shell itself can go fullscreen — not on iPhone. */
  useEffect(() => {
    const doc = document as FullscreenDocument;
    const element = shell.current as FullscreenElement | null;
    setCanFullscreen(
      Boolean(
        element &&
          (document.fullscreenEnabled || doc.webkitFullscreenEnabled) &&
          (element.requestFullscreen || element.webkitRequestFullscreen)
      )
    );
    const onChange = () => {
      const active = document.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
      setFullscreen(active !== null && active === shell.current);
    };
    document.addEventListener("fullscreenchange", onChange);
    document.addEventListener("webkitfullscreenchange", onChange);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      document.removeEventListener("webkitfullscreenchange", onChange);
    };
  }, []);

  const togglePlay = () => {
    const p = player.current;
    if (!p) return;
    if (playing) p.pauseVideo();
    else p.playVideo();
  };

  /*
   * A seek moves the playhead and nothing else. ClassPlayer sees the jump on
   * its next reading and closes the interval where the jump began, exactly as
   * it does when a learner drags the native player's timeline.
   */
  const seek = (seconds: number) => {
    const p = player.current;
    if (!p) return;
    const target = Math.max(0, Math.min(duration || seconds, seconds));
    p.seekTo(target, true);
    setTime(target);
  };

  const toggleMute = () => {
    const p = player.current;
    if (!p) return;
    if (muted) p.unMute();
    else p.mute();
    setMuted(!muted);
  };

  const changeVolume = (next: number) => {
    const p = player.current;
    if (!p) return;
    p.setVolume(next);
    setVolume(next);
    if (next > 0 && muted) {
      p.unMute();
      setMuted(false);
    }
  };

  const toggleCaptions = () => {
    const p = player.current;
    if (!p) return;
    try {
      if (captionsOn) {
        p.unloadModule?.("captions");
      } else {
        p.loadModule?.("captions");
        if (captionCode) p.setOption?.("captions", "track", { languageCode: captionCode });
      }
      setCaptionsOn(!captionsOn);
    } catch {
      // The undocumented calls stopped answering: stop offering the button.
      setTracks(null);
    }
  };

  const chooseCaptions = (code: string) => {
    const p = player.current;
    if (!p) return;
    try {
      if (!captionsOn) p.loadModule?.("captions");
      p.setOption?.("captions", "track", { languageCode: code });
      setCaptionCode(code);
      setCaptionsOn(true);
    } catch {
      setTracks(null);
    }
  };

  const toggleFullscreen = () => {
    const doc = document as FullscreenDocument;
    const element = shell.current as FullscreenElement | null;
    if (!element) return;
    if (fullscreen) {
      if (document.exitFullscreen) void document.exitFullscreen();
      else doc.webkitExitFullscreen?.();
    } else if (element.requestFullscreen) {
      void element.requestFullscreen();
    } else {
      element.webkitRequestFullscreen?.();
    }
  };

  const shownDuration = duration > 0 ? duration : 0;
  const shownTime = Math.min(time, shownDuration || time);
  const trackName = (track: CaptionTrack) =>
    track.displayName ?? track.languageName ?? track.languageCode;

  return (
    <div
      ref={shell}
      className={
        fullscreen
          ? "flex h-full w-full flex-col bg-black"
          : "w-full overflow-hidden rounded-ui bg-black"
      }
    >
      <div className={fullscreen ? "min-h-0 flex-1" : "aspect-video w-full"}>
        <iframe
          ref={frame}
          src={src}
          title={title}
          className="h-full w-full"
          allow="autoplay; encrypted-media; picture-in-picture"
          /*
           * The platform's pages send no Referer to other origins (next.config's
           * Referrer-Policy: same-origin), and YouTube refuses to play an embed
           * that arrives without one. This iframe alone sends the origin — never
           * the path, which carries enrollment and class ids.
           */
          referrerPolicy="strict-origin-when-cross-origin"
        />
      </div>

      <div
        role="group"
        aria-label="Video controls"
        style={ON_DARK}
        className="flex flex-wrap items-center gap-x-1 gap-y-2 px-2 py-2 text-white"
      >
        <Button
          type="button"
          size="icon"
          variant="ghost"
          disabled={!ready}
          onClick={togglePlay}
          aria-label={playing ? "Pause" : "Play"}
        >
          {playing ? <Pause aria-hidden /> : <Play aria-hidden />}
        </Button>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          disabled={!ready}
          onClick={() => seek(time - BACK_SECONDS)}
          aria-label={`Back ${BACK_SECONDS} seconds`}
        >
          <RotateCcw aria-hidden />
        </Button>

        <div className="flex min-w-40 flex-1 items-center gap-3 px-2">
          <input
            type="range"
            min={0}
            max={Math.max(1, Math.floor(shownDuration))}
            step={1}
            value={Math.floor(shownTime)}
            disabled={!ready || shownDuration === 0}
            onChange={(event) => seek(Number(event.target.value))}
            aria-label="Position in the video"
            aria-valuetext={`${formatMediaTime(shownTime)} of ${formatMediaTime(shownDuration)}`}
            className="h-11 w-full cursor-pointer accent-ui-brand disabled:cursor-default"
          />
          <span className="whitespace-nowrap font-ui text-ui-caption tabular-nums" aria-hidden>
            {formatMediaTime(shownTime)} / {formatMediaTime(shownDuration)}
          </span>
        </div>

        <Button
          type="button"
          size="icon"
          variant="ghost"
          disabled={!ready}
          onClick={toggleMute}
          aria-label={muted ? "Unmute" : "Mute"}
        >
          {muted || volume === 0 ? <VolumeX aria-hidden /> : <Volume2 aria-hidden />}
        </Button>
        {/* A phone's volume is its own buttons; the slider is for larger screens. */}
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={muted ? 0 : volume}
          disabled={!ready}
          onChange={(event) => changeVolume(Number(event.target.value))}
          aria-label="Volume"
          className="hidden h-11 w-24 cursor-pointer accent-ui-brand sm:block"
        />

        {tracks && (
          <>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              onClick={toggleCaptions}
              aria-pressed={captionsOn}
              aria-label="Captions"
            >
              {captionsOn ? <Captions aria-hidden /> : <CaptionsOff aria-hidden />}
            </Button>
            {tracks.length > 1 && (
              <select
                value={captionCode ?? ""}
                onChange={(event) => chooseCaptions(event.target.value)}
                aria-label="Caption language"
                className="h-9 rounded-full border border-white/40 bg-black px-3 font-ui text-ui-caption text-white"
              >
                {tracks.map((track) => (
                  <option key={track.languageCode} value={track.languageCode}>
                    {trackName(track)}
                  </option>
                ))}
              </select>
            )}
          </>
        )}

        {canFullscreen && (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onClick={toggleFullscreen}
            aria-label={fullscreen ? "Exit full screen" : "Full screen"}
          >
            {fullscreen ? <Minimize aria-hidden /> : <Maximize aria-hidden />}
          </Button>
        )}
      </div>
    </div>
  );
}
