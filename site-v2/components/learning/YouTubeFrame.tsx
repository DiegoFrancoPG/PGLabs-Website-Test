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
 * timeline, volume, captions, speed and fullscreen. Speed has to be here: with
 * YouTube's bar goes its settings menu, which is where a learner set the rate.
 * There is no quality control: YouTube retired the API calls for it in 2019
 * and now chooses the quality itself.
 *
 * Captions have one menu (D-20), on every screen size: off, any of the
 * video's own tracks, or YouTube's automatic translation of a track into
 * another language — what YouTube's own settings menu offered. The choice is
 * remembered on this device for the next video. The spoken language cannot
 * be offered: the IFrame API has no call for a video's audio tracks.
 *
 * The bar is one row of fixed height (CONTROL_BAR_HEIGHT), so ClassPlayer can
 * hold the player's final size before it loads. On a phone the controls a
 * phone already has (volume) and the ones there is no room for (back ten
 * seconds, the time read-out) are left out.
 */

/** The bar's height, as a class; ClassPlayer reserves it below the 16:9 frame. */
export const CONTROL_BAR_HEIGHT = "h-14";

const RATES = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

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
  /** The frame's own box; by default a 16:9 block. */
  className?: string;
}

interface CaptionTrack {
  languageCode: string;
  displayName?: string;
  languageName?: string;
  kind?: string;
  is_translateable?: boolean;
  translationLanguage?: TranslationLanguage | null;
}

interface TranslationLanguage {
  languageCode: string;
  languageName?: string;
}

/** What the captions show: a track, optionally translated, or nothing. */
interface CaptionChoice {
  code: string;
  translateTo: string | null;
}

const CAPTION_PREF = "pglearn.captions";

/* The subset of the IFrame Player API used here. */
interface YouTubePlayer {
  getCurrentTime(): number;
  getDuration(): number;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getPlaybackRate(): number;
  setPlaybackRate(rate: number): void;
  playVideo(): void;
  pauseVideo(): void;
  getAvailablePlaybackRates(): number[];
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
  getOption?(module: "captions", option: "tracklist" | "track" | "translationLanguages"): unknown;
  setOption?(module: "captions", option: "track", value: Partial<CaptionTrack> | Record<string, never>): void;
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

function currentCaption(player: YouTubePlayer): CaptionChoice | null {
  try {
    const track = player.getOption?.("captions", "track") as Partial<CaptionTrack> | undefined;
    if (typeof track?.languageCode !== "string" || track.languageCode === "") return null;
    const to = track.translationLanguage?.languageCode;
    return { code: track.languageCode, translateTo: typeof to === "string" ? to : null };
  } catch {
    return null;
  }
}

/** The languages YouTube can translate captions into, or none when it will not say. */
function readTranslationLanguages(player: YouTubePlayer): TranslationLanguage[] {
  try {
    const list = player.getOption?.("captions", "translationLanguages");
    if (!Array.isArray(list)) return [];
    return list
      .filter((language): language is TranslationLanguage => typeof language?.languageCode === "string")
      .sort((a, b) => (a.languageName ?? a.languageCode).localeCompare(b.languageName ?? b.languageCode));
  } catch {
    return [];
  }
}

function applyCaption(player: YouTubePlayer, choice: CaptionChoice, tracks: CaptionTrack[]) {
  const track = tracks.find((candidate) => candidate.languageCode === choice.code);
  player.setOption?.("captions", "track", {
    ...(track ?? { languageCode: choice.code }),
    translationLanguage: choice.translateTo ? { languageCode: choice.translateTo } : null,
  });
}

/* The learner's last choice on this device; storage may be unavailable. */
function readPreference(): { off: boolean; language: string | null } | null {
  try {
    const raw = window.localStorage.getItem(CAPTION_PREF);
    return raw ? (JSON.parse(raw) as { off: boolean; language: string | null }) : null;
  } catch {
    return null;
  }
}

function writePreference(off: boolean, language: string | null) {
  try {
    window.localStorage.setItem(CAPTION_PREF, JSON.stringify({ off, language }));
  } catch {
    // Not remembered; nothing else depends on it.
  }
}

export function YouTubeFrame({ videoId, title, startSeconds, className, ...handlers }: Props) {
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
  const [rate, setRate] = useState(1);
  const [rates, setRates] = useState<readonly number[]>(RATES);
  const [tracks, setTracks] = useState<CaptionTrack[] | null>(null);
  const [translations, setTranslations] = useState<TranslationLanguage[]>([]);
  const [captionsOn, setCaptionsOn] = useState(true);
  const [caption, setCaption] = useState<CaptionChoice | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  // YouTube loads its captions module once playback begins, so before then
  // "no tracks yet" says nothing about the video.
  const [started, setStarted] = useState(false);
  const menu = useRef<HTMLDivElement | null>(null);
  // The remembered choice is applied once, when the tracks first appear.
  const preferenceApplied = useRef(false);
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
              setRate(created.getPlaybackRate());
              // Only the speeds this video offers, of the ones the bar lists.
              const offered = created.getAvailablePlaybackRates?.() ?? [];
              const usable = RATES.filter((option) => offered.includes(option));
              if (usable.length > 1) setRates(usable);
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
                setStarted(true);
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
              if (cancelled) return;
              setRate(data);
              latest.current.onRateChange(data);
            },
            /*
             * Fired when a module such as captions loads. Turning captions off
             * unloads the module, so an empty answer then does not mean the
             * video has none: the button stays once it has appeared.
             */
            onApiChange: () => {
              if (cancelled) return;
              const found = readCaptionTracks(created);
              if (!found || found.length === 0) {
                // What YouTube answered, for diagnosing a video whose menu stays empty.
                let options: unknown = "unavailable";
                try {
                  options = created.getOptions?.() ?? "unavailable";
                } catch {
                  // Reported as unavailable.
                }
                console.info("[youtube] no caption tracks reported", { options });
                return;
              }
              setTracks(found);
              const offered = readTranslationLanguages(created);
              if (offered.length > 0) setTranslations(offered);
              const shown = currentCaption(created) ?? { code: found[0].languageCode, translateTo: null };
              setCaption(shown);

              if (preferenceApplied.current) return;
              preferenceApplied.current = true;
              const preference = readPreference();
              if (!preference) return;
              try {
                if (preference.off) {
                  created.unloadModule?.("captions");
                  setCaptionsOn(false);
                  return;
                }
                if (!preference.language || preference.language === shown.code) return;
                // The language itself if the video has it, else a translation of
                // the track showing, when YouTube can translate it.
                const own = found.find((track) => track.languageCode === preference.language);
                const base = found.find((track) => track.languageCode === shown.code);
                const next: CaptionChoice | null = own
                  ? { code: own.languageCode, translateTo: null }
                  : base?.is_translateable !== false && offered.some((l) => l.languageCode === preference.language)
                    ? { code: shown.code, translateTo: preference.language }
                    : null;
                if (next) {
                  applyCaption(created, next, found);
                  setCaption(next);
                }
              } catch {
                // Leave YouTube's default showing.
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

  const changeRate = (next: number) => {
    const p = player.current;
    if (!p) return;
    p.setPlaybackRate(next);
    setRate(next);
  };

  const captionsOff = () => {
    const p = player.current;
    if (!p) return;
    try {
      p.unloadModule?.("captions");
      setCaptionsOn(false);
      writePreference(true, caption?.translateTo ?? caption?.code ?? null);
    } catch {
      // The undocumented calls stopped answering: stop offering the menu.
      setTracks(null);
    }
    setMenuOpen(false);
  };

  const chooseCaptions = (next: CaptionChoice) => {
    const p = player.current;
    if (!p || !tracks) return;
    try {
      if (!captionsOn) p.loadModule?.("captions");
      applyCaption(p, next, tracks);
      setCaption(next);
      setCaptionsOn(true);
      writePreference(false, next.translateTo ?? next.code);
    } catch {
      setTracks(null);
    }
    setMenuOpen(false);
  };

  /* The menu closes on a click elsewhere or Escape. */
  useEffect(() => {
    if (!menuOpen) return;
    const onPointer = (event: PointerEvent) => {
      if (menu.current && !menu.current.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    // A click into the video goes to the iframe, which the page only sees as blur.
    const onBlur = () => setMenuOpen(false);
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", onBlur);
    };
  }, [menuOpen]);

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
    `${track.displayName ?? track.languageName ?? track.languageCode}${
      track.kind === "asr" && !(track.displayName ?? "").includes("(") ? " (auto-generated)" : ""
    }`;
  const languageName = (code: string) =>
    translations.find((language) => language.languageCode === code)?.languageName ?? code;
  const baseTrack = tracks?.find((track) => track.languageCode === caption?.code) ?? tracks?.[0];
  const canTranslate = Boolean(baseTrack && baseTrack.is_translateable !== false && translations.length > 0);

  return (
    <div
      ref={shell}
      className={
        fullscreen
          ? "relative flex h-full w-full flex-col bg-black"
          : // A given box is already positioned (ClassPlayer's is absolute), which the menu needs.
            `${className ?? "relative w-full overflow-hidden rounded-ui"} flex flex-col bg-black`
      }
    >
      {/* Given a box (ClassPlayer's stage), the frame takes what the bar leaves. */}
      <div className={fullscreen || className ? "min-h-0 flex-1" : "aspect-video w-full"}>
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
        className={`flex ${CONTROL_BAR_HEIGHT} shrink-0 items-center gap-1 px-1 text-white sm:px-2`}
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
          className="hidden sm:inline-flex"
          disabled={!ready}
          onClick={() => seek(time - BACK_SECONDS)}
          aria-label={`Back ${BACK_SECONDS} seconds`}
        >
          <RotateCcw aria-hidden />
        </Button>

        <div className="flex min-w-0 flex-1 items-center gap-3 px-1 sm:px-2">
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
          <span
            className="hidden whitespace-nowrap font-ui text-ui-caption tabular-nums sm:inline"
            aria-hidden
          >
            {formatMediaTime(shownTime)} / {formatMediaTime(shownDuration)}
          </span>
        </div>

        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="hidden sm:inline-flex"
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

        {/*
         * Always shown, so learners can find it: with no tracks the menu says
         * why, rather than the button appearing only once YouTube reports some.
         * The menu is placed against the whole player, so it fits above the bar.
         */}
        <div ref={menu}>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            disabled={!ready}
            onClick={() => setMenuOpen((open) => !open)}
            aria-haspopup="true"
            aria-expanded={menuOpen}
            aria-label="Subtitles and language"
          >
            {tracks && captionsOn ? <Captions aria-hidden /> : <CaptionsOff aria-hidden />}
          </Button>
          {menuOpen && (
            <div
              role="group"
              aria-label="Subtitles"
              className="absolute bottom-16 right-2 z-10 max-h-[calc(100%-4.5rem)] w-64 max-w-[calc(100%-1rem)] overflow-y-auto rounded-ui border border-white/20 bg-black/95 p-2 font-ui text-ui-caption text-white shadow-lg"
            >
              <p className="px-2 pb-1 pt-1 text-white/60">Subtitles</p>
              {!tracks && (
                <p className="px-2 py-2 text-white">
                  {started
                    ? "No subtitles are available for this video."
                    : "Subtitles appear once the video starts playing."}
                </p>
              )}
              {tracks && (
                <MenuItem selected={!captionsOn} onClick={captionsOff}>
                  Off
                </MenuItem>
              )}
              {tracks?.map((track) => (
                <MenuItem
                  key={`${track.languageCode}-${track.kind ?? ""}`}
                  selected={captionsOn && caption?.code === track.languageCode && !caption.translateTo}
                  onClick={() => chooseCaptions({ code: track.languageCode, translateTo: null })}
                >
                  {trackName(track)}
                </MenuItem>
              ))}
              {canTranslate && baseTrack && (
                <label className="mt-2 block border-t border-white/20 px-2 pt-2">
                  <span className="text-white/60">Translate subtitles to</span>
                  <select
                    value={captionsOn && caption?.translateTo ? caption.translateTo : ""}
                    onChange={(event) =>
                      event.target.value &&
                      chooseCaptions({ code: baseTrack.languageCode, translateTo: event.target.value })
                    }
                    className="mt-1 h-9 w-full rounded-full border border-white/40 bg-black px-3 text-white"
                  >
                    <option value="">Choose a language</option>
                    {translations.map((language) => (
                      <option key={language.languageCode} value={language.languageCode}>
                        {languageName(language.languageCode)}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          )}
        </div>

        <select
          value={rate}
          disabled={!ready}
          onChange={(event) => changeRate(Number(event.target.value))}
          aria-label="Playback speed"
          className="h-9 shrink-0 rounded-full border border-white/40 bg-black px-2 font-ui text-ui-caption text-white"
        >
          {rates.map((option) => (
            <option key={option} value={option}>
              {option}×
            </option>
          ))}
        </select>

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

function MenuItem({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`flex min-h-9 w-full items-center gap-2 rounded-ui-sm px-2 text-left hover:bg-white/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ui-ring ${
        selected ? "font-semibold" : ""
      }`}
    >
      <span aria-hidden className="w-3">
        {selected ? "✓" : ""}
      </span>
      {children}
    </button>
  );
}
