import { ArrowRight, Shield, Heart, MapPin, BarChart2, Handshake } from "lucide-react";
import { Badge } from "@ds/components/ui/badge";
import { StatBlock } from "@ds/components/custom/stat-block";
import type { Project, FeatureItem } from "./types";
import { BADGE_VARIANT } from "./badge-variant";

// Icon map — extend as new icons are needed in data.ts
const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  Shield,
  Heart,
  MapPin,
  BarChart2,
  ArrowRight,
  Handshake,
};

// --- Image placeholder ---
function ImagePlaceholder({ label }: { label: string }) {
  return (
    <div className="aspect-video w-full rounded-sm border border-steel-200 bg-surface flex flex-col items-center justify-center gap-3">
      <div className="w-9 h-9 rounded-sm bg-white border border-steel-200 flex items-center justify-center">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="text-steel-300">
          <rect x="1" y="3" width="14" height="10" rx="1" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="5.5" cy="6.5" r="1" fill="currentColor" />
          <path
            d="M1 10l3.5-3 3 3 2.5-2.5L15 11"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      <span className="text-label uppercase text-steel-400">{label}</span>
    </div>
  );
}

// --- Feature row ---
function FeatureRow({ item }: { item: FeatureItem }) {
  const Icon = ICONS[item.icon];
  return (
    <div className="flex items-start gap-4">
      <div className="w-8 h-8 rounded-sm bg-white border border-steel-200 flex items-center justify-center shrink-0 mt-0.5">
        {Icon && <Icon className="w-4 h-4 text-steel-500" />}
      </div>
      <div>
        <p className="font-display text-[16px] font-semibold text-ink-800">{item.label}</p>
        <p className="text-body-sm text-steel-500">{item.sublabel}</p>
      </div>
    </div>
  );
}

// --- Right panel variants ---
function WelcomeCoachPanel({ project }: { project: Project }) {
  if (project.panel.kind !== "welcome-coach") return null;
  const { stats, features, supporters } = project.panel;

  return (
    <div className="flex flex-col gap-8">
      <ImagePlaceholder label={project.imagePlaceholder} />

      <div className="grid grid-cols-2 gap-8">
        {stats.map((s, i) => (
          <StatBlock
            key={s.label}
            ruled
            size="sm"
            value={s.value}
            caption={s.label}
            color={i === 0 ? "brand" : "ink"}
          />
        ))}
      </div>

      <div className="border-t border-steel-200 pt-6 flex flex-col gap-3">
        <p className="text-eyebrow uppercase text-steel-400 mb-1">Included tools</p>
        {features.map((f) => (
          <div key={f} className="flex items-center gap-3">
            <span className="w-1.5 h-1.5 rounded-full bg-brand-500 shrink-0" />
            <span className="text-body-sm text-ink-800">{f}</span>
          </div>
        ))}
      </div>

      <div className="border-t border-steel-200 pt-6">
        <p className="text-eyebrow uppercase text-steel-400 mb-3">Supported by</p>
        <div className="flex items-center gap-5 flex-wrap">
          {supporters.map((s) => (
            <span key={s} className="text-body-sm font-semibold text-steel-500">
              {s}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function FeatureListPanel({ project }: { project: Project }) {
  if (project.panel.kind === "welcome-coach") return null;
  const { featureTitle, features } = project.panel;

  return (
    <div className="flex flex-col gap-8">
      <ImagePlaceholder label={project.imagePlaceholder} />
      <div className="border-t border-steel-200 pt-6 flex flex-col gap-6">
        <p className="text-eyebrow uppercase text-steel-400">{featureTitle}</p>
        {features.map((f) => (
          <FeatureRow key={f.label} item={f} />
        ))}
      </div>
    </div>
  );
}

// --- Main export ---
export function ProjectPanel({ project }: { project: Project }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-14">
      {/* Left column */}
      <div className="flex flex-col gap-6">
        <div className="flex items-center gap-3">
          <Badge variant={BADGE_VARIANT[project.badgeTint]}>{project.badge}</Badge>
          <span className="text-eyebrow uppercase text-steel-400">{project.category}</span>
        </div>

        <h3 className="font-display text-h3">{project.headline}</h3>

        <p className="text-body text-steel-500 max-w-prose">{project.description}</p>

        <div className="flex flex-wrap gap-2">
          {project.tags.map((tag) => (
            <span
              key={tag}
              className="text-body-sm px-3 py-1 rounded-sm border border-steel-200 text-steel-500"
            >
              {tag}
            </span>
          ))}
        </div>

        <a
          href={project.cta.href}
          className="inline-flex items-center gap-2 text-body-sm font-semibold text-brand-600 border-b border-brand-600/35 hover:border-brand-600 w-fit pb-0.5 transition-colors"
        >
          {project.cta.label}
          <ArrowRight className="w-4 h-4" />
        </a>
      </div>

      {/* Right column */}
      <div>
        {project.panel.kind === "welcome-coach" ? (
          <WelcomeCoachPanel project={project} />
        ) : (
          <FeatureListPanel project={project} />
        )}
      </div>
    </div>
  );
}
