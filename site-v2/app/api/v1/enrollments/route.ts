import { listMyEnrollments } from "@/features/learning/learning";
import { readRoute } from "@/lib/route";

/* operationId list_my_enrollments. */
export const dynamic = "force-dynamic";

export const GET = (request: Request) =>
  readRoute(request, async () => ({ items: await listMyEnrollments(), next_cursor: null }));
