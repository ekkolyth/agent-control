> **Community default.** A project rule that explicitly supersedes this one takes precedence.

# Go Naming Conventions

Go favors short, readable names. Capitalization controls visibility — uppercase is exported, lowercase is unexported. All identifiers MUST use MixedCaps, NEVER underscores.

**Name length scales with scope.** A one- or two-letter name is only acceptable
where the declaration and every use are within a few lines of each other — a loop
index (`i`), a method receiver (`s *Server`), a short-lived local. Everything with
real scope earns a full word: prefer `process` or `proc` over `p`, `event` over
`e`, a package-level identifier over any abbreviation of it. A function or a
package-level variable never gets a one- or two-letter name.

One name has an established spelling that overrides the above: a
`context.Context` is always `ctx`, never `c`.

> "Clear is better than clever." — Go Proverbs
>
> "Design the architecture, name the components, document the details." — Go Proverbs

## Quick Reference

| Element | Convention | Example |
| --- | --- | --- |
| Package | lowercase, single word | `json`, `http`, `tabwriter` |
| File | lowercase, underscores OK | `user_handler.go` |
| Exported name | UpperCamelCase | `ReadAll`, `HTTPClient` |
| Unexported | lowerCamelCase | `parseToken`, `userCount` |
| Interface | method name + `-er` | `Reader`, `Closer`, `Stringer` |
| Struct | MixedCaps noun | `Request`, `FileHeader` |
| Constant | MixedCaps (not ALL_CAPS) | `MaxRetries`, `defaultTimeout` |
| Receiver | 1-2 letter abbreviation | `func (s *Server)`, `func (b *Buffer)` |
| Error variable | `Err` prefix | `ErrNotFound`, `ErrTimeout` |
| Error type | `Error` suffix | `PathError`, `SyntaxError` |
| Constructor | `New` (single type) or `NewTypeName` (multi-type) | `ring.New`, `http.NewRequest` |
| Boolean | `Is`/`Has`/`Can` on **methods**; same shape by default on fields | `IsConnected()`, `isReady` |
| Test function | `Test` + function name | `TestParseToken` |
| Acronym | all caps or all lower | `URL`, `HTTPServer`, `xmlParser` |
| Variant: context | `WithContext` suffix | `FetchWithContext`, `QueryContext` |
| Variant: in-place | `In` suffix | `SortIn()`, `ReverseIn()` |
| Variant: error | `Must` prefix | `MustParse()`, `MustLoadConfig()` |
| Option func | `With` + field name | `WithPort()`, `WithLogger()` |
| Enum (iota) | type name prefix, zero-value = unknown | `StatusUnknown` at 0, `StatusReady` |
| Named return | descriptive, for docs only | `(n int, err error)` |
| Error string | lowercase (incl. acronyms), no punctuation | `"image: unknown format"`, `"invalid id"` |
| Import alias | short, only on collision | `mrand "math/rand"`, `pb "app/proto"` |
| Format func | `f` suffix | `Errorf`, `Wrapf`, `Logf` |
| Test table fields | `got`/`expected` prefixes | `input string`, `expected int` |

## MixedCaps

All Go identifiers MUST use `MixedCaps` (or `mixedCaps`). NEVER use underscores in identifiers — the only exceptions are test function subcases (`TestFoo_InvalidInput`), generated code, and OS/cgo interop. This is load-bearing, not cosmetic — Go's export mechanism relies on capitalization, and tooling assumes MixedCaps throughout.

```go
// ✓ Good
MaxPacketSize
userCount
parseHTTPResponse

// ✗ Bad — these conventions conflict with Go's export mechanism and tooling expectations
MAX_PACKET_SIZE   // C/Python style
max_packet_size   // snake_case
kMaxBufferSize    // Hungarian notation
```

## Avoid Stuttering

Go call sites always include the package name, so repeating it in the identifier wastes the reader's time — `http.HTTPClient` forces parsing "HTTP" twice. A name MUST NOT repeat information already present in the package name, type name, or surrounding context.

```go
// Good — clean at the call site
http.Client       // not http.HTTPClient
json.Decoder      // not json.JSONDecoder
user.New()        // not user.NewUser()
config.Parse()    // not config.ParseConfig()

// In package sqldb:
type Connection struct{}  // not DBConnection — "db" is already in the package name

// Anti-stutter applies to ALL exported types, not just the primary struct:
// In package dbpool:
type Pool struct{}        // not DBPool
type Status struct{}      // not PoolStatus — callers write dbpool.Status
type Option func(*Pool)   // not PoolOption
```

## Frequently Missed Conventions

These conventions are correct but non-obvious — they are the most common source of naming mistakes:

**Constructor naming:** When a package exports a single primary type, the constructor is `New()`, not `NewTypeName()`. This avoids stuttering — callers write `apiclient.New()` not `apiclient.NewClient()`. Use `NewTypeName()` only when a package has multiple constructible types (like `http.NewRequest`, `http.NewServeMux`).

**Boolean predicates:** a boolean *method* MUST carry an `Is`/`Has`/`Can` prefix — `IsConnected() bool`, not `Connected() bool`. Boolean *fields* should follow the same shape by default (`isConnected`, `hasPermission` over bare `connected`), so the field reads as a question; the stdlib is not consistent here (`tls.Config.InsecureSkipVerify`), so match the surrounding struct where one already has a convention.

**Error strings are fully lowercase — including acronyms.** Write `"invalid message id"` not `"invalid message ID"`, because error strings are often concatenated with other context (`fmt.Errorf("parsing token: %w", err)`) and mixed case looks wrong mid-sentence. Sentinel errors should include the package name as prefix: `errors.New("apiclient: not found")`.

**Enum zero values:** Always place an explicit `Unknown`/`Invalid` sentinel at iota position 0. A `var s Status` silently becomes 0 — if that maps to a real state like `StatusReady`, code can behave as if a status was deliberately chosen when it wasn't.

**Subtest names:** Table-driven test case names in `t.Run()` should be fully lowercase descriptive phrases: `"valid id"`, `"empty input"` — not `"valid ID"` or `"Valid Input"`.

## Common Mistakes

| Mistake | Fix |
| --- | --- |
| `GetName()` getter | Go omits `Get` because `user.Name()` reads naturally at call sites. But `Is`/`Has`/`Can` prefixes are kept for boolean predicates: `IsHealthy() bool` not `Healthy() bool` |
| `this` or `self` receiver | Go methods are called frequently — use 1-2 letter abbreviation (`s` for `Server`) to reduce visual noise |
| `util`, `helper` packages | These names say nothing about content — use specific names that describe the abstraction |
| `userSlice` type-in-name | Types encode implementation detail — `users` describes what it holds, not how |
| Inconsistent receiver names | Switching names across methods of the same type confuses readers — use one name consistently |
| Naming constants by value | Values change, roles don't — `DefaultPort` survives a port change, `Port8080` doesn't |
| Inconsistent concept names | Using `user`/`account`/`person` for the same concept forces readers to track synonyms — pick one name |

## Enforce with Linters

Many naming convention issues are caught automatically: `revive`, `predeclared`, `misspell`, and `errname`, all runnable under `golangci-lint`. Where the repo configures them, the linter's verdict wins over anything here.
