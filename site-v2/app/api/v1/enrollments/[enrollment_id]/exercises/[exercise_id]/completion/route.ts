import {
  completeExercise,
  exerciseCompleteSchema,
  getExerciseCompletion,
} from "@/features/learning/exercises";
import { mutateRoute, readRoute } from "@/lib/route";

/*
 * operationIds complete_exercise and get_exercise_completion.
 *
 * The saved response is read-only after the first success (spec/03), so there
 * is no PUT here — a second, different response is 409
 * EXERCISE_ALREADY_COMPLETED rather than an update.
 */
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ enrollment_id: string; exercise_id: string }> }
) {
  const { enrollment_id, exercise_id } = await params;
  return mutateRoute(request, exerciseCompleteSchema, ({ body, requestId }) =>
    completeExercise(enrollment_id, exercise_id, body, requestId)
  );
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ enrollment_id: string; exercise_id: string }> }
) {
  const { enrollment_id, exercise_id } = await params;
  return readRoute(request, () => getExerciseCompletion(enrollment_id, exercise_id));
}
