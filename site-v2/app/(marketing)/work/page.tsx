import type { Metadata } from "next";
import { SectionHeading } from "@ds/components/custom/section-heading";
import { WorkPortfolio } from "@/components/sections/WorkPortfolio";
import type { WorkProject } from "@/components/sections/WorkPortfolio";

export const metadata: Metadata = {
  title: "Work",
  description:
    "Selected projects from PG Labs — responsible AI, human-centered design, and technology strategy for nonprofits and social impact organizations.",
};

// ─── Project data ─────────────────────────────────────────────────────────────
// Sample template — replace with final content

const PROJECTS: WorkProject[] = [
  {
    id: "welcome-coach",
    number: "01",
    category: "Newcomer Settlement",
    name: "Welcome Coach",
    tagline: "Helping newcomers find their footing in Canada.",
    badge: "Flagship",
    description: [
      "Welcome Coach is an AI-powered digital settlement guide built for newcomers navigating Canadian life. The platform provides personalized guidance on employment, services, language, and community — all through a conversational, accessible interface designed for people with varying digital literacy.",
      "PG Labs led the responsible AI strategy, product design, and co-design process alongside people with lived experience of displacement and migration.",
    ],
    services: [
      {
        title: "Responsible AI Strategy",
        desc: "Ethical framework for AI-powered recommendations, bias audits, and human-in-the-loop oversight protocols.",
      },
      {
        title: "Human-Centered Design",
        desc: "End-to-end UX research, co-design sessions with newcomers, and iterative interface design.",
      },
      {
        title: "Product Strategy",
        desc: "Feature prioritization, roadmap development, and alignment with IRCC policy requirements.",
      },
    ],
    stats: [
      { value: "162k+", label: "People reached" },
      { value: "6", label: "AI-powered tools" },
      { value: "3", label: "Languages supported" },
    ],
    supporters: ["IRCC", "Accenture", "UNAOC"],
    cta: { label: "Visit Welcome Coach", href: "https://welcomecoach.ca", external: true },
    images: ["Welcome Coach — Main interface", "Welcome Coach — Job matching tool"],
  },
  {
    id: "vesta",
    number: "02",
    category: "Gender-Based Violence",
    name: "Vesta",
    tagline: "Safety-first design for people who need it most.",
    badge: "Safety",
    description: [
      "Vesta is a digital platform built with and for people experiencing gender-based violence. Every design decision was made through a trauma-informed lens — from how information is presented, to the way the platform handles data, to the emergency exit button visible on every screen.",
      "PG Labs facilitated community co-design sessions, led the privacy-by-design architecture, and delivered the full UX/UI for the platform.",
    ],
    services: [
      {
        title: "Trauma-Informed UX",
        desc: "Co-design with survivors and frontline workers to ensure safe, dignified interactions at every touchpoint.",
      },
      {
        title: "Privacy by Design",
        desc: "Data minimization, consent-first architecture, and zero data retention policy.",
      },
      {
        title: "Service Navigation",
        desc: "Integration with local resource directories, real-time shelter availability, and crisis line access.",
      },
    ],
    stats: [
      { value: "100%", label: "Community co-designed" },
      { value: "0", label: "Data retained after session" },
      { value: "12+", label: "Partner organizations" },
    ],
    supporters: ["BC Government", "Status of Women Canada"],
    cta: { label: "Learn more about Vesta", href: "#", external: false },
    images: ["Vesta — Safe resource navigation", "Vesta — Privacy-first data flow"],
  },
  {
    id: "credit-canada",
    number: "03",
    category: "Financial Inclusion",
    name: "Credit Canada — Butterfly",
    tagline: "Making financial health accessible to everyone.",
    badge: "Partnership",
    description: [
      "The Butterfly tool gives Canadians a free, jargon-free snapshot of their credit health — with plain-language explanations and clear next steps, no shame, no gatekeeping.",
      "Built in partnership with Credit Canada, the country's oldest non-profit credit counsellor, PG Labs led the co-design process, plain-language content strategy, and full product design for the tool.",
    ],
    services: [
      {
        title: "Co-design",
        desc: "Participatory design sessions with Credit Canada clients across income levels and financial literacy backgrounds.",
      },
      {
        title: "Plain-Language UX",
        desc: "Content strategy and microcopy that explains credit concepts without jargon or judgment.",
      },
      {
        title: "Accessibility-First Design",
        desc: "Designed for users with low digital literacy and full compatibility with assistive technologies.",
      },
    ],
    stats: [
      { value: "Free", label: "For all Canadians" },
      { value: "60+", label: "Years of Credit Canada" },
      { value: "3×", label: "Engagement vs. prior tool" },
    ],
    supporters: ["Credit Canada", "Financial Consumer Agency of Canada"],
    cta: { label: "Learn more", href: "#", external: false },
    images: ["Butterfly — Credit health dashboard", "Butterfly — Personalized action plan"],
  },
];

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function WorkPage() {
  return (
    <>
      {/* Editorial masthead */}
      <section className="pt-22 pb-16 px-6 border-b border-steel-200">
        <div className="max-w-content mx-auto flex items-end justify-between gap-14 flex-wrap">
          <SectionHeading
            eyebrow="Selected work"
            size="lg"
            title={
              <>
                Projects that drive{" "}
                real impact.
              </>
            }
          />
          <p className="text-body text-steel-500 max-w-measure hidden md:block">
            A selection of projects where PG Labs applied responsible AI,
            human-centered design, and technology strategy to mission-driven
            challenges.
          </p>
        </div>
      </section>

      {/* Interactive portfolio */}
      <div className="max-w-content mx-auto px-6">
        <WorkPortfolio projects={PROJECTS} />
      </div>
    </>
  );
}
