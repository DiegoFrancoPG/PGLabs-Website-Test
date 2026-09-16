import { z } from "zod";
import { removeCohortMember } from "@/features/organizations/cohorts";
import { mutateRoute } from "@/lib/route";

/*
 * operationId remove_cohort_member. A DELETE with no body, so the schema is an
 * empty object — it still goes through mutateRoute, which means the Origin
 * rule and the Idempotency-Key requirement apply.
 */
export const dynamic = "force-dynamic";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ cohort_id: string; user_id: string }> }
) {
  const { cohort_id, user_id } = await params;
  return mutateRoute(request, z.object({}).strict().optional(), () =>
    removeCohortMember(cohort_id, user_id)
  );
}
