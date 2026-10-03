# Comment Style

Comments exist to add information the reader can't already see. If the name, type signature, file, or package already says it, the comment is noise.

The target is noise, not comments. A comment carrying something the code genuinely can't — why a workaround exists, which invariant a block relies on, what a non-obvious algorithm is doing, a unit or a bound that isn't in the type — earns its line and should be written. Delete the ones that restate the name; keep the ones that save the next reader a trip through three other files.

## Core Rules

### 1. Don't comment the obvious

If the function/type/variable name already tells you what it does, skip the comment entirely.

```go
// ❌
// getClaimKeys returns a slice of claim keys
func getClaimKeys() {}

// ✅ no comment needed
func getClaimKeys() {}
```

```typescript
// ❌
// formatDate formats a date into a readable string
const formatDate = (date: Date) => {};

// ✅ no comment needed
const formatDate = (date: Date) => {};
```

### 2. Never echo the name back

The comment must not repeat what the function/type/struct is already called. Strip out any words that appear in the name, receiver, file, or package — what's left is the comment. If nothing's left, you don't need a comment.

```go
// ❌ parrots the name and receiver
// GoogleHandler provides Google Books metadata lookup.
func (h *GoogleHandler) Search() {}

// ✅ the file is google.go, the type is GoogleHandler — just say what it does
// lookup metadata
func (h *GoogleHandler) Search() {}

// ❌ restates the function name
// GetListNames extracts list names from the overview endpoint.
func GetListNames() {}

// ✅ strip what the name already tells you
// from overview endpoint
func GetListNames() {}
```

```typescript
// ❌
// RecipeCard displays a recipe in card format
const RecipeCard = () => {};

// ✅ no comment needed — the name says it
const RecipeCard = () => {};
```

### 3. Strip context the reader already has

Don't restate: the language, the framework, the package name, the file name, the HTTP method, or the route path. The reader can see all of those.

```go
// ❌ "handles POST /api/playlists/:id/videos — adds a video to a playlist"
// ✅ no comment needed — AddVideo on PlaylistVideosHandler says it all
func (h *PlaylistVideosHandler) AddVideo() {}

// ❌ "retrieves SMTP configuration with ENV priority over database"
// ✅ ENV > DB priority
func GetSmtpConfig() {}
```

### 4. When you do comment, be the shortest useful phrase

Lowercase. No period. No "returns X". Just the thing the reader can't infer.

```go
// ENV or default
func GetUploadDir() {}

// memoized
var expensiveResult = sync.OnceValue(compute)
```

```typescript
// parse or return null
const parseOptionalDate = (dateStr?: string) => {};

// prevent re-renders on parent updates
export const ExpensiveList = React.memo(() => {});
```

### 5. Inline comments explain WHY, not WHAT

If a line of code needs a comment, it's because the intent isn't obvious from reading it. Describe the reason, not the operation.

```go
// ❌
// increment retry count
retries++

// ✅
retries++ // API is flaky under load, retry up to 3x
```

## Write like a maintainer

- Explain the product behavior or real-world constraint, not the control flow.
- Prefer language a product teammate would naturally use.
- Avoid implementation-state jargon such as "gate transitions", "owned path",
  "still-unmet", "released", and "satisfied user".
- Do not compress several implementation facts into a formal-sounding summary.

Casing and punctuation are unchanged — lowercase, no period, per rule 4.

```ts
// ❌ describes how the code classifies its own state
// redirect only when this gate transitions from blocked to satisfied

// ✅ describes why the user should experience this
// send newly activated users home, but leave later profile edits alone
```

```ts
// ❌ "still-unmet", "requirement", "reachable" — code-state vocabulary
// the screens that satisfy a still-unmet requirement stay reachable

// ✅
// let the user move through any setup flow they still need to finish
```

Comment on why the user should experience this behavior, not on how the code
classifies its state.

## A linter that mandates a doc-comment format wins

Some languages enforce a shape on doc comments for **exported** symbols, and the
tooling reads them. Go is the common case: a doc comment must begin with the
identifier's name, `go doc` and the package-docs site render it as a standalone
sentence, and `revive`'s `exported` rule (via `golangci-lint`) fails the build
without it.

Where such a linter is configured, its format wins — don't ship code that fails
CI to satisfy the style above. Comply in the cheapest way: keep the leading name,
cut everything the signature already says.

```go
// ❌ padded — "provides", "functionality", and the type name all restate the signature
// GoogleHandler provides Google Books metadata lookup functionality.

// ✅ starts with the name, adds only what the reader can't see
// Search queries Google Books, returning nil when the ISBN is unknown.
```

Unexported symbols, and every language without such a linter, follow the rules
above: shortest useful phrase, or nothing.

## Banned Patterns

These are noise. Never write them:

- `"[Name] contains/represents/provides/is a..."` — describing what a thing IS
- `"[Name] is a component/interface/struct that..."` — reader can see the keyword
- `"[Name] fetches/retrieves/returns X"` — restating the signature
- `"returns a X suitable for Y"` — nobody cares about the return type in prose
- `"helper/utility/convenience function"` — meaningless label
- `"handles METHOD /path"` — reader can see the route registration
- `"is called when..."` — describe what it does, not when it runs

## Bad → Good

```go
// ❌ SmtpConfig contains SMTP configuration with source metadata
// ✅ (no comment — the name says it)
type SmtpConfig struct {}

// ❌ GetSmtpConfig retrieves SMTP configuration with ENV priority over database
// ✅ ENV > DB priority
func GetSmtpConfig() {}

// ❌ AddVideo handles POST /api/playlists/:id/videos — adds a video to a playlist
// ✅ (no comment)
func (h *PlaylistVideosHandler) AddVideo() {}

// ❌ GoogleHandler provides Google Books metadata lookup
// ✅ (no comment — or just "lookup metadata" if Search isn't the only method)
type GoogleHandler struct {}
```

```typescript
// ❌ VideoCardProps is an interface that contains props for the VideoCard component
// ✅ (no comment)
interface VideoCardProps {}

// ❌ fetchVideos fetches all videos from the API and returns them as an array
// ✅ (no comment)
async function fetchVideos(): Promise<Video[]> {}

// ❌ handleClick handles the click event on the video card
// ✅ (no comment)
const handleClick = () => {};

// ❌ useVideoList manages video list state
// ✅ (no comment — it's a hook named useVideoList)
function useVideoList() {}
```
