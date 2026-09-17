import { exportEnrollments } from "@/features/reporting/reports";
import { verifiedUser } from "@/lib/auth";
import { errorResponse } from "@/lib/route";
import { jsonError, resolveRequestId } from "@/lib/http";
import { parseFilters } from "../enrollments/route";

/*
 * operationId export_enrollments.
 *
 * The CSV shares its filters, its scoping and its errors with the JSON report;
 * only the rendering differs. An export too large to serve synchronously is
 * 422 EXPORT_LIMIT rather than a file that is quietly missing rows.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestId = resolveRequestId(request);
  const url = new URL(request.url);

  const filters = parseFilters(url);
  if (!filters.success) {
    return jsonError("VALIDATION_ERROR", "The request was not valid.", requestId,
      filters.error.issues.map((i) => ({ path: i.path.join(".") || "(query)", message: i.message })));
  }
  if (!(await verifiedUser())) {
    return jsonError("UNAUTHENTICATED", "Sign in to continue.", requestId);
  }

  try {
    const csv = await exportEnrollments(filters.data);
    const stamp = new Date().toISOString().slice(0, 10);
    return new Response(csv, {
      status: 200,
      headers: {
        // The charset is declared as well as the BOM: between them no reader
        // has an excuse for mangling an accented name.
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="pglearn-enrollments-${stamp}.csv"`,
        "Cache-Control": "private, no-store",
        "X-Request-Id": requestId,
      },
    });
  } catch (err) {
    return errorResponse(err, requestId);
  }
}
