import { authorizeUpload, uploadCreateSchema } from "@/features/content/assets";
import { mutateRoute } from "@/lib/route";

/* operationId authorize_upload. */
export const dynamic = "force-dynamic";

export const POST = (request: Request) =>
  mutateRoute(request, uploadCreateSchema, ({ body, requestId }) =>
    authorizeUpload(body, requestId)
  );
