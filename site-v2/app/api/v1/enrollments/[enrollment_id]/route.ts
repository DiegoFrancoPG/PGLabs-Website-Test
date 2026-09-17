import { updateEnrollment, enrollmentPatchSchema } from "@/features/content/enrollment";
import { getEnrollment } from "@/features/learning/learning";
import { readRoute, mutateRoute } from "@/lib/route";

/* operationIds get_enrollment and update_enrollment. */
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ enrollment_id: string }> }
) {
  const { enrollment_id } = await params;
  return readRoute(request, () => getEnrollment(enrollment_id));
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ enrollment_id: string }> }
) {
  const { enrollment_id } = await params;
  return mutateRoute(request, enrollmentPatchSchema, ({ body }) =>
    updateEnrollment(enrollment_id, body)
  );
}
