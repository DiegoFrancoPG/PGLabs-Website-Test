"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { ArrowRight } from "lucide-react";
import { Button } from "@ds/components/ui/button";
import { cn } from "@/lib/utils";
import { projects } from "./data";
import type { Project, ProjectId } from "./types";

/*
 * "Our work" rebuilt on the Figma "Impact in practice" frame: a full-bleed
 * dark team photo behind the whole section (with a 40% black scrim, matching
 * OurHeritage's use of the same photo), a row of project tabs sitting directly
 * on top of a three-cell panel, all drawn with hairline rules on white/12.
 *
 *   cell 1  the project's real photo (Welcome Coach ships with one; the other
 *           tabs still fall back to a painted tile since no photo exists for
 *           them yet)
 *   cell 2  its headline claim, with the proof figure at the foot
 *   cell 3  what it is, who backed it, and the way in
 *
 * One deliberate departure from the reference: it puts a brand logo in cell 1
 * and a portrait plus a personal quote in cell 3; we have neither. Cell 3 takes
 * the project's own description rather than an attributed quote — inventing a
 * testimonial here would put words in a partner's mouth.
 */
const STAT_FALLBACK_LABEL = "Focus";

/** Normalises the two panel shapes in data.ts into what the layout needs. */
function panelContent(project: Project) {
  if (project.panel.kind === "welcome-coach") {
    const [primary] = project.panel.stats;
    return {
      stat: primary,
      detailTitle: "Supported by",
      details: project.panel.supporters,
    };
  }
  return {
    stat: null,
    detailTitle: project.panel.featureTitle,
    details: project.panel.features.map((f) => f.label),
  };
}

export function OurWork() {
  const [activeId, setActiveId] = useState<ProjectId>("welcome-coach");
  const project = projects.find((p) => p.id === activeId)!;
  const { stat, detailTitle, details } = panelContent(project);

  return (
    <section className="relative overflow-hidden px-6 py-30" aria-label="Our work">
      <div aria-hidden className="absolute inset-0">
        <Image
          src="/images/figma-2026/team-photo-dark-bg.png"
          alt=""
          fill
          className="object-cover"
        />
        <div className="absolute inset-0 bg-black/40" />
      </div>

      <div className="relative max-w-wide mx-auto">
        {/* Head — square bullet eyebrow, serif title, outlined way out */}
        <div className="flex items-center gap-3">
          <span className="h-2 w-2 bg-brand-500" />
          <p className="text-eyebrow uppercase text-white/70">Our work</p>
        </div>

        <h2 className="font-display text-h2-sm md:text-h2 text-white mt-6">
          Impact in practice.
        </h2>

        <Button variant="ghost" className="mt-9" asChild>
          <Link href="/work">
            <span>See all projects</span>
            <ArrowRight className="h-4 w-4" />
          </Link>
        </Button>

        {/* Tabs sit on the panel, sharing its hairline grid */}
        <div className="mt-15 border border-white/12">
          <div
            role="tablist"
            aria-label="Projects"
            className="grid sm:grid-cols-4"
          >
            {projects.map((p) => {
              const isActive = p.id === activeId;
              return (
                <button
                  key={p.id}
                  role="tab"
                  aria-selected={isActive}
                  aria-controls={`work-panel-${p.id}`}
                  onClick={() => setActiveId(p.id)}
                  className={cn(
                    "border-b border-white/12 px-6 py-5 text-center transition-colors duration-200",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-azure-600",
                    "sm:border-r sm:last:border-r-0",
                    isActive
                      ? "bg-white/[0.06] text-white"
                      : "text-white/40 hover:bg-white/[0.03] hover:text-white/70"
                  )}
                >
                  <span className="text-eyebrow uppercase">{p.name}</span>
                </button>
              );
            })}
          </div>

          <div
            id={`work-panel-${project.id}`}
            role="tabpanel"
            className="grid lg:grid-cols-[minmax(0,36fr)_minmax(0,38fr)_minmax(0,26fr)]"
          >
            {/* Cell 1 — the project's photo where we have one, else a painted tile */}
            <div className="relative flex aspect-square flex-col justify-end overflow-hidden p-8">
              {project.id === "welcome-coach" ? (
                <Image
                  src="/images/figma-2026/welcome-coach-project.jpg"
                  alt="Welcome Coach — AI-powered settlement guide for newcomers"
                  fill
                  className="object-cover"
                  sizes="(max-width: 1024px) 100vw, 490px"
                />
              ) : (
                <div
                  aria-hidden
                  className="absolute inset-0 bg-ink-800 bg-cover bg-center"
                  style={{
                    backgroundImage: "url('/textures/blue-wash-texture.png')",
                  }}
                />
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
              <p className="relative text-eyebrow uppercase text-white/70">
                {project.category}
              </p>
              <p className="relative font-display text-h2-sm text-white mt-3">
                {project.name}
              </p>
            </div>

            {/* Cell 2 — the claim, with the proof figure at the foot */}
            <div className="flex flex-col justify-between gap-13 border-white/12 p-9 lg:border-l">
              <p className="font-display text-h3 text-white">
                {project.headline}
              </p>

              {stat ? (
                <div>
                  <p className="font-display tabular text-stat-sm text-white">
                    {stat.value}
                  </p>
                  <p className="text-body-sm text-white/60 mt-2">{stat.label}</p>
                </div>
              ) : (
                /* No figure cleared for this project, so the practice areas
                 * carry the foot of the cell instead of a blank space. */
                <div>
                  <p className="text-label uppercase text-white/40">
                    {STAT_FALLBACK_LABEL}
                  </p>
                  <ul className="mt-3 flex flex-wrap gap-2">
                    {project.tags.map((tag) => (
                      <li
                        key={tag}
                        className="border border-white/15 px-3 py-1 text-body-sm text-white/70"
                      >
                        {tag}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* Cell 3 — what it is, who backed it, the way in */}
            <div className="flex flex-col justify-between gap-13 border-white/12 p-9 lg:border-l">
              <p className="text-body-sm text-white/70">{project.description}</p>

              <div>
                <p className="text-label uppercase text-white/40">
                  {detailTitle}
                </p>
                <ul className="mt-3 flex flex-col gap-1.5">
                  {details.map((detail) => (
                    <li key={detail} className="text-body-sm text-white">
                      {detail}
                    </li>
                  ))}
                </ul>

                <Link
                  href={project.cta.href}
                  className="mt-7 inline-flex items-center gap-2 text-body-sm font-semibold text-white underline decoration-brand-500/50 underline-offset-4 transition-colors hover:decoration-brand-500"
                >
                  {project.cta.label}
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
