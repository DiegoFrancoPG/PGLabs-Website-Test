import Image from "next/image";

/*
 * "Our heritage" rebuilt on the Figma "Born from PeaceGeeks" frame: a
 * full-bleed dark team photo behind the whole section (the same photo used
 * behind OurWork, with a matching 40% black scrim), a translucent white/10
 * panel on the left holding an inner ink-900 card with the eyebrow and the
 * statement, and a stack of three stat cards on the right.
 *
 * The stat card is local to this section on purpose. The DS `StatBlock` is the
 * hairline treatment used elsewhere on the page; this slide sets its figures in
 * filled `surface` cards with a source line beneath, which is a different
 * object. The prose lives inside the ink card with the statement; only the
 * partner row sits below the split.
 */
const STATS = [
  {
    value: "10+",
    caption: "Years in the humanitarian technology sector.",
    source: "PeaceGeeks program data",
  },
  {
    value: "400K+",
    caption: "People reached by tools we designed and built.",
    source: "PeaceGeeks program data",
  },
  {
    value: "12",
    caption: "Countries where those tools are in use.",
    source: "PeaceGeeks program data",
  },
];

const PARTNERS = [
  { src: "/images/UNHCR.png", alt: "UNHCR" },
  { src: "/images/USAID.png", alt: "USAID" },
  { src: "/images/BMW.png", alt: "BMW Foundation" },
  { src: "/images/IRCC.png", alt: "IRCC" },
  { src: "/images/GOOGLE.png", alt: "Google" },
  { src: "/images/ACCENTURE.png", alt: "Accenture" },
  { src: "/images/UNAOC.png", alt: "UNAOC" },
  { src: "/images/ICC.png", alt: "ICC" },
];

export function OurHeritage() {
  return (
    <section className="relative overflow-hidden px-6 py-30">
      <div aria-hidden className="absolute inset-0">
        <Image
          src="/images/figma-2026/team-photo-dark-bg.png"
          alt=""
          fill
          className="object-cover"
        />
        <div className="absolute inset-0 bg-black/40" />
      </div>

      <div className="relative max-w-wide mx-auto flex flex-col gap-18">
        <div className="grid items-stretch gap-5 lg:grid-cols-2">
          {/* Translucent panel matting an ink card, as on the slide */}
          <div className="flex min-h-[420px] rounded-3xl bg-white/10 p-[8%] lg:min-h-[560px]">
            <div className="flex flex-1 flex-col justify-between gap-10 rounded-3xl bg-ink-900 p-8">
              <p className="text-eyebrow uppercase text-white/70">Our heritage</p>

              {/*
               * The statement and the prose share the card, so the statement
               * steps down from h2 to h3 and the body sits at body-sm. At the
               * old 40px the two would have competed instead of reading as one
               * block, and the copy would not have fit the card.
               */}
              <div>
                <h2 className="font-display text-h4 md:text-h3 text-white">
                  Born from PeaceGeeks.
                  <br />
                  Driven by impact.
                </h2>
                <p className="text-body-sm text-white/70 mt-5">
                  For over ten years, PeaceGeeks has built digital tools that
                  have reached more than 400,000 people in crisis. We have seen
                  where technology succeeds, and where it creates risk.
                </p>
                <p className="text-body-sm text-white/55 mt-4">
                  PG Labs translates that experience into strategic advisory,
                  bridging the gap between technology hype and humanitarian
                  values so your organization stays innovative without
                  compromising safety.
                </p>
              </div>
            </div>
          </div>

          {/* Three stat cards, equal share of the column */}
          <div className="grid gap-5">
            {STATS.map((stat) => (
              <div
                key={stat.value}
                className="flex flex-col justify-center rounded-3xl bg-surface px-9 py-8"
              >
                <p className="font-display tabular text-stat-sm text-ink-800">
                  {stat.value}
                </p>
                <p className="text-body text-steel-500 mt-3 max-w-measure">
                  {stat.caption}
                </p>
                <p className="text-source text-steel-400 mt-5">{stat.source}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="border-t border-white/20 pt-14">
          <p className="text-eyebrow uppercase text-white/50 mb-10">
            Partners &amp; funders
          </p>
          <div className="flex flex-wrap items-center gap-x-14 gap-y-10">
            {PARTNERS.map((p) => (
              <div
                key={p.alt}
                className="brightness-0 invert opacity-40 transition-all duration-200 hover:opacity-75"
              >
                <Image
                  src={p.src}
                  alt={p.alt}
                  width={100}
                  height={32}
                  className="h-7 w-auto object-contain"
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
