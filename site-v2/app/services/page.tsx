import type { Metadata } from "next";
import Link from "next/link";
import { Eyebrow } from "@ds/components/custom/eyebrow";
import { SectionHeading } from "@ds/components/custom/section-heading";
import { PhaseCard } from "@ds/components/custom/phase-card";
import { Card, CardTitle, CardDescription } from "@ds/components/ui/card";
import { Badge } from "@ds/components/ui/badge";
import { Button } from "@ds/components/ui/button";

export const metadata: Metadata = {
  title: "Services",
  description:
    "AI Governance, Tech Strategy, and Human-Centered Design services for nonprofits and social-impact organizations.",
};

const PILLARS = [
  {
    title: "Responsible AI governance",
    desc: "From risk assessment and governance to ethical implementation. We help you make informed decisions about AI without compromising your mission or data.",
    accent: "brand" as const,
  },
  {
    title: "Human-centered design",
    desc: "Technology built for people. Award-winning design methodologies for refugees, newcomers, and humanitarian staff.",
    accent: "gold" as const,
  },
];

const FUNDER_CARDS = [
  {
    title: "Get visibility",
    desc: "Comparable AI maturity scores and risk heat maps across your team, grantees or cohorts. A clear view of where AI is being used and where risk is concentrated — inputs for better funding and support decisions.",
  },
  {
    title: "Build real capacity",
    desc: "Structured capacity-building across roles focused on ethics, governance, and decision-making — moving beyond generic AI tool training to durable organizational capability.",
  },
  {
    title: "Strengthen governance",
    desc: "Plain-language policies, clear roles, and incident response protocols aligned with government and institutional expectations on risk mitigation, privacy, and equity.",
  },
];

const NONPROFIT_CARDS = [
  {
    title: "Assess where you are",
    desc: "Role-based surveys for frontline staff, managers, admin, and technical teams. Understand AI awareness, digital literacy, current use, and risk exposure so you can act from a clear baseline.",
  },
  {
    title: "Build role-based AI literacy",
    desc: "Shared minimum standard for all staff, with tailored learning by role — covering AI fundamentals, ethics and bias, data privacy, cybersecurity, and when not to use AI in your context.",
  },
  {
    title: "Enable ethical, everyday use",
    desc: 'Practical, approved use cases with "Approved / Conditional / Prohibited" guidance, human-in-the-loop workflows, and simple checklists so teams can use AI confidently and safely.',
  },
];

const METHODOLOGY = [
  { phase: "01", title: "Discover", desc: "Deep dive into organizational culture and user needs.", color: "brand" as const },
  { phase: "02", title: "De-risk", desc: "Identifying ethical pitfalls and technical debt.", color: "gold" as const },
  { phase: "03", title: "Design", desc: "Co-creating human-centered, scalable solutions.", color: "coral" as const },
  { phase: "04", title: "Deploy", desc: "Training and hand-off for sustainable ownership.", color: "azure" as const },
];

export default function ServicesPage() {
  return (
    <>
      {/* Hero */}
      <section className="bg-ink-800 pt-22 pb-26 px-6">
        <div className="max-w-content mx-auto">
          <Badge variant="dark">RAIRRE Program</Badge>
          <h1 className="font-display text-h1-sm md:text-display text-white mt-7 max-w-[24ch]">
            Bring AI out of the shadows and into{" "}
            safe, ethical practice.
          </h1>
          <p className="text-lede text-white/70 mt-8 max-w-prose">
            Understand AI use, reduce risk, and build confident practice across
            your team and the people you support.
          </p>
          <div className="flex flex-wrap gap-3 mt-10">
            <Button variant="primary" size="lg" asChild>
              <a href="#for-nonprofits">I&rsquo;m a nonprofit</a>
            </Button>
            <Button variant="ghost" size="lg" asChild>
              <a href="#for-funders">I&rsquo;m a funder</a>
            </Button>
          </div>
        </div>
      </section>

      {/* Two pillars */}
      <section className="bg-white py-30 px-6">
        <div className="max-w-content mx-auto">
          <SectionHeading
            eyebrow="Our approach"
            title={
              <>
                Two pillars, one mission.
              </>
            }
            className="mb-18"
          />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
            {PILLARS.map((p) => (
              <Card key={p.title} variant="plain" accent={p.accent} className="pt-6">
                <CardTitle className="text-h3 mb-4">{p.title}</CardTitle>
                <CardDescription className="text-body max-w-prose">{p.desc}</CardDescription>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* For funders */}
      <section id="for-funders" className="bg-ink-800 py-30 px-6">
        <div className="max-w-content mx-auto grid grid-cols-1 md:grid-cols-2 gap-18 items-start">
          <div>
            <SectionHeading
              eyebrow="For funders"
              tone="dark"
              title="De-risk AI across your portfolio."
              lede="Nonprofits are under pressure to adopt AI but often lack the governance, training, and organizational capacity to do it safely — creating ethical, legal, and operational risks, especially when working with vulnerable populations and sensitive data."
            />
            <Button variant="primary" size="lg" className="mt-10" asChild>
              <Link href="/contact">Inquire about funder advisory</Link>
            </Button>
          </div>
          <div className="flex flex-col gap-10">
            {FUNDER_CARDS.map((c) => (
              <Card key={c.title} variant="dark-ruled">
                <CardTitle className="text-white mb-3">{c.title}</CardTitle>
                <CardDescription className="text-white/70 max-w-prose">{c.desc}</CardDescription>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* For nonprofits */}
      <section id="for-nonprofits" className="py-30 px-6 bg-surface">
        <div className="max-w-content mx-auto grid grid-cols-1 md:grid-cols-2 gap-18 items-start">
          <div>
            <SectionHeading
              eyebrow="For non-profits"
              title={
                <>
                  Safer, smarter{" "}
                  AI use.
                </>
              }
              lede="AI is already being used across nonprofit teams — often informally, inconsistently, and without sufficient safeguards. This creates real risks around privacy, bias, decision-making, and reputational harm."
            />
            <Button variant="primary" size="lg" className="mt-10" asChild>
              <Link href="/contact">Talk about my organization</Link>
            </Button>
          </div>
          <div className="flex flex-col gap-10">
            {NONPROFIT_CARDS.map((c) => (
              <Card key={c.title} variant="ruled">
                <CardTitle className="mb-3">{c.title}</CardTitle>
                <CardDescription className="max-w-prose">{c.desc}</CardDescription>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Methodology */}
      <section className="py-30 px-6 bg-white">
        <div className="max-w-content mx-auto">
          <SectionHeading
            eyebrow="Our methodology"
            title="The PG Labs way."
            lede="A systematic route from unmanaged AI use to a funder-compliant, mission-aligned standard."
            align="center"
            className="mb-18"
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-10">
            {METHODOLOGY.map((m) => (
              <PhaseCard
                key={m.phase}
                phase={m.phase}
                title={m.title}
                description={m.desc}
                color={m.color}
              />
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-30 px-6 bg-surface">
        <div className="max-w-content mx-auto flex flex-col items-center text-center gap-6">
          <Eyebrow variant="brand">Get started</Eyebrow>
          <h2 className="font-display text-h2-sm md:text-h2 max-w-[24ch]">
            Ready to future-proof{" "}
            your mission?
          </h2>
          <p className="text-body-lg text-steel-500 max-w-prose">
            Book a fifteen-minute discovery session to discuss your technology
            challenges.
          </p>
          <Button variant="primary" size="lg" asChild>
            <Link href="/contact">Schedule a discovery call</Link>
          </Button>
          <p className="text-source uppercase tracking-label text-steel-400">
            Free · No commitment · 15 minutes
          </p>
        </div>
      </section>
    </>
  );
}
