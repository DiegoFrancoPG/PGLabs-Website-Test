"use client";

import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";

export interface NavProject {
  id: string;
  number: string;
  name: string;
}

export function WorkNav({ projects }: { projects: NavProject[] }) {
  const [activeId, setActiveId] = useState(projects[0]?.id ?? "");

  useEffect(() => {
    const observers: IntersectionObserver[] = [];

    projects.forEach((p) => {
      const el = document.getElementById(p.id);
      if (!el) return;

      const observer = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) setActiveId(p.id);
        },
        // Fire when the section occupies the upper-middle band of the viewport
        { rootMargin: "-15% 0px -65% 0px" }
      );

      observer.observe(el);
      observers.push(observer);
    });

    return () => observers.forEach((o) => o.disconnect());
  }, [projects]);

  const scrollTo = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    const offset = 104; // clears the fixed masthead + breathing room
    const top = el.getBoundingClientRect().top + window.scrollY - offset;
    window.scrollTo({ top, behavior: "smooth" });
  };

  return (
    <aside className="hidden md:flex flex-col sticky top-30 h-fit w-48 shrink-0 pt-16 pb-8">
      <p className="text-eyebrow uppercase text-steel-400 mb-6">Projects</p>
      {projects.map((p) => {
        const isActive = p.id === activeId;
        return (
          <button
            key={p.id}
            onClick={() => scrollTo(p.id)}
            className={cn(
              "flex items-baseline gap-3 py-3 text-left w-full border-t transition-colors duration-200",
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
  );
}
