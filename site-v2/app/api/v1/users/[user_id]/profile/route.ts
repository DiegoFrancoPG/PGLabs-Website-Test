import { updateMemberProfile, memberProfilePatchSchema } from "@/features/organizations/organizations";
import { mutateRoute } from "@/lib/route";

/* operationId update_member_profile (M30, D-07). */
export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ user_id: string }> }
) {
  const { user_id } = await params;
  return mutateRoute(request, memberProfilePatchSchema, ({ body }) =>
    updateMemberProfile(user_id, body)
  );
}
