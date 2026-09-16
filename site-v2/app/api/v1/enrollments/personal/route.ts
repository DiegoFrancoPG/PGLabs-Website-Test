import { enrollPersonal, enrollPersonalSchema } from "@/features/content/enrollment";
import { mutateRoute } from "@/lib/route";

/* operationId enroll_personal. */
export const dynamic = "force-dynamic";

export const POST = (request: Request) =>
  mutateRoute(request, enrollPersonalSchema, ({ body, requestId }) =>
    enrollPersonal(body, requestId)
  );
