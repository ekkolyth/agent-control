# Typography & Sizing Scale

One canonical text and spacing scale per project, shared across every surface
(web + mobile). The values below are a working default on a Tailwind theme —
where the project's design system publishes its own scale, that one wins and its
local rules name it. What doesn't vary: use the named scale, never invent a
value, and change the scale itself rather than working around it at a call
site.

## Text sizes

Use the Tailwind scale. Don't invent values (no `text-[13px]`, no
`text-[0.9rem]`).

| Class      | Use                                                          | Pixels      |
| ---------- | ------------------------------------------------------------ | ----------- |
| `text-xs`  | Pills / badges only                                          | 12 / 16     |
| `text-sm`  | Eyebrows above headings, secondary captions, timestamps      | 14 / 20     |
| `text-base`| **Body default.** Min size for any prose / row content       | 16 / 24     |
| `text-lg`  | Card titles, widget headers                                  | 18 / 28     |
| `text-2xl` | Page headlines, greeting hero                                | 24 / 32     |
| `text-3xl` | Marketing landing-page headlines only                        | 30 / 36     |
| `text-5xl` | Hero numerics (weather temp, big stat values)                | 48 / 1      |

`text-xs` is **never** used for body text. If a label is too small at `text-sm`,
hide it instead — don't shrink further.

## Weight

| Class              | Use                                       |
| ------------------ | ----------------------------------------- |
| `font-normal`      | Default body                              |
| `font-medium`      | Emphasis in lists, list-row titles        |
| `font-semibold`    | Card titles, headlines, big numerics      |

Weights are a short closed set — don't reach outside it. Where the ramp tops out
at `semibold`, `font-bold` is off the table; where the design system's own
headings use a bold weight, follow the system. Either way it's one decision, made
once, not per call site.

## Color tokens for text

- `text-foreground` — default
- `text-muted-foreground` — secondary, eyebrows, timestamps, descriptions
- `text-muted-foreground/70` — tertiary (rare)
- `text-primary` — links / CTAs

No hardcoded hex / RGB. These are the theme's token names — read the theme before assuming one exists. Color rules in `frontend/colors.md`.

## Card / Widget spacing

Card and list spacing lives in the primitive, not the call site. On a
shadcn-style card the defaults are:

- `py-5` outer vertical padding
- `gap-4` between CardHeader / CardContent / CardFooter
- `px-6` inside CardHeader / CardContent / CardFooter
- Border + rounded-xl from primitive

**Don't override these defaults at call sites.** If a card looks wrong, fix
the primitive once and propagate. The Widget primitive from the UI library
inherits these defaults — no per-widget className overrides.

## List rhythm

List rows inside a card (quests, activity, notes, etc.) use:

- `py-3` to `py-4` per row depending on content density
- `gap-3` between row internal elements (icon → text → meta)
- Divider via bare `border-t`, where global CSS sets a default border-color. No
  opacity modifiers, no restatement of the default token (see `tailwind.md` →
  Borders)
- First row no top border via `first:border-t-0`

## Headers within sections

Section labels that previously sat as a separate uppercase eyebrow above a
Widget are **redundant** — the Widget's own title carries the label. Drop the
outer eyebrow when wrapping content in a Widget.

```tsx
// ✅
<Widget title='Recent activity' href='/activity'>
    {items.map(...)}
</Widget>

// ❌
<section>
    <p className='text-sm uppercase ...'>Recent activity</p>
    <Widget title='Activity' href='/activity'>...</Widget>
</section>
```

## Page headlines

- One canonical page-title component, rendering the headline step plus
  `tracking-tight`. Don't hand-roll an `<h1>` beside it — pages have one title
  source.
- Hero-style greetings are the exception and set the headline step directly.

## Mobile parity

Mobile uses the same scale via NativeWind. Tailwind defaults transfer 1:1 —
`text-base` = 16px on iOS too. No mobile-specific scale exists.

## Forbidden patterns

1. `text-xs` on body content (paragraphs, list-row text, descriptions). Only
   pills, badges, very small chrome.
2. Bracket-pixel sizes (`text-[13px]`, `text-[1.0625rem]`). Use the named scale.
3. Off-scale fractional sizes (`text-[0.875rem]` — that's `text-sm`, just write
   `text-sm`).
4. A weight outside the project's ramp.
5. Eyebrow labels OUTSIDE Widget/Card chrome that duplicate the Widget's own
   title.
6. Per-callsite `className` overrides on `<Card>` / `<CardHeader>` for
   padding/gap. Fix the primitive once if defaults feel wrong.
