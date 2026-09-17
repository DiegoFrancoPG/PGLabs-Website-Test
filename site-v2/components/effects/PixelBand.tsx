import { cn } from "@ds/lib/utils";

/*
 * Pixel band: white squares fading in and out slowly at random across a 15%
 * strip on one edge of a painted texture panel. Used on the hero (right edge)
 * and on the "what we do" cards (bottom edge).
 *
 * Deterministic pseudo-randomness, not Math.random. These sections render on
 * the server, so a real RNG would produce different markup per request and
 * desync from any client render. Hashing the cell index gives the same scatter
 * every time while still looking arbitrary, and keeps the callers as server
 * components with zero client JavaScript.
 *
 * Place it BEFORE the photo in the DOM. Both are positioned, so source order
 * decides paint order: the photograph covers the band and the pixels only ever
 * show on the texture around it.
 */
type Edge = "right" | "bottom";

const LAYOUT: Record<
  Edge,
  { cells: number; box: string; grid: string; mask: string }
> = {
  /*
   * Cells are always `aspect-square`, so the cross-axis track count sets the
   * pixel size and the long axis simply overflows and clips. `right` runs 4
   * columns down; `bottom` runs 2 rows across via column flow.
   */
  right: {
    cells: 96,
    box: "inset-y-0 right-0 w-[15%]",
    grid: "grid-cols-4",
    mask: "linear-gradient(to right, transparent, black 45%)",
  },
  bottom: {
    cells: 56,
    box: "inset-x-0 bottom-0 h-[15%]",
    grid: "grid-rows-2 grid-flow-col",
    mask: "linear-gradient(to bottom, transparent, black 45%)",
  },
};

function hash(n: number) {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function pixels(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    i,
    /* A third of the cells sit out, so the field never looks like a grid */
    active: hash(i * 3.7) > 0.34,
    duration: 3.5 + hash(i + 11) * 3.5,
    /* Negative delay starts each cell mid-cycle, so nothing waits to begin */
    delay: -hash(i + 29) * 12,
    peak: 0.55 + hash(i + 53) * 0.45,
  }));
}

export function PixelBand({
  edge = "right",
  className,
}: {
  edge?: Edge;
  className?: string;
}) {
  const layout = LAYOUT[edge];

  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none absolute grid overflow-hidden",
        layout.box,
        layout.grid,
        className
      )}
      /* Feathered on its inner edge so the band reads as an effect, not a crop */
      style={{ maskImage: layout.mask, WebkitMaskImage: layout.mask }}
    >
      {pixels(layout.cells).map((pixel) =>
        pixel.active ? (
          <span
            key={pixel.i}
            className="animate-pixel aspect-square bg-white"
            style={{
              animationDuration: `${pixel.duration}s`,
              animationDelay: `${pixel.delay}s`,
              ["--pixel-peak" as string]: pixel.peak,
            }}
          />
        ) : (
          <span key={pixel.i} className="aspect-square" />
        )
      )}
    </div>
  );
}
