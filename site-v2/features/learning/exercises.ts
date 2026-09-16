import { z } from "zod";
import { callRpc } from "@/lib/rpc";
import { validateSubmission } from "@/lib/exercise";
import { progressResultSchema, type ProgressResult } from "@/features/learning/playback";

/* contracts/api.json: ExerciseComplete and ExerciseSaved. */

export const exerciseSavedSchema = z.object({
  exercise_id: z.string().uuid(),
  response: z.string().min(1).max(2000),
  confirmed_at: z.string(),
});

export type ExerciseSaved = z.infer<typeof exerciseSavedSchema>;

/*
 * The contract's minLength/maxLength are UTF-16 in Zod, which is not how the
 * database counts. The length rule therefore lives in lib/exercise.ts and runs
 * after this, so a 2,000-emoji response is accepted rather than refused at
 * 4,000 "characters" that do not exist.
 */
export const exerciseCompleteSchema = z
  .object({
    response: z.string(),
    confirmed: z.literal(true),
  })
  .strict();

export async function completeExercise(
  enrollmentId: string,
  exerciseId: string,
  body: z.infer<typeof exerciseCompleteSchema>,
  requestId: string
): Promise<ProgressResult> {
  // Normalised here, so what is validated is exactly what is stored.
  const response = validateSubmission(body);
  return progressResultSchema.parse(
    await callRpc("complete_exercise", {
      request_id: requestId,
      enrollment_id: enrollmentId,
      exercise_id: exerciseId,
      response,
      confirmed: true,
    })
  );
}

export async function getExerciseCompletion(
  enrollmentId: string,
  exerciseId: string
): Promise<ExerciseSaved> {
  return exerciseSavedSchema.parse(
    await callRpc("get_exercise_completion", {
      enrollment_id: enrollmentId,
      exercise_id: exerciseId,
    })
  );
}
