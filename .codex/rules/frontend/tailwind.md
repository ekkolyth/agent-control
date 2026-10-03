# Tailwind

This project styles with Tailwind. Load the `tailwind` skill before writing or
editing `className` strings, before choosing a spacing or text size, and before
touching a `@theme` block — it carries the v4 utility names, the scale, and the
border and dark-mode rules. Several v3 names still emit **nothing** in v4 rather
than erroring, so guessing a class silently drops the style.
