import Image from "next/image";
import { SectionHeading } from "@ds/components/custom/section-heading";
import { PixelBand } from "@/components/effects/PixelBand";

/*
 * "What we do" after the deck's three-card slide: a narrow left rail carrying
 * the section head and lede, then three soft-cornered cards on a wide right
 * column, each an image seated in a `surface` panel above its title and copy.
 *
 * The deck's card is deliberately quiet — no icon, no ghost numeral, no ruled
 * top edge. The photograph does the signalling, so the earlier icon/number/rule
 * furniture is gone and the per-service accent colours with it.
 *
 * The photograph sits inside a painted panel rather than flush to the card, so
 * the texture frames it and the pixel band has a bottom strip to animate in.
 */
const SERVICES = [
  {
    title: "Responsible AI governance",
    description:
      "From risk assessment and governance to ethical implementation. We help you make informed decisions about AI without compromising your mission or data.",
    image: "/human-imagery/02_Responsible_AI_Governance/pexels-rdne-9034716.jpg",
    imageAlt: "Designing responsible AI governance frameworks",
  },
  {
    title: "Tech strategy",
    description:
      "Technology roadmaps aligned with your mission. From auditing your current stack to designing the right path forward for your team and the people you serve.",
    image: "/human-imagery/05_Strategy_Capacity/pexels-theo-decker-5945799.jpg",
    imageAlt: "Diverse team in strategic planning session",
  },
  {
    title: "Human-centered design",
    description:
      "Technology built for people. Award-winning design methodologies for refugees, newcomers, and humanitarian staff.",
    image: "/human-imagery/03_Human_Centered_Design/pexels-rdne-6646868.jpg",
    imageAlt: "Humanitarian volunteers — the communities we design for",
  },
];

export function WhatWeDo() {
  return (
    <section id="what-we-do" className="bg-white py-30 px-6">
      <div className="max-w-wide mx-auto">
        <div className="grid gap-13 lg:grid-cols-[minmax(0,30fr)_minmax(0,70fr)] lg:gap-15">
          {/* Left rail — section head held at the top of the row */}
          <SectionHeading
            eyebrow="What we do"
            title="Navigating complexity with clarity."
            lede="From AI governance to human-centered design, we help mission-driven organizations make confident technology decisions — and build the systems those decisions depend on."
          />

          {/* Three cards, equal height so the copy blocks bottom out together */}
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
            {SERVICES.map((s) => (
              <article
                key={s.title}
                className="flex flex-col rounded-3xl bg-surface pb-11"
              >
                {/*
                 * Painted panel at full card width, with a square photograph inset
                 * by an even 8% so the texture reads the same on all four sides.
                 * Square image plus even padding makes the panel itself square.
                 * The band sits before the photo in the DOM so it never runs over
                 * the image.
                 */}
                <div
                  className="relative overflow-hidden rounded-3xl bg-ink-800 bg-cover bg-center p-[8%]"
                  style={{
                    backgroundImage: "url('/textures/blue-canvas-texture.png')",
                  }}
                >
                  <PixelBand edge="bottom" />

                  <div className="relative aspect-square w-full overflow-hidden rounded-2xl">
                    <Image
                      src={s.image}
                      alt={s.imageAlt}
                      fill
                      className="object-cover"
                      sizes="(max-width: 640px) 100vw, 30vw"
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-4 px-7 pt-8">
                  <h3 className="font-display text-h4 text-ink-800">
                    {s.title}
                  </h3>
                  <p className="text-body-sm text-steel-500">{s.description}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
