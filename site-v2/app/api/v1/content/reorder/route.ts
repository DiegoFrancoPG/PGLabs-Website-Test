import { reorderContent, reorderSchema } from "@/features/content/content";
import { mutateRoute } from "@/lib/route";

/* operationId reorder_content. */
export const dynamic = "force-dynamic";

export const POST = (request: Request) =>
  mutateRoute(request, reorderSchema, ({ body }) => reorderContent(body));
