import { describe, it, expect } from "vitest";
import { renderEmail, escapeHtml, type TemplateContext } from "@/lib/email/templates";
import { secretMatches, normalizeEventType } from "@/lib/email/provider";

/*
 * What the templates say, and what they must never say.
 *
 * spec/05: "Include plain text and HTML, PGLearn name, no exercise/chat
 * contents, and settings link for learning-reminder preferences."
 */

const context = (overrides: Partial<TemplateContext> = {}): TemplateContext => ({
  appUrl: "https://pglearn.example",
  displayName: "Amber",
  programTitle: "AI Foundations",
  organizationName: "Demo Organization A",
  dueDate: "13 September 2026",
  timezone: "UTC",
  enrollmentId: "11111111-1111-4111-8111-111111111111",
  certificateId: "22222222-2222-4222-8222-222222222222",
  ...overrides,
});

const KINDS = ["invitation", "inactivity", "due_soon", "due_today", "overdue", "certificate"] as const;

describe("every template", () => {
  it("has a subject, plain text and HTML", () => {
    for (const kind of KINDS) {
      const email = renderEmail(kind, context());
      expect(email.subject.length).toBeGreaterThan(0);
      expect(email.text.length).toBeGreaterThan(0);
      expect(email.html).toContain("<html>");
      // Both parts, always: a text-only client must not receive an empty message.
      expect(email.text).not.toContain("<");
    }
  });

  it("names PGLearn and links the reminder settings", () => {
    for (const kind of KINDS) {
      const email = renderEmail(kind, context());
      expect(email.html).toContain("PGLearn");
      expect(email.text).toContain("PGLearn");
      expect(email.html).toContain("https://pglearn.example/settings");
      expect(email.text).toContain("https://pglearn.example/settings");
    }
  });

  it("links only into our own application", () => {
    for (const kind of KINDS) {
      const email = renderEmail(kind, context());
      const links = [...email.html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
      expect(links.length).toBeGreaterThan(0);
      for (const link of links) expect(link.startsWith("https://pglearn.example")).toBe(true);
    }
  });

  it("carries no course content, exercise response or tutor conversation", () => {
    for (const kind of KINDS) {
      const email = renderEmail(kind, context());
      const everything = `${email.subject} ${email.text} ${email.html}`.toLowerCase();
      for (const forbidden of ["response", "answer", "tutor", "chat", "transcript", "score", "grade"]) {
        expect(everything).not.toContain(forbidden);
      }
    }
  });

  it("escapes anything interpolated into the HTML", () => {
    const email = renderEmail("inactivity", context({ programTitle: '<script>alert("x")</script>' }));
    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain("&lt;script&gt;");
    expect(escapeHtml(`& < > " '`)).toBe("&amp; &lt; &gt; &quot; &#39;");
  });
});

describe("what each template is for", () => {
  it("gives an invitation its accept link and its organization", () => {
    const email = renderEmail(
      "invitation",
      context({ actionUrl: "https://pglearn.example/invitations/abc" })
    );
    expect(email.html).toContain("https://pglearn.example/invitations/abc");
    expect(email.text).toContain("Demo Organization A");
  });

  it("gives every reminder a Continue link into the enrollment", () => {
    for (const kind of ["inactivity", "due_soon", "due_today", "overdue"] as const) {
      const email = renderEmail(kind, context());
      expect(email.html).toContain(
        "https://pglearn.example/learn/11111111-1111-4111-8111-111111111111"
      );
      expect(email.text).toContain("Continue");
    }
  });

  it("states the due date and the timezone it is in", () => {
    for (const kind of ["due_soon", "due_today", "overdue"] as const) {
      const email = renderEmail(kind, context());
      expect(email.text).toContain("13 September 2026");
      expect(email.text).toContain("UTC");
    }
  });

  it("sends a certificate to its authenticated page, never as an attachment", () => {
    const email = renderEmail("certificate", context());
    expect(email.html).toContain(
      "https://pglearn.example/certificates/22222222-2222-4222-8222-222222222222"
    );
    // No public lookup and no PDF in the mail (spec/03).
    expect(email.html).not.toContain(".pdf");
  });
});

describe("AC-050 the scheduler secret", () => {
  it("accepts only the exact secret", () => {
    expect(secretMatches("s3cret", "s3cret")).toBe(true);
    expect(secretMatches("s3cret", "s3crey")).toBe(false);
    expect(secretMatches("s3cre", "s3cret")).toBe(false);
    expect(secretMatches("s3crett", "s3cret")).toBe(false);
  });

  it("refuses when either side is missing", () => {
    expect(secretMatches(null, "s3cret")).toBe(false);
    expect(secretMatches("s3cret", undefined)).toBe(false);
    expect(secretMatches("", "")).toBe(false);
    // An unconfigured secret must never mean "anything goes".
    expect(secretMatches("anything", undefined)).toBe(false);
  });

  it("does not throw on a length mismatch, which would itself be a signal", () => {
    expect(() => secretMatches("a", "a-much-longer-secret")).not.toThrow();
  });
});

describe("AC-049 the provider's vocabulary", () => {
  it("maps Resend's event types onto the outbox's four outcomes", () => {
    expect(normalizeEventType("email.sent")).toBe("accepted");
    expect(normalizeEventType("email.delivered")).toBe("delivered");
    expect(normalizeEventType("email.bounced")).toBe("bounced");
    expect(normalizeEventType("email.complained")).toBe("complained");
  });

  it("treats an unknown event as a failure rather than as a success", () => {
    expect(normalizeEventType("email.something_new")).toBe("failed");
    expect(normalizeEventType("")).toBe("failed");
  });
});
