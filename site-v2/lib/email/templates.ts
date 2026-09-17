/*
 * What PGLearn actually writes to people.
 *
 * spec/05: "Email templates: invitation (organization/program and accept
 * link), inactivity (Continue link), due soon/today/overdue (due timezone and
 * Continue), certificate (authenticated certificate page). Include plain text
 * and HTML, PGLearn name, no exercise/chat contents, and settings link for
 * learning-reminder preferences."
 *
 * Every link points at our own application and is built here from ids the
 * caller verified — nothing in an email comes from anything a learner or a
 * model typed. The templates carry no progress detail beyond the due date and
 * no course content at all, so an email in the wrong inbox reveals a programme
 * title and nothing more.
 */

export type EmailKind =
  | "invitation"
  | "inactivity"
  | "due_soon"
  | "due_today"
  | "overdue"
  | "certificate";

export interface EmailContent {
  subject: string;
  text: string;
  html: string;
}

export interface TemplateContext {
  /** The application's own origin, for absolute links. */
  appUrl: string;
  displayName: string;
  programTitle?: string;
  organizationName?: string | null;
  /** The due date, already formatted in the learner's timezone. */
  dueDate?: string;
  timezone?: string;
  enrollmentId?: string;
  certificateId?: string;
  /** Only for an invitation, and never logged. */
  actionUrl?: string;
}

/** Escapes text going into HTML. Everything interpolated goes through this. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function layout(heading: string, paragraphs: string[], action: { label: string; href: string } | null, settingsUrl: string): string {
  const body = paragraphs.map((p) => `<p style="margin:0 0 16px">${escapeHtml(p)}</p>`).join("");
  const button = action
    ? `<p style="margin:24px 0"><a href="${escapeHtml(action.href)}" style="background:#26639f;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;display:inline-block">${escapeHtml(action.label)}</a></p>`
    : "";
  return [
    `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,sans-serif;color:#1c2128;line-height:1.5;margin:0;padding:24px">`,
    `<div style="max-width:520px;margin:0 auto">`,
    `<p style="font-weight:600;color:#26639f;margin:0 0 24px">PGLearn</p>`,
    `<h1 style="font-size:20px;margin:0 0 16px">${escapeHtml(heading)}</h1>`,
    body,
    button,
    `<hr style="border:none;border-top:1px solid #dde1e6;margin:32px 0 16px">`,
    `<p style="font-size:13px;color:#6b7280;margin:0">`,
    `You can change your learning reminder preferences in your `,
    `<a href="${escapeHtml(settingsUrl)}" style="color:#26639f">settings</a>.`,
    `</p></div></body></html>`,
  ].join("");
}

function plain(heading: string, paragraphs: string[], action: { label: string; href: string } | null, settingsUrl: string): string {
  const lines = ["PGLearn", "", heading, "", ...paragraphs];
  if (action) lines.push("", `${action.label}: ${action.href}`);
  lines.push("", "---", `Change your learning reminder preferences: ${settingsUrl}`);
  return lines.join("\n");
}

/**
 * The message for one outbox row.
 *
 * `continueUrl` and `certificateUrl` are built from the enrollment id the
 * database recorded, so a link can only ever point at something the recipient
 * is entitled to — and they still have to sign in to follow it.
 */
export function renderEmail(kind: EmailKind, context: TemplateContext): EmailContent {
  const settingsUrl = `${context.appUrl}/settings`;
  const continueUrl = context.enrollmentId
    ? `${context.appUrl}/learn/${context.enrollmentId}`
    : `${context.appUrl}/learn`;
  const programme = context.programTitle ?? "your course";
  const where = context.organizationName ? ` with ${context.organizationName}` : "";

  switch (kind) {
    case "invitation": {
      const heading = `You have been invited to PGLearn${where}`;
      const paragraphs = [
        `Hello ${context.displayName},`,
        `You have been invited to join PGLearn${where}${
          context.programTitle ? ` and start ${context.programTitle}` : ""
        }.`,
        "Opening the link below confirms your account. It expires in 24 hours.",
      ];
      const action = { label: "Accept your invitation", href: context.actionUrl ?? continueUrl };
      return {
        subject: `Your PGLearn invitation${where}`,
        text: plain(heading, paragraphs, action, settingsUrl),
        html: layout(heading, paragraphs, action, settingsUrl),
      };
    }

    case "inactivity": {
      const heading = `Pick up ${programme} where you left off`;
      const paragraphs = [
        `Hello ${context.displayName},`,
        `You have not been back to ${programme} for a few days.`,
        "Your place is saved, so you can carry on from exactly where you stopped.",
      ];
      const action = { label: "Continue", href: continueUrl };
      return {
        subject: `Continue ${programme}`,
        text: plain(heading, paragraphs, action, settingsUrl),
        html: layout(heading, paragraphs, action, settingsUrl),
      };
    }

    case "due_soon": {
      const heading = `${programme} is due on ${context.dueDate}`;
      const paragraphs = [
        `Hello ${context.displayName},`,
        `${programme} is due on ${context.dueDate} (${context.timezone}).`,
        "There is still time to finish it.",
      ];
      const action = { label: "Continue", href: continueUrl };
      return {
        subject: `${programme} is due on ${context.dueDate}`,
        text: plain(heading, paragraphs, action, settingsUrl),
        html: layout(heading, paragraphs, action, settingsUrl),
      };
    }

    case "due_today": {
      const heading = `${programme} is due today`;
      const paragraphs = [
        `Hello ${context.displayName},`,
        `${programme} is due today, ${context.dueDate} (${context.timezone}).`,
      ];
      const action = { label: "Continue", href: continueUrl };
      return {
        subject: `${programme} is due today`,
        text: plain(heading, paragraphs, action, settingsUrl),
        html: layout(heading, paragraphs, action, settingsUrl),
      };
    }

    case "overdue": {
      const heading = `${programme} was due on ${context.dueDate}`;
      const paragraphs = [
        `Hello ${context.displayName},`,
        `${programme} was due on ${context.dueDate} (${context.timezone}) and is not finished yet.`,
        "You can still complete it while you have access.",
      ];
      const action = { label: "Continue", href: continueUrl };
      return {
        subject: `${programme} is overdue`,
        text: plain(heading, paragraphs, action, settingsUrl),
        html: layout(heading, paragraphs, action, settingsUrl),
      };
    }

    case "certificate": {
      const heading = `You completed ${programme}`;
      const paragraphs = [
        `Hello ${context.displayName},`,
        `You have completed ${programme}. Your certificate is ready.`,
        "Sign in to view or download it.",
      ];
      // The certificate page requires a session; the email carries no PDF and
      // no public link (spec/03: "no public endpoint in v1").
      const action = {
        label: "View your certificate",
        href: `${context.appUrl}/certificates/${context.certificateId}`,
      };
      return {
        subject: `Your certificate for ${programme}`,
        text: plain(heading, paragraphs, action, settingsUrl),
        html: layout(heading, paragraphs, action, settingsUrl),
      };
    }
  }
}
