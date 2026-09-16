import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { verifiedUser } from "@/lib/auth";
import { RpcError } from "@/lib/rpc";
import {
  listNotifications,
  listJobs,
  configuration,
  type OperationStatus,
} from "@/features/operations/operations";
import { RetryNotification } from "@/components/operations/RetryNotification";
import { Alert } from "@ds/components/ui/alert";
import { Badge } from "@ds/components/ui/badge";
import { Card } from "@ds/components/ui/card";

/*
 * spec/04 /admin/operations: "Notification status/recipient/attempts/error, job
 * last success/counts/errors. No raw message body/auth links; unknown/uncertain
 * send gives reconciliation instruction; missing model/email configuration
 * clearly shown."
 *
 * What is deliberately absent from this screen: the message body, the subject,
 * the rendered template, and above all the Auth action link an invitation's
 * outbox payload may be holding. The DTO behind it has no field for any of
 * them, so none can arrive here by being forgotten.
 */

export const metadata: Metadata = {
  title: "Operations",
  robots: { index: false, follow: false },
};

function formatWhen(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(iso));
}

const STATUS_VARIANT: Record<string, "azure" | "coral" | "outline" | "default"> = {
  delivered: "azure",
  accepted: "azure",
  completed: "azure",
  failed: "coral",
  uncertain: "coral",
  suppressed: "outline",
  pending: "outline",
  sending: "default",
  running: "default",
};

export default async function OperationsPage() {
  if (!(await verifiedUser())) redirect("/login?next=/admin/operations");

  let notifications;
  let jobs;
  try {
    [notifications, jobs] = await Promise.all([listNotifications(50), listJobs(20)]);
  } catch (err) {
    if (err instanceof RpcError && err.code === "FORBIDDEN") return <NoAccess />;
    throw err;
  }

  const config = configuration();
  const uncertain = notifications.items.filter((item) => item.status === "uncertain");

  return (
    <main className="mx-auto max-w-5xl px-6 py-16">
      <h1 className="font-display text-h2-sm text-ink-800">Operations</h1>
      <p className="mt-2 text-body-sm text-steel-500">
        Delivery status and scheduled runs. Message contents are never shown here.
      </p>

      <section className="mt-10">
        <h2 className="text-label uppercase text-ink-700">Configuration</h2>
        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Configured label="Email" state={config.email} />
          <Configured label="Tutor model" state={config.tutor} />
          <Configured label="Scheduler" state={config.scheduler} />
        </div>
      </section>

      {uncertain.length > 0 && (
        <Alert variant="warning" className="mt-8">
          {uncertain.length} message{uncertain.length === 1 ? " has" : "s have"} no confirmed
          outcome. Check the provider&rsquo;s dashboard for each one before sending it again — a
          resend may be a second copy.
        </Alert>
      )}

      <section className="mt-10">
        <h2 className="font-display text-h4 text-ink-800">Notifications</h2>
        {notifications.items.length === 0 ? (
          <Card className="mt-4 p-6">
            <p className="text-body-sm">Nothing has been queued yet.</p>
          </Card>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[44rem] border-collapse text-body-sm">
              <caption className="sr-only">Queued and sent notifications</caption>
              <thead>
                <tr className="border-b border-steel-300 text-left">
                  <Th>Kind</Th>
                  <Th>Recipient</Th>
                  <Th>Status</Th>
                  <Th>Attempts</Th>
                  <Th>Queued</Th>
                  <Th>Last error</Th>
                  <Th>Action</Th>
                </tr>
              </thead>
              <tbody>
                {notifications.items.map((item) => (
                  <Row key={item.id} item={item} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mt-12">
        <h2 className="font-display text-h4 text-ink-800">Scheduled runs</h2>
        {jobs.items.length === 0 ? (
          <Card className="mt-4 p-6">
            <p className="text-body-sm">The scheduler has not recorded a run yet.</p>
          </Card>
        ) : (
          <ul className="mt-4 flex flex-col gap-2">
            {jobs.items.map((job) => (
              <li key={job.id} className="flex flex-wrap items-center gap-3 text-body-sm">
                <Badge variant={STATUS_VARIANT[job.status] ?? "outline"}>{job.status}</Badge>
                <span>{job.kind}</span>
                <span className="text-steel-500">{formatWhen(job.created_at)}</span>
                {job.last_error && <span className="text-coral-600">{job.last_error}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="mt-12 text-body-sm">
        <Link href="/learn" className="text-brand-600 underline underline-offset-4">
          Back to your learning
        </Link>
      </p>
    </main>
  );
}

function Row({ item }: { item: OperationStatus }) {
  return (
    <tr className="border-b border-steel-200">
      <td className="py-3 pr-4">{item.kind}</td>
      <td className="py-3 pr-4 text-steel-500">{item.recipient_email ?? "—"}</td>
      <td className="py-3 pr-4">
        <Badge variant={STATUS_VARIANT[item.status] ?? "outline"}>{item.status}</Badge>
      </td>
      <td className="tabular py-3 pr-4">{item.attempts}</td>
      <td className="py-3 pr-4 text-steel-500">{formatWhen(item.created_at)}</td>
      <td className="py-3 pr-4 text-steel-500">{item.last_error ?? "—"}</td>
      <td className="py-3">
        {item.status === "failed" || item.status === "suppressed" ? (
          <RetryNotification notificationId={item.id} />
        ) : item.status === "uncertain" ? (
          <span className="text-steel-500">Reconcile first</span>
        ) : (
          "—"
        )}
      </td>
    </tr>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th scope="col" className="py-2 pr-4 text-label uppercase text-steel-500">
      {children}
    </th>
  );
}

function Configured({ label, state }: { label: string; state: string }) {
  const ok = state === "configured";
  return (
    <Card className="p-4">
      <p className="text-label uppercase text-steel-500">{label}</p>
      <p className={`mt-1 text-body-sm ${ok ? "text-ink-800" : "text-coral-600"}`}>
        {ok ? "Configured" : "Not configured"}
      </p>
    </Card>
  );
}

function NoAccess() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="font-display text-h2-sm text-ink-800">This page is not available</h1>
      <Alert variant="info" className="mt-6">
        Operations is for platform administrators.
      </Alert>
      <p className="mt-8 text-body-sm">
        <Link href="/learn" className="text-brand-600 underline underline-offset-4">
          Back to your learning
        </Link>
      </p>
    </main>
  );
}
