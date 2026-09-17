import {
  listCohortMembers,
  addCohortMembers,
  cohortMembersAddSchema,
} from "@/features/organizations/cohorts";
import { readRoute, mutateRoute } from "@/lib/route";

/* operationIds list_cohort_members and add_cohort_members. */
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ cohort_id: string }> }) {
  const { cohort_id } = await params;
  return readRoute(request, () => listCohortMembers(cohort_id));
}

export async function POST(request: Request, { params }: { params: Promise<{ cohort_id: string }> }) {
  const { cohort_id } = await params;
  return mutateRoute(request, cohortMembersAddSchema, ({ body, requestId }) =>
    addCohortMembers(cohort_id, body, requestId)
  );
}
