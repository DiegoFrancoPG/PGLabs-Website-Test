import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Eyebrow } from "@ds/components/custom/eyebrow";
import { SectionHeading } from "@ds/components/custom/section-heading";
import { Timeline } from "@ds/components/custom/timeline";
import { StatBlock } from "@ds/components/custom/stat-block";
import { Card, CardTitle, CardDescription } from "@ds/components/ui/card";
import { Button } from "@ds/components/ui/button";

export const metadata: Metadata = {
  title: "About",
  description:
    "PG Labs is a PeaceGeeks initiative supporting nonprofits with responsible technology adoption.",
};

const TIMELINE = [
  {
    label: "2014",
    title: "PeaceGeeks founded",
    description: "Set up to design and create digital tools for peace.",
    color: "brand" as const,
  },
  {
    label: "2017",
    title: "UNHCR and the ICC",
    description: "Designed and built applications for two of the largest institutions in the field.",
    color: "azure" as const,
  },
  {
    label: "2019–2021",
    title: "Google.org, the UN and BMW Group",
    description: "Recognized with awards from all three for humanitarian technology work.",
    color: "gold" as const,
  },
  {
    label: "2024",
    title: "Consulting expands internationally",
    description:
      "Humanitarian and migration advisory extends to companies, governments and foundations across Canada, Germany and the US.",
    color: "coral" as const,
  },
  {
    label: "2025",
    title: "PG Labs launches",
    description:
      "A dedicated practice helping nonprofits and grantmakers leverage emerging technology ethically and effectively.",
    color: "brand" as const,
  },
];

const VALUES = [
  {
    title: "Risk mitigation",
    desc: 'We prioritize "do no harm." We build frameworks to stop data leaks and algorithmic bias before they start.',
    accent: "brand" as const,
  },
  {
    title: "Human-centered design",
    desc: "We ensure your technology is accessible to everyone, especially the most vulnerable.",
    accent: "gold" as const,
  },
  {
    title: "Funder alignment",
    desc: "We align your tech strategy with the rigorous compliance standards of global donors and government agencies.",
    accent: "coral" as const,
  },
];

const PARTNERS = ["UNHCR", "USAID", "BMW", "IRCC", "GOOGLE", "ACCENTURE", "UNAOC", "ICC"];

export default function AboutPage() {
  return (
    <>
      {/* Hero */}
      <section className="bg-ink-800 pt-22 pb-26 px-6">
        <div className="max-w-content mx-auto">
          <Eyebrow variant="white">About</Eyebrow>
          <h1 className="font-display text-h1-sm md:text-display text-white mt-7 max-w-[22ch]">
            Expert tech strategy{" "}
            for the social sector.
          </h1>
          <p className="text-lede text-white/70 mt-8 max-w-prose">
            PG Labs is the consultancy arm of PeaceGeeks. We help nonprofits and
            funders understand and employ AI and emerging technology safely,
            ethically, and strategically.
          </p>
        </div>
      </section>

      {/* Story + timeline */}
      <section className="py-30 px-6">
        <div className="max-w-content mx-auto grid grid-cols-1 md:grid-cols-2 gap-18 items-start">
          <div>
            <SectionHeading
              eyebrow="Our story"
              title={
                <>
                  A decade of{" "}
                  humanitarian tech.
                </>
              }
              lede="For over ten years, PeaceGeeks has built digital tools that have reached more than 400,000 people in crisis. We have seen where technology succeeds — and where it creates risk."
            />

            <p className="text-body text-steel-500 mt-6 max-w-prose">
              PG Labs translates that real-world experience into strategic
              advisory. We bridge the gap between technology hype and humanitarian
              values, ensuring your organization stays innovative without
              compromising safety.
            </p>

            <div className="grid grid-cols-2 gap-10 mt-12">
              <StatBlock ruled size="sm" value="400K+" caption="People reached in crisis." />
              <StatBlock
                ruled
                size="sm"
                value="10+"
                caption="Years in humanitarian technology."
                color="brand"
              />
            </div>

            <Button variant="outline" size="lg" className="mt-12" asChild>
              <a href="https://peacegeeks.org" target="_blank" rel="noopener noreferrer">
                Visit peacegeeks.org
              </a>
            </Button>
          </div>

          <div className="border-t border-steel-200 pt-8">
            <p className="text-eyebrow uppercase text-steel-400 mb-8">Our journey</p>
            <Timeline items={TIMELINE} />
          </div>
        </div>
      </section>

      {/* Values */}
      <section className="py-30 px-6 bg-surface">
        <div className="max-w-content mx-auto">
          <SectionHeading
            eyebrow="What we stand for"
            title={
              <>
                Our values guide{" "}
                every engagement.
              </>
            }
            className="mb-18"
          />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-10">
            {VALUES.map((v) => (
              <Card key={v.title} variant="plain" accent={v.accent} className="pt-6">
                <CardTitle className="text-h3 mb-4">{v.title}</CardTitle>
                <CardDescription className="text-body">{v.desc}</CardDescription>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Trusted by */}
      <section className="py-30 px-6 bg-white">
        <div className="max-w-content mx-auto">
          <SectionHeading
            eyebrow="Partners & funders"
            title={
              <>
                Trusted by{" "}
                leading organizations.
              </>
            }
            className="mb-18"
          />
          <div className="flex flex-wrap items-center gap-x-14 gap-y-10">
            {PARTNERS.map((p) => (
              <div
                key={p}
                className="grayscale opacity-40 hover:opacity-75 hover:grayscale-0 transition-all"
              >
                <Image
                  src={`/images/${p}.png`}
                  alt={p}
                  width={100}
                  height={32}
                  className="h-8 w-auto object-contain"
                />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="bg-ink-800 py-30 px-6">
        <div className="max-w-content mx-auto">
          <SectionHeading
            eyebrow="Next step"
            tone="dark"
            size="lg"
            title={
              <>
                Lead the AI era{" "}
                with confidence.
              </>
            }
            lede='From auditing your current tech stack to training your team on ethical use, we help you replace unregulated "shadow AI" with professional, funder-compliant standards.'
          />
          <div className="flex flex-wrap gap-3 mt-10">
            <Button variant="primary" size="lg" asChild>
              <Link href="/contact">Talk to an expert</Link>
            </Button>
            <Button variant="ghost" size="lg" asChild>
              <Link href="/ai-readiness">AI readiness program</Link>
            </Button>
          </div>
        </div>
      </section>
    </>
  );
}
