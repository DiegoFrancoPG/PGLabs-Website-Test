"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Alert } from "@ds/components/ui/alert";
import { Button } from "@ds/components/ui/button";
import type { Progress } from "@/features/learning/playback";

/*
 * The media player (spec/04 §class page, spec/03 §4).
 *
 * Native controls, deliberately: ADR-16's accessibility requirement is met by
 * the browser's own player, which already has keyboard support, captions and a
 * volume control that people know. What this component adds is the part the
 * browser cannot do — telling the server what was actually watched.
 *
 * Every fifteen seconds it sends one interval of media time, never a position
 * alone, because a position is where the playhead is and an interval is what
 * was played (AC-026). A seek closes the current interval and opens a new one
 * at the new place, so the skipped span is never claimed.
 */

const HEARTBEAT_MS = 15_000;
const RATES = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

interface Props {
  enrollmentId: string;
  classId: string;
  kind: "video" | "audio";
  durationMs: number;
  primaryAssetId: string;
  captionAssetId: string | null;
  onProgress?: (progress: Progress) => void;
}

interface Session {
  sessionId: string;
  positionMs: number;
  nextSequence: number;
}

async function post(path: string, body: unknown) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
    body: JSON.stringify(body ?? {}),
  });
  const json = await response.json();
  if (!response.ok) {
    const error = new Error(json?.error?.message ?? "Request failed") as Error & { code?: string };
    error.code = json?.error?.code;
    throw error;
  }
  return json.data;
}

export function ClassPlayer({
  enrollmentId,
  classId,
  kind,
  durationMs,
  primaryAssetId,
  captionAssetId,
  onProgress,
}: Props) {
  const media = useRef<HTMLMediaElement | null>(null);
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [captionUrl, setCaptionUrl] = useState<string | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [superseded, setSuperseded] = useState(false);
  const [rate, setRate] = useState(1);

  /*
   * Heartbeat state lives in refs, not state: it is written by media events
   * many times a second and read by a timer, and none of it should cause a
   * render. `intervalStart` is null whenever nothing is being played.
   */
  const intervalStart = useRef<number | null>(null);
  const lastTime = useRef(0);
  const playedMs = useRef(0);
  const sequence = useRef(1);
  const sending = useRef(false);

  const toMs = (seconds: number) => Math.max(0, Math.min(durationMs, Math.round(seconds * 1000)));

  /* Opens the session and signs the media. Runs once per class. */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const started = await post(
          `/api/v1/enrollments/${enrollmentId}/classes/${classId}/playback`,
          {}
        );
        if (cancelled) return;
        sequence.current = started.next_sequence;
        setSession({
          sessionId: started.session_id,
          positionMs: started.position_ms,
          nextSequence: started.next_sequence,
        });

        const signed = await post(`/api/v1/assets/${primaryAssetId}/download`, {
          enrollment_id: enrollmentId,
          preview: false,
        });
        if (!cancelled) setMediaUrl(signed.url);

        if (captionAssetId) {
          const caption = await post(`/api/v1/assets/${captionAssetId}/download`, {
            enrollment_id: enrollmentId,
            preview: false,
          });
          /*
           * Fetched and turned into a blob rather than pointed at directly:
           * a <track> is subject to CORS, and the signed URL is on the storage
           * origin. This also means the track disappears with the page.
           */
          const vtt = await fetch(caption.url).then((r) => r.text());
          if (!cancelled) setCaptionUrl(URL.createObjectURL(new Blob([vtt], { type: "text/vtt" })));
        }
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enrollmentId, classId, primaryAssetId, captionAssetId]);

  useEffect(() => {
    return () => {
      if (captionUrl) URL.revokeObjectURL(captionUrl);
    };
  }, [captionUrl]);

  const sendHeartbeat = useCallback(
    async (closing: boolean) => {
      const element = media.current;
      if (!element || !session || superseded || sending.current) return;

      const now = toMs(element.currentTime);
      const start = intervalStart.current;
      const interval = start !== null && now > start ? { start_ms: start, end_ms: now } : null;
      // Nothing played and nothing to correct: stay quiet.
      if (!interval && !closing && playedMs.current === 0) return;

      sending.current = true;
      const elapsed = Math.min(30_000, Math.round(playedMs.current));
      playedMs.current = 0;
      if (interval) intervalStart.current = now;

      try {
        const result = await post(
          `/api/v1/enrollments/${enrollmentId}/classes/${classId}/progress`,
          {
            event_id: crypto.randomUUID(),
            session_id: session.sessionId,
            sequence: sequence.current,
            position_ms: now,
            elapsed_ms: interval ? Math.max(1, elapsed) : 0,
            rate: element.playbackRate,
            interval,
          }
        );
        sequence.current += 1;
        onProgress?.(result.progress);
      } catch (err) {
        const code = (err as { code?: string }).code;
        if (code === "SESSION_SUPERSEDED") {
          setSuperseded(true);
          element.pause();
        } else if (code === "INVALID_PROGRESS") {
          /*
           * The server did not believe this interval. It is not the learner's
           * doing — a suspended tab or a clock jump can produce one — so the
           * beat is dropped and the next one starts clean rather than shown
           * as an error.
           */
          intervalStart.current = toMs(element.currentTime);
          sequence.current += 1;
        } else {
          // A network blip: keep playing, the next beat carries the interval.
          if (interval) intervalStart.current = interval.start_ms;
        }
      } finally {
        sending.current = false;
      }
    },
    [enrollmentId, classId, session, superseded, onProgress, durationMs] // eslint-disable-line react-hooks/exhaustive-deps
  );

  /* The fifteen-second timer, and one last beat when the page goes away. */
  useEffect(() => {
    if (!session) return;
    const timer = setInterval(() => void sendHeartbeat(false), HEARTBEAT_MS);
    const onHide = () => {
      if (document.visibilityState === "hidden") void sendHeartbeat(true);
    };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onHide);
      void sendHeartbeat(true);
    };
  }, [session, sendHeartbeat]);

  const onLoaded = () => {
    const element = media.current;
    if (!element || !session) return;
    // Resume where the last session left off (AC-024).
    if (session.positionMs > 0) element.currentTime = session.positionMs / 1000;
    lastTime.current = element.currentTime;
  };

  const onPlay = () => {
    const element = media.current;
    if (!element) return;
    intervalStart.current = toMs(element.currentTime);
    lastTime.current = element.currentTime;
  };

  const onPause = () => {
    void sendHeartbeat(true);
    intervalStart.current = null;
  };

  const onTimeUpdate = () => {
    const element = media.current;
    if (!element) return;
    const delta = element.currentTime - lastTime.current;
    lastTime.current = element.currentTime;
    /*
     * A jump is a seek, not playback. Anything bigger than a second of media
     * time between two timeupdate events closes the interval here and reopens
     * it at the new place; the server applies the same rule independently.
     */
    if (delta < 0 || delta > 1.5) {
      void sendHeartbeat(true);
      intervalStart.current = toMs(element.currentTime);
      return;
    }
    // Wall-clock time actually spent playing, which is what elapsed_ms means.
    playedMs.current += (delta / element.playbackRate) * 1000;
  };

  const onEnded = () => void sendHeartbeat(true);

  const changeRate = (next: number) => {
    setRate(next);
    if (media.current) media.current.playbackRate = next;
  };

  if (error) {
    return (
      <Alert variant="warning" className="mt-8">
        This class could not be opened: {error}
      </Alert>
    );
  }

  const Tag = kind === "video" ? "video" : "audio";

  return (
    <div className="mt-8">
      {superseded && (
        <Alert variant="warning" className="mb-4">
          This program is playing in another tab.{" "}
          <Button variant="subtle" size="sm" onClick={() => window.location.reload()}>
            Resume here
          </Button>
        </Alert>
      )}

      {mediaUrl ? (
        <Tag
          ref={media as never}
          className="w-full rounded-lg bg-ink-800"
          src={mediaUrl}
          controls
          preload="metadata"
          crossOrigin="anonymous"
          onLoadedMetadata={onLoaded}
          onPlay={onPlay}
          onPause={onPause}
          onTimeUpdate={onTimeUpdate}
          onEnded={onEnded}
        >
          {captionUrl && (
            <track kind="captions" srcLang="en" label="English" src={captionUrl} default />
          )}
        </Tag>
      ) : (
        <p className="text-body-sm text-steel-500">Preparing playback…</p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="text-body-sm text-steel-500" id="rate-label">
          Speed
        </span>
        <div role="group" aria-labelledby="rate-label" className="flex flex-wrap gap-1">
          {RATES.map((option) => (
            <Button
              key={option}
              type="button"
              size="sm"
              variant={option === rate ? "primary" : "outline"}
              aria-pressed={option === rate}
              onClick={() => changeRate(option)}
            >
              {option}&times;
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}
