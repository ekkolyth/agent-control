# Logging

Every project has ONE shared logger module (both Go and JS sides) that
adopts these semantics. Callers acquire a scoped logger and emit at the
right level with a stable message + structured attrs.

## Two kinds of error

Everything below hangs off this split. Without it, "ERROR or INFO", "does
the user see this", and "does anyone get woken up" have no principled
answer, and each call site invents one.

- **Expected** — an outcome the code already knows how to describe:
  validation rejected the input, the record isn't there, permission was
  denied, the user cancelled, a request aborted because they navigated
  away. Nothing is broken. This is normal flow that happens to be
  disappointing.
- **Unexpected** — a defect or an outage: a null the type said was
  impossible, a dependency down, an invariant violated. Nobody planned
  for it and somebody has to look at it.

|                    | Expected                                | Unexpected                          |
|--------------------|-----------------------------------------|-------------------------------------|
| Level              | INFO, or not logged at all              | ERROR                               |
| Shown to the user  | a normal message saying what to do next | a failure, with an id they can quote |
| Wakes someone      | never                                   | yes, via the alerting path           |

Shape the code to match: return expected outcomes as values — `null`, a
result union, a typed sentinel — and throw or propagate the unexpected
ones. **Absence the caller should handle is a value; a violated
requirement is a throw.** An expected outcome raised as an exception
gets logged at the wrong level by whoever catches it, because by then
the information that it was expected is gone.

## Levels

Strict semantics:

| Level | When |
|---|---|
| DEBUG | Dev/ops investigation. Not enabled by default in prod (`LOG_LEVEL=info`); flip per container at runtime to investigate without a redeploy. |
| INFO | Normal operational flow — startup, shutdown, completed operations, request access, expected errors. |
| WARN | Recoverable anomaly. Operation continues. Examples: retry exhausted but caller has fallback, transient subsystem failure. |
| ERROR | Unexpected failure — the operation cannot continue, or data is at risk. |

Every ERROR must be actionable by someone. If nobody would act on it, it
is a WARN, or it is deleted. Without that clause the level drifts into a
louder INFO within a quarter, and then the one that mattered gets
scrolled past.

## Message style

- **Voice:** sterile, technical. Not casual, not playful.
- **Length:** terse — 2–4 words. All variable data goes in attrs, not the
  msg.
- **Casing:** lowercase, no period.
- **Tense:**
  - In-progress (slow ops only): imperative — `"connecting to db"`,
    `"loading config"`
  - Completed: past tense — `"connected to db"`, `"loaded config"`,
    `"watcher started"`
  - Failed: `"failed to <verb>"` — `"failed to connect to db"`,
    `"failed to load config"`
- **Structure:** stable msg string + structured attrs. Same operation
  always emits the same msg text. Variable parts (IDs, counts, durations)
  are attrs.

```ts
// ✅
log.info({ count: 12, duration_ms: 340 }, 'queue drained')

// ❌
log.info(`drained 12 items in 340ms`)
```

Examples here use the object-first signature (`log.info({ attrs }, 'msg')`);
adapt to whatever the project's logger takes. What matters is that the
variables arrive as structured fields rather than interpolated into the
message — a message you can't group on is a message you can't count.

## Start / completion logging

- Default: log only the completion (success or failure). Skip the start.
- Exception: operations that take >100ms (db migrations, cron sweeps,
  large fetches) should also log a start so dev/ops sees "in progress."

## Attribute keys

**One key convention, used by every service and every language in the
project.** A query written against one service's logs must work against
another's, so the casing is a project-wide decision, not a per-service one.
App-internal variables keep their language's normal style; the rule governs
only the key strings inside log calls.

**Choose the convention to match where the logs land.** If they reach an
OpenTelemetry-native backend, use OTel's semantic conventions — dot-namespaced
names like `http.response.status_code` and `service.name`, snake_case only
*within* a segment. Those names are what a managed backend's built-in queries,
dashboards, and alerts key off; invent your own and you forfeit all of it, then
pay a mapping layer to get it back.

Where nothing exports to such a backend, any stable convention works — flat
`snake_case` is a common choice. Pick once, record it in the project's own
rules, and don't mix. Adding an OTel export later means a mapping layer, so
it's worth knowing which case you're in before the first log line ships.

```ts
const queueSize = redis.queueSize                   // app code: its own style
log.info({ queue_size: queueSize }, 'queue drained') // log key: the project's convention
```

```go
slog.Info("queue drained", "queue_size", queueSize)
```

## Errors

- Always pass the full error object on the `error` key. Never `err`.
  Never just the message string. The message alone loses the type, the
  cause chain, and the stack — which is most of what you came for.
- **Redact it before it is emitted.** An error is not just a message: it
  routinely carries the request config it failed on, a headers bag with
  `Authorization` in it, a connection string with the password inline, or
  the failing statement with its bound parameters. "Pass the whole error"
  and "stack traces are harmless" are each defensible alone and a
  credential leak together. Configure the redaction once on the shared
  logger's error serializer — at the call site it is a discipline problem,
  and discipline loses.

```ts
// ✅
log.error({ error }, 'failed to fetch user')

// ❌
log.error({ err: error }, 'failed to fetch user')
log.error('failed to fetch user: ' + error.message)
```

```go
slog.Error("failed to fetch user", "error", err)
```

### Log + throw policy

| Situation | Log? |
|---|---|
| Catch + handle (don't rethrow) | Log at the catch site |
| Catch + rethrow | Don't log; caller will |
| Top-of-stack handler (HTTP middleware, ErrorBoundary, top-level main) | Always log — at the level the error's class dictates, not because catching it felt severe |

One entry per error, at the point where someone decided what to do about
it. The top-of-stack clause is what stops a rethrown error vanishing; the
class clause is what stops every expected 404 arriving as an ERROR.

## Service + Scope

Every line carries both, and the format places them consistently so a log
viewer can filter on either.

- **Service** — identifies the process. Set once at boot, one value per
  deployable.
- **Scope** — identifies the domain or feature within a service. Set
  per-logger, so a single process emits many scopes.
- **Format (both):** kebab-case. Single word when natural; hyphenate when
  multi-word.
- **Acquisition:** top-of-file singleton. Every module gets its own
  scoped logger; no reaching up for a global.
- **Child loggers:** use when (a) a chunk of code logs under a different
  scope label, or (b) shared context attrs (`request_id`, `user_id`)
  should propagate to multiple subsequent calls.

## Lifecycle (startup / shutdown)

- **Startup:** verbose. Each subsystem init logs at INFO (`db connected`,
  `redis connected`, `cron loaded N tasks`, `server listening port=<port>`).
  Helps diagnose boot stalls.
- **Shutdown:** quiet. Only log if cleanup errored.

## Recurring success — aggregate or sample, never suppress

Healthchecks, cron ticks, and poll loops should not emit one identical
line per iteration. The obvious fix — drop repeats of the same message
for a window — is the wrong one, and the reason is worth internalising:
**suppression destroys the data it drops.** Collapse 500 healthchecks to
one line and you have lost 499 durations, 499 statuses, and the count.
A loop that failed four hundred times now looks exactly like a loop that
ticked along quietly, so the mechanism hides the one case it was built
for. Absence that reads as success is the worst property an
observability tool can have.

Two mechanisms keep the signal:

- **Aggregate.** One line per window carrying `count`, `error_count`, and
  a duration summary (`min` / `p50` / `max`). Fewer lines than
  dedup-with-drops, and nothing is thrown away.
- **Sample.** Where individual lines genuinely matter, keep a fixed
  fraction and stamp `sample_rate` on every survivor, so true volume is
  reconstructable downstream. Sample routine successes only.

Before either, ask whether the line should exist. A healthcheck
heartbeat is a counter and a liveness gauge, not a log line — "is it
running, how often, how many failed" is a chart, and a log is a poor way
to build one. Log the transitions (started failing, recovered) and count
the rest. Same for cron ticks and poll loops.

Errors and slow responses are never aggregated away and never sampled
out.

## HTTP request logging

The shared logger's request middleware should log inbound requests with
attrs `method`, `path`, `status`, `size`, `duration_ms`, `request_id`,
`ip`, `user_agent`.

Level + volume decision:

| Condition                                                 | Level | Volume |
|-----------------------------------------------------------|-------|--------|
| `status >= 500`                                           | ERROR | every one |
| `400 <= status < 500`                                     | WARN  | every one |
| `status < 400` AND slower than the slow-request threshold | WARN  | every one |
| `status < 400` AND fast                                   | INFO  | sampled at a fixed rate, `sample_rate` stamped on each survivor |

Reasonable default for the slow-request threshold: 1s, configurable per
service.

Sampled, not deduped. An access log whose successful majority has been
collapsed can no longer answer requests-per-second or error rate — the
two questions it exists for. A known sample rate can be multiplied back
out; a suppression window cannot.

Slow 2xx, all 4xx, and all 5xx always emit.

## Cross-service correlation

Lead with W3C Trace Context. The `traceparent` header carries a
`trace_id`, the caller's `span_id`, and the sampling decision, and every
gateway, service mesh, and APM agent already speaks it. That is the whole
point: correlation only works if the components you didn't write join in,
and a bespoke header guarantees they won't.

- **Inbound:** middleware reads `traceparent`, starts a span, and binds
  `trace_id` + `span_id` to the request context. No header → start a new
  trace. Both ids go on every log line emitted under that context — that
  is what makes a log line clickable through to its trace, and the trace
  clickable back to its logs. Ids that nothing joins on are decoration.
- **Outbound:** the HTTP client injects the current `traceparent`,
  sampling flag included. Drop the flag and each service decides for
  itself, which yields half-populated traces that read as missing spans,
  i.e. as a bug.
- **Off the HTTP path:** a queued job, cron tick, or event handler
  carries the enqueuing context's `traceparent` so it lands as a child
  span rather than a fresh root. Minting a new id there breaks the chain
  exactly where reconstructing it by hand is hardest.

Where there is no tracing, propagate `X-Request-Id` the same way — read
inbound, generate if absent, echo on the response, inject outbound,
never overwrite an existing header. It still tells you which services
touched a request, just not which operation inside one. Note a UUID is
not a valid trace-id (16 bytes of hex, no dashes), so adopting tracing
later means a translation layer.

The goal is one query across the aggregated logs, or one click from a log
line to its trace. Grepping service by service is the fallback you're
trying to retire, not the destination.

## Outbound HTTP calls

Log every external call at INFO with `provider`, `url` (redact tokens),
`status`, `duration_ms`. Visibility on rate-limit + cost surfaces is worth
the noise.

Outbound calls are never aggregated away and never sampled out — every external
call must be visible.

## Retries / loops

One log entry per overall operation, attempts as an attr. No per-attempt
logs.

```ts
// after retry-with-backoff loop
log.info({ attempts: 3, duration_ms: 5400 }, 'fetched user')
log.error({ attempts: 3, error }, 'failed to fetch user')
```

## Audit / security events

Same logger, under a dedicated `audit` scope — however the project
acquires a scoped logger.

```ts
audit.info({ user_id, action: 'login', method: 'oauth' }, 'auth login')
audit.warn({ user_id, action: 'permission_denied', resource }, 'auth denied')
```

Filterable in any viewer as `scope=audit`, and splittable into a separate
compliance sink later without touching a single call site.

## Tests

Verbose by default — keep INFO. Helpful when a test fails. Rely on test
runners suppressing output for passing cases.

## Sensitive data — never log

Hard NO at INFO/WARN/ERROR levels:

- Passwords, API keys, OAuth / bearer / refresh tokens, session cookies,
  and decoded JWT payloads — the claims are PII even once the signature
  is gone
- `Authorization`, `Cookie`, and `Set-Cookie` header values, whole
- Request and response bodies — any endpoint, not only the auth ones. Any
  route can carry a password change, a card, or a diagnosis
- Inbound URLs with their query string. Reset links, signed URLs, and
  `?api_key=` land in access logs constantly; log the route template
  instead (`/users/:id`, not the raw path)
- Connection strings, and query parameters bound into a statement
- Payment data — PAN, CVV, IBAN
- Health data, government identifiers, precise geolocation, biometrics
- Full PII at INFO+: full email, full name, phone, postal address

OK to log:

- IP address (`ip`) — personal data in most jurisdictions, so it is fine
  to log and not fine to keep forever; it needs a retention limit
- Request / trace / span ids
- User ID (`user_id` — opaque identifier, no associated secret)
- Stack traces — frames and file paths are not secrets, *provided* the
  attached error fields have been redacted per the Errors section above
- Email / name etc. at DEBUG when investigating a specific issue. Note
  that DEBUG is flippable at runtime, so this makes one env var a change
  to the system's privacy posture — treat enabling it in production as a
  decision with an owner, not a convenience.

A list is only as good as everyone's memory of it. Make it structural:
redaction paths configured once on the shared logger, and secret-bearing
types that render as `[REDACTED]` wherever they are passed. Both
ecosystems support this; use it rather than relying on every author at
every call site, forever.

## Pretty vs JSON

Both modes are first-class — pretty for humans, JSON for ingestion. Resolve
the mode in this order, most explicit first:

1. An explicit option on the logger constructor
2. An env override, so a container can be flipped without a redeploy
3. A build-tool colour signal, where one is present
4. TTY auto-detect — TTY means pretty, a pipe means JSON

Never decide by `NODE_ENV`. The same binary should emit JSON in a container
and pretty in a terminal without rebuilding.

## Format

Whatever the format, it is **stable** — same shape every line, so a viewer can
parse it and a human can scan it. Service and scope appear on every line in a
fixed position in pretty mode, and as top-level fields in JSON mode, because
filtering by either is the most common thing anyone does with these logs.

The project's own logging rule carries the exact format and its API.
