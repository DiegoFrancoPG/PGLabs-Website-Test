import { z } from "zod";
import { callRpc } from "@/lib/rpc";
import { mutateRoute } from "@/lib/route";
import { jsonError, resolveRequestId } from "@/lib/http";

/*
 * operationId publish_version.
 *
 * spec/05 maps an incomplete draft to 422 PUBLISH_INCOMPLETE, and spec/04 has
 * the editor list the missing fields per class — so the handler's issues become
 * the error's `fields` rather than a single message.
 */
export const dynamic = "force-dynamic";

interface PublishResult {
  version: { id: string; state: string; published_at: string | null };
  issues: { path: string; message: string }[];
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ version_id: string }> }
) {
  const { version_id } = await params;

  const response = await mutateRoute(request, z.object({}).strict().optional(), () =>
    callRpc<PublishResult>("publish_version", { version_id })
  );

  // A refusal comes back as data, because the draft is intact and the caller
  // needs every problem at once. It is turned into the contract's error here.
  if (response.status === 200) {
    const body = (await response.clone().json()) as { data: PublishResult };
    if (body.data.issues.length > 0) {
      return jsonError(
        "PUBLISH_INCOMPLETE",
        "This version cannot be published yet.",
        resolveRequestId(request),
        body.data.issues
      );
    }
  }
  return response;
}
