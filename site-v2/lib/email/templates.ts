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

/*
 * The PG Labs design system, written inline because email clients ignore
 * stylesheets (D-29). Same tokens as app/globals.css: surface-subtle canvas, a
 * white card, heading navy in Lora, text-body in Nunito Sans, one ink-900
 * filled action, and the accent only as a rule. Web fonts rarely load in mail,
 * so each stack falls back to Georgia and Arial. Tables, not flex or grid, so
 * Outlook lays it out too. The logo is a PNG (Gmail and Outlook drop SVG),
 * served by the application itself.
 */
const EMAIL = {
  canvas: "#f4f6f8", // surface-subtle
  card: "#ffffff", // surface
  heading: "#1a2230", // heading
  body: "#667083", // text-body
  ink: "#10161f", // ink-900 — the filled action
  accent: "#59c4ed", // accent — rules only, never text on white
  border: "#e5e7eb", // border-tab
  divider: "#c9d4e2", // divider
  serif: "Lora, Georgia, 'Times New Roman', serif",
  sans: "'Nunito Sans', Arial, Helvetica, sans-serif",
};

function layout(
  heading: string,
  paragraphs: string[],
  action: { label: string; href: string } | null,
  settingsUrl: string,
  appUrl: string
): string {
  const origin = appUrl.replace(/\/$/, "");
  const body = paragraphs
    .map(
      (p) =>
        `<p style="margin:0 0 16px;font-family:${EMAIL.sans};font-size:15px;line-height:23px;color:${EMAIL.body}">${escapeHtml(p)}</p>`
    )
    .join("");
  const button = action
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 8px"><tr>` +
      `<td style="background:${EMAIL.ink};border-radius:8px">` +
      `<a href="${escapeHtml(action.href)}" style="display:inline-block;padding:13px 24px;font-family:${EMAIL.sans};font-size:15px;font-weight:700;line-height:20px;color:#ffffff;text-decoration:none;border-radius:8px">${escapeHtml(action.label)}</a>` +
      `</td></tr></table>`
    : "";
  return [
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">`,
    `<meta name="color-scheme" content="light"><title>${escapeHtml(heading)}</title></head>`,
    `<body style="margin:0;padding:0;background:${EMAIL.canvas}">`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${EMAIL.canvas}"><tr><td align="center" style="padding:32px 16px">`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px">`,
    // The PGLearn lockup, as in components/pglearn/Logo: PG Labs, a hairline, "Learn" in Lora.
    `<tr><td style="padding:0 0 20px"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>`,
    `<td style="vertical-align:middle"><img src="${escapeHtml(origin)}/images/email/pglabs-logo.png" width="92" height="28" alt="PG Labs" style="display:block;border:0;height:28px;width:92px"></td>`,
    `<td style="vertical-align:middle;padding:0 12px"><div style="width:1px;height:20px;background:${EMAIL.divider}"></div></td>`,
    `<td style="vertical-align:middle;font-family:${EMAIL.serif};font-size:20px;line-height:24px;color:${EMAIL.heading}">Learn</td>`,
    `</tr></table></td></tr>`,
    `<tr><td style="background:${EMAIL.card};border:1px solid ${EMAIL.border};border-radius:12px;padding:0">`,
    `<div style="height:4px;background:${EMAIL.accent};border-radius:12px 12px 0 0;font-size:0;line-height:0">&nbsp;</div>`,
    `<div style="padding:32px 32px 28px">`,
    `<h1 style="margin:0 0 20px;font-family:${EMAIL.serif};font-size:24px;line-height:31px;font-weight:400;color:${EMAIL.heading}">${escapeHtml(heading)}</h1>`,
    body,
    button,
    `</div></td></tr>`,
    `<tr><td style="padding:20px 8px 0;font-family:${EMAIL.sans};font-size:13px;line-height:20px;color:${EMAIL.body}">`,
    `You can change your learning reminder preferences in your `,
    `<a href="${escapeHtml(settingsUrl)}" style="color:${EMAIL.heading};text-decoration:underline">settings</a>.<br>`,
    `PGLearn · PG Labs, a PeaceGeeks initiative`,
    `</td></tr></table></td></tr></table></body></html>`,
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
        "The link below opens your invitation. It is valid for 7 days.",
      ];
      const action = { label: "Accept your invitation", href: context.actionUrl ?? continueUrl };
      return {
        subject: `Your PGLearn invitation${where}`,
        text: plain(heading, paragraphs, action, settingsUrl),
        html: layout(heading, paragraphs, action, settingsUrl, context.appUrl),
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
        html: layout(heading, paragraphs, action, settingsUrl, context.appUrl),
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
        html: layout(heading, paragraphs, action, settingsUrl, context.appUrl),
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
        html: layout(heading, paragraphs, action, settingsUrl, context.appUrl),
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
        html: layout(heading, paragraphs, action, settingsUrl, context.appUrl),
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
        html: layout(heading, paragraphs, action, settingsUrl, context.appUrl),
      };
    }
  }
}
