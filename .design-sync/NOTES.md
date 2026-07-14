# design-sync notes — PGLabs Design System

## [GENERAL] No dist/.d.ts shipped
This repo is Storybook-only — `design-system/` has never had a build step; Vite/Storybook
consume `src/*.tsx` directly. The converter's package-shape detection needs a `.d.ts` tree to
enumerate exports (`findTypesRoot`/`exportedNames` in the staged `lib/dts.mjs`), so:
- Added `"types": "dist/index.d.ts"` to `design-system/package.json` (previously absent).
- Added a `build:types` script: `tsc -p tsconfig.json --declaration --emitDeclarationOnly --outDir dist`.
- `cfg.buildCmd` runs `npm --prefix design-system ci && npm --prefix design-system run build:types`
  before the converter on every (re)sync — re-run this whenever DS source changes.
- `dist/` stays gitignored (build artifact); this is purely a types-emission step, no bundling.
- `tsc` reports a handful of pre-existing type errors (unused `React` import in
  mini-card.tsx/timeline.tsx, a couple of `.stories.tsx` `render`-vs-`args` mismatches) but still
  emits declarations (`noEmitOnError` defaults false). Not fixed — out of scope for this sync,
  harmless for declaration emit, but worth a note for whoever eventually adds real CI type-checking.

## [GENERAL] cfg.tsconfig / cfg.entry path resolution
Both are resolved relative to `PKG_DIR`, which the build derives by walking up from `--entry`
to the nearest `package.json` with a `name` field — that lands on `design-system/`, not
`design-system/src/`. So `cfg.tsconfig` = `"tsconfig.json"` (not `"../tsconfig.json"`).

## titleMap exclusions — non-component story pages
These stories don't correspond to a real package export — they're either page-composition demos
or documentation/foundations pages defined inline in the story file:
- `Colors`, `Shadows&Radius`, `Spacing`, `Typography` (Foundations/*) — token/style reference
  pages, not components.
- `Form` (Components/Form) — a demo composition of Input/Textarea/Label/Button, not itself an
  exported component.
- `Hero`, `FeatureSection`, `PhaseTimeline` (Patterns/*) — page-section compositions built from
  real exported atoms (Eyebrow, Card, PhaseCard, IconCircle, Button, Badge) but not exported as
  standalone components themselves.
- `Navigation` → mapped to real export `Navbar` (`cfg.titleMap: {"Navigation": "Navbar"}`).

**Re-sync risk / future improvement**: if PGLabs wants the Patterns (Hero, FeatureSection,
PhaseTimeline) available as reusable cards in Claude Design too, the fix is to actually export
them from the package (e.g. add them under `src/components/patterns/` and re-export from
`src/index.ts`) rather than leaving them as story-local functions — then drop their `titleMap`
exclusion. Left out of scope for this first sync.

## [GENERAL] Stories with `parameters.backgrounds.default` set to a non-default value render invisible
Several stories rely on storybook's backgrounds addon to paint the canvas dark (e.g.
`parameters: { backgrounds: { default: "dark-grey" } }`) so their white-on-transparent content
is legible. The design-sync preview harness always renders on a plain white page and does not
apply story `parameters.backgrounds` — so these stories rendered as blank/invisible previews
(white text on white background). Confirmed the SAME root cause in 4 components: `Card`
(DarkVariant), `Badge` (DarkBadge), `Button` (Ghost), `Eyebrow` (White). Fixed by owning each
preview file (`.design-sync/previews/<Name>.tsx`) and wrapping just that one story's composed
output in a `<div style={{ background: '#2c3436', padding: '24px' }}>` to replicate the
dark-grey canvas — see those 4 files. Stories that already inline their own background
(e.g. Button's `AllVariants`, Eyebrow's `AllVariants`) didn't need this — they're self-contained.
**Re-sync risk**: any NEW story added with a non-cream `parameters.backgrounds.default` will hit
this same blank-render bug and needs the same owned-preview wrapper fix.

## Re-sync risks
- The `tsc` declaration-emit errors above are pre-existing lint-level issues in source; if they're
  ever fixed, no config change is needed (this is a note for humans, not the converter).
- No `cfg.provider` — this DS has no Storybook decorators/context providers (confirmed via
  `.storybook/preview.ts` — just a global CSS import and background param). If a provider is
  added later (e.g. ThemeProvider), it needs `cfg.provider` set explicitly.
- No token/CSS package exists separately from Tailwind — CSS ships via `[CSS_RUNTIME]` self-styling
  fallback or scraped from the storybook build; watch for `[CSS_PLACEHOLDER]`/`[CSS_RUNTIME]`
  warnings on re-sync if Tailwind config changes.
