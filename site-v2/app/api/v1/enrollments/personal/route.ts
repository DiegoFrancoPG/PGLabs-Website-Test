import { enrollPersonal, enrollPersonalSchema } from "@/features/content/enrollment";
import { mutateRoute } from "@/lib/route";

/*
 * operationId enroll_personal.
 *
 * An individual's enrollment has no organization and no offering: their grant
 * names them directly, and the dates come with this request rather than from a
 * cohort's offering. That is what "no fake organization required" (spec/04)
 * means in the data.
 */
export const dynamic = "force-dynamic";

export const POST = (request: Request) =>
  mutateRoute(request, enrollPersonalSchema, ({ body, requestId }) =>
    enrollPersonal(body, requestId)
  );
