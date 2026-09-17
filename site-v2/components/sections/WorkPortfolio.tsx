"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Button } from "@ds/components/ui/button";
import { Badge } from "@ds/components/ui/badge";
import { StatBlock } from "@ds/components/custom/stat-block";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WorkProject {
  id: string;
  number: string;
  category: string;
  name: string;
  tagline: string;
  badge: string;
  description: string[];
  services: { title: string; desc: string }[];
  stats: { value: string; label: string }[];
  supporters: string[];
  cta: { label: string; href: string; external: boolean };
  images: [string, string];
}

const STAT_COLORS = ["brand", "gold", "coral"] as const;

// ─── Screenshot placeholder ───────────────────────────────────────────────────

function ScreenshotPlaceholder({ label }: { label: string }) {
  return (
    <div className="aspect-video w-full rounded-sm bg-surface border border-steel-200 flex flex-col items-center justify-center gap-3">
      <div className="w-11 h-11 rounded-sm bg-white border border-steel-200 flex items-center justify-center">
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" className="text-steel-300">
          <rect x="1.5" y="3.5" width="17" height="13" rx="1" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="6.5" cy="7.5" r="1.25" fill="currentColor" opacity="0.5" />
          <path
            d="M1.5 13l4-3.5 3.5 3.5 3-3 5 4"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      <span className="text-label uppercase text-steel-400 text-center px-6">{label}</span>
    </div>
  );
}

// ─── Project detail ───────────────────────────────────────────────────────────

function ProjectDetail({ project }: { project: WorkProject }) {
  return (
    <div className="animate-testimonial-in flex flex-col gap-14">
      {/* Header */}
      <div className="flex items-start justify-between gap-6 flex-wrap">
        <div className="flex flex-col gap-3">
          <p className="text-eyebrow uppercase text-steel-400 tabular">
            {project.number}&nbsp;&nbsp;/&nbsp;&nbsp;{project.category}
          </p>
          <h2 className="font-display text-h2-sm md:text-h1">{project.name}</h2>
          <p className="text-lede text-steel-500 max-w-prose">{project.tagline}</p>
        </div>
        <Badge variant="ink" className="shrink-0 mt-2">
          {project.badge}
        </Badge>
      </div>

      <ScreenshotPlaceholder label={project.images[0]} />

      {/* Description + services */}
      <div className="grid grid-cols-1 md:grid-cols-[1fr_280px] gap-14">
        <div className="flex flex-col gap-5 border-t border-steel-200 pt-6">
          <h3 className="font-body text-eyebrow uppercase text-steel-400">About this project</h3>
          {project.description.map((para, i) => (
            <p key={i} className="text-body text-steel-500 max-w-prose">
              {para}
            </p>
          ))}
        </div>
        <div className="flex flex-col gap-6 border-t border-steel-200 pt-6">
          <h3 className="font-body text-eyebrow uppercase text-steel-400">What PG Labs did</h3>
          {project.services.map((s) => (
            <div key={s.title} className="flex flex-col gap-1">
              <p className="font-display text-[16px] font-semibold text-ink-800">{s.title}</p>
              <p className="text-body-sm text-steel-500">{s.desc}</p>
            </div>
          ))}
        </div>
      </div>

      <ScreenshotPlaceholder label={project.images[1]} />

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-10">
        {project.stats.map((s, i) => (
          <StatBlock
            key={s.label}
            ruled
            size="sm"
            value={s.value}
            caption={s.label}
            color={STAT_COLORS[i % STAT_COLORS.length]}
          />
        ))}
      </div>

      {/* Supporters + CTA */}
      <div className="flex items-center justify-between gap-6 flex-wrap border-t border-steel-200 pt-8">
        <div className="flex items-center gap-4 flex-wrap">
          <span className="text-eyebrow uppercase text-steel-400">Supported by</span>
          {project.supporters.map((s) => (
            <span key={s} className="text-body-sm font-semibold text-steel-500">
              {s}
            </span>
          ))}
        </div>
        <a
          href={project.cta.href}
          {...(project.cta.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
          className="inline-flex items-center gap-2 text-body-sm font-semibold text-brand-600 border-b border-brand-600/35 hover:border-brand-600 pb-0.5 transition-colors"
        >
          {project.cta.label}
          <ArrowUpRight className="w-4 h-4" />
        </a>
      </div>
    </div>
  );
}

// ─── Portfolio shell ──────────────────────────────────────────────────────────

export function WorkPortfolio({ projects }: { projects: WorkProject[] }) {
  const [selectedId, setSelectedId] = useState(projects[0].id);
  const selected = projects.find((p) => p.id === selectedId) ?? projects[0];

  return (
    <div className="flex items-start gap-0 md:gap-18">
      {/* Desktop sticky sidebar */}
      <aside className="hidden md:flex flex-col sticky top-30 h-fit w-48 shrink-0 pt-16 pb-8">
        <p className="text-eyebrow uppercase text-steel-400 mb-6">Projects</p>
        {projects.map((p) => {
          const isActive = p.id === selectedId;
          return (
            <button
              key={p.id}
              onClick={() => setSelectedId(p.id)}
              className={cn(
                "flex items-baseline gap-3 py-3 text-left w-full border-t transition-colors duration-150",
                isActive
                  ? "border-t-brand-500 text-ink-800"
                  : "border-t-steel-200 text-steel-400 hover:text-ink-800"
              )}
            >
              <span
                className={cn(
                  "font-display tabular text-body-sm font-semibold shrink-0 transition-colors",
                  isActive ? "text-brand-600" : "text-steel-300"
                )}
              >
                {p.number}
              </span>
              <span className="text-body-sm font-semibold leading-snug">{p.name}</span>
            </button>
          );
        })}
      </aside>

      {/* Main content */}
      <div className="flex-1 min-w-0 pt-14">
        {/* Mobile project selector */}
        <div className="md:hidden flex gap-2 overflow-x-auto pb-4 mb-10 border-b border-steel-200 -mx-6 px-6">
          {projects.map((p) => {
            const isActive = p.id === selectedId;
            return (
              <button
                key={p.id}
                onClick={() => setSelectedId(p.id)}
                className={cn(
                  "flex-shrink-0 flex items-center gap-2 px-4 h-10 rounded-lg text-body-sm font-semibold transition-all",
                  isActive
                    ? "bg-ink-800 text-white"
                    : "bg-surface text-steel-500 hover:bg-surface-sunken"
                )}
              >
                <span
                  className={cn(
                    "tabular font-display",
                    isActive ? "text-brand-400" : "text-steel-300"
                  )}
                >
                  {p.number}
                </span>
                {p.name}
              </button>
            );
          })}
        </div>

        {/* key remount triggers the fade-in animation on each project change */}
        <ProjectDetail key={selectedId} project={selected} />

        {/* Bottom CTA */}
        <div className="mt-22 pt-14 border-t border-steel-200 flex flex-col gap-5">
          <h3 className="font-display text-h3">Want to discuss a project?</h3>
          <Button variant="primary" size="lg" className="w-fit" asChild>
            <Link href="/contact">Start a conversation</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
