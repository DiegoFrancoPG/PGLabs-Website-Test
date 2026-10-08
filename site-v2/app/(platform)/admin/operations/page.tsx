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
import { Alert } from "@/components/pglearn/ui/alert";
import { Badge } from "@/components/pglearn/ui/badge";
import { Card } from "@/components/pglearn/ui/card";
import { pageContainer } from "@/components/pglearn/layout";

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
    <main className={`${pageContainer} py-16 [&>*]:max-w-5xl`}>
      <h1 className="font-heading text-2xl font-semibold tracking-tight text-ui-foreground">Operations</h1>
      <p className="mt-2 text-sm text-ui-muted-foreground">
        Delivery status and scheduled runs. Message contents are never shown here.
      </p>

      <section className="mt-10">
        <h2 className="text-xs font-medium uppercase tracking-wider text-ui-foreground">Configuration</h2>
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
        <h2 className="font-heading text-lg font-semibold text-ui-foreground">Notifications</h2>
        {notifications.items.length === 0 ? (
          <Card className="mt-4 p-6">
            <p className="text-sm">Nothing has been queued yet.</p>
          </Card>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[44rem] border-collapse text-sm">
              <caption className="sr-only">Queued and sent notifications</caption>
              <thead>
                <tr className="border-b border-ui-border text-left">
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
        <h2 className="font-heading text-lg font-semibold text-ui-foreground">Scheduled runs</h2>
        {jobs.items.length === 0 ? (
          <Card className="mt-4 p-6">
            <p className="text-sm">The scheduler has not recorded a run yet.</p>
          </Card>
        ) : (
          <ul className="mt-4 flex flex-col gap-2">
            {jobs.items.map((job) => (
              <li key={job.id} className="flex flex-wrap items-center gap-3 text-sm">
                <Badge variant={STATUS_VARIANT[job.status] ?? "outline"}>{job.status}</Badge>
                <span>{job.kind}</span>
                <span className="text-ui-muted-foreground">{formatWhen(job.created_at)}</span>
                {job.last_error && <span className="text-ui-destructive">{job.last_error}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="mt-12 text-sm">
        <Link href="/learn" className="pglearn-link">
          Back to your learning
        </Link>
      </p>
    </main>
  );
}

function Row({ item }: { item: OperationStatus }) {
  return (
    <tr className="border-b border-ui-border">
      <td className="py-3 pr-4">{item.kind}</td>
      <td className="py-3 pr-4 text-ui-muted-foreground">{item.recipient_email ?? "—"}</td>
      <td className="py-3 pr-4">
        <Badge variant={STATUS_VARIANT[item.status] ?? "outline"}>{item.status}</Badge>
      </td>
      <td className="tabular py-3 pr-4">{item.attempts}</td>
      <td className="py-3 pr-4 text-ui-muted-foreground">{formatWhen(item.created_at)}</td>
      <td className="py-3 pr-4 text-ui-muted-foreground">{item.last_error ?? "—"}</td>
      <td className="py-3">
        {item.status === "failed" || item.status === "suppressed" ? (
          <RetryNotification notificationId={item.id} />
        ) : item.status === "uncertain" ? (
          <span className="text-ui-muted-foreground">Reconcile first</span>
        ) : (
          "—"
        )}
      </td>
    </tr>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th scope="col" className="py-2 pr-4 text-xs font-medium uppercase tracking-wider text-ui-muted-foreground">
      {children}
    </th>
  );
}

function Configured({ label, state }: { label: string; state: string }) {
  const ok = state === "configured";
  return (
    <Card className="p-4">
      <p className="text-xs font-medium uppercase tracking-wider text-ui-muted-foreground">{label}</p>
      <p className={`mt-1 text-sm ${ok ? "text-ui-foreground" : "text-ui-destructive"}`}>
        {ok ? "Configured" : "Not configured"}
      </p>
    </Card>
  );
}

function NoAccess() {
  return (
    <main className={`${pageContainer} py-16 [&>*]:max-w-2xl`}>
      <h1 className="font-heading text-2xl font-semibold tracking-tight text-ui-foreground">This page is not available</h1>
      <Alert variant="info" className="mt-6">
        Operations is for platform administrators.
      </Alert>
      <p className="mt-8 text-sm">
        <Link href="/learn" className="pglearn-link">
          Back to your learning
        </Link>
      </p>
    </main>
  );
}
