# File Organization

## Filename casing

- **One casing convention per repo, never mixed.** Match what the surrounding files already do — a rename campaign costs more than the inconsistency it fixes, breaks every import, fights the lint config, and on a case-insensitive filesystem produces a git state that looks clean locally and fails on Linux CI.
- Default for a new repo, or where nothing is established: **kebab-case** — `recipe-card.tsx`, `use-bill.ts`, `api-proxy.ts`. Some ecosystems mandate otherwise (PascalCase component files, Angular's `.component.ts` / `.service.ts` suffixes); those win where they apply.
- Test files colocated next to source: `recipe-image.ts` + `recipe-image.test.ts`

## Domain subfolder rule

When grouping related files in `hooks/`, `lib/`, `components/`:

- Create a domain subfolder only when **2+ files** belong to that domain
- A single file stays at the parent root
- If a singleton later grows to 2+ files, move it into a new subfolder

Examples:
- `hooks/recipes/use-recipe.ts` + `hooks/recipes/use-recipes.ts` ✓ (2 files → folder)
- `hooks/use-chat.ts` (1 file → stays root, no `hooks/chat/` folder)

## Generic vs domain

- Domain-specific files go in subfolders (`hooks/budget/use-bill.ts`)
- Generic utilities stay at parent root (`hooks/use-mobile.ts`, `lib/utils.ts`, `lib/dayjs.ts`)
- "Generic" = not tied to a single business domain

## Types location

- Project-wide types live in one `types/` folder at the source root — `src/types/` where the project has a `src/`, otherwise beside the app root.
- Never put that folder inside a framework's route directory (Next.js `app/`, TanStack Start `src/routes/`) — those trees are scanned by the router.
- Types derived from a data layer alias the generated row type rather than restating its fields: `type Bill = Doc<'subscriptionEntries'>` on Convex, the ORM's inferred row elsewhere.

## Index/barrel files

- Avoid barrel `index.ts` files unless the subfolder is a published-style module that re-exports a deliberate surface. Default: import from the file path directly.

## TanStack Start parity

The conventions above (kebab-case filenames, domain subfolders, colocated tests) apply identically to TanStack Start projects operating in `src/routes/`.

**The colocation prefix differs, and getting it wrong creates a route.** Next.js uses `_components/` — its private-folder convention. TanStack Router does not: `_` is its *pathless layout route* prefix, so a `_components/` directory there becomes a routing construct rather than being ignored. Its ignore prefix is `-`, so colocated components go in `-components/`. Reach for the `/tanstack-start` skill before laying out a route folder.
