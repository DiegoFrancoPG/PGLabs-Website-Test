import { listOfferings, createOffering, offeringCreateSchema } from "@/features/content/enrollment";
import { readRoute, mutateRoute } from "@/lib/route";

/* operationIds list_offerings and create_offering. */
export const dynamic = "force-dynamic";

export const GET = (request: Request) =>
  readRoute(request, () =>
    listOfferings(new URL(request.url).searchParams.get("organization_id") ?? undefined)
  );

export const POST = (request: Request) =>
  mutateRoute(request, offeringCreateSchema, ({ body, requestId }) =>
    createOffering(body, requestId)
  );
