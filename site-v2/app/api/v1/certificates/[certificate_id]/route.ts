import { getCertificate } from "@/features/learning/certificates";
import { readRoute } from "@/lib/route";

/*
 * operationId get_certificate.
 *
 * Metadata stays readable after the course window closes, and after
 * revocation — spec/03 keeps revoked metadata visible and refuses only the
 * PDF. There is no public lookup in v1: this requires a session like
 * everything else.
 */
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ certificate_id: string }> }
) {
  const { certificate_id } = await params;
  return readRoute(request, () => getCertificate(certificate_id));
}
