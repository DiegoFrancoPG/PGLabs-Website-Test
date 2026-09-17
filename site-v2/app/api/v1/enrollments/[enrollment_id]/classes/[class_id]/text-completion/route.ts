import { completeText, textCompleteSchema } from "@/features/learning/playback";
import { mutateRoute } from "@/lib/route";

/*
 * operationId complete_text.
 *
 * AC-030: a text class completes here and nowhere else. Reading the class is
 * a GET against a STABLE handler, which cannot write.
 */
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ enrollment_id: string; class_id: string }> }
) {
  const { enrollment_id, class_id } = await params;
  return mutateRoute(request, textCompleteSchema, ({ body }) =>
    completeText(enrollment_id, class_id, body.event_id)
  );
}
