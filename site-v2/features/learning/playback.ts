import { z } from "zod";
import { callRpc } from "@/lib/rpc";

/*
 * Playback, progress and text completion — contracts/api.json's Playback,
 * Heartbeat, TextComplete and ProgressResult.
 *
 * The rules themselves live in the database (spec/03 §4). These schemas are
 * the contract's shape, checked at the boundary so a malformed body is a 422
 * with a field path rather than a database error.
 */

export const playbackSchema = z.object({
  session_id: z.string().uuid(),
  generation: z.number().int().min(1),
  position_ms: z.number().int().min(0),
  next_sequence: z.number().int().min(1),
});

export type Playback = z.infer<typeof playbackSchema>;

export const progressSchema = z.object({
  class_id: z.string().uuid(),
  position_ms: z.number().int().min(0),
  coverage_ms: z.number().int().min(0),
  content_complete: z.boolean(),
  exercise_complete: z.boolean(),
  class_complete: z.boolean(),
  required_completed: z.number().int().min(0),
  required_total: z.number().int().min(1),
  certificate_id: z.string().uuid().nullable(),
});

export type Progress = z.infer<typeof progressSchema>;

export const progressResultSchema = z.object({
  accepted: z.boolean(),
  reason: z.literal("stale_sequence").nullable(),
  progress: progressSchema,
});

export type ProgressResult = z.infer<typeof progressResultSchema>;

/** The request body of record_progress, exactly as the contract declares it. */
export const heartbeatSchema = z
  .object({
    event_id: z.string().uuid(),
    session_id: z.string().uuid(),
    sequence: z.number().int().min(1),
    position_ms: z.number().int().min(0),
    elapsed_ms: z.number().int().min(0).max(30_000),
    rate: z.number().min(0.5).max(2),
    interval: z
      .object({
        start_ms: z.number().int().min(0),
        end_ms: z.number().int().min(1),
      })
      .strict()
      .nullable(),
  })
  .strict();

export type Heartbeat = z.infer<typeof heartbeatSchema>;

export const textCompleteSchema = z.object({ event_id: z.string().uuid() }).strict();

export async function startPlayback(
  enrollmentId: string,
  classId: string,
  requestId: string
): Promise<Playback> {
  return playbackSchema.parse(
    await callRpc("start_playback", {
      request_id: requestId,
      enrollment_id: enrollmentId,
      class_id: classId,
    })
  );
}

export async function recordProgress(
  enrollmentId: string,
  classId: string,
  body: Heartbeat
): Promise<ProgressResult> {
  /*
   * No request_id: the event_id IS the idempotency key here, and the database
   * compares the stored body against the new one itself. Putting this through
   * the generic idempotency table as well would give two different answers to
   * the same question.
   */
  return progressResultSchema.parse(
    await callRpc("record_progress", {
      enrollment_id: enrollmentId,
      class_id: classId,
      ...body,
    })
  );
}

export async function completeText(
  enrollmentId: string,
  classId: string,
  eventId: string
): Promise<ProgressResult> {
  return progressResultSchema.parse(
    await callRpc("complete_text", {
      enrollment_id: enrollmentId,
      class_id: classId,
      event_id: eventId,
    })
  );
}
