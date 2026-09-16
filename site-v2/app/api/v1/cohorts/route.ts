import { listCohorts, createCohort, cohortCreateSchema } from "@/features/organizations/cohorts";
import { readRoute, mutateRoute } from "@/lib/route";

/* operationIds list_cohorts and create_cohort. */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const org = new URL(request.url).searchParams.get("organization_id") ?? undefined;
  return readRoute(request, () => listCohorts(org));
}

export async function POST(request: Request) {
  return mutateRoute(request, cohortCreateSchema, ({ body, requestId }) =>
    createCohort(body, requestId)
  );
}
