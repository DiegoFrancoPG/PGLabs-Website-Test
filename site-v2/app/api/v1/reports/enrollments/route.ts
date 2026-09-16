import { reportEnrollments, reportFilterSchema } from "@/features/reporting/reports";
import { readRoute } from "@/lib/route";
import { jsonError, resolveRequestId } from "@/lib/http";

/*
 * operationId report_enrollments.
 *
 * Filters arrive in the query string, so they are parsed and typed here before
 * the database sees them — an unknown parameter is refused rather than
 * ignored, as everywhere else in the API.
 */
export const dynamic = "force-dynamic";

export function parseFilters(url: URL) {
  const raw: Record<string, unknown> = {};
  for (const [key, value] of url.searchParams) {
    if (key === "overdue") raw[key] = value === "true";
    else if (key === "limit") raw[key] = Number(value);
    else raw[key] = value;
  }
  return reportFilterSchema.safeParse(raw);
}

export async function GET(request: Request) {
  const filters = parseFilters(new URL(request.url));
  if (!filters.success) {
    return jsonError(
      "VALIDATION_ERROR",
      "The request was not valid.",
      resolveRequestId(request),
      filters.error.issues.map((i) => ({ path: i.path.join(".") || "(query)", message: i.message }))
    );
  }
  return readRoute(request, () => reportEnrollments(filters.data));
}
