import { getLearningClass } from "@/features/learning/learning";
import { readRoute } from "@/lib/route";

/*
 * operationId get_learning_class.
 *
 * A read, and only a read. AC-066 requires that no completion is caused by a
 * GET, and the handler behind this is declared STABLE so the database will not
 * let it write whatever the route does.
 */
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ enrollment_id: string; class_id: string }> }
) {
  const { enrollment_id, class_id } = await params;
  return readRoute(request, () => getLearningClass(enrollment_id, class_id));
}
