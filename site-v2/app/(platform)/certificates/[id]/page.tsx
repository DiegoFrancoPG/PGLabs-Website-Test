import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { verifiedUser } from "@/lib/auth";
import { RpcError } from "@/lib/rpc";
import { getCertificate } from "@/features/learning/certificates";
import { AppShell } from "@/components/layout/AppShell";
import { Alert } from "@ds/components/ui/alert";
import { Badge } from "@ds/components/ui/badge";
import { Button } from "@ds/components/ui/button";
import { Card } from "@ds/components/ui/card";

/*
 * spec/04 /certificates/[id]: "Name, program, completion date, issuer, status,
 * Download PDF. Authorized metadata after course expiry; revoked banner and
 * disabled PDF; do not expose public lookup."
 *
 * The last clause is why this page requires a session and why an unauthorized
 * reader is told the certificate is not available rather than that it exists.
 */

export const metadata: Metadata = {
  title: "Certificate",
  robots: { index: false, follow: false },
};

function utcDate(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(iso));
}

export default async function CertificatePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!(await verifiedUser())) redirect(`/login?next=/certificates/${id}`);

  let certificate;
  try {
    certificate = await getCertificate(id);
  } catch (err) {
    if (err instanceof RpcError && err.code === "NOT_FOUND") return <Unavailable />;
    throw err;
  }

  const revoked = certificate.revoked_at !== null;

  return (
    <AppShell active="learn">
    <main className="mx-auto max-w-2xl px-6 py-16">
      <p className="text-body-sm">
        <Link href="/learn" className="text-brand-600 underline underline-offset-4">
          Your learning
        </Link>
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <h1 className="font-display text-h2-sm text-ink-800">Certificate of completion</h1>
        {revoked ? <Badge variant="coral">Revoked</Badge> : <Badge variant="azure">Valid</Badge>}
      </div>

      {/* The revoked banner. The metadata below it stays visible (spec/03). */}
      {revoked && (
        <Alert variant="warning" className="mt-6">
          This certificate was revoked on {utcDate(certificate.revoked_at!)}:{" "}
          {certificate.revocation_reason}
        </Alert>
      )}

      <Card className="mt-8 p-6">
        <dl className="flex flex-col gap-4">
          <Field label="Awarded to" value={certificate.learner_name} />
          <Field label="Course" value={certificate.program_title} />
          <Field label="Version" value={String(certificate.version_number)} />
          <Field label="Completed" value={`${utcDate(certificate.completed_at)} (UTC)`} />
          <Field label="Issued" value={`${utcDate(certificate.issued_at)} (UTC)`} />
          <Field label="Issuer" value={certificate.issuer} />
          {/* The UUID is the verification identity — spec/03 — so it is shown. */}
          <Field label="Verification id" value={certificate.id} />
        </dl>
      </Card>

      <div className="mt-8">
        {revoked ? (
          <>
            <Button variant="outline" disabled>
              Download PDF
            </Button>
            <p className="mt-2 text-body-sm text-steel-500">
              A revoked certificate cannot be downloaded.
            </p>
          </>
        ) : (
          <Button variant="primary" asChild>
            <a href={`/api/v1/certificates/${certificate.id}/pdf`}>Download PDF</a>
          </Button>
        )}
      </div>
    </main>
    </AppShell>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-label uppercase text-steel-500">{label}</dt>
      <dd className="mt-1 text-body-lg text-ink-800">{value}</dd>
    </div>
  );
}

function Unavailable() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="font-display text-h2-sm text-ink-800">This certificate is not available</h1>
      <Alert variant="info" className="mt-6">
        It may belong to a different account.
      </Alert>
      <p className="mt-8 text-body-sm">
        <Link href="/learn" className="text-brand-600 underline underline-offset-4">
          Back to your learning
        </Link>
      </p>
    </main>
  );
}
