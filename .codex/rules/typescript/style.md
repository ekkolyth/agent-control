# TypeScript

- No `any` allowed, ever.
- On UI files, use the project's established component library and styling
  system — don't introduce a second alongside it. Where that's shadcn + Tailwind
  v4, follow `frontend/tailwind.md`.

## Class-merging helpers

Don't reach for a class-merging helper (`cn()`, `clsx`, `twMerge`) at a call site
where the component already merges its own classes. Every shadcn component does —
it takes `className` and merges it internally, so wrapping the argument in `cn()`
is a no-op that spreads by imitation until it's on every element in the tree.
Pass a plain `className=""` string.

Use one where classes genuinely have to be resolved: conditional classes, or an
override that conflicts with a class the component already emits. That is the job
`tailwind-merge` exists for — `px-2` and `px-4` in one string otherwise resolve by
stylesheet order rather than by intent, which is invisible in review.

## Exports

Prefer a single trailing `export { ... }` block at the bottom of the
file over inline `export` keywords scattered through declarations. The
export block IS the file's public surface; keeping it in one place makes
it a one-glance answer to "what does this file export?"

```ts
// ✅ trailing export block
function buildOpenApiDoc(): Record<string, unknown> { /* … */ }
function buildComponents(): Record<string, unknown> { /* … */ }
function buildPaths(): Record<string, Record<string, unknown>> { /* … */ }

export { buildOpenApiDoc }
```

```ts
// ❌ inline exports scattered through declarations
export function buildOpenApiDoc(): Record<string, unknown> { /* … */ }

function buildComponents(): Record<string, unknown> { /* … */ }

function buildPaths(): Record<string, Record<string, unknown>> { /* … */ }
```

**Exception — `export type` and `export interface`.** Inline is fine
because they carry no runtime weight and hoist reads to the surface at
the site of definition. Still fine to re-export them in the trailing
block if the file has a heavy public-type surface.

**Exception — one-symbol files.** A file that exports a single symbol
(a component, a hook, a schema) can inline the export — the trailing
block would just repeat the name. Once the file has 2+ exports OR any
non-exported helpers, switch to the trailing block.

**Exception — default exports.** Framework-driven defaults (route
components in TanStack Start, `page.tsx` / `layout.tsx` in Next.js App
Router) keep their `export default` inline as required by the framework.
