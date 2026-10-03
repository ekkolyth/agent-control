# UI / Design

- Minimal, calm UI.

## Text Colors

- Color comes from the design system's semantic text tokens — named for role (default/primary, muted/secondary, destructive), never for hue.
- On a shadcn-style Tailwind theme those are `text-foreground`, `text-muted-foreground`, `text-destructive`. They are the theme's utilities, not stock Tailwind: an unknown class emits no CSS and no error, so read the theme before assuming a token exists. Where the design system names them differently, use its names — the project's local rules pin them.
- The default token is fine — and often necessary — on standard elements (`div`, `span`, `p`, headings).
- Don't hardcode `text-white`, `text-black`, or raw hex/rgb values.
- Don't override the foreground on a component that already sets its own color (Button, Badge, and their equivalents) unless intentional.
