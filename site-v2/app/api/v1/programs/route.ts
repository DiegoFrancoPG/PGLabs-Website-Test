import { listPrograms, createProgram, programCreateSchema } from "@/features/content/content";
import { readRoute, mutateRoute } from "@/lib/route";

/* operationIds list_programs and create_program. */
export const dynamic = "force-dynamic";

export const GET = (request: Request) => readRoute(request, () => listPrograms());

export const POST = (request: Request) =>
  mutateRoute(request, programCreateSchema, ({ body, requestId }) => createProgram(body, requestId));
