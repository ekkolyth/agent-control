# Boundary Parsing

Data crossing into the app from outside TypeScript's type system gets parsed
and validated before it is used. The compiler's guarantee stops at the
boundary — past it, an unchecked value is an assertion the rest of the code
believes without evidence.

Three categories are worth naming, because they're the ones that get missed:

- **External HTTP responses** — any `fetch`, SSE / WebSocket `event.data`, XHR
  `responseText`, and internal route-handler responses consumed by `fetch`.
- **User-supplied data** — JSON imports, paste, file uploads, clipboard reads,
  `localStorage` / `sessionStorage` reads.
- **URL params / searchParams where they affect logic** — anything beyond
  direct display.

Framework-typed sources are exempt: a typed query hook, an RPC procedure, or an
ORM query result is already validated at the source.

## Report the failure, don't swallow it

A parse failure goes through the project's error-surfacing convention. The
parse error carries the path and the mismatch, which is the whole value when a
wire format drifts — a bare `return` on failure turns a schema change into a
blank screen with nothing to grep for.

## No `as`-cast on a parsed result

An `as`-cast asserts a shape instead of checking it, which is exactly what the
boundary exists to prevent. Banned:

- `(await response.json()) as Shape`
- `JSON.parse(text) as Shape`
- `JSON.parse(event.data) as Shape`
- `JSON.parse(xhr.responseText) as Shape`
- `localStorage.getItem(...) as Shape` (after parsing the string)
- WebSocket `message.data as Shape`

Still legal, so nobody re-litigates them:

- DOM event narrowing: `(event.target as HTMLInputElement).value`.
- Framework-typed narrowing where the upstream contract guarantees it — a
  branded row id from an ORM or backend client, for instance.
- React state defaults taken from upstream-typed values.
- Chart / library config object literals (`as ChartConfig`).
- `Promise<T>` narrowing on framework mutation refs.

Which validation library does the parsing, where schemas live, and how they are
named are the project's own calls — its local rules name them.
