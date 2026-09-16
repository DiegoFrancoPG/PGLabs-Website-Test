import { listNotifications } from "@/features/operations/operations";
import { readRoute } from "@/lib/route";

/* operationId list_notifications. Platform admin only; status without content. */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const limit = Number(new URL(request.url).searchParams.get("limit") ?? 50);
  return readRoute(request, () => listNotifications(limit));
}
