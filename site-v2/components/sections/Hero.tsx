import Link from "next/link";
import Image from "next/image";
import { ArrowRight } from "lucide-react";
import { Eyebrow } from "@ds/components/custom/eyebrow";
import { Button } from "@ds/components/ui/button";

/*
 * Hero rebuilt on the Figma "Welcome coach" frame (node 5931:370): a centred
 * type stack — eyebrow, headline, lede, two pill CTAs — sitting above a full-
 * width photo mosaic of the team-collaborating imagery, with the proof stats
 * overlaid as translucent cards across the foot of the mosaic rather than a
 * separate hairline row.
 */
const stats = [
  { value: "400K+", caption: "People reached through PeaceGeeks technology." },
  { value: "12", caption: "Countries where our tools are deployed." },
  { value: "10+", caption: "Years building for humanitarian contexts." },
];

export function Hero() {
  return (
    <section className="bg-surface px-6 py-15 lg:py-13">
      <div className="max-w-wide mx-auto flex flex-col gap-10">
        {/* Centred type stack — eyebrow, headline, lede, CTAs */}
        <div className="flex flex-col items-center gap-5 text-center">
          <Eyebrow rule={false}>A PeaceGeeks initiative</Eyebrow>

          <h1 className="font-display text-h2-sm md:text-h2 text-ink-800 max-w-[22ch]">
            Responsible AI and technology strategy{" "}
            {/*
             * Closing phrase knocked out of the brushstroke painting, so the
             * emphasis is textural rather than a second colour. The dark
             * overlay in the same background shorthand deepens the mid-blues
             * enough to clear 3:1 against the surface at this size; clone
             * keeps the paint continuous if the phrase wraps.
             */}
            <span
              className="bg-clip-text text-transparent [-webkit-background-clip:text] [box-decoration-break:clone]"
              style={{
                backgroundImage:
                  "linear-gradient(#7d9bc4, #7d9bc4), url('/textures/blue-brushstroke-type.png')",
                backgroundBlendMode: "multiply",
                backgroundSize: "100% auto",
                backgroundPosition: "center 28%",
              }}
            >
              for the social sector
            </span>
          </h1>

          <p className="text-body text-steel-500 max-w-measure">
            PG Labs helps nonprofits, funders, and social-impact organizations
            navigate technology to accelerate social change — safely and
            effectively.
          </p>

          <div className="flex flex-wrap justify-center gap-3 mt-2">
            <Button variant="secondary" className="rounded-full" asChild>
              <Link href="/contact">
                <span>Talk to an AI Expert</span>
                <ArrowRight className="w-4 h-4" />
              </Link>
            </Button>
            <Button variant="outline" className="rounded-full" asChild>
              <Link href="/services">Explore AI Governance</Link>
            </Button>
          </div>
        </div>

        {/* Photo mosaic — the team-collaborating set, cropped into a 4-up grid */}
        <div className="relative grid grid-cols-4 grid-rows-2 gap-3 overflow-hidden rounded-xl aspect-[16/9] lg:aspect-[21/9]">
          <div className="relative col-span-2 row-span-2 overflow-hidden rounded-lg">
            <Image
              src="/images/figma-2026/team-collaborating-1.jpg"
              alt="Team members collaborating around a laptop"
              fill
              className="object-cover"
              priority
              sizes="(max-width: 1024px) 50vw, 640px"
            />
          </div>
          <div className="relative col-start-3 row-start-1 overflow-hidden rounded-lg">
            <Image
              src="/images/figma-2026/team-collaborating-3-portrait.jpg"
              alt="Colleague reviewing project notes"
              fill
              className="object-cover"
              sizes="(max-width: 1024px) 25vw, 320px"
            />
          </div>
          <div className="relative col-start-4 row-start-1 overflow-hidden rounded-lg">
            <Image
              src="/images/figma-2026/team-collaborating-2.jpg"
              alt="Team discussing strategy in a meeting room"
              fill
              className="object-cover"
              sizes="(max-width: 1024px) 25vw, 320px"
            />
          </div>
          <div className="relative col-start-3 row-start-2 overflow-hidden rounded-lg">
            <Image
              src="/images/figma-2026/team-collaborating-5-portrait.jpg"
              alt="Team member presenting to colleagues"
              fill
              className="object-cover"
              sizes="(max-width: 1024px) 25vw, 320px"
            />
          </div>
          <div className="relative col-start-4 row-start-2 overflow-hidden rounded-lg">
            <Image
              src="/images/figma-2026/team-collaborating-4.jpg"
              alt="Colleagues working together at a shared desk"
              fill
              className="object-cover"
              sizes="(max-width: 1024px) 25vw, 320px"
            />
          </div>

          {/* Proof stats — translucent cards laid across the foot of the mosaic */}
          <dl className="pointer-events-none absolute inset-x-0 bottom-0 hidden gap-5 p-5 sm:grid sm:grid-cols-3">
            {stats.map((stat) => (
              <div
                key={stat.value}
                className="rounded-lg bg-black/40 p-6 backdrop-blur-sm"
              >
                <dt className="font-display tabular text-h4 text-white">
                  {stat.value}
                </dt>
                <dd className="text-body-sm text-white/75 mt-2">
                  {stat.caption}
                </dd>
              </div>
            ))}
          </dl>
        </div>

        {/* Stacked proof row for narrow viewports, where the overlay is dropped */}
        <dl className="grid grid-cols-1 gap-x-10 gap-y-6 sm:hidden">
          {stats.map((stat) => (
            <div key={stat.value} className="border-t border-steel-200 pt-4">
              <dt className="font-display tabular text-h4 text-ink-800">
                {stat.value}
              </dt>
              <dd className="text-body-sm text-steel-500 mt-1.5 max-w-measure">
                {stat.caption}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
