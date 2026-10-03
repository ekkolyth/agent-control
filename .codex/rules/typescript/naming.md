# Naming Conventions

## Files

- Match the repo's existing filename casing — see `file-organization.md`. Where nothing is established, kebab-case: `bill-row.tsx`, `use-recipe.ts`
- Hooks are prefixed `use`, in whatever casing the repo uses: `use-bill.ts`, `use-recipe-video.ts`
- Test files: `<source>.test.ts(x)`
- Type-only files: domain name without suffix (`discord.ts`, not `discord-types.ts`)

## Identifiers

| Kind | Convention | Example |
|---|---|---|
| Component | PascalCase | `BillTable`, `RecipeCard` |
| Hook | camelCase, `use` prefix | `useBill`, `useRecipe` |
| Function | camelCase | `formatTimestamp`, `extractText` |
| Variable / prop | camelCase | `editingNote`, `isLoading` |
| Type / interface | PascalCase | `BillRowEntry`, `Recipe` |
| Constant | camelCase if local, UPPER_SNAKE if module-level config | `BILLING_CYCLE_LABELS` |
| Convex table id | matches table name | `Id<'subscriptionEntries'>` |

## No redundant suffixes / stuttering

- Context files: `context/notification.tsx` not `context/notification-context.tsx`
- Hook return shape: `quest.create()` not `quest.createQuest()`
- Type files: `types/discord.ts` exporting `DiscordUser` not `DiscordUserType`
- Component props live next to the component as `interface BillRowProps`, never `BillRowComponentProps`

## Hooks: noun-shaped remote control

See `typescript/hooks.md`. Summary:
- Hook returns an object that reads as the noun: `note.save(...)`, `bill.remove(...)`
- Verbs are short and generic: `create`, `update`, `remove`, `save` — never `createNote`, `removeMutation`
- Data keys match the domain: `bill.bills`, `note.notes` — not `bill.billData`. **Hooks backed by TanStack Query return `{ data }` — see `typescript/react-query.md`.**

## Domain-vs-implementation rename trap

If two unrelated subjects share a name (e.g. coffee `useSubscription` for product subscriptions vs budget `useSubscription` for bills):

- Rename the **less-domain-specific** one to its actual subject
- Backend table renames are separate work (data migration risk) — leave Convex table names alone, rename only the TS surface, and leave a TODO comment on the hook that consumes the old table

## TanStack Start parity

Naming conventions above apply identically inside `src/routes/` for TanStack Start projects. Route file names (`route.tsx`, `index.tsx`, `$param.tsx`, `$.tsx`) are the only exception — those filenames are framework-mandated.
