import { listJobs } from "@/features/operations/operations";
import { readRoute } from "@/lib/route";

/* operationId list_jobs. The scheduler's last runs and their counts. */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const limit = Number(new URL(request.url).searchParams.get("limit") ?? 20);
  return readRoute(request, () => listJobs(limit));
}
