import { updateEnrollment, enrollmentPatchSchema } from "@/features/content/enrollment";
import { mutateRoute } from "@/lib/route";

/* operationId update_enrollment. get_enrollment is T12. */
export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ enrollment_id: string }> }
) {
  const { enrollment_id } = await params;
  return mutateRoute(request, enrollmentPatchSchema, ({ body }) =>
    updateEnrollment(enrollment_id, body)
  );
}
