"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { ChevronLeft, ChevronRight, UserRound } from "lucide-react";
import { Eyebrow } from "@ds/components/custom/eyebrow";
import { cn } from "@/lib/utils";

/*
 * v2 treats testimony as an editorial pull-quote: the quote is set large in
 * Playfair against ink, with the attribution below a hairline — the same
 * structure the deck uses for its "proof is in the people" slides.
 */
const TESTIMONIALS = [
  {
    quote:
      "The RAIRRE program helped us move from unmanaged shadow AI to a governed, policy-backed framework in under three months. Our frontline staff now have clear guidelines, and our funders are asking us to share our approach with other grantees.",
    name: "Sarah Chen",
    role: "Executive Director",
    org: "Vancouver Community Foundation",
    // avatar: "/images/testimonials/sarah-chen.jpg"
  },
  {
    quote:
      "PG Labs didn't just deliver a report — they worked alongside our team to understand the real operational challenges. The co-design process meant our staff actually adopted the tools and workflows instead of letting them collect dust on a shelf.",
    name: "Marcus Williams",
    role: "Director of Programs",
    org: "Refugee Support Network",
    // avatar: "/images/testimonials/marcus-williams.jpg"
  },
  {
    quote:
      "As a funder, we needed a way to assess AI readiness across our grantee portfolio without creating extra burden for nonprofits. PG Labs built us a rubric that's now part of our standard due diligence process — it's been a game changer.",
    name: "Anika Patel",
    role: "Program Officer, Technology & Innovation",
    org: "McConnell Foundation",
    // avatar: "/images/testimonials/anika-patel.jpg"
  },
];

const INTERVAL_MS = 10_000;

function PhotoPlaceholder({ name }: { name: string }) {
  return (
    /*
     * Replace this entire div with:
     *   <Image src={avatar} alt={name} fill className="object-cover object-top" />
     * once portrait photos are available. Parent already has overflow-hidden.
     */
    <div
      className="w-full h-full bg-white/[0.04] flex flex-col items-end justify-end p-4"
      aria-label={`Portrait placeholder for ${name}`}
    >
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className="w-20 h-20 rounded-full bg-white/10 flex items-center justify-center">
          <UserRound className="w-10 h-10 text-white/25" strokeWidth={1.5} />
        </div>
        <div className="w-36 h-24 rounded-t-full bg-white/10 mt-2" />
      </div>
      <span className="relative text-label uppercase text-white/25 z-10">
        Portrait photo
      </span>
    </div>
  );
}

export function Testimonials() {
  const [current, setCurrent] = useState(0);
  const [animKey, setAnimKey] = useState(0);
  const [paused, setPaused] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const goTo = useCallback((index: number) => {
    setCurrent(index);
    setAnimKey((k) => k + 1);
  }, []);

  const next = useCallback(
    () => goTo((current + 1) % TESTIMONIALS.length),
    [current, goTo]
  );
  const prev = useCallback(
    () => goTo((current - 1 + TESTIMONIALS.length) % TESTIMONIALS.length),
    [current, goTo]
  );

  const startTimer = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setCurrent((c) => {
        setAnimKey((k) => k + 1);
        return (c + 1) % TESTIMONIALS.length;
      });
    }, INTERVAL_MS);
  }, []);

  useEffect(() => {
    if (!paused) startTimer();
    else if (timerRef.current) clearInterval(timerRef.current);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [paused, startTimer]);

  const handleManualNav = (action: () => void) => {
    action();
    startTimer();
  };

  const t = TESTIMONIALS[current];

  return (
    <section
      className="bg-ink-800 py-30 px-6"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div className="max-w-content mx-auto">
        {/* Header */}
        <div className="flex items-end justify-between gap-8 flex-wrap mb-16">
          <div>
            <Eyebrow variant="white">What clients say</Eyebrow>
            <h2 className="font-display text-h2-sm md:text-h2 text-white mt-5 max-w-[24ch]">
              Trusted by{" "}
              mission-driven organizations.
            </h2>
          </div>

          {/* Arrows */}
          <div className="flex gap-2">
            <button
              onClick={() => handleManualNav(prev)}
              className="w-11 h-11 rounded-lg border border-white/20 flex items-center justify-center text-white hover:bg-white/10 hover:border-white/40 transition-colors"
              aria-label="Previous testimonial"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() => handleManualNav(next)}
              className="w-11 h-11 rounded-lg border border-white/20 flex items-center justify-center text-white hover:bg-white/10 hover:border-white/40 transition-colors"
              aria-label="Next testimonial"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Quote */}
        <div className="border-t border-white/20 grid grid-cols-1 md:grid-cols-[260px_1fr]">
          <div className="relative min-h-[240px] md:min-h-0 overflow-hidden border-b md:border-b-0 md:border-r border-white/12">
            <PhotoPlaceholder name={t.name} />
          </div>

          <div
            key={animKey}
            className="animate-testimonial-in flex flex-col justify-between gap-10 py-12 md:pl-14"
          >
            <blockquote>
              <p className="font-display text-h3 md:text-h2-sm text-white">
                &ldquo;{t.quote}&rdquo;
              </p>
            </blockquote>

            <footer className="border-t border-white/12 pt-6">
              <p className="font-display text-h4 text-white">{t.name}</p>
              <p className="text-body-sm text-white/55 mt-1">{t.role}</p>
              <p className="text-eyebrow uppercase text-brand-500 mt-2">{t.org}</p>
            </footer>
          </div>
        </div>

        {/* Dot indicators */}
        <div
          className="flex items-center gap-2 mt-10"
          role="group"
          aria-label="Testimonial navigation"
        >
          {TESTIMONIALS.map((_, i) => (
            <button
              key={i}
              onClick={() => handleManualNav(() => goTo(i))}
              className={cn(
                "h-1 transition-all duration-300",
                i === current ? "w-10 bg-brand-500" : "w-5 bg-white/25 hover:bg-white/50"
              )}
              aria-label={`Go to testimonial ${i + 1}`}
              aria-current={i === current ? "true" : undefined}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
