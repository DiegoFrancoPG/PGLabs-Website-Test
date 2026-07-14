## Building with the PGLabs Design System

No provider or theme wrapper is required. Load the two files once per page and mount into a
dedicated child node (not the host page's own React root):

```html
<link rel="stylesheet" href="styles.css">
<script src="_ds_bundle.js"></script>
```

```jsx
const { Button, Card, CardHeader, CardTitle, CardDescription, CardFooter } = window.PGLabsDesignSystem;
```

### Styling idiom: Tailwind utility classes, PGLabs' own palette

This design system has no CSS-in-JS and no runtime theme tokens — components take a `className`
prop and are styled with compiled Tailwind utility classes using PGLabs' custom scale. Compose
layouts and one-off spacing with these same classes rather than inline styles or ad-hoc hex
values, so anything you build sits on the same scale as the components themselves:

| Purpose | Classes |
|---|---|
| Brand colors | `bg-brand-orange`, `bg-brand-orange-hover`, `bg-brand-cream`, `bg-brand-dark-grey`, `bg-brand-dark-blue` (and `text-*`, `border-*` variants) |
| Accent colors | `bg-accent-blue`, `bg-accent-gold`, `bg-accent-purple` (and `text-*` variants) |
| Neutral text | `text-neutral-body`, `text-neutral-muted` |
| Semantic (shadcn-style) | `bg-background`, `bg-secondary`, `text-secondary-foreground`, `bg-muted`, `text-muted-foreground` |
| Display font (headings) | `font-display` (Space Grotesk) |
| Body font | `font-body` / `font-sans` (Inter) |
| Type scale | `text-h3` (18px/500), `text-body` (15px), `text-body-lg` (18px/300), `text-eyebrow` (13px), `text-label` (11px, letter-spacing 1.1px) |
| Radius | `rounded-sm` (6px) · `rounded` (8px, default) · `rounded-md` (12px) · `rounded-lg` (16px) · `rounded-full` |
| Shadow | `shadow-xs`, `shadow-sm`, `shadow-nav`, `shadow-glow-orange`, `shadow-glow-blue`, `shadow-glow-gold` |
| Nav blur | `backdrop-blur-nav` (8px) |

Component surface colors (card backgrounds, borders) use low-opacity utilities like `bg-white/5`,
`border-black/5`, `border-white/10` — follow that pattern rather than introducing new opacity
values when composing your own containers.

**One gotcha found while verifying previews**: a handful of stories (Card's dark variant, Badge's
dark variant, Button's ghost variant, Eyebrow's white variant) are only legible on a dark
background (`#2c3436`, PGLabs' `brand-dark-grey`) — when composing these variants into a design,
place them on a `bg-brand-dark-grey` (or equivalent dark) surface, the same way the reference designs do.

### Where the truth lives

- `styles.css` in this bundle — the actual compiled Tailwind output; every class above is real
  and verified against it. Read it directly if a class you need isn't listed here.
- `components/components/<Name>/<Name>.prompt.md` — per-component usage notes and variant JSX.
- `components/components/<Name>/<Name>.d.ts` — the exact prop types (variant/size/accent unions, etc).

### Example

```jsx
const { Eyebrow, Card, CardHeader, CardTitle, CardContent, CardDescription, CardFooter, Button } = window.PGLabsDesignSystem;

function FeatureCard() {
  return (
    <div className="bg-brand-cream p-8 rounded-lg">
      <Eyebrow variant="coral">What We Do</Eyebrow>
      <Card accent="orange" className="mt-4" style={{ width: 320 }}>
        <CardHeader>
          <CardTitle>Responsible AI Design</CardTitle>
        </CardHeader>
        <CardContent>
          <CardDescription>
            Embed ethical principles and accountability into every stage of AI system development.
          </CardDescription>
        </CardContent>
        <CardFooter>
          <Button variant="cta" size="sm">Learn More</Button>
        </CardFooter>
      </Card>
    </div>
  );
}
```
