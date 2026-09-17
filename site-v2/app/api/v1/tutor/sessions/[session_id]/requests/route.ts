import { listTutorHistory } from "@/features/tutor/tutor";
import { readRoute } from "@/lib/route";

/* operationId list_tutor_history. One learner's own conversation. */
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ session_id: string }> }
) {
  const { session_id } = await params;
  const limit = Number(new URL(request.url).searchParams.get("limit") ?? 20);
  return readRoute(request, () => listTutorHistory(session_id, limit));
}
