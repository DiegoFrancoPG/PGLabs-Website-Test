import { revokeCertificate, revokeSchema } from "@/features/learning/certificates";
import { mutateRoute } from "@/lib/route";

/*
 * operationId revoke_certificate. Platform admin only, and once: a repeat with
 * the same reason returns the certificate, a different reason is refused
 * rather than silently discarded (spec/03).
 */
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ certificate_id: string }> }
) {
  const { certificate_id } = await params;
  return mutateRoute(request, revokeSchema, ({ body, requestId }) =>
    revokeCertificate(certificate_id, body.reason, requestId)
  );
}
