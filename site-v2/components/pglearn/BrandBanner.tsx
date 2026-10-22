import { Eyebrow } from "./Eyebrow";

/*
 * A short, decorative PG Labs banner for the learner's home. It sits on the
 * design system's `surface-dark` ground in its own `.pglearn.dark` scope, so
 * it reads the same in light and dark mode (a `white-10` hairline keeps its
 * edge visible on the dark canvas): Lora for the line, `white-70`
 * for the support text, and `accent` only as the eyebrow rule and the pixel
 * field — a static nod to the site's PixelBand, drawn as squares of the one
 * hue at fixed opacities so the server and the browser render the same thing.
 */

// Opacity of each square, row by row; 0 leaves a gap.
const PIXELS = [
  [0, 0.15, 0, 0.35, 0.15, 0.6],
  [0.15, 0, 0.35, 0.15, 0.6, 0.35],
  [0, 0.35, 0.15, 0.6, 0.35, 0.9],
  [0.15, 0, 0.6, 0.35, 0.9, 0.6],
];

export function BrandBanner() {
  return (
    <section
      aria-label="About PG Labs"
      className="pglearn dark relative isolate overflow-hidden rounded-ui-lg border border-ui-border bg-ui-background"
    >
      {/* A soft glow of the accent from the right, behind everything. */}
      <div
        aria-hidden
        className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_right,rgb(89_196_237/0.22),transparent_60%)]"
      />
      <div className="flex items-center justify-between gap-8 px-6 py-7 sm:px-9">
        <div className="max-w-2xl">
          <Eyebrow className="leading-[18px] text-white/70">PG Labs · A PeaceGeeks initiative</Eyebrow>
          <p className="mt-3 font-heading text-[22px] leading-[28px] tracking-[-0.3px] text-ui-foreground sm:text-ui-title">
            Learning for the thoughtful adoption of AI
          </p>
          <p className="mt-2 text-ui-body text-white/70">
            PG Labs is the PeaceGeeks initiative that helps organizations adopt artificial
            intelligence consciously and responsibly.
          </p>
        </div>

        <div aria-hidden className="hidden shrink-0 grid-cols-6 gap-1.5 md:grid">
          {PIXELS.flat().map((opacity, index) => (
            <span
              key={index}
              className="size-4 rounded-[3px] bg-ui-brand lg:size-5"
              style={{ opacity }}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
