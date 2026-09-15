import type { Project } from "./types";

export const projects: Project[] = [
  {
    id: "welcome-coach",
    name: "Welcome Coach",
    icon: "GraduationCap",
    iconColor: "brand",
    badge: "Flagship",
    badgeTint: "green",
    category: "Newcomer settlement",
    headline: /* COPY: Welcome Coach headline */ "Helping newcomers find their footing in Canada.",
    description: /* COPY: Welcome Coach 2-sentence description */ "Welcome Coach is an AI-powered settlement guide that helps newcomers navigate Canadian life — from finding work to understanding services. Built with and for people with lived experience of displacement.",
    tags: ["Responsible AI", "Human-centered design", "Product strategy"],
    cta: { label: "Visit Welcome Coach", href: "https://welcomecoach.ca" },
    imagePlaceholder: "WELCOME COACH PROJECT IMAGE",
    panel: {
      kind: "welcome-coach",
      stats: [
        { value: "162k+", label: "People reached" },
        { value: "6", label: "AI-powered tools" },
      ],
      features: [
        "AI interview practice",
        "NOC code finder",
        "Job matching",
        "Skills & workplace readiness",
      ],
      supporters: ["IRCC", "Accenture", "UNAOC"],
    },
  },
  {
    id: "vesta",
    name: "Vesta",
    icon: "ShieldCheck",
    iconColor: "coral",
    badge: "Safety",
    badgeTint: "rose",
    category: "Gender-based violence",
    headline: /* COPY: Vesta headline */ "Safety-first design for people who need it most.",
    description: /* COPY: Vesta 2-sentence description */ "Vesta is a platform built with and for people experiencing gender-based violence, prioritizing privacy and dignity at every touchpoint. Every design decision is trauma-informed and community-validated.",
    tags: ["Trauma-informed design", "Safety by design", "Community access"],
    cta: { label: "Learn more", href: /* LINK: vesta url */ "#" },
    imagePlaceholder: "VESTA PROJECT IMAGE",
    panel: {
      kind: "vesta",
      featureTitle: "Design principles",
      features: [
        {
          icon: "Shield",
          label: "Privacy first",
          sublabel: "No data exposure, ever",
        },
        {
          icon: "Heart",
          label: "Trauma-informed UX",
          sublabel: "Built with affected communities",
        },
        {
          icon: "MapPin",
          label: "Service navigation",
          sublabel: "Connects to real support",
        },
      ],
    },
  },
  {
    id: "credit-canada",
    name: "Credit Canada",
    icon: "TrendingUp",
    iconColor: "gold",
    badge: "Partnership",
    badgeTint: "gold",
    category: "Financial inclusion",
    headline: /* COPY: Credit Canada headline */ "Making financial health accessible to everyone.",
    description: /* COPY: Credit Canada 2-sentence description */ "The Butterfly tool gives Canadians a free, jargon-free snapshot of their credit health with clear next steps — no shame, no gatekeeping. Built in partnership with Credit Canada, the country's oldest non-profit credit counsellor.",
    tags: ["Co-design", "Financial inclusion", "Plain-language UX"],
    cta: { label: "Learn more", href: /* LINK: credit canada url */ "#" },
    imagePlaceholder: "CREDIT CANADA PROJECT IMAGE",
    panel: {
      kind: "credit-canada",
      featureTitle: "What it does",
      features: [
        {
          icon: "BarChart2",
          label: "Credit assessment",
          sublabel: "Free, jargon-free snapshot",
        },
        {
          icon: "ArrowRight",
          label: "Personalized next steps",
          sublabel: "Actionable guidance per user",
        },
        {
          icon: "Handshake",
          label: "Partner with Credit Canada",
          sublabel: "Canada's oldest non-profit counsellor",
        },
      ],
    },
  },
  {
    /*
     * The RAIRRE program as a fourth tab. Copy is taken from the AI readiness
     * page and ../../../rairre-program, so the tab, that page, and the program
     * deliverables all describe the phases the same way.
     */
    id: "ai-program",
    name: "AI Program",
    icon: "ShieldCheck",
    iconColor: "azure",
    badge: "Program",
    badgeTint: "azure",
    category: "AI readiness & governance",
    headline: "Getting organizations ready to use AI without putting people or data at risk.",
    description:
      "RAIRRE is a four-phase program that measures where AI is actually in use across your team, builds the literacy to use it well, and leaves you with a policy your staff can follow. Built for nonprofits and civil society, not adapted down from enterprise consulting.",
    tags: ["Responsible AI", "Risk assessment", "Staff literacy"],
    cta: { label: "Explore the program", href: "/ai-readiness" },
    imagePlaceholder: "AI PROGRAM IMAGE",
    panel: {
      kind: "ai-program",
      featureTitle: "The four phases",
      features: [
        {
          icon: "BarChart2",
          label: "Readiness baseline",
          sublabel: "Role-based surveys and a risk heat map",
        },
        {
          icon: "ArrowRight",
          label: "Literacy and leveling",
          sublabel: "A core module, then one per role",
        },
        {
          icon: "Handshake",
          label: "Use-case enablement",
          sublabel: "Approved / Conditional / Prohibited catalog",
        },
        {
          icon: "Shield",
          label: "Governance",
          sublabel: "Policy, RACI, incident response, review cadence",
        },
      ],
    },
  },
];
