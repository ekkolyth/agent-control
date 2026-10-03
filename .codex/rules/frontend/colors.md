# Colors

Every project has ONE shared color-resolution module. Import from it; never
reimplement per-domain (no `resolveBudgetColor`, no `getQuestTint`).

**Scope: user-chosen and data-bound color** — a category that picks its own tint,
a chart series, an avatar fill. Static UI color stays on the design system's
semantic tokens (`frontend/style.md`); resolving those to hex at a call site
bypasses the theme's CSS variables and breaks dark mode.

## Source of truth

A single shared module exports:

- A canonical list of theme color names (`ThemeColor` type or equivalent).
- A `<name> → hex` map (a `colorPalette` or similar).
- A `resolveColorHex(color, fallback)` accepting name-or-hex and returning
  hex; falls back when input is missing or unknown.
- A `getContrastForeground(hex)` returning `#000000` or `#ffffff` for
  legible text over that background.

Naming and exact export shape live in the project's own local rules or
component library.

## Usage

Callers import the resolver, pass an explicit fallback, and use the
returned hex:

```tsx
const tint = resolveColorHex(group.color, colorPalette.emerald)
```

The fallback is explicit at the call site. No hidden
`DEFAULT_<DOMAIN>_COLOR` constants — pass a `colorPalette.<name>` lookup
inline.

## Storing color choices

For data-bound color picking (a category chooses its hex), store the
theme color name (`'emerald'`, `'rose'`, etc.) or a raw hex on the
document. `resolveColorHex` handles both.

## Borders

Border color discipline lives in `tailwind.md` → Borders. Prefer bare
`border` and reach for a promoted semantic token only when the semantic
distinction is real.

## Forbidden patterns

1. **Domain-specific color resolvers.** No `resolveBudgetColor`,
   `getQuestTint`, etc. The resolver is generic by design.
2. **Hardcoded hex tables that duplicate the palette.** If you need
   `#10b981`, write `colorPalette.emerald` (or whatever the palette calls
   the emerald slot).
3. **Hardcoded `DEFAULT_<X>_COLOR` constants buried in unrelated files.**
   Pass the fallback explicitly at the call site.
4. **Reading from ad-hoc chart palettes.** If you need an extra hue not in
   the canonical palette, justify it in code review — or extend the
   palette module upstream.
