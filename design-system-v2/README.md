# PGLabs Design System v2 — "Editorial"

A second, parallel design system derived from **`assets/PeaceGeeks_NY_Donor_Deck_DRAFT.pptx`**.
v1 (`../design-system` + `../site`) is untouched and still runs independently.

| | v1 | **v2 (this)** |
|---|---|---|
| Display type | Space Grotesk | **Playfair Display** SemiBold |
| Body type | Inter | **Open Sans** |
| Base surface | Cream `#fcfaf7` | White / cool `#f4f6f8` |
| Ink | `#2c3436` | **`#1a2230`** |
| Body copy | `#636e72` | **`#667083`** |
| Primary | Coral `#e87964` | **Blue `#11739c`** (accent `#59c4ed`) |
| Accents | blue, gold, purple | **gold `#e8a33d`**, coral `#e2624a`, azure `#59c4ed` |
| Geometry | 16px radius, pill buttons | **2–3px radius, squared buttons** |
| Structure | boxed cards, soft elevation | **hairlines, keylines, top rules** |

## Where the values come from

Every token traces to the deck itself, not to invention:

- **Colours** — frequency analysis of `srgbClr` values across all 27 slides. `#667083`
  (259 uses) is the deck's body copy, `#1a2230` (164) its ink, `#59c4ed`/`#11739c` (86
  combined) its accent, `#f4f6f8` (46) its light section fill, `#c9d4e2` its hairline.
- **Typography** — the deck embeds Playfair Display (SemiBold most-used, 372 runs) and
  Open Sans (1,273 runs). v2 uses exactly that pairing.
- **Geometry** — the deck sets type on a grid with keylines rather than in rounded
  containers, so v2 drops to near-square radii and expresses hierarchy through rules.

## Components

Restyled from v1: `Button`, `Card`, `Badge`, `Input`, `Textarea`, `Label`, `Separator`,
`Eyebrow`, `IconCircle`, `MiniCard`, `Navbar`, `PhaseCard`, `Timeline`.

New in v2, reproducing the deck's signature devices:

- **`StatBlock`** — the oversized Playfair figure + caption + attributed source
  (`— UNHCR, 2025`) that carries slides 5–7, 14, 20 and 21. Tabular numerals so rows align.
- **`SectionNumber`** — the large two-digit chapter numeral (`01`…`04`).
- **`SectionHeading`** — eyebrow + serif headline + lede, the deck's standard slide head.

## Colour naming

Brand ramps use names that do **not** collide with Tailwind's built-in scales, so the
built-ins stay available alongside them:

`ink` · `steel` · `brand` (blue) · `gold` · `coral` · `azure` · `surface`

## One gotcha worth knowing: `cn()` is extended

Our type scale uses named keys (`text-h2`, `text-stat-sm`, `text-lede`) rather than
Tailwind's t-shirt sizes. `tailwind-merge` cannot distinguish those from text-*colour*
utilities, so by default it silently drops the size whenever a colour follows:

```
twMerge("text-stat-sm text-white")  ->  "text-white"   // size lost!
```

`src/lib/utils.ts` therefore registers the scale in tailwind-merge's `font-size` class
group via `extendTailwindMerge`. Keep that list in sync when adding a `fontSize` token,
or the new size will vanish from any component that composes classes through `cn()`.

> Note: v1 has this same latent issue (`twMerge("text-h3 text-ink-800")` drops `text-h3`)
> — it was left as-is so v1 stays byte-for-byte unchanged.

## Running it

```bash
# Storybook for v2 (v1 stays on 6006)
cd design-system-v2 && npm run storybook     # -> :6007

# Site v2 (v1 stays on 3000)
cd ../site-v2 && npm run dev                 # -> :3001
```

`node_modules` in both v2 folders is a **symlink** to the v1 equivalents — the dependency
sets are identical, so this saves a duplicate install. Run a real `npm install` in each v2
folder if their dependencies ever diverge from v1's.
