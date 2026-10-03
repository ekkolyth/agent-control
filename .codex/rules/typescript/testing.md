# Testing

One test runner per repo, and every package uses it — the choice is the
project's, and everything below holds under any of them. Don't migrate a suite
between runners as a side effect of another task. Keep tests small, colocated,
and mock-free where possible.

## Test colocation

Tests live next to the source as `<name>.test.ts` (or `<name>.test.tsx`
for React). Integration suites that span multiple sources go in a
`tests/` folder next to the package.

## Shared helpers

Once a test-scaffold pattern repeats across 2+ files, extract it into a
project-shared test-utils module and consume from there. Redeclared
helpers per file drift silently over time; a shared module keeps one
authoritative shape.

Common concerns worth centralising:

- **Parity helpers** — `AssertEqual<A, B>` (invariant type equality),
  `StripIds<T>` (strip framework brand wrappers), for schema-vs-source
  parity tests. Prefer a single import over repeated `type A extends B`
  inline patterns.
- **Contract loading** — a `loadContract(dir, filename)` helper that
  reads a checked-in wire-format sample and returns `unknown` for the
  schema to parse. Avoid `readFileSync` + `path.resolve(__dirname, ...)`
  blocks scattered per test file.
- **Fetch stubbing** — a `mockFetch()` / `mockFetchSequence()` API that
  replaces `global.fetch`. Reset between tests. Avoid one-off
  `global.fetch = <spy returning a Response>` blocks scattered per file.

The exact package name, import paths, and directory layout for these
helpers live in the project's own local rules.

## Contract-first testing for wire formats

`contract-first.md` owns when a data model requires agreement and the complete
producer/consumer wire proof. This section applies that policy to TypeScript
tests; it does not make an inline-only model into a new contract.

Any code that reads bytes from a network boundary (an HTTP response, a
WebSocket message, a queued job payload) should be tested against a
checked-in sample of the real wire format, not against an inline
hand-authored object. The sample lives under `testdata/` (or a
project-conventional equivalent) next to the code that produces or
consumes it. The test loads the sample and feeds it through the schema
or parser.

This catches wire-format drift with a real bytes-in-file test, not an
inline `{ ... }` that the author kept in sync by hand.

**A stubbed transport is a wire boundary too.** The rule above is usually
read as applying to parser tests, so the case that slips through is the
consumer test that stubs `fetch` (or the queue client, or the socket) and
hand-writes the response body:

```ts
// ❌ the body is the consumer's assumption, asserted against itself
mockFetch({ status: 200, body: { user: { id: 'u_1', name: 'Ada' } } })

// ✅ the body is what the producer actually sends
mockFetch({ status: 200, body: loadContract('<dir>', 'get-user.json') })
```

Both versions pass. Only the second can fail when the producer changes.
A hand-written stub body encodes what the consumer *wishes* it received,
so the test goes green the moment the consumer is self-consistent —
including when the producer has never once sent that shape.

Where a stub body stands in for a response some other code in the repo
produces, it comes from the contract sample. Reserve hand-written bodies
for shapes nothing in the repo produces: a third-party payload with no
sample yet, or a deliberate malformed case.

## When NOT to reach for shared helpers

- **Stateful service tests** that need a real DB or HTTP server — those
  are integration tests, separate concern with their own lifecycle.
- **Writing / snapshotting** contracts — helpers like `loadContract`
  only READ; producing a contract is a different flow.

## Mocks

Prefer real dependencies over mocks for anything cheaper than a
network / DB. Type-only mocks (fake generics, inferred stubs) are fine.
Runtime module mocks (the runner's `mock`/`vi.mock`/`jest.mock` equivalent)
should be a last resort; they hide real integration bugs.
