import type { Metadata } from "next";
import Link from "next/link";
import { SectionHeading } from "@ds/components/custom/section-heading";
import { Eyebrow } from "@ds/components/custom/eyebrow";
import { Card, CardTitle, CardDescription } from "@ds/components/ui/card";
import { Badge } from "@ds/components/ui/badge";
import { Button } from "@ds/components/ui/button";

/*
 * Public overview of PGLearn. Every claim on this page traces to the confirmed
 * product requirements in spec/01; spec/01 also says "Do not invent product
 * requirements", so there is deliberately no pricing, no outcome or mastery
 * claim, and no accreditation language (ADR-11 sets the default issuer with
 * "no accreditation claim").
 *
 * There is no sign-up call to action because ADR-05 disables public sign-up —
 * access is invite-only and arranged with PG Labs. The Sign in link joins the
 * masthead at T05, when /login exists.
 */

export const metadata: Metadata = {
  title: "PGLearn",
  description:
    "PGLearn is PG Labs' learning platform for nonprofit and social-impact teams: structured programs, practical exercises, and completion tracking for managers.",
};

const LEARNER_FEATURES = [
  {
    title: "Pick up where you left off",
    desc: "Programs are organized into modules and classes, delivered as video, audio or text. Progress is saved as you go, so a class resumes where you stopped rather than restarting.",
  },
  {
    title: "Practice, not just watch",
    desc: "A class can carry a short practical exercise. You write your own response and confirm you have completed it. Nothing is graded and nothing is scored.",
  },
  {
    title: "Ask the course a question",
    desc: "A built-in tutor explains the material in the class you are on and offers practical workplace examples. It answers from the course content and takes no actions on your behalf.",
  },
  {
    title: "Handouts and certificates",
    desc: "Download the handouts attached to a class, and receive a certificate once every required class in the program is complete.",
  },
];

const MANAGER_FEATURES = [
  {
    title: "Organise staff into cohorts",
    desc: "Group your team into cohorts and assign a program with a start date and a due date that suit your schedule.",
  },
  {
    title: "See how the team is doing",
    desc: "Track who has been assigned, started, completed or is overdue across your own organization, and export the same view as CSV.",
  },
  {
    title: "Reminders that do the chasing",
    desc: "Learners receive their own reminders as a due date approaches, so following up is not another task on your list.",
  },
];

export default function LearningPage() {
  return (
    <>
      {/* Hero. The h1 is written here rather than via SectionHeading, which
          always renders an h2 — matching how every other marketing page does
          its hero, and giving the page the single top-level heading it needs. */}
      <section className="bg-ink-800 px-6 pt-22 pb-26">
        <div className="max-w-content mx-auto">
          <Badge variant="dark">PGLearn</Badge>
          <h1 className="font-display text-h1-sm md:text-display text-white mt-7 max-w-[24ch]">
            Structured learning for teams adopting technology responsibly.
          </h1>
          <p className="text-lede text-white/70 mt-8 max-w-prose">
            PGLearn is the PG Labs learning platform. Organizations run their staff through a
            program together; individuals can be enrolled directly. Access is arranged with us
            rather than bought online.
          </p>
          <div className="mt-10">
            <Button variant="primary" size="lg" asChild>
              <Link href="/contact">Talk to us about access</Link>
            </Button>
          </div>
        </div>
      </section>

      <section className="px-6 pt-22 pb-20">
        <div className="max-w-content mx-auto">
          <SectionHeading
            eyebrow="For learners"
            title="Built around finishing the course"
            lede="Short classes, saved progress and practical exercises, so learning fits around the work rather than competing with it."
          />
          <div className="mt-12 grid grid-cols-1 md:grid-cols-2 gap-6">
            {LEARNER_FEATURES.map((f) => (
              <Card key={f.title} className="p-7">
                <CardTitle className="text-h4">{f.title}</CardTitle>
                <CardDescription className="mt-3 text-body-sm">{f.desc}</CardDescription>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-surface px-6 pt-20 pb-22">
        <div className="max-w-content mx-auto">
          <SectionHeading
            eyebrow="For managers"
            title="Know where your team actually is"
            lede="Managers see their own organization's progress — and only their own organization's."
          />
          <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-6">
            {MANAGER_FEATURES.map((f) => (
              <Card key={f.title} className="p-7">
                <CardTitle className="text-h4">{f.title}</CardTitle>
                <CardDescription className="mt-3 text-body-sm">{f.desc}</CardDescription>
              </Card>
            ))}
          </div>

          <p className="mt-10 max-w-measure text-body-sm text-steel-500">
            Exercise responses and tutor conversations stay private to the learner. Managers and
            administrators see progress and completion, never what someone wrote or asked.
          </p>
        </div>
      </section>

      <section className="px-6 pt-20 pb-26">
        <div className="max-w-content mx-auto">
          <Eyebrow variant="brand" rule>
            Getting started
          </Eyebrow>
          <h2 className="mt-5 max-w-measure text-h2-sm md:text-h2">
            Access is set up with your organization
          </h2>
          <p className="mt-5 max-w-measure text-body-lg">
            There is no public sign-up. We agree which programs your organization has access to, set
            up your cohorts and dates, and invite your staff by email. If you have been invited
            already, the invitation has your link.
          </p>
          <div className="mt-8">
            <Button variant="primary" asChild>
              <Link href="/contact">Talk to an AI expert for free</Link>
            </Button>
          </div>
        </div>
      </section>
    </>
  );
}
