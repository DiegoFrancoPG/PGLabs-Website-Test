import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import {
  ArrowRight,
  Check,
  ClipboardList,
  FileCheck2,
  FileText,
  Gauge,
  GraduationCap,
  ListChecks,
  Minus,
  Repeat,
  ScrollText,
  ShieldAlert,
  Table2,
  Users,
} from "lucide-react";
import { Eyebrow } from "@ds/components/custom/eyebrow";
import { SectionHeading } from "@ds/components/custom/section-heading";
import { Badge } from "@ds/components/ui/badge";
import { Button } from "@ds/components/ui/button";
import { cn } from "@ds/lib/utils";

/*
 * RAIRRE landing page.
 *
 * Content is grounded in ../../../rairre-program: the four phases and their
 * gates come from that repo's README delivery table, the pillar and use-case
 * language from _brand-assets/terminology-glossary.md, the tier names from
 * _brand-assets/naming-conventions.md, and the heat-map axes from
 * 01_readiness-baseline/08-risk-heat-map-template.md.
 *
 * Two rules from _brand-assets/style-guide.md are load-bearing here: no em
 * dashes anywhere in the copy, and no invented client detail. Section 9 is the
 * "How we built RAIRRE" variant precisely because there is no cleared client
 * result to publish yet.
 *
 * One conversion action throughout: book a discovery call. Everything else
 * (program overview, proposal request, cohort waitlist) is secondary.
 */
export const metadata: Metadata = {
  title: "AI Readiness, Risk & Ethical Use",
  description:
    "RAIRRE is a four-phase program that measures where AI is actually in use across your team, builds the literacy to use it well, and leaves you with a policy your staff can follow.",
};

const CALL_HREF = "/contact";

/* ---------------------------------------------------------------- section 1 */

/*
 * The heat map is the program's most legible artifact, so it carries the hero
 * instead of a stock photograph. Built as a real table: row and column headers
 * make it navigable, and the table *is* the accessible alternative view.
 *
 * Risk levels are ordinal, so the fills run light to dark (brand tint, gold,
 * coral) rather than as three unrelated hues. Both the low tint (1.18:1) and
 * gold (2.16:1) sit under 3:1 against white, so every cell also carries a text
 * label. Nothing here is encoded by colour alone. Sample figures are
 * illustrative, per the style guide's rule against real client detail.
 */
const RISK_DIMENSIONS = [
  "Data exposure",
  "Shadow AI use",
  "Oversight gap",
  "Confidence vs competence",
  "Awareness gap",
];

const HEAT_ROWS: { role: string; cells: (0 | 1 | 2)[] }[] = [
  { role: "Frontline", cells: [2, 2, 1, 2, 1] },
  { role: "Managers", cells: [1, 1, 2, 1, 1] },
  { role: "Admin / Ops", cells: [2, 1, 1, 0, 1] },
  { role: "Technical / IT", cells: [1, 0, 1, 0, 0] },
];

const LEVELS = [
  /*
   * One ink label on three fills that descend in lightness (0.84 / 0.57 / 0.32),
   * so the ramp survives grayscale and CVD. Ink on the darkest step is 5.3:1;
   * white on it was only 2.9:1. Same dark-on-tint rule as the buttons.
   */
  { label: "Low", cell: "bg-brand-100 text-ink-800" },
  { label: "Med", cell: "bg-gold-500/70 text-ink-800" },
  { label: "High", cell: "bg-coral-500/85 text-ink-800" },
] as const;

function RiskHeatMap() {
  return (
    <figure className="rounded-2xl bg-white p-7 shadow-md">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-3">
        <span className="text-eyebrow uppercase text-steel-400">
          Phase 1 output: role by risk
        </span>
        <span className="text-source text-steel-400">Illustrative example</span>
      </figcaption>

      <div className="mt-6 overflow-x-auto">
        <table className="w-full border-separate border-spacing-0.5 text-left">
          <thead>
            <tr>
              <th scope="col" className="sr-only">
                Role group
              </th>
              {RISK_DIMENSIONS.map((dimension) => (
                <th
                  key={dimension}
                  scope="col"
                  className="px-1 pb-3 align-bottom text-label uppercase text-steel-400"
                >
                  {dimension}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {HEAT_ROWS.map((row) => (
              <tr key={row.role}>
                <th
                  scope="row"
                  className="whitespace-nowrap pr-5 text-body-sm font-semibold text-ink-800"
                >
                  {row.role}
                </th>
                {row.cells.map((level, i) => (
                  <td
                    key={RISK_DIMENSIONS[i]}
                    className={cn(
                      "rounded-sm px-2 py-3 text-center text-label uppercase",
                      LEVELS[level].cell
                    )}
                  >
                    {LEVELS[level].label}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-6 border-t border-steel-100 pt-5 text-body-sm text-steel-500">
        The red cells are the story. Each one is paired with concrete examples
        from your own survey data, so leadership sees what the risk looks like
        in practice, not just that it is high.
      </p>
    </figure>
  );
}

const TRUST_LOGOS = [
  { src: "/images/UNHCR.png", alt: "UNHCR" },
  { src: "/images/IRCC.png", alt: "IRCC" },
  { src: "/images/USAID.png", alt: "USAID" },
  { src: "/images/UNAOC.png", alt: "UNAOC" },
];

/* ---------------------------------------------------------------- section 2 */

const PROBLEMS = [
  "Staff are pasting client information into tools nobody approved.",
  "Nobody owns AI decisions, so every decision gets made twice or not at all.",
  "Your vendor contracts may already permit uses of your data you have not reviewed.",
  "Funders are starting to ask what your AI policy is, and “we’re being careful” is not an answer.",
];

/* ---------------------------------------------------------------- section 3 */

const PILLARS = [
  {
    letter: "Readiness",
    icon: Gauge,
    color: "brand" as const,
    body: "Where your organization actually stands, measured by role rather than averaged across everyone.",
  },
  {
    letter: "Risk",
    icon: ShieldAlert,
    color: "coral" as const,
    body: "Where exposure sits, named specifically and ranked, so you know what to fix first.",
  },
  {
    letter: "Ethical Use",
    icon: FileCheck2,
    color: "gold" as const,
    body: "What your team is permitted to do, written down in plain language and owned by a named person.",
  },
];

/* ---------------------------------------------------------------- section 4 */

const PREPARATION = [
  "Discovery call",
  "Tool and vendor audit",
  "Data sensitivity map",
  "Signed scope of work",
  "Kickoff",
];

const PHASES = [
  {
    n: "01",
    name: "Readiness Baseline",
    happens: "Role-specific surveys plus leadership interviews.",
    gets: [
      "Maturity score",
      "Risk heat map",
      "Skills distribution",
      "Executive briefing",
    ],
    gate: "Executive briefing delivered",
  },
  {
    n: "02",
    name: "Literacy & Leveling",
    happens: "A core module every role takes, then a module per role.",
    gets: ["Certified staff literacy across roles"],
    gate: "Targeted roles certified",
  },
  {
    n: "03",
    name: "Use-Case Enablement",
    happens: "Co-creation labs classify your real use cases.",
    gets: [
      "Use-case catalog: Approved / Conditional / Prohibited",
      "Role playbooks",
      "Decision checklists",
      "Safe prompts",
      "Escalation pathways",
    ],
    gate: "Catalog classified and playbooks in hand",
  },
  {
    n: "04",
    name: "Governance",
    happens: "Working sessions draft the policy and assign ownership.",
    gets: [
      "AI policy",
      "RACI matrix",
      "Incident response protocol",
      "Review cadence",
      "Onboarding module",
    ],
    gate: "Policy signed, owner named, cadence on the calendar",
  },
];

/* ---------------------------------------------------------------- section 5 */

const DELIVERABLES = [
  { icon: Gauge, text: "AI maturity score and role-by-risk heat map" },
  { icon: Table2, text: "Skills distribution across staff, not just an average" },
  { icon: FileText, text: "Executive briefing for leadership and board" },
  { icon: GraduationCap, text: "Certified staff literacy, by role" },
  {
    icon: ListChecks,
    text: "Use-case catalog classified Approved / Conditional / Prohibited",
  },
  {
    icon: ClipboardList,
    text: "Role-specific playbooks, decision checklists, and a safe prompt library",
  },
  { icon: ScrollText, text: "Plain-language AI policy your staff can actually follow" },
  {
    icon: Users,
    text: "RACI matrix, incident response protocol, and a standing review cadence",
  },
  {
    icon: Repeat,
    text: "Onboarding module so the standard survives staff turnover",
  },
];

/* ---------------------------------------------------------------- section 6 */

const FIT_YES = [
  "You are a nonprofit or civil society organization.",
  "You have roughly 15 to 300 staff.",
  "You handle sensitive community or client data.",
  "Leadership is willing to sponsor the work and sign a policy at the end.",
];

const FIT_NO = [
  "You want a tool recommendation only.",
  "You cannot commit staff time to surveys and modules.",
  "Nobody at the leadership level will own the outcome.",
];

/* ---------------------------------------------------------------- section 7 */

const TIERS = [
  {
    tier: "Tier 1",
    name: "Baseline Assessment & Policy Foundations",
    forWhom: "We need to know where we stand and get something written down.",
    includes: "Preparation, Phase 1, and a foundational policy.",
    recommended: false,
  },
  {
    tier: "Tier 2",
    name: "Core Strategy & Literacy Pathways",
    forWhom: "We need our staff capable, not just assessed.",
    includes: "Tier 1 plus Phase 2.",
    recommended: true,
  },
  {
    tier: "Tier 3",
    name: "The Full Program",
    forWhom: "We want this embedded and self-sustaining.",
    includes:
      "All four phases, playbooks, governance, a named internal AI champion, and train-the-trainer.",
    recommended: false,
  },
];

/* ---------------------------------------------------------------- section 8 */

const WHY = [
  {
    title: "Sector-native",
    body: "Built for nonprofits and civil society, not adapted down from enterprise consulting.",
  },
  {
    title: "Evidence-first",
    body: "The policy comes out of your own data, not a template with your logo on it.",
  },
  {
    title: "Co-created",
    body: "Staff help build the standard, which is why they follow it.",
  },
  {
    title: "Designed to be handed over",
    body: "The program ends with your own owner, your own cadence, and PG Labs stepping back.",
  },
];

/* --------------------------------------------------------------- section 10 */

const FAQS = [
  {
    q: "How much staff time does this take?",
    a: "The Phase 1 survey is short and confidential, and staff complete it once. Leadership interviews run 45 to 60 minutes. Phase 2 modules are scheduled around your operations, and Phase 3 labs and Phase 4 sessions involve a small working group rather than all staff.",
  },
  {
    q: "What if we do not currently use any AI tools?",
    a: "Most organizations that tell us this discover otherwise in Phase 1. Auto note-takers, summarizers, and features quietly added to tools you already pay for all count. If the assessment genuinely finds very little use, you get something valuable anyway: a standard in place before the pressure arrives, rather than after.",
  },
  {
    q: "Do you tell us which tools to buy?",
    a: "No. This is not a procurement exercise and we do not resell software. We assess the tools already in your environment, classify what they may be used for, and leave the buying decisions with you.",
  },
  {
    q: "Who sees our survey responses, and where is that data stored?",
    a: "Survey responses are confidential and reported to leadership in aggregate, by role group, never as individual answers. Response data lives in access-controlled storage held for your engagement, separate from our program templates. No client data is kept in our program repository.",
  },
  {
    q: "What happens after the engagement ends?",
    a: "That is what Phase 4 exists for. You finish with a signed policy, a named AI champion, a RACI matrix, an incident response protocol, and a review cadence already on the calendar. An advisory retainer and an annual resurvey are available if you want continued support, but the program is designed to work without us.",
  },
  {
    q: "Can we start with just the assessment?",
    a: "Yes. That is Tier 1: preparation, Phase 1, and a foundational policy. Many organizations start there and decide on literacy and governance once they have seen their own heat map.",
  },
  {
    q: "Do you work with organizations outside Canada?",
    a: "Yes. PG Labs is based in Vancouver and PeaceGeeks has delivered in humanitarian contexts internationally. Bring us your jurisdiction and we will account for it in the policy work.",
  },
];

/* -------------------------------------------------------------------------- */

export default function AiReadinessPage() {
  return (
    <>
      {/* 1. Hero ---------------------------------------------------------- */}
      <section className="bg-surface px-6 pt-22 pb-18">
        <div className="max-w-wide mx-auto">
          <div className="grid items-center gap-13 lg:grid-cols-[minmax(0,47fr)_minmax(0,53fr)] lg:gap-15">
            <div>
              <Eyebrow rule={false}>AI Readiness, Risk &amp; Ethical Use</Eyebrow>

              <h1 className="font-display text-h2-sm md:text-h2 text-ink-800 mt-6">
                Your staff are already using AI. Do you know where, and what
                it&rsquo;s touching?
              </h1>

              <p className="text-body-lg text-steel-500 mt-6 max-w-prose">
                RAIRRE is a four-phase program that measures where AI is
                actually in use across your team, builds the literacy to use it
                well, and leaves you with a policy your staff can follow.
              </p>

              <div className="flex flex-wrap gap-3 mt-9">
                <Button variant="primary" size="lg" asChild>
                  <Link href={CALL_HREF}>
                    <span>Book a discovery call</span>
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
                {/* Drop the file at public/program-overview.pdf to activate */}
                <Button variant="outline" size="lg" asChild>
                  <a href="/program-overview.pdf" download>
                    Download the program overview (PDF)
                  </a>
                </Button>
              </div>
            </div>

            <RiskHeatMap />
          </div>

          {/* Trust strip */}
          <div className="mt-18 flex flex-col gap-6 border-t border-steel-200 pt-8 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-body-sm text-steel-500">
              Delivered by PG Labs, a PeaceGeeks initiative.
            </p>
            <div className="flex flex-wrap items-center gap-x-10 gap-y-6">
              {TRUST_LOGOS.map((logo) => (
                <Image
                  key={logo.alt}
                  src={logo.src}
                  alt={logo.alt}
                  width={100}
                  height={28}
                  className="h-6 w-auto object-contain opacity-40 grayscale"
                />
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* 2. The problem --------------------------------------------------- */}
      <section className="bg-white px-6 py-30">
        <div className="max-w-content mx-auto">
          <SectionHeading
            eyebrow="The problem"
            title="None of this is a technology problem yet."
          />

          <div className="mt-13 grid gap-x-12 gap-y-10 sm:grid-cols-2">
            {PROBLEMS.map((problem) => (
              <p
                key={problem}
                className="border-t border-steel-200 pt-6 text-body-lg text-ink-800"
              >
                {problem}
              </p>
            ))}
          </div>

          <p className="mt-15 max-w-prose border-l-2 border-l-brand-500 pl-7 text-body-lg text-steel-500">
            The gap is not enthusiasm. It is evidence, shared literacy, and a
            written standard.
          </p>
        </div>
      </section>

      {/* 3. What RAIRRE is ------------------------------------------------ */}
      <section className="bg-surface px-6 py-30">
        <div className="max-w-content mx-auto">
          <div className="grid gap-13 lg:grid-cols-[minmax(0,40fr)_minmax(0,60fr)] lg:gap-15">
            <SectionHeading eyebrow="What it is" title="A program, not a workshop." />
            <div>
              <p className="text-body-lg text-steel-500">
                RAIRRE stands for AI Readiness, Risk and Ethical Use. It is a
                four-phase program that measures how ready your organization is
                to use AI safely, names where your exposure actually sits, gives
                every role the literacy to work with these tools, and ends with
                a plain-language policy your staff can follow and a named person
                who owns it.
              </p>
              <p className="mt-6 text-body text-steel-500">
                What it is not: a tool procurement exercise, a one-off training
                webinar, or a generic policy template with your logo dropped on
                it.
              </p>
            </div>
          </div>

          <div className="mt-15 grid gap-5 md:grid-cols-3">
            {PILLARS.map((pillar) => (
              <div key={pillar.letter} className="rounded-3xl bg-white p-8">
                <pillar.icon
                  className={cn(
                    "h-5 w-5",
                    pillar.color === "brand" && "text-brand-600",
                    pillar.color === "coral" && "text-coral-500",
                    pillar.color === "gold" && "text-gold-500"
                  )}
                  strokeWidth={1.75}
                />
                <h3 className="font-display text-h4 text-ink-800 mt-6">
                  {pillar.letter}
                </h3>
                <p className="mt-3 text-body-sm text-steel-500">{pillar.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 4. The four phases ---------------------------------------------- */}
      <section className="bg-white px-6 py-30">
        <div className="max-w-wide mx-auto">
          <SectionHeading
            eyebrow="The method"
            title="Four phases, each gated on the one before it."
            lede="No phase starts on assumption. Every one opens with evidence produced by the phase ahead of it, which is what separates this from a workshop."
          />

          {/* Preparation lead-in, kept light */}
          <div className="mt-13 flex flex-wrap items-center gap-x-4 gap-y-3 rounded-2xl bg-surface px-7 py-6">
            <span className="text-eyebrow uppercase text-steel-400">
              Before Phase 1
            </span>
            {PREPARATION.map((step, i) => (
              <span key={step} className="flex items-center gap-4">
                {i > 0 && <Minus className="h-3 w-3 text-steel-300" />}
                <span className="text-body-sm text-steel-500">{step}</span>
              </span>
            ))}
          </div>

          <ol className="mt-5 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
            {PHASES.map((phase) => (
              <li
                key={phase.n}
                className="flex flex-col rounded-3xl border border-steel-200 bg-white p-7"
              >
                <div className="flex items-baseline gap-3">
                  <span className="font-display tabular text-h4 text-brand-500">
                    {phase.n}
                  </span>
                  <h3 className="font-display text-h4 text-ink-800">
                    {phase.name}
                  </h3>
                </div>

                <p className="mt-6 text-label uppercase text-steel-400">
                  What happens
                </p>
                <p className="mt-2 text-body-sm text-steel-500">{phase.happens}</p>

                <p className="mt-7 text-label uppercase text-steel-400">You get</p>
                <ul className="mt-2 flex flex-col gap-2">
                  {phase.gets.map((item) => (
                    <li key={item} className="flex gap-2.5 text-body-sm text-ink-800">
                      <Check
                        className="mt-1 h-3.5 w-3.5 shrink-0 text-brand-600"
                        strokeWidth={2.5}
                      />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>

                {/* The gate is the differentiator, so it gets its own block */}
                <div className="mt-auto pt-8">
                  <div className="rounded-lg bg-surface px-4 py-3">
                    <p className="text-label uppercase text-steel-400">
                      Gate to next
                    </p>
                    <p className="mt-1.5 text-body-sm font-semibold text-ink-800">
                      {phase.gate}
                    </p>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* 5. What you walk away with -------------------------------------- */}
      <section className="bg-ink-900 px-6 py-30">
        <div className="max-w-content mx-auto">
          <SectionHeading
            tone="dark"
            eyebrow="Deliverables"
            title="What you walk away with."
            lede="Artifacts, not outcomes-speak. This is the list to put in front of a board or a funder."
          />

          <ul className="mt-13 grid gap-x-12 gap-y-8 md:grid-cols-2 xl:grid-cols-3">
            {DELIVERABLES.map((item) => (
              <li
                key={item.text}
                className="flex gap-4 border-t border-white/15 pt-6"
              >
                <item.icon
                  className="mt-0.5 h-5 w-5 shrink-0 text-brand-400"
                  strokeWidth={1.75}
                />
                <span className="text-body-sm text-white/80">{item.text}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* 6. Who it's for ------------------------------------------------- */}
      <section className="bg-white px-6 py-30">
        <div className="max-w-content mx-auto">
          <SectionHeading eyebrow="Fit" title="Who this is for, and who it is not." />

          <div className="mt-13 grid gap-5 md:grid-cols-2">
            <div className="rounded-3xl bg-surface p-9">
              <h3 className="font-display text-h4 text-ink-800">A good fit if</h3>
              <ul className="mt-6 flex flex-col gap-4">
                {FIT_YES.map((item) => (
                  <li key={item} className="flex gap-3 text-body-sm text-steel-500">
                    <Check
                      className="mt-1 h-4 w-4 shrink-0 text-brand-600"
                      strokeWidth={2.25}
                    />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-3xl border border-steel-200 p-9">
              <h3 className="font-display text-h4 text-ink-800">
                Not the right fit yet if
              </h3>
              <ul className="mt-6 flex flex-col gap-4">
                {FIT_NO.map((item) => (
                  <li key={item} className="flex gap-3 text-body-sm text-steel-500">
                    <Minus
                      className="mt-1 h-4 w-4 shrink-0 text-steel-300"
                      strokeWidth={2.25}
                    />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* 7. Tiers -------------------------------------------------------- */}
      <section id="tiers" className="bg-surface px-6 py-30">
        <div className="max-w-content mx-auto">
          <SectionHeading
            eyebrow="Scope"
            title="Start where your organization actually is."
            lede="Three tiers, ascending. Most organizations begin in the middle."
          />

          <div className="mt-13 grid items-start gap-5 md:grid-cols-3">
            {TIERS.map((tier) => (
              <div
                key={tier.tier}
                className={cn(
                  "flex h-full flex-col rounded-3xl bg-white p-8",
                  tier.recommended
                    ? "border-2 border-brand-500 shadow-md"
                    : "border border-steel-200"
                )}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-eyebrow uppercase text-steel-400">
                    {tier.tier}
                  </span>
                  {tier.recommended && <Badge>Recommended</Badge>}
                </div>

                <h3 className="font-display text-h4 text-ink-800 mt-5">
                  {tier.name}
                </h3>

                {/*
                 * "Starting at" figures go here once pricing is set. Nothing in
                 * the program repo carries numbers, so the card qualifies on
                 * scope and sends the reader to a proposal instead.
                 */}

                <p className="mt-6 text-label uppercase text-steel-400">For</p>
                <p className="mt-2 text-body-sm text-steel-500">{tier.forWhom}</p>

                <p className="mt-6 text-label uppercase text-steel-400">Includes</p>
                <p className="mt-2 text-body-sm text-ink-800">{tier.includes}</p>

                <div className="mt-auto pt-8">
                  <Button
                    variant={tier.recommended ? "primary" : "outline"}
                    className="w-full"
                    asChild
                  >
                    <Link href={CALL_HREF}>Request a proposal</Link>
                  </Button>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-10 grid gap-5 md:grid-cols-2">
            <p className="text-body-sm text-steel-500">
              <span className="font-semibold text-ink-800">Add-ons:</span>{" "}
              advisory retainer, annual resurvey, funder risk report, sector
              cohort delivery.
            </p>
            <p className="border-l-2 border-l-brand-500 pl-6 text-body-sm text-steel-500">
              <span className="font-semibold text-ink-800">
                Running it as a cohort:
              </span>{" "}
              organizations can go through RAIRRE together as a sector cohort at
              a lower per-organization cost.{" "}
              <Link
                href={CALL_HREF}
                className="font-semibold text-brand-600 underline decoration-brand-500/40 underline-offset-2 hover:decoration-brand-500"
              >
                Join the cohort waitlist
              </Link>
              .
            </p>
          </div>
        </div>
      </section>

      {/* 8. Why PG Labs -------------------------------------------------- */}
      <section className="bg-white px-6 py-30">
        <div className="max-w-content mx-auto">
          <div className="grid gap-13 lg:grid-cols-[minmax(0,38fr)_minmax(0,62fr)] lg:gap-15">
            <SectionHeading
              eyebrow="Why PG Labs"
              title="Built inside the sector it serves."
            />

            <ul className="grid gap-x-12 gap-y-9 sm:grid-cols-2">
              {WHY.map((item) => (
                <li key={item.title} className="border-t border-steel-200 pt-6">
                  <h3 className="text-body font-semibold text-ink-800">
                    {item.title}
                  </h3>
                  <p className="mt-2 text-body-sm text-steel-500">{item.body}</p>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* 9. How we built RAIRRE ------------------------------------------ */}
      <section className="bg-surface px-6 py-30">
        <div className="max-w-content mx-auto">
          <div className="grid gap-13 lg:grid-cols-[minmax(0,38fr)_minmax(0,62fr)] lg:gap-15">
            <SectionHeading
              eyebrow="Provenance"
              title="How we built RAIRRE."
            />

            <div className="max-w-prose">
              <p className="text-body-lg text-steel-500">
                RAIRRE was not adapted from an enterprise AI framework. It was
                built from the ground up for organizations that hold sensitive
                community data, drawing on PeaceGeeks&rsquo; decade of building
                technology in humanitarian and settlement contexts.
              </p>
              <p className="mt-6 text-body text-steel-500">
                The assessment instruments are role-specific by design, because
                a frontline worker and an IT lead carry entirely different
                exposure. The maturity rubric, the risk dimensions, and the
                terminology glossary are shared assets, so the words in your
                policy match the words in your training and in the surveys your
                staff filled in. The program was shaped through sector
                consultation with nonprofit leadership, including
                trauma-informed framing developed with gender-based violence
                service providers, where confidentiality is a safety issue
                rather than a compliance one.
              </p>
              <p className="mt-6 text-body text-steel-500">
                Client results from current engagements will be published here
                once those organizations have reviewed and cleared them.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 10. FAQ --------------------------------------------------------- */}
      <section className="bg-white px-6 py-30">
        <div className="max-w-content mx-auto">
          <SectionHeading eyebrow="Questions" title="The things leadership asks first." />

          {/*
           * Native disclosure elements: keyboard operable, searchable by the
           * browser's find-in-page, and no client JavaScript on the page.
           */}
          <div className="mt-13 max-w-prose">
            {FAQS.map((faq) => (
              <details
                key={faq.q}
                className="group border-t border-steel-200 py-6 last:border-b"
              >
                <summary className="flex cursor-pointer list-none items-start justify-between gap-6 text-body font-semibold text-ink-800 marker:content-none">
                  <span>{faq.q}</span>
                  <span
                    aria-hidden
                    className="mt-1 shrink-0 text-brand-600 transition-transform duration-200 group-open:rotate-45 motion-reduce:transition-none"
                  >
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <path
                        d="M7 1v12M1 7h12"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                      />
                    </svg>
                  </span>
                </summary>
                <p className="mt-4 text-body-sm text-steel-500">{faq.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* 11. Closing CTA ------------------------------------------------- */}
      <section className="bg-ink-900 px-6 py-30">
        <div className="max-w-content mx-auto grid gap-13 lg:grid-cols-[minmax(0,42fr)_minmax(0,58fr)] lg:gap-15">
          <div>
            <h2 className="font-display text-h2-sm md:text-h2 text-white">
              Start with a conversation, not a commitment.
            </h2>
            <p className="mt-6 text-body-lg text-white/70 max-w-measure">
              A 45-minute discovery call. We map where AI is showing up in your
              organization and tell you which tier fits. No obligation, and you
              get the map either way.
            </p>
            <p className="mt-9 border-t border-white/15 pt-6 text-body-sm text-white/50 max-w-measure">
              We do not share your information. Nothing you tell us on the call
              is used outside the proposal.
            </p>
          </div>

          {/* Same Tally form the contact page uses, so leads land in one place */}
          <div className="rounded-2xl bg-white p-8">
            <iframe
              data-tally-src="https://tally.so/embed/5BkV76?alignLeft=1&hideTitle=1&dynamicHeight=1"
              loading="lazy"
              width="100%"
              height="566"
              frameBorder={0}
              title="Book a PG Labs discovery call"
            />
            <script
              dangerouslySetInnerHTML={{
                __html: `var d=document,w="https://tally.so/widgets/embed.js",v=function(){"undefined"!=typeof Tally?Tally.loadEmbeds():d.querySelectorAll("iframe[data-tally-src]:not([src])").forEach(function(e){e.src=e.dataset.tallySrc})};if("undefined"!=typeof Tally)v();else if(d.querySelector('script[src="'+w+'"]')==null){var s=d.createElement("script");s.src=w,s.onload=v,s.onerror=v,d.body.appendChild(s);}`,
              }}
            />
          </div>
        </div>
      </section>
    </>
  );
}
