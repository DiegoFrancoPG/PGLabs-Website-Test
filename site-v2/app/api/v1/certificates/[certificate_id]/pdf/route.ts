import { getCertificatePdf } from "@/features/learning/certificates";
import { CertificateFontError } from "@/lib/certificate-pdf";
import { verifiedUser } from "@/lib/auth";
import { errorResponse } from "@/lib/route";
import { jsonError, resolveRequestId } from "@/lib/http";

/*
 * operationId get_certificate_pdf.
 *
 * The one response in the API that is not a JSON envelope. Its errors still
 * are: authorization, 404 and 409 CERTIFICATE_REVOKED all come from the same
 * mapping every other route uses.
 */
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ certificate_id: string }> }
) {
  const { certificate_id } = await params;
  const requestId = resolveRequestId(request);

  if (!(await verifiedUser())) {
    return jsonError("UNAUTHENTICATED", "Sign in to continue.", requestId);
  }

  try {
    const verificationUrl = new URL(`/certificates/${certificate_id}`, request.url).toString();
    const pdf = await getCertificatePdf(certificate_id, verificationUrl);

    return new Response(pdf as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="certificate-${certificate_id}.pdf"`,
        // A certificate is somebody's personal document; no shared cache may hold it.
        "Cache-Control": "private, no-store",
        "X-Request-Id": requestId,
      },
    });
  } catch (err) {
    /*
     * A name the bundled font cannot draw. spec/03 forbids silently replacing
     * the characters, so nothing is produced and the failure is reported as a
     * missing configuration — a font has to be added before this certificate
     * can exist.
     */
    if (err instanceof CertificateFontError) {
      console.error("[certificate] unrenderable characters", err.missing);
      return jsonError(
        "NOT_CONFIGURED",
        "This certificate cannot be produced yet. Support has been notified.",
        requestId
      );
    }
    return errorResponse(err, requestId);
  }
}
