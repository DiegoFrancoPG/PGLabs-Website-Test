import { enrollCohort, enrollCohortSchema } from "@/features/content/enrollment";
import { mutateRoute } from "@/lib/route";

/* operationId enroll_cohort. */
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ offering_id: string }> }) {
  const { offering_id } = await params;
  return mutateRoute(request, enrollCohortSchema, ({ body, requestId }) =>
    enrollCohort(offering_id, body, requestId)
  );
}
