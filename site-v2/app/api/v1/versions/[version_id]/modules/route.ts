import { createModule, moduleCreateSchema } from "@/features/content/content";
import { mutateRoute } from "@/lib/route";

/* operationId create_module. */
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ version_id: string }> }) {
  const { version_id } = await params;
  return mutateRoute(request, moduleCreateSchema, ({ body, requestId }) =>
    createModule(version_id, body, requestId)
  );
}
