# TanStack Query

Writing or reviewing `useQuery`, `useMutation`, `useInfiniteQuery`, a query key,
a cache setting, or an invalidation? Load the `tanstack-query` skill first — v5
removed the v4 call shape and renamed enough options that a remembered snippet
still compiles while doing something else.

## Hook return shape

A hook that wraps `useQuery` / `useMutation` returns the query result's
`{ data }` — not a domain-noun key like `budget.budgets`. This keys off TanStack
Query, not the framework: hooks under Start, Next.js, and Expo/mobile all return
`{ data }` alike, so `data`, `isPending`, `error`, and `refetch` read the same on
every query hook in the repo.

Domain-noun keys (`note.notes`, `bill.bills`) are for hooks that own their data
without TanStack Query underneath — see `typescript/hooks.md`.
