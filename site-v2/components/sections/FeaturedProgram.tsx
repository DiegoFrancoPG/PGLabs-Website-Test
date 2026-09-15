"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { ArrowRight } from "lucide-react";
import { SectionHeading } from "@ds/components/custom/section-heading";
import { Button } from "@ds/components/ui/button";
import { cn } from "@ds/lib/utils";
import { PixelBand } from "@/components/effects/PixelBand";

/*
 * RAIRRE methodology as a scroll-driven stepper: the three columns pin while
 * the section scrolls, and each screen-height of scroll advances one phase.
 *
 * The left list is static — nothing moves or reorders. The active phase's
 * bottom hairline doubles as a progress bar, filling left-to-right across that
 * phase's share of the scroll, so the rule tells you both where you are and how
 * much of the step is left. Items stay clickable, which also makes the whole
 * thing keyboard-operable rather than scroll-only.
 *
 * Below `lg` the pinning is dropped entirely for a plain stacked list — a
 * pinned three-column layout has nowhere to go on a phone.
 */
const PHASES = [
  {
    label: "Phase 1 — Assessment",
    title: "Organization-wide assessment",
    description:
      "Role-based surveys generate an AI maturity score and a priority risk heat map, so you start from evidence rather than assumption.",
    image: "/human-imagery/04 Readiness/pexels-yankrukov-7793171.jpg",
    imageAlt: "Team analysing survey data and risk charts together",
  },
  {
    label: "Phase 2 — Literacy",
    title: "Role-based AI literacy",
    description:
      "Calibrated training for frontline, management, admin and technical staff — each group learns what its own work actually requires.",
    image: "/human-imagery/04 Readiness/pexels-gabby-k-9489075.jpg",
    imageAlt: "Facilitator leading an AI literacy session at a flip chart",
  },
  {
    label: "Phase 3 — Enablement",
    title: "Ethical use-case enablement",
    description:
      "Approved workflows with clear guidance and human-in-the-loop checklists, so staff know which uses are sanctioned and how to run them.",
    image: "/human-imagery/05_Strategy_Capacity/pexels-mikhail-nilov-7989009.jpg",
    imageAlt: "Colleague walking a teammate through an approved AI workflow",
  },
  {
    label: "Phase 4 — Governance",
    title: "Governance & sustainability",
    description:
      "Plain-language policies, clear roles, and incident response protocols that keep working after the program ends.",
    image: "/human-imagery/04 Readiness/pexels-fauxels-3184285.jpg",
    imageAlt: "Team agreeing on AI governance policy around a table",
  },
];

/** Visual for one phase — shared by the pinned and the stacked layouts. */
function PhaseMedia({ phase, active }: { phase: (typeof PHASES)[number]; active: boolean }) {
  return (
    <Image
      src={phase.image}
      alt={phase.imageAlt}
      fill
      className={cn(
        "object-cover transition-opacity duration-500 motion-reduce:transition-none",
        active ? "opacity-100" : "opacity-0"
      )}
      sizes="(max-width: 1024px) 100vw, 620px"
    />
  );
}

/** Masthead height — the panel pins directly beneath it and fills the fold. */
const STICK_TOP = 72;

export function FeaturedProgram() {
  const trackRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  /** 0–1 progress through the active phase; drives the hairline fill. */
  const [fraction, setFraction] = useState(0);

  /*
   * The panel is pinned from the moment the track's top passes STICK_TOP until
   * the panel's bottom meets the track's bottom, so the scrollable distance is
   * the track height less the panel's own height. Measuring the panel rather
   * than assuming a viewport-tall one keeps the fill in step with the pin now
   * that the panel is top-aligned and shorter than the screen.
   */
  const pinnedRange = useCallback(() => {
    const track = trackRef.current;
    const panel = panelRef.current;
    if (!track || !panel) return null;
    const rect = track.getBoundingClientRect();
    return {
      /* Distance the panel travels while pinned. */
      distance: Math.max(track.offsetHeight - panel.offsetHeight, 1),
      /* How far into that travel we currently are, before clamping. */
      offset: STICK_TOP - rect.top,
      /* The track's top in document coordinates. */
      documentTop: rect.top + window.scrollY,
    };
  }, []);

  useEffect(() => {
    let frame = 0;
    const measure = () => {
      frame = 0;
      const range = pinnedRange();
      if (!range) return;

      const scrolled = Math.min(Math.max(range.offset, 0), range.distance);
      const t = (scrolled / range.distance) * PHASES.length;
      const next = Math.min(Math.floor(t), PHASES.length - 1);
      setIndex(next);
      setFraction(Math.min(Math.max(t - next, 0), 1));
    };

    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };

    measure();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [pinnedRange]);

  /* Clicking a phase scrolls to the start of its slice of the track. */
  const goTo = useCallback(
    (i: number) => {
      const range = pinnedRange();
      if (!range) return;
      const top =
        range.documentTop -
        STICK_TOP +
        (range.distance * i) / PHASES.length +
        (i === 0 ? 0 : 2);
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      window.scrollTo({ top, behavior: reduced ? "auto" : "smooth" });
    },
    [pinnedRange]
  );

  const active = PHASES[index];

  const head = (
    <SectionHeading
      eyebrow="Featured program"
      title="Is your organization ready for the AI era?"
      lede="A structured, organization-wide program that builds AI literacy, establishes risk frameworks, and creates ethical governance systems — designed for nonprofits navigating AI adoption with integrity."
    />
  );

  return (
    <section id="featured-program" className="bg-surface">
      {/* ---------- Pinned stepper (lg and up) ---------- */}
      <div
        ref={trackRef}
        className="relative hidden lg:block"
        style={{ height: `${PHASES.length * 100}svh` }}
      >
        {/*
         * Head and columns pin together as one fold-height panel, so the
         * section holds the viewport for the whole run of phases. Everything
         * inside sits on one 26/44/30 template — the head spans the first two
         * tracks, so its left edge rails with the list and its right edge with
         * the image.
         */}
        <div
          ref={panelRef}
          className="sticky top-18 h-[calc(100svh-4.5rem)] px-6"
        >
          <div className="max-w-wide mx-auto flex h-full flex-col pt-15 pb-15">
            <div className="grid gap-x-12 lg:grid-cols-[minmax(0,26fr)_minmax(0,44fr)_minmax(0,30fr)]">
              <div className="lg:col-span-2">{head}</div>
            </div>

            {/* Fills whatever height the head leaves, so the fold stays exact */}
            <div className="mt-13 grid min-h-0 flex-1 gap-x-12 lg:grid-cols-[minmax(0,26fr)_minmax(0,44fr)_minmax(0,30fr)]">
              {/* Column 1 — static list, hairline doubles as progress */}
              <nav aria-label="RAIRRE phases" className="flex flex-col">
                <ol>
                  {PHASES.map((phase, i) => {
                    const isActive = i === index;
                    return (
                      <li key={phase.title} className="relative">
                        <button
                          type="button"
                          onClick={() => goTo(i)}
                          aria-current={isActive ? "step" : undefined}
                          className="flex w-full items-center gap-3 py-4 text-left"
                        >
                          <span
                            className={cn(
                              "h-1.5 w-1.5 shrink-0 transition-colors",
                              isActive ? "bg-brand-500" : "bg-steel-200"
                            )}
                          />
                          <span
                            className={cn(
                              "text-eyebrow uppercase transition-colors",
                              isActive ? "text-ink-800" : "text-steel-300"
                            )}
                          >
                            {phase.label}
                          </span>
                        </button>

                        {/* Track, then the fill for the phase being read */}
                        <span className="absolute bottom-0 left-0 h-px w-full bg-steel-200" />
                        {isActive && (
                          <span
                            className="absolute bottom-0 left-0 h-0.5 bg-brand-500"
                            style={{ width: `${fraction * 100}%` }}
                          />
                        )}
                      </li>
                    );
                  })}
                </ol>

                {/* Sits with the list, not stranded at the foot of the section */}
                <Button variant="outline" className="mt-10 self-start" asChild>
                  <Link href="/ai-readiness">
                    <span>Learn more about the program</span>
                    <ArrowRight className="w-4 h-4" />
                  </Link>
                </Button>
              </nav>

              {/*
               * Column 2 — square painted panel with a square photo inset by an
               * even 7%, so the texture reads the same on all four sides. The
               * panel takes its size from the available height (`h-full` plus
               * `aspect-square`) and centres in the column, which keeps the
               * pinned panel exactly one fold tall.
               */}
              <div className="flex h-full items-center justify-center">
                <div
                  className="relative h-full max-w-full overflow-hidden rounded-3xl bg-ink-800 bg-cover bg-center p-[7%] aspect-square"
                  style={{
                    backgroundImage: "url('/textures/blue-wash-texture.png')",
                  }}
                >
                  <PixelBand edge="bottom" />

                  <div className="relative h-full w-full overflow-hidden rounded-2xl">
                    {PHASES.map((phase, i) => (
                      <PhaseMedia
                        key={phase.title}
                        phase={phase}
                        active={i === index}
                      />
                    ))}
                  </div>
                </div>
              </div>

              {/* Column 3 — the active phase, explained */}
              <div>
                <h3 className="font-display text-h3 text-ink-800">{active.title}</h3>
                <p className="text-body text-steel-500 mt-5">{active.description}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ---------- Stacked fallback (below lg) ---------- */}
      <div className="px-6 pt-30 lg:hidden">{head}</div>

      <div className="mt-13 flex flex-col gap-12 px-6 lg:hidden">
        {PHASES.map((phase) => (
          <article key={phase.title}>
            <p className="text-eyebrow uppercase text-steel-400 border-b border-steel-200 pb-4">
              {phase.label}
            </p>
            <div
              className="relative mt-6 aspect-square w-full overflow-hidden rounded-3xl bg-ink-800 bg-cover bg-center p-[7%]"
              style={{ backgroundImage: "url('/textures/blue-wash-texture.png')" }}
            >
              <PixelBand edge="bottom" />

              <div className="relative h-full w-full overflow-hidden rounded-2xl">
                <PhaseMedia phase={phase} active />
              </div>
            </div>
            <h3 className="font-display text-h4 text-ink-800 mt-6">{phase.title}</h3>
            <p className="text-body-sm text-steel-500 mt-3">{phase.description}</p>
          </article>
        ))}
      </div>

      {/* The stacked layout keeps its own copy of the CTA */}
      <div className="px-6 pt-13 pb-30 lg:hidden">
        <Button variant="outline" asChild>
          <Link href="/ai-readiness">
            <span>Learn more about the program</span>
            <ArrowRight className="w-4 h-4" />
          </Link>
        </Button>
      </div>

      {/* Tail clearance once the panel unpins */}
      <div className="hidden lg:block lg:h-18" />
    </section>
  );
}
