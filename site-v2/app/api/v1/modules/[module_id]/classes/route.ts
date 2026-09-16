import { createClass, classCreateSchema } from "@/features/content/content";
import { mutateRoute } from "@/lib/route";

/* operationId create_class. */
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ module_id: string }> }) {
  const { module_id } = await params;
  return mutateRoute(request, classCreateSchema, ({ body, requestId }) =>
    createClass(module_id, body, requestId)
  );
}
