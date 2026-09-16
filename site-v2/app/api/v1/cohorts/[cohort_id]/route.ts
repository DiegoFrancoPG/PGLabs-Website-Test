import { updateCohort, cohortPatchSchema } from "@/features/organizations/cohorts";
import { mutateRoute } from "@/lib/route";

/* operationId update_cohort. */
export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: Promise<{ cohort_id: string }> }) {
  const { cohort_id } = await params;
  return mutateRoute(request, cohortPatchSchema, ({ body }) => updateCohort(cohort_id, body));
}
