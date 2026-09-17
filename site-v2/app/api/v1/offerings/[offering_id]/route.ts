import { updateOffering, offeringPatchSchema } from "@/features/content/enrollment";
import { mutateRoute } from "@/lib/route";

/* operationId update_offering. */
export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: Promise<{ offering_id: string }> }) {
  const { offering_id } = await params;
  return mutateRoute(request, offeringPatchSchema, ({ body }) => updateOffering(offering_id, body));
}
