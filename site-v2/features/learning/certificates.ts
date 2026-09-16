import { z } from "zod";
import { callRpc } from "@/lib/rpc";
import { renderCertificatePdf } from "@/lib/certificate-pdf";

/* contracts/api.json: Certificate and Revoke. */

export const certificateSchema = z.object({
  id: z.string().uuid(),
  enrollment_id: z.string().uuid(),
  learner_name: z.string().min(1).max(120),
  program_title: z.string().min(1).max(160),
  version_number: z.number().int().min(1),
  issuer: z.string(),
  completed_at: z.string(),
  issued_at: z.string(),
  revoked_at: z.string().nullable(),
  revocation_reason: z.string().nullable(),
});

export type Certificate = z.infer<typeof certificateSchema>;

export const revokeSchema = z.object({ reason: z.string().min(1).max(500) }).strict();

export async function getCertificate(certificateId: string): Promise<Certificate> {
  return certificateSchema.parse(await callRpc("get_certificate", { certificate_id: certificateId }));
}

export async function revokeCertificate(
  certificateId: string,
  reason: string,
  requestId: string
): Promise<Certificate> {
  return certificateSchema.parse(
    await callRpc("revoke_certificate", {
      request_id: requestId,
      certificate_id: certificateId,
      reason,
    })
  );
}

/*
 * The PDF. The database authorizes and refuses a revoked certificate (409
 * CERTIFICATE_REVOKED) before a single byte is rendered, and hands back the
 * snapshot the document is drawn from — never the live profile or program,
 * which may since have been renamed.
 */
export async function getCertificatePdf(
  certificateId: string,
  verificationUrl: string
): Promise<Uint8Array> {
  const certificate = certificateSchema.parse(
    await callRpc("get_certificate_pdf", { certificate_id: certificateId })
  );
  return renderCertificatePdf(certificate, verificationUrl);
}
